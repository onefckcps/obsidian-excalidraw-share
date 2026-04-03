import { Notice, Platform } from 'obsidian';
import {
  styles,
  ICONS,
  STATUS_COLORS,
  TOOLBAR_CLASS,
  applyStyles,
  getPositionStyles,
} from './styles';
import type { ToolbarPosition } from './styles';
import type { CollaboratorInfo } from './collabTypes';
import { getCollaboratorColor } from './collabTypes';

export type ToolbarStatus = 'unpublished' | 'published' | 'syncing' | 'collabActive' | 'error';

export interface ToolbarState {
  status: ToolbarStatus;
  publishedId: string | null;
  collabSessionId: string | null;
  collabDrawingId: string | null;
  hasApiKey: boolean;
  /** Whether the drawing is password-protected */
  passwordProtected?: boolean;
  /** Number of participants in the active collab session (including self) */
  collabParticipantCount?: number;
  /** Whether the host is natively connected to the collab session from Obsidian */
  collabNativeJoined?: boolean;
  /** List of collaborators in the active session */
  collabCollaborators?: CollaboratorInfo[];
  /** The user ID currently being followed (null if not following) */
  collabFollowingUserId?: string | null;
  /** The display name of the local user (to identify self in the list) */
  collabDisplayName?: string;
  /** Whether persistent collab is enabled for this drawing */
  persistentCollabEnabled?: boolean;
}

export interface ToolbarCallbacks {
  onPublish: () => Promise<void>;
  onSync: () => Promise<void>;
  onCopyLink: () => void;
  onPull: () => Promise<void>;
  onStartCollab: () => Promise<void>;
  onStopCollab: () => Promise<void>;
  onOpenInBrowser: () => void;
  onUnpublish: () => Promise<void>;
  onOpenSettings: () => void;
  /** Start following a collaborator's viewport */
  onStartFollowing?: (userId: string) => void;
  /** Stop following the current collaborator */
  onStopFollowing?: () => void;
  /** Enable persistent collab for the current drawing */
  onEnablePersistentCollab: () => Promise<void>;
  /** Disable persistent collab for the current drawing */
  onDisablePersistentCollab: () => Promise<void>;
}

// ── Selectors for finding Excalidraw's native toolbar ──
const TOOLBAR_SELECTORS = {
  /** Desktop/tablet: upper toolbar container (>987px Excalidraw breakpoint) */
  topBar: '.App-toolbar-container',
  /** Mobile: bottom toolbar content (≤987px Excalidraw breakpoint) */
  bottomBar: '.App-toolbar-content',
  /** Alternative: the top bar wrapper */
  appTopBar: '.App-top-bar',
  /** Fallback: plugins container */
  pluginsContainer: '.plugins-container',
};

/**
 * ExcaliShare toolbar that can operate in two modes:
 *
 * 1. **Auto mode** (`position === 'auto'`): Injects a small icon into Excalidraw's
 *    native toolbar (as an Island element). Clicking opens a popover panel.
 *    Falls back to floating mode if the native toolbar is not found.
 *
 * 2. **Floating mode** (`position !== 'auto'`): Absolutely positioned overlay
 *    at a configurable corner of the Excalidraw view. Original behavior.
 */
export class ExcaliShareToolbar {
  private containerEl: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;
  private expanded = false;
  private state: ToolbarState;
  private callbacks: ToolbarCallbacks;
  private position: ToolbarPosition;
  private startCollapsed: boolean;
  private loading = false;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  // DOM references for updates
  private statusDotEl: HTMLElement | null = null;
  private expandedPanelEl: HTMLElement | null = null;
  private collapsedBtnEl: HTMLElement | null = null;

  // Auto mode specific
  private injectionMode: 'auto-injected' | 'floating' = 'floating';
  private nativeToolbarObserver: MutationObserver | null = null;
  private popoverBackdropEl: HTMLElement | null = null;
  private islandBtnEl: HTMLElement | null = null;

  constructor(
    callbacks: ToolbarCallbacks,
    position: ToolbarPosition = 'auto',
    startCollapsed = true,
  ) {
    this.callbacks = callbacks;
    this.position = position;
    this.startCollapsed = startCollapsed;
    this.state = {
      status: 'unpublished',
      publishedId: null,
      collabSessionId: null,
      collabDrawingId: null,
      hasApiKey: false,
    };
  }

