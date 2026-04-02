/**
 * CSS-in-JS styles for the ExcaliShare floating toolbar.
 * Uses Obsidian CSS variables for automatic theme compatibility.
 */

export const TOOLBAR_CLASS = 'excalishare-toolbar';
export const TOOLBAR_COLLAPSED_CLASS = 'excalishare-toolbar-collapsed';
export const TOOLBAR_EXPANDED_CLASS = 'excalishare-toolbar-expanded';

export type ToolbarPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export function getPositionStyles(position: ToolbarPosition): Partial<CSSStyleDeclaration> {
  switch (position) {
    case 'top-right':
      return { top: '50px', right: '12px', bottom: '', left: '' };
    case 'top-left':
      return { top: '50px', left: '12px', bottom: '', right: '' };
    case 'bottom-right':
      return { bottom: '12px', right: '12px', top: '', left: '' };
    case 'bottom-left':
      return { bottom: '12px', left: '12px', top: '', right: '' };
  }
}

export const styles = {
  /** Outer container — absolutely positioned within the Excalidraw view */
  container: {
    position: 'absolute',
    zIndex: '100',
    fontFamily: 'var(--font-interface, var(--default-font))',
    fontSize: '13px',
    userSelect: 'none',
    transition: 'all 0.2s ease',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>,

  /** Collapsed pill button */
  collapsedButton: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid var(--background-modifier-border)',
    backgroundColor: 'var(--background-primary)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  } as Partial<CSSStyleDeclaration>,

  /** Status dot on the collapsed button */
  statusDot: {
    position: 'absolute',
    bottom: '-2px',
    right: '-2px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    border: '2px solid var(--background-primary)',
    transition: 'background-color 0.3s ease',
  } as Partial<CSSStyleDeclaration>,

  /** Expanded panel */
  expandedPanel: {
    minWidth: '200px',
    maxWidth: '240px',
    borderRadius: '12px',
    border: '1px solid var(--background-modifier-border)',
    backgroundColor: 'var(--background-primary)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    overflow: 'hidden',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  } as Partial<CSSStyleDeclaration>,

  /** Header row in expanded panel */
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: '1px solid var(--background-modifier-border)',
    fontWeight: '600',
    fontSize: '13px',
    color: 'var(--text-normal)',
  } as Partial<CSSStyleDeclaration>,

  /** Header status badge */
  headerBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '8px',
    fontWeight: '500',
    marginLeft: 'auto',
  } as Partial<CSSStyleDeclaration>,

  /** Action button row */
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    cursor: 'pointer',
    color: 'var(--text-normal)',
    backgroundColor: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left' as any,
    fontSize: '13px',
    fontFamily: 'inherit',
    transition: 'background-color 0.1s ease',
    borderRadius: '0',
  } as Partial<CSSStyleDeclaration>,

  /** Action button hover */
  actionButtonHover: {
    backgroundColor: 'var(--background-modifier-hover)',
  } as Partial<CSSStyleDeclaration>,

  /** Separator between action groups */
  separator: {
    height: '1px',
    backgroundColor: 'var(--background-modifier-border)',
    margin: '4px 0',
  } as Partial<CSSStyleDeclaration>,

  /** Danger action (unpublish) */
  dangerButton: {
    color: '#e53935',
  } as Partial<CSSStyleDeclaration>,

  /** Icon container in action buttons */
  actionIcon: {
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    opacity: '0.85',
  } as Partial<CSSStyleDeclaration>,

  /** Setup prompt when API key is missing */
  setupPrompt: {
    padding: '12px',
    textAlign: 'center' as any,
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>,

  /** Loading spinner overlay */
  loadingOverlay: {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: 'var(--background-primary)',
    opacity: '0.8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12px',
    zIndex: '10',
  } as Partial<CSSStyleDeclaration>,

  /** Collab pulsing indicator */
  collabPulse: {
    animation: 'excalishare-pulse 2s ease-in-out infinite',
  } as Partial<CSSStyleDeclaration>,
};

