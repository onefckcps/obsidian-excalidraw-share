import { Notice } from 'obsidian';
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

/**
 * Floating toolbar that injects into the Excalidraw view container.
 * Provides quick access to all ExcaliShare actions with visual state feedback.
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

  constructor(
    callbacks: ToolbarCallbacks,
    position: ToolbarPosition = 'top-right',
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
   */
  inject(containerEl: HTMLElement): void {
    this.remove(); // Clean up any existing toolbar
    this.containerEl = containerEl;
    this.expanded = !this.startCollapsed;
    this.render();
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
    this.removeClickOutsideListener();
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
   */
  setPosition(position: ToolbarPosition): void {
    this.position = position;
    if (this.rootEl) {
      const posStyles = getPositionStyles(this.position);
      applyStyles(this.rootEl, posStyles);
    }
  }

  /**
   * Check if the toolbar is currently injected.
   */
  isInjected(): boolean {
    return this.rootEl !== null && this.rootEl.parentElement !== null;
  }

  // ── Private Methods ──

  private render(): void {
    if (!this.containerEl) return;

    // Ensure the container has relative positioning for absolute children
    const containerPosition = getComputedStyle(this.containerEl).position;
    if (containerPosition === 'static' || containerPosition === '') {
      this.containerEl.style.position = 'relative';
    }

    // Create root element
    this.rootEl = document.createElement('div');
    this.rootEl.className = TOOLBAR_CLASS;
    applyStyles(this.rootEl, styles.container);
    applyStyles(this.rootEl, getPositionStyles(this.position));

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
      if (this.state.collabSessionId && this.state.collabDrawingId === this.state.publishedId) {
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
      } else if (!this.state.collabSessionId) {
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

    // ── Collapse button at bottom ──
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
    collapseBtn.textContent = '▲ Collapse';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapse();
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
      if (this.rootEl && !this.rootEl.contains(e.target as Node)) {
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