  /**
   * Inject the toolbar into the given container element (Excalidraw view).
   * In auto mode, tries to find and inject into the native Excalidraw toolbar.
   * Falls back to floating mode if not found.
   */
  inject(containerEl: HTMLElement): void {
    this.remove(); // Clean up any existing toolbar
    this.containerEl = containerEl;
    this.expanded = !this.startCollapsed;

    if (this.position === 'auto') {
      this.tryAutoInject();
    } else {
      this.injectFloating();
    }
  }

  /**
   * Remove the toolbar from the DOM.
   */
  remove(): void {
    if (this.rootEl && this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
    this.rootEl = null;
    this.containerEl = null;
    this.statusDotEl = null;
    this.expandedPanelEl = null;
    this.collapsedBtnEl = null;
    this.islandBtnEl = null;
    this.removeClickOutsideListener();
    this.removePopoverBackdrop();
    if (this.nativeToolbarObserver) {
      this.nativeToolbarObserver.disconnect();
      this.nativeToolbarObserver = null;
    }
    this.injectionMode = 'floating';
  }

  /**
   * Update the toolbar state and re-render the content.
   */
  updateState(newState: Partial<ToolbarState>): void {
    this.state = { ...this.state, ...newState };
    this.updateContent();
  }

  /**
   * Update the toolbar position.
   * Only re-injects if the position actually changed.
   */
  setPosition(position: ToolbarPosition): void {
    if (this.position === position) return; // No change
    this.position = position;
    // Re-inject with new position
    if (this.containerEl) {
      this.inject(this.containerEl);
    }
  }

  /**
   * Check if the toolbar is currently injected.
   */
  isInjected(): boolean {
    return this.rootEl !== null && this.rootEl.parentElement !== null;
  }

  // ══════════════════════════════════════════════
  // AUTO MODE: Inject into native Excalidraw toolbar
  // ══════════════════════════════════════════════

  private tryAutoInject(): void {
    if (!this.containerEl) return;

    // Try to find the native toolbar
    const nativeToolbar = this.findNativeToolbar();
    if (nativeToolbar) {
      this.injectIntoNativeToolbar(nativeToolbar);
      return;
    }

    // Native toolbar not yet in DOM — set up observer to wait for it
    // Meanwhile, inject as floating as a temporary fallback
    this.injectFloating();

    this.nativeToolbarObserver = new MutationObserver(() => {
      const toolbar = this.findNativeToolbar();
      if (toolbar) {
        this.nativeToolbarObserver?.disconnect();
        this.nativeToolbarObserver = null;

        // Remove floating toolbar and re-inject into native
        if (this.rootEl && this.rootEl.parentElement) {
          this.rootEl.parentElement.removeChild(this.rootEl);
        }
        this.rootEl = null;
        this.statusDotEl = null;
        this.expandedPanelEl = null;
        this.collapsedBtnEl = null;
        this.removeClickOutsideListener();

        this.injectIntoNativeToolbar(toolbar);
      }
    });

    this.nativeToolbarObserver.observe(this.containerEl, {
      childList: true,
      subtree: true,
    });

    // Timeout: if native toolbar never appears, keep floating
    setTimeout(() => {
      if (this.nativeToolbarObserver) {
        this.nativeToolbarObserver.disconnect();
        this.nativeToolbarObserver = null;
      }
    }, 15000);
  }

  /**
   * Find the native Excalidraw toolbar within the container.
   * Tries multiple selectors for compatibility with different versions.
   */
  private findNativeToolbar(): HTMLElement | null {
    if (!this.containerEl) return null;

    // Try the main toolbar container first (desktop/tablet)
    for (const selector of [
      TOOLBAR_SELECTORS.topBar,
      TOOLBAR_SELECTORS.bottomBar,
      TOOLBAR_SELECTORS.appTopBar,
    ]) {
      const el = this.containerEl.querySelector<HTMLElement>(selector);
      if (el) return el;
    }

    return null;
  }

  /**
   * Inject the ExcaliShare button into the native Excalidraw toolbar.
   * Creates an Island-style element that matches Excalidraw's native look.
   */
  private injectIntoNativeToolbar(toolbar: HTMLElement): void {
    this.injectionMode = 'auto-injected';

    // Create the Island wrapper (matches Excalidraw's .Island class)
    this.rootEl = document.createElement('div');
    this.rootEl.className = `Island ${TOOLBAR_CLASS}`;
    applyStyles(this.rootEl, styles.autoContainer);
    this.rootEl.style.marginLeft = '4px';
    this.rootEl.style.alignSelf = 'center';
    this.rootEl.style.height = 'fit-content';
    this.rootEl.style.padding = '2px';
    this.rootEl.style.display = 'flex';
    this.rootEl.style.alignItems = 'center';

    // Create the island button
    this.renderIslandButton();

    toolbar.appendChild(this.rootEl);
  }

  /**
   * Render the small icon button for auto mode (inside the Island).
   */
  private renderIslandButton(): void {
    if (!this.rootEl) return;

    // Remove existing button content (but keep rootEl)
    const existingBtn = this.rootEl.querySelector('.excalishare-island-btn');
    if (existingBtn) existingBtn.remove();

    const btn = document.createElement('button');
    btn.className = 'excalishare-island-btn';
    applyStyles(btn, styles.islandButton);
    btn.innerHTML = ICONS.cloud;
    btn.setAttribute('aria-label', 'ExcaliShare');
    btn.title = 'ExcaliShare — Click to open';

    // Status dot
    this.statusDotEl = document.createElement('div');
    applyStyles(this.statusDotEl, styles.islandStatusDot);
    this.updateStatusDot();
    btn.appendChild(this.statusDotEl);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.expanded) {
        this.collapseAuto();
      } else {
        this.expandAuto();
      }
    });

    this.islandBtnEl = btn;
    this.rootEl.appendChild(btn);
  }

  /**
   * Expand: show the popover panel below the island button.
   */
  private expandAuto(): void {
    this.expanded = true;

    if (!this.rootEl) return;

    // Remove any existing popover
    this.removePopover();

    const isMobile = Platform.isMobile || Platform.isMobileApp;

    if (isMobile) {
      this.renderMobilePopover();
    } else {
      this.renderDesktopPopover();
    }
  }

  /**
   * Desktop popover: positioned below the island button.
   */
  private renderDesktopPopover(): void {
    if (!this.rootEl) return;

    const panel = document.createElement('div');
    panel.className = 'excalishare-toolbar-expanded excalishare-popover';
    applyStyles(panel, styles.popoverPanel);
    panel.style.animation = 'excalishare-fade-in 0.2s ease';

    this.expandedPanelEl = panel;
    this.buildExpandedContent(panel);

    // Position relative to rootEl (the Island)
    this.rootEl.appendChild(panel);
    this.addClickOutsideListener();
  }

  /**
   * Mobile popover: bottom sheet style.
   */
  private renderMobilePopover(): void {
    // Create backdrop
    this.popoverBackdropEl = document.createElement('div');
    this.popoverBackdropEl.className = 'excalishare-popover-backdrop';
    this.popoverBackdropEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapseAuto();
    });
    document.body.appendChild(this.popoverBackdropEl);

    // Create bottom sheet panel
    const panel = document.createElement('div');
    panel.className = 'excalishare-toolbar-expanded excalishare-popover excalishare-mobile-popover';
    applyStyles(panel, styles.mobilePopoverPanel);

    // Drag handle
    const handle = document.createElement('div');
    handle.style.cssText = `
      width: 36px; height: 4px; border-radius: 2px;
      background: var(--text-faint); margin: 8px auto 4px;
    `;
    panel.appendChild(handle);

    this.expandedPanelEl = panel;
    this.buildExpandedContent(panel);

    document.body.appendChild(panel);
  }

  /**
   * Collapse the auto-mode popover.
   */
  private collapseAuto(): void {
    this.expanded = false;
    this.removePopover();
    this.removeClickOutsideListener();
  }

  /**
   * Remove the popover panel (both desktop and mobile).
   */
  private removePopover(): void {
    // Remove desktop popover (child of rootEl)
    if (this.rootEl) {
      const popover = this.rootEl.querySelector('.excalishare-popover');
      if (popover) popover.remove();
    }

    // Remove mobile popover (child of document.body)
    const mobilePopover = document.querySelector('.excalishare-mobile-popover');
    if (mobilePopover) mobilePopover.remove();

    this.removePopoverBackdrop();
    this.expandedPanelEl = null;
  }

  private removePopoverBackdrop(): void {
    if (this.popoverBackdropEl) {
      this.popoverBackdropEl.remove();
      this.popoverBackdropEl = null;
    }
    // Also clean up any orphaned backdrops
    document.querySelectorAll('.excalishare-popover-backdrop').forEach(el => el.remove());
  }

  // ══════════════════════════════════════════════
  // FLOATING MODE: Original absolute-positioned overlay
  // ══════════════════════════════════════════════

  private injectFloating(): void {
    if (!this.containerEl) return;
    this.injectionMode = 'floating';

    // Ensure the container has relative positioning for absolute children
    const containerPosition = getComputedStyle(this.containerEl).position;
    if (containerPosition === 'static' || containerPosition === '') {
      this.containerEl.style.position = 'relative';
    }

    // Create root element
    this.rootEl = document.createElement('div');
    this.rootEl.className = TOOLBAR_CLASS;
    applyStyles(this.rootEl, styles.container);
    const posStyles = getPositionStyles(this.position === 'auto' ? 'top-right' : this.position);
    applyStyles(this.rootEl, posStyles);

    if (this.expanded) {
      this.renderExpanded();
    } else {
      this.renderCollapsed();
    }

    this.containerEl.appendChild(this.rootEl);
  }

  private renderCollapsed(): void {
    if (!this.rootEl) return;
    this.rootEl.empty();

    const btn = document.createElement('div');
    btn.className = 'excalishare-toolbar-collapsed';
    applyStyles(btn, styles.collapsedButton);
    btn.innerHTML = ICONS.cloud;
    btn.setAttribute('aria-label', 'ExcaliShare');
    btn.title = 'ExcaliShare — Click to expand';

    // Status dot
    this.statusDotEl = document.createElement('div');
    applyStyles(this.statusDotEl, styles.statusDot);
    this.updateStatusDot();
    btn.appendChild(this.statusDotEl);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expand();
    });

    this.collapsedBtnEl = btn;
    this.rootEl.appendChild(btn);
    this.removeClickOutsideListener();
  }

  private renderExpanded(): void {
    if (!this.rootEl) return;
    this.rootEl.empty();

    const panel = document.createElement('div');
    panel.className = 'excalishare-toolbar-expanded';
    applyStyles(panel, styles.expandedPanel);
    panel.style.animation = 'excalishare-fade-in 0.2s ease';

    this.expandedPanelEl = panel;
    this.buildExpandedContent(panel);

    this.rootEl.appendChild(panel);
    this.addClickOutsideListener();
  }

  // ══════════════════════════════════════════════
  // SHARED: Content building (used by both modes)
  // ══════════════════════════════════════════════

  private buildExpandedContent(panel: HTMLElement): void {
    panel.empty();

    // ── Header ──
    const header = document.createElement('div');
    applyStyles(header, styles.header);

    const headerIcon = document.createElement('span');
    headerIcon.innerHTML = ICONS.cloud;
    headerIcon.style.display = 'flex';
    headerIcon.style.alignItems = 'center';
    header.appendChild(headerIcon);

    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'ExcaliShare';
    header.appendChild(headerTitle);

    // Status badge
    const badge = document.createElement('span');
    applyStyles(badge, styles.headerBadge);
    this.applyStatusBadge(badge);
    header.appendChild(badge);

    panel.appendChild(header);

    // ── Actions ──
    if (!this.state.hasApiKey) {
      // Setup prompt
      const prompt = document.createElement('div');
      applyStyles(prompt, styles.setupPrompt);
      prompt.innerHTML = '⚙️ API key not configured.<br>Click below to set up.';
      panel.appendChild(prompt);

      panel.appendChild(this.createActionButton(
        ICONS.settings,
        'Open Settings',
        () => this.callbacks.onOpenSettings(),
      ));
    } else if (!this.state.publishedId) {
      // Not published — show publish button
      panel.appendChild(this.createActionButton(
        ICONS.upload,
        'Publish Drawing',
        () => this.wrapAsync(this.callbacks.onPublish),
      ));
    } else {
      // Published — show all actions
      panel.appendChild(this.createActionButton(
        ICONS.sync,
        'Sync to Server',
        () => this.wrapAsync(this.callbacks.onSync),
      ));

      panel.appendChild(this.createActionButton(
        ICONS.link,
        'Copy Share Link',
        () => {
          this.callbacks.onCopyLink();
          this.flashSuccess('Link copied!');
        },
      ));

      panel.appendChild(this.createActionButton(
        ICONS.download,
        'Pull from Server',
        () => this.wrapAsync(this.callbacks.onPull),
      ));

      // Separator before collab
      const sep1 = document.createElement('div');
      applyStyles(sep1, styles.separator);
      panel.appendChild(sep1);

      // Collab actions
      const hasActiveSessionForThisDrawing = this.state.collabSessionId && this.state.collabDrawingId === this.state.publishedId;
      if (hasActiveSessionForThisDrawing) {
        // Show participant count header
        const count = this.state.collabParticipantCount;
        const nativeJoined = this.state.collabNativeJoined;
        if (count !== undefined && count > 0) {
          const countLabel = document.createElement('div');
          countLabel.style.padding = '4px 8px';
          countLabel.style.fontSize = '11px';
          countLabel.style.color = 'var(--text-muted)';
          countLabel.style.textAlign = 'center';
          countLabel.style.display = 'flex';
          countLabel.style.alignItems = 'center';
          countLabel.style.justifyContent = 'center';
          countLabel.style.gap = '4px';
          const dotSpan = document.createElement('span');
          dotSpan.style.display = 'inline-block';
          dotSpan.style.width = '6px';
          dotSpan.style.height = '6px';
          dotSpan.style.borderRadius = '50%';
          dotSpan.style.backgroundColor = nativeJoined ? '#4CAF50' : '#FF6B6B';
          dotSpan.style.animation = 'excalishare-pulse 2s ease-in-out infinite';
          countLabel.appendChild(dotSpan);
          countLabel.appendChild(document.createTextNode(
            `${count} participant${count !== 1 ? 's' : ''}${nativeJoined ? ' • Connected' : ''}`
          ));
          panel.appendChild(countLabel);
        }

        // ── Collaborator list with follow buttons ──
        if (nativeJoined && this.state.collabCollaborators && this.state.collabCollaborators.length > 0) {
          this.buildCollaboratorList(panel);
        }

        panel.appendChild(this.createActionButton(
          ICONS.stopCircle,
          'Stop Live Collab',
          () => this.wrapAsync(this.callbacks.onStopCollab),
          true, // danger style for the icon
        ));

        panel.appendChild(this.createActionButton(
          ICONS.externalLink,
          'Open in Browser',
          () => this.callbacks.onOpenInBrowser(),
        ));
      } else {
        // No active session for this drawing — show Start button
        // (even if another drawing has an active session; the callback handles the guard)
        panel.appendChild(this.createActionButton(
          ICONS.users,
          'Start Live Collab',
          () => this.wrapAsync(this.callbacks.onStartCollab),
        ));
      }

      // ── Persistent Collab section ──
      if (this.state.persistentCollabEnabled) {
        // Show "Persistent Collab Active" indicator + Disable button
        const persistentRow = document.createElement('div');
        persistentRow.style.padding = '4px 8px';
        persistentRow.style.fontSize = '11px';
        persistentRow.style.color = 'var(--text-muted)';
        persistentRow.style.textAlign = 'center';
        persistentRow.style.display = 'flex';
        persistentRow.style.alignItems = 'center';
        persistentRow.style.justifyContent = 'center';
        persistentRow.style.gap = '4px';

        const persistentDot = document.createElement('span');
        persistentDot.style.display = 'inline-block';
        persistentDot.style.width = '6px';
        persistentDot.style.height = '6px';
        persistentDot.style.borderRadius = '50%';
        persistentDot.style.backgroundColor = '#2196F3';
        persistentRow.appendChild(persistentDot);
        persistentRow.appendChild(document.createTextNode('Persistent Collab'));
        panel.appendChild(persistentRow);

        panel.appendChild(this.createActionButton(
          ICONS.globe,
          'Disable Persistent Collab',
          () => this.wrapAsync(this.callbacks.onDisablePersistentCollab),
          true, // danger style
        ));
      } else if (this.state.status !== 'collabActive') {
        // Only show enable button when no ephemeral collab is active
        panel.appendChild(this.createActionButton(
          ICONS.globe,
          'Enable Persistent Collab',
          () => this.wrapAsync(this.callbacks.onEnablePersistentCollab),
        ));
      }

      // Separator before danger zone
      const sep2 = document.createElement('div');
      applyStyles(sep2, styles.separator);
      panel.appendChild(sep2);

      // Unpublish (danger)
      const unpublishBtn = this.createActionButton(
        ICONS.trash,
        'Unpublish',
        () => this.wrapAsync(this.callbacks.onUnpublish),
        true,
      );
      panel.appendChild(unpublishBtn);
    }

    // ── Collapse/Close button at bottom ──
    const collapseRow = document.createElement('div');
    collapseRow.style.borderTop = '1px solid var(--background-modifier-border)';
    collapseRow.style.padding = '4px';
    collapseRow.style.display = 'flex';
    collapseRow.style.justifyContent = 'center';

    const collapseBtn = document.createElement('button');
    collapseBtn.style.background = 'none';
    collapseBtn.style.border = 'none';
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.color = 'var(--text-muted)';
    collapseBtn.style.fontSize = '10px';
    collapseBtn.style.padding = '4px 8px';
    collapseBtn.style.borderRadius = '4px';
    collapseBtn.style.fontFamily = 'inherit';
    collapseBtn.textContent = this.injectionMode === 'auto-injected' ? '✕ Close' : '▲ Collapse';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.injectionMode === 'auto-injected') {
        this.collapseAuto();
      } else {
        this.collapse();
      }
    });
    collapseRow.appendChild(collapseBtn);
    panel.appendChild(collapseRow);

    // Loading overlay
    if (this.loading) {
      this.showLoadingOverlay(panel);
    }
  }

  private createActionButton(
    icon: string,
    label: string,
    onClick: () => void,
    danger = false,
  ): HTMLElement {
    const btn = document.createElement('button');
    applyStyles(btn, styles.actionButton);
    if (danger) {
      applyStyles(btn, styles.dangerButton);
    }

    const iconEl = document.createElement('span');
    applyStyles(iconEl, styles.actionIcon);
    iconEl.innerHTML = icon;
    if (danger) {
      iconEl.style.color = '#e53935';
    }
    btn.appendChild(iconEl);

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    btn.appendChild(labelEl);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  private expand(): void {
    this.expanded = true;
    this.renderExpanded();
  }

  private collapse(): void {
    this.expanded = false;
    this.renderCollapsed();
  }

  private updateContent(): void {
    if (!this.rootEl) return;

    if (this.injectionMode === 'auto-injected') {
      // Update status dot on the island button
      this.updateStatusDot();
      // If popover is open, rebuild its content
      if (this.expanded && this.expandedPanelEl) {
        this.buildExpandedContent(this.expandedPanelEl);
      }
      return;
    }

    // Floating mode
    if (this.expanded && this.expandedPanelEl) {
      this.buildExpandedContent(this.expandedPanelEl);
    }

    if (!this.expanded) {
      this.updateStatusDot();
    }
  }

  private updateStatusDot(): void {
    if (!this.statusDotEl) return;

    let color: string;
    switch (this.state.status) {
      case 'published':
        color = STATUS_COLORS.published;
        break;
      case 'syncing':
        color = STATUS_COLORS.syncing;
        break;
      case 'collabActive':
        color = STATUS_COLORS.collabActive;
        this.statusDotEl.style.animation = 'excalishare-pulse 2s ease-in-out infinite';
        break;
      case 'error':
        color = STATUS_COLORS.error;
        break;
      case 'unpublished':
      default:
        color = STATUS_COLORS.unpublished;
        break;
    }

    this.statusDotEl.style.backgroundColor = color;
    if (this.state.status !== 'collabActive') {
      this.statusDotEl.style.animation = '';
    }
  }

  private applyStatusBadge(badge: HTMLElement): void {
    switch (this.state.status) {
      case 'published':
        badge.textContent = this.state.passwordProtected ? '🔒 Published' : 'Published';
        badge.style.backgroundColor = 'rgba(76, 175, 80, 0.15)';
        badge.style.color = '#4caf50';
        break;
      case 'syncing':
        badge.textContent = 'Syncing...';
        badge.style.backgroundColor = 'rgba(255, 152, 0, 0.15)';
        badge.style.color = '#ff9800';
        break;
      case 'collabActive':
        badge.textContent = '● Live';
        badge.style.backgroundColor = 'rgba(244, 67, 54, 0.15)';
        badge.style.color = '#f44336';
        break;
      case 'error':
        badge.textContent = 'Error';
        badge.style.backgroundColor = 'rgba(229, 57, 53, 0.15)';
        badge.style.color = '#e53935';
        break;
      case 'unpublished':
      default:
        badge.textContent = 'Draft';
        badge.style.backgroundColor = 'rgba(158, 158, 158, 0.15)';
        badge.style.color = 'var(--text-muted)';
        break;
    }
  }

  private async wrapAsync(fn: () => Promise<void>): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.updateContent();

    try {
      await fn();
    } catch (e) {
      console.error('ExcaliShare toolbar action failed:', e);
    } finally {
      this.loading = false;
      this.updateContent();
    }
  }

  private showLoadingOverlay(panel: HTMLElement): void {
    const overlay = document.createElement('div');
    applyStyles(overlay, styles.loadingOverlay);

    const spinner = document.createElement('div');
    spinner.innerHTML = ICONS.sync;
    spinner.style.animation = 'excalishare-spin 1s linear infinite';
    spinner.style.color = 'var(--text-muted)';
    overlay.appendChild(spinner);

    panel.style.position = 'relative';
    panel.appendChild(overlay);
  }

  /**
   * Build the collaborator list with follow/unfollow buttons.
   * Each collaborator shows a colored dot, name, and an eye icon to toggle follow mode.
   */
  private buildCollaboratorList(panel: HTMLElement): void {
    const collaborators = this.state.collabCollaborators || [];
    const followingUserId = this.state.collabFollowingUserId || null;
    const displayName = this.state.collabDisplayName || '';

    const listContainer = document.createElement('div');
    listContainer.style.padding = '4px 0';

    for (const collab of collaborators) {
      const isSelf = collab.name === displayName;
      const isFollowing = followingUserId === collab.id;
      const color = getCollaboratorColor(collab.colorIndex);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '5px 12px';
      row.style.cursor = isSelf ? 'default' : 'pointer';
      row.style.borderRadius = '0';
      row.style.transition = 'background-color 0.1s ease';
      if (isFollowing) {
        row.style.backgroundColor = 'rgba(76, 175, 80, 0.12)';
      }

      // Hover effect (non-self, non-following)
      if (!isSelf) {
        row.addEventListener('mouseenter', () => {
          if (!isFollowing) {
            row.style.backgroundColor = 'var(--background-modifier-hover)';
          }
        });
        row.addEventListener('mouseleave', () => {
          if (!isFollowing) {
            row.style.backgroundColor = 'transparent';
          }
        });
      }

      // Color dot
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = color.stroke;
      dot.style.flexShrink = '0';
      row.appendChild(dot);

      // Name
      const nameEl = document.createElement('span');
      nameEl.style.fontSize = '12px';
      nameEl.style.color = 'var(--text-normal)';
      nameEl.style.flex = '1';
      nameEl.style.overflow = 'hidden';
      nameEl.style.textOverflow = 'ellipsis';
      nameEl.style.whiteSpace = 'nowrap';
      nameEl.textContent = collab.name;
      if (isSelf) {
        const youSpan = document.createElement('span');
        youSpan.style.color = 'var(--text-muted)';
        youSpan.style.fontSize = '10px';
        youSpan.style.marginLeft = '4px';
        youSpan.textContent = '(you)';
        nameEl.appendChild(youSpan);
      }
      row.appendChild(nameEl);

      // Follow/eye button (not for self)
      if (!isSelf) {
        const eyeBtn = document.createElement('span');
        eyeBtn.style.fontSize = '12px';
        eyeBtn.style.flexShrink = '0';
        eyeBtn.style.cursor = 'pointer';
        eyeBtn.style.userSelect = 'none';
        eyeBtn.style.padding = '2px 4px';
        eyeBtn.style.borderRadius = '4px';
        eyeBtn.style.transition = 'background-color 0.1s ease';

        if (isFollowing) {
          eyeBtn.textContent = '👁 Following';
          eyeBtn.style.color = '#4CAF50';
          eyeBtn.style.fontWeight = '600';
          eyeBtn.title = 'Click to stop following';
        } else {
          eyeBtn.textContent = '👁';
          eyeBtn.style.color = 'var(--text-faint)';
          eyeBtn.title = `Follow ${collab.name}`;
        }

        eyeBtn.addEventListener('mouseenter', () => {
          eyeBtn.style.backgroundColor = 'var(--background-modifier-hover)';
        });
        eyeBtn.addEventListener('mouseleave', () => {
          eyeBtn.style.backgroundColor = 'transparent';
        });

        row.appendChild(eyeBtn);

        // Click handler for the entire row
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isFollowing) {
            this.callbacks.onStopFollowing?.();
          } else {
            this.callbacks.onStartFollowing?.(collab.id);
          }
        });
      }

      listContainer.appendChild(row);
    }

    // Following banner (if following someone)
    if (followingUserId) {
      const followedName = collaborators.find(c => c.id === followingUserId)?.name || 'user';
      const banner = document.createElement('div');
      banner.style.padding = '4px 12px';
      banner.style.margin = '4px 8px';
      banner.style.borderRadius = '6px';
      banner.style.backgroundColor = 'rgba(76, 175, 80, 0.12)';
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.gap = '6px';
      banner.style.fontSize = '11px';
      banner.style.color = 'var(--text-muted)';

      const bannerText = document.createElement('span');
      bannerText.textContent = `👁 Following ${followedName}`;
      banner.appendChild(bannerText);

      const stopBtn = document.createElement('span');
      stopBtn.textContent = '✕';
      stopBtn.style.marginLeft = 'auto';
      stopBtn.style.cursor = 'pointer';
      stopBtn.style.padding = '2px 4px';
      stopBtn.style.borderRadius = '4px';
      stopBtn.style.color = 'var(--text-muted)';
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onStopFollowing?.();
      });
      stopBtn.addEventListener('mouseenter', () => {
        stopBtn.style.backgroundColor = 'var(--background-modifier-hover)';
      });
      stopBtn.addEventListener('mouseleave', () => {
        stopBtn.style.backgroundColor = 'transparent';
      });
      banner.appendChild(stopBtn);

      listContainer.appendChild(banner);
    }

    panel.appendChild(listContainer);

    // Separator after collaborator list
    const sep = document.createElement('div');
    applyStyles(sep, styles.separator);
    panel.appendChild(sep);
  }

  private flashSuccess(message: string): void {
    new Notice(message, 2000);
  }

  private addClickOutsideListener(): void {
    this.removeClickOutsideListener();
    this.clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the rootEl (Island + popover)
      if (this.rootEl && this.rootEl.contains(target)) return;
      // Don't close if clicking inside a mobile popover
      if (this.expandedPanelEl && this.expandedPanelEl.contains(target)) return;

      if (this.injectionMode === 'auto-injected') {
        this.collapseAuto();
      } else {
        this.collapse();
      }
    };
    // Delay to avoid the current click event
    setTimeout(() => {
      if (this.clickOutsideHandler) {
        document.addEventListener('click', this.clickOutsideHandler, true);
      }
    }, 50);
  }

  private removeClickOutsideListener(): void {
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler, true);
      this.clickOutsideHandler = null;
    }
  }
}