/** Status dot colors */
export const STATUS_COLORS = {
  unpublished: '#9e9e9e',     // Gray
  published: '#4caf50',       // Green
  syncing: '#ff9800',         // Orange (during sync)
  collabActive: '#f44336',    // Red
  error: '#e53935',           // Red
};

/** SVG icons used in the toolbar */
export const ICONS = {
  cloud: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
  upload: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  sync: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  stopCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`,
  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

/**
 * Inject the global CSS keyframes for animations.
 * Called once during plugin load.
 */
export function injectGlobalStyles(): void {
  const id = 'excalishare-global-styles';
  if (document.getElementById(id)) return;

  const styleEl = document.createElement('style');
  styleEl.id = id;
  styleEl.textContent = `
    @keyframes excalishare-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes excalishare-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes excalishare-fade-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .excalishare-toolbar button:hover {
      background-color: var(--background-modifier-hover) !important;
    }
    .excalishare-toolbar button:active {
      background-color: var(--background-modifier-active-hover, var(--background-modifier-hover)) !important;
    }
    .excalishare-toolbar-collapsed:hover {
      transform: scale(1.08);
      box-shadow: 0 3px 12px rgba(0,0,0,0.2);
    }

    /* ── Excalidraw built-in collaborator UI fixes for Obsidian ──
     * When we push collaborators via updateScene({ collaborators }),
     * Excalidraw renders its built-in UserList with Avatar elements.
     * These can be invisible or poorly positioned in Obsidian's context,
     * especially on mobile where they appear in the right-side toolbar.
     */

    /* Ensure collaborator avatars are visible with proper colors */
    .excalidraw .UserList {
      pointer-events: auto !important;
      z-index: 10 !important;
    }

    .excalidraw .UserList .Avatar {
      opacity: 1 !important;
      visibility: visible !important;
      cursor: pointer !important;
      min-width: 28px !important;
      min-height: 28px !important;
    }

    /* Ensure the follow button/icon inside avatars is visible */
    .excalidraw .UserList .Avatar button,
    .excalidraw .UserList .Avatar [class*="follow"],
    .excalidraw .UserList button[class*="follow"] {
      opacity: 1 !important;
      visibility: visible !important;
      color: var(--text-normal, #333) !important;
    }

    /* Fix avatar text/initials visibility */
    .excalidraw .UserList .Avatar span,
    .excalidraw .UserList .Avatar div {
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* Ensure the UserList doesn't overlap the Obsidian mobile toolbar excessively */
    .excalidraw .UserList {
      position: relative !important;
      max-height: 200px !important;
      overflow-y: auto !important;
    }

    /* Fix for Excalidraw's collaborator tooltip/popover visibility */
    .excalidraw [class*="UserList"] [class*="tooltip"],
    .excalidraw [class*="UserList"] [class*="popover"] {
      color: var(--text-normal, #333) !important;
      background-color: var(--background-primary, #fff) !important;
      border: 1px solid var(--background-modifier-border, #ddd) !important;
      z-index: 1000 !important;
    }

    /* Dark mode adjustments for Excalidraw collaborator UI */
    .theme-dark .excalidraw .UserList .Avatar button,
    .theme-dark .excalidraw .UserList .Avatar [class*="follow"],
    .theme-dark .excalidraw .UserList button[class*="follow"] {
      color: var(--text-normal, #e0e0e0) !important;
    }
  `;
  document.head.appendChild(styleEl);
}

/**
 * Remove global styles on plugin unload.
 */
export function removeGlobalStyles(): void {
  const el = document.getElementById('excalishare-global-styles');
  if (el) el.remove();
}

/** Apply a style object to an HTMLElement */
export function applyStyles(el: HTMLElement, styleObj: Partial<CSSStyleDeclaration>): void {
  for (const [key, value] of Object.entries(styleObj)) {
    if (value !== undefined && value !== '') {
      (el.style as any)[key] = value;
    }
  }
}
