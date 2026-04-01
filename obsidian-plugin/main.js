"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ExcaliSharePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "http://localhost:8184",
  pdfScale: 1.5,
  collabTimeoutSecs: 7200,
  collabAutoOpenBrowser: true,
  showFloatingToolbar: true,
  toolbarPosition: "top-right",
  autoSyncOnSave: false,
  autoSyncDelaySecs: 5,
  toolbarCollapsedByDefault: true
};
var ExcaliShareSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.pluginRef = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "ExcaliShare Settings" });
    new import_obsidian.Setting(containerEl).setName("API Key").setDesc("API key for the share server").addText((text) => {
      text.setPlaceholder("Enter API key").setValue(this.pluginRef.settings.apiKey).onChange((value) => {
        this.pluginRef.settings.apiKey = value;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Server URL").setDesc("Base URL of the Excalidraw Share server").addText((text) => {
      text.setPlaceholder("http://localhost:8184").setValue(this.pluginRef.settings.baseUrl).onChange((value) => {
        this.pluginRef.settings.baseUrl = value;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("PDF Scale").setDesc("Scale factor for PDF to PNG conversion (0.5 - 5.0). Higher values = better quality but larger file size.").addSlider((slider) => {
      slider.setValue(this.pluginRef.settings.pdfScale).setLimits(0.5, 5, 0.1).setDynamicTooltip().onChange((value) => {
        this.pluginRef.settings.pdfScale = value;
        this.pluginRef.saveSettings();
      });
    });
    containerEl.createEl("h3", { text: "Floating Toolbar" });
    new import_obsidian.Setting(containerEl).setName("Show Floating Toolbar").setDesc("Display the ExcaliShare toolbar directly inside the Excalidraw canvas for quick access to all actions.").addToggle((toggle) => {
      toggle.setValue(this.pluginRef.settings.showFloatingToolbar).onChange((value) => {
        this.pluginRef.settings.showFloatingToolbar = value;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Toolbar Position").setDesc("Where to place the floating toolbar in the Excalidraw view.").addDropdown((dropdown) => {
      dropdown.addOption("top-right", "Top Right").addOption("top-left", "Top Left").addOption("bottom-right", "Bottom Right").addOption("bottom-left", "Bottom Left").setValue(this.pluginRef.settings.toolbarPosition).onChange((value) => {
        this.pluginRef.settings.toolbarPosition = value;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Start Collapsed").setDesc("Start the toolbar in collapsed mode (small icon). Click to expand.").addToggle((toggle) => {
      toggle.setValue(this.pluginRef.settings.toolbarCollapsedByDefault).onChange((value) => {
        this.pluginRef.settings.toolbarCollapsedByDefault = value;
        this.pluginRef.saveSettings();
      });
    });
    containerEl.createEl("h3", { text: "Auto-Sync" });
    new import_obsidian.Setting(containerEl).setName("Auto-Sync on Save").setDesc("Automatically sync published drawings to the server when you save changes.").addToggle((toggle) => {
      toggle.setValue(this.pluginRef.settings.autoSyncOnSave).onChange((value) => {
        this.pluginRef.settings.autoSyncOnSave = value;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Auto-Sync Delay").setDesc("Seconds to wait after the last change before auto-syncing (1-30).").addSlider((slider) => {
      slider.setValue(this.pluginRef.settings.autoSyncDelaySecs).setLimits(1, 30, 1).setDynamicTooltip().onChange((value) => {
        this.pluginRef.settings.autoSyncDelaySecs = value;
        this.pluginRef.saveSettings();
      });
    });
    containerEl.createEl("h3", { text: "Live Collaboration" });
    new import_obsidian.Setting(containerEl).setName("Session Timeout").setDesc("How long a collab session stays alive (in hours). Default: 2 hours.").addSlider((slider) => {
      slider.setValue(this.pluginRef.settings.collabTimeoutSecs / 3600).setLimits(0.5, 12, 0.5).setDynamicTooltip().onChange((value) => {
        this.pluginRef.settings.collabTimeoutSecs = value * 3600;
        this.pluginRef.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Auto-open Browser").setDesc("Automatically open the web viewer when starting a collab session.").addToggle((toggle) => {
      toggle.setValue(this.pluginRef.settings.collabAutoOpenBrowser).onChange((value) => {
        this.pluginRef.settings.collabAutoOpenBrowser = value;
        this.pluginRef.saveSettings();
      });
    });
  }
};

// toolbar.ts
var import_obsidian2 = require("obsidian");

// styles.ts
var TOOLBAR_CLASS = "excalishare-toolbar";
function getPositionStyles(position) {
  switch (position) {
    case "top-right":
      return { top: "50px", right: "12px", bottom: "", left: "" };
    case "top-left":
      return { top: "50px", left: "12px", bottom: "", right: "" };
    case "bottom-right":
      return { bottom: "12px", right: "12px", top: "", left: "" };
    case "bottom-left":
      return { bottom: "12px", left: "12px", top: "", right: "" };
  }
}
var styles = {
  /** Outer container — absolutely positioned within the Excalidraw view */
  container: {
    position: "absolute",
    zIndex: "50",
    fontFamily: "var(--font-interface, var(--default-font))",
    fontSize: "13px",
    userSelect: "none",
    transition: "all 0.2s ease"
  },
  /** Collapsed pill button */
  collapsedButton: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    border: "1px solid var(--background-modifier-border)",
    backgroundColor: "var(--background-primary)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    transition: "transform 0.15s ease, box-shadow 0.15s ease"
  },
  /** Status dot on the collapsed button */
  statusDot: {
    position: "absolute",
    bottom: "-2px",
    right: "-2px",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    border: "2px solid var(--background-primary)",
    transition: "background-color 0.3s ease"
  },
  /** Expanded panel */
  expandedPanel: {
    minWidth: "200px",
    maxWidth: "240px",
    borderRadius: "12px",
    border: "1px solid var(--background-modifier-border)",
    backgroundColor: "var(--background-primary)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
    overflow: "hidden",
    transition: "opacity 0.2s ease, transform 0.2s ease"
  },
  /** Header row in expanded panel */
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    borderBottom: "1px solid var(--background-modifier-border)",
    fontWeight: "600",
    fontSize: "13px",
    color: "var(--text-normal)"
  },
  /** Header status badge */
  headerBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    borderRadius: "8px",
    fontWeight: "500",
    marginLeft: "auto"
  },
  /** Action button row */
  actionButton: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    cursor: "pointer",
    color: "var(--text-normal)",
    backgroundColor: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    fontSize: "13px",
    fontFamily: "inherit",
    transition: "background-color 0.1s ease",
    borderRadius: "0"
  },
  /** Action button hover */
  actionButtonHover: {
    backgroundColor: "var(--background-modifier-hover)"
  },
  /** Separator between action groups */
  separator: {
    height: "1px",
    backgroundColor: "var(--background-modifier-border)",
    margin: "4px 0"
  },
  /** Danger action (unpublish) */
  dangerButton: {
    color: "#e53935"
  },
  /** Icon container in action buttons */
  actionIcon: {
    width: "18px",
    height: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    opacity: "0.85"
  },
  /** Setup prompt when API key is missing */
  setupPrompt: {
    padding: "12px",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: "12px",
    lineHeight: "1.4"
  },
  /** Loading spinner overlay */
  loadingOverlay: {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    backgroundColor: "var(--background-primary)",
    opacity: "0.8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "12px",
    zIndex: "10"
  },
  /** Collab pulsing indicator */
  collabPulse: {
    animation: "excalishare-pulse 2s ease-in-out infinite"
  }
};
var STATUS_COLORS = {
  unpublished: "#9e9e9e",
  // Gray
  published: "#4caf50",
  // Green
  syncing: "#ff9800",
  // Orange (during sync)
  collabActive: "#f44336",
  // Red
  error: "#e53935"
  // Red
};
var ICONS = {
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
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
};
function injectGlobalStyles() {
  const id = "excalishare-global-styles";
  if (document.getElementById(id)) return;
  const styleEl = document.createElement("style");
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
  `;
  document.head.appendChild(styleEl);
}
function removeGlobalStyles() {
  const el = document.getElementById("excalishare-global-styles");
  if (el) el.remove();
}
function applyStyles(el, styleObj) {
  for (const [key, value] of Object.entries(styleObj)) {
    if (value !== void 0 && value !== "") {
      el.style[key] = value;
    }
  }
}

// toolbar.ts
var ExcaliShareToolbar = class {
  constructor(callbacks, position = "top-right", startCollapsed = true) {
    this.containerEl = null;
    this.rootEl = null;
    this.expanded = false;
    this.loading = false;
    this.clickOutsideHandler = null;
    // DOM references for updates
    this.statusDotEl = null;
    this.expandedPanelEl = null;
    this.collapsedBtnEl = null;
    this.callbacks = callbacks;
    this.position = position;
    this.startCollapsed = startCollapsed;
    this.state = {
      status: "unpublished",
      publishedId: null,
      collabSessionId: null,
      collabDrawingId: null,
      hasApiKey: false
    };
  }
  /**
   * Inject the toolbar into the given container element (Excalidraw view).
   */
  inject(containerEl) {
    this.remove();
    this.containerEl = containerEl;
    this.expanded = !this.startCollapsed;
    this.render();
  }
  /**
   * Remove the toolbar from the DOM.
   */
  remove() {
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
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.updateContent();
  }
  /**
   * Update the toolbar position.
   */
  setPosition(position) {
    this.position = position;
    if (this.rootEl) {
      const posStyles = getPositionStyles(this.position);
      applyStyles(this.rootEl, posStyles);
    }
  }
  /**
   * Check if the toolbar is currently injected.
   */
  isInjected() {
    return this.rootEl !== null && this.rootEl.parentElement !== null;
  }
  // ── Private Methods ──
  render() {
    if (!this.containerEl) return;
    const containerPosition = getComputedStyle(this.containerEl).position;
    if (containerPosition === "static" || containerPosition === "") {
      this.containerEl.style.position = "relative";
    }
    this.rootEl = document.createElement("div");
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
  renderCollapsed() {
    if (!this.rootEl) return;
    this.rootEl.empty();
    const btn = document.createElement("div");
    btn.className = "excalishare-toolbar-collapsed";
    applyStyles(btn, styles.collapsedButton);
    btn.innerHTML = ICONS.cloud;
    btn.setAttribute("aria-label", "ExcaliShare");
    btn.title = "ExcaliShare \u2014 Click to expand";
    this.statusDotEl = document.createElement("div");
    applyStyles(this.statusDotEl, styles.statusDot);
    this.updateStatusDot();
    btn.appendChild(this.statusDotEl);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.expand();
    });
    this.collapsedBtnEl = btn;
    this.rootEl.appendChild(btn);
    this.removeClickOutsideListener();
  }
  renderExpanded() {
    if (!this.rootEl) return;
    this.rootEl.empty();
    const panel = document.createElement("div");
    panel.className = "excalishare-toolbar-expanded";
    applyStyles(panel, styles.expandedPanel);
    panel.style.animation = "excalishare-fade-in 0.2s ease";
    this.expandedPanelEl = panel;
    this.buildExpandedContent(panel);
    this.rootEl.appendChild(panel);
    this.addClickOutsideListener();
  }
  buildExpandedContent(panel) {
    panel.empty();
    const header = document.createElement("div");
    applyStyles(header, styles.header);
    const headerIcon = document.createElement("span");
    headerIcon.innerHTML = ICONS.cloud;
    headerIcon.style.display = "flex";
    headerIcon.style.alignItems = "center";
    header.appendChild(headerIcon);
    const headerTitle = document.createElement("span");
    headerTitle.textContent = "ExcaliShare";
    header.appendChild(headerTitle);
    const badge = document.createElement("span");
    applyStyles(badge, styles.headerBadge);
    this.applyStatusBadge(badge);
    header.appendChild(badge);
    panel.appendChild(header);
    if (!this.state.hasApiKey) {
      const prompt = document.createElement("div");
      applyStyles(prompt, styles.setupPrompt);
      prompt.innerHTML = "\u2699\uFE0F API key not configured.<br>Click below to set up.";
      panel.appendChild(prompt);
      panel.appendChild(this.createActionButton(
        ICONS.settings,
        "Open Settings",
        () => this.callbacks.onOpenSettings()
      ));
    } else if (!this.state.publishedId) {
      panel.appendChild(this.createActionButton(
        ICONS.upload,
        "Publish Drawing",
        () => this.wrapAsync(this.callbacks.onPublish)
      ));
    } else {
      panel.appendChild(this.createActionButton(
        ICONS.sync,
        "Sync to Server",
        () => this.wrapAsync(this.callbacks.onSync)
      ));
      panel.appendChild(this.createActionButton(
        ICONS.link,
        "Copy Share Link",
        () => {
          this.callbacks.onCopyLink();
          this.flashSuccess("Link copied!");
        }
      ));
      panel.appendChild(this.createActionButton(
        ICONS.download,
        "Pull from Server",
        () => this.wrapAsync(this.callbacks.onPull)
      ));
      const sep1 = document.createElement("div");
      applyStyles(sep1, styles.separator);
      panel.appendChild(sep1);
      if (this.state.collabSessionId && this.state.collabDrawingId === this.state.publishedId) {
        panel.appendChild(this.createActionButton(
          ICONS.stopCircle,
          "Stop Live Collab",
          () => this.wrapAsync(this.callbacks.onStopCollab),
          true
          // danger style for the icon
        ));
        panel.appendChild(this.createActionButton(
          ICONS.externalLink,
          "Open in Browser",
          () => this.callbacks.onOpenInBrowser()
        ));
      } else if (!this.state.collabSessionId) {
        panel.appendChild(this.createActionButton(
          ICONS.users,
          "Start Live Collab",
          () => this.wrapAsync(this.callbacks.onStartCollab)
        ));
      }
      const sep2 = document.createElement("div");
      applyStyles(sep2, styles.separator);
      panel.appendChild(sep2);
      const unpublishBtn = this.createActionButton(
        ICONS.trash,
        "Unpublish",
        () => this.wrapAsync(this.callbacks.onUnpublish),
        true
      );
      panel.appendChild(unpublishBtn);
    }
    const collapseRow = document.createElement("div");
    collapseRow.style.borderTop = "1px solid var(--background-modifier-border)";
    collapseRow.style.padding = "4px";
    collapseRow.style.display = "flex";
    collapseRow.style.justifyContent = "center";
    const collapseBtn = document.createElement("button");
    collapseBtn.style.background = "none";
    collapseBtn.style.border = "none";
    collapseBtn.style.cursor = "pointer";
    collapseBtn.style.color = "var(--text-muted)";
    collapseBtn.style.fontSize = "10px";
    collapseBtn.style.padding = "4px 8px";
    collapseBtn.style.borderRadius = "4px";
    collapseBtn.style.fontFamily = "inherit";
    collapseBtn.textContent = "\u25B2 Collapse";
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.collapse();
    });
    collapseRow.appendChild(collapseBtn);
    panel.appendChild(collapseRow);
    if (this.loading) {
      this.showLoadingOverlay(panel);
    }
  }
  createActionButton(icon, label, onClick, danger = false) {
    const btn = document.createElement("button");
    applyStyles(btn, styles.actionButton);
    if (danger) {
      applyStyles(btn, styles.dangerButton);
    }
    const iconEl = document.createElement("span");
    applyStyles(iconEl, styles.actionIcon);
    iconEl.innerHTML = icon;
    if (danger) {
      iconEl.style.color = "#e53935";
    }
    btn.appendChild(iconEl);
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    btn.appendChild(labelEl);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }
  expand() {
    this.expanded = true;
    this.renderExpanded();
  }
  collapse() {
    this.expanded = false;
    this.renderCollapsed();
  }
  updateContent() {
    if (!this.rootEl) return;
    if (this.expanded && this.expandedPanelEl) {
      this.buildExpandedContent(this.expandedPanelEl);
    }
    if (!this.expanded) {
      this.updateStatusDot();
    }
  }
  updateStatusDot() {
    if (!this.statusDotEl) return;
    let color;
    switch (this.state.status) {
      case "published":
        color = STATUS_COLORS.published;
        break;
      case "syncing":
        color = STATUS_COLORS.syncing;
        break;
      case "collabActive":
        color = STATUS_COLORS.collabActive;
        this.statusDotEl.style.animation = "excalishare-pulse 2s ease-in-out infinite";
        break;
      case "error":
        color = STATUS_COLORS.error;
        break;
      case "unpublished":
      default:
        color = STATUS_COLORS.unpublished;
        break;
    }
    this.statusDotEl.style.backgroundColor = color;
    if (this.state.status !== "collabActive") {
      this.statusDotEl.style.animation = "";
    }
  }
  applyStatusBadge(badge) {
    switch (this.state.status) {
      case "published":
        badge.textContent = "Published";
        badge.style.backgroundColor = "rgba(76, 175, 80, 0.15)";
        badge.style.color = "#4caf50";
        break;
      case "syncing":
        badge.textContent = "Syncing...";
        badge.style.backgroundColor = "rgba(255, 152, 0, 0.15)";
        badge.style.color = "#ff9800";
        break;
      case "collabActive":
        badge.textContent = "\u25CF Live";
        badge.style.backgroundColor = "rgba(244, 67, 54, 0.15)";
        badge.style.color = "#f44336";
        break;
      case "error":
        badge.textContent = "Error";
        badge.style.backgroundColor = "rgba(229, 57, 53, 0.15)";
        badge.style.color = "#e53935";
        break;
      case "unpublished":
      default:
        badge.textContent = "Draft";
        badge.style.backgroundColor = "rgba(158, 158, 158, 0.15)";
        badge.style.color = "var(--text-muted)";
        break;
    }
  }
  async wrapAsync(fn) {
    if (this.loading) return;
    this.loading = true;
    this.updateContent();
    try {
      await fn();
    } catch (e) {
      console.error("ExcaliShare toolbar action failed:", e);
    } finally {
      this.loading = false;
      this.updateContent();
    }
  }
  showLoadingOverlay(panel) {
    const overlay = document.createElement("div");
    applyStyles(overlay, styles.loadingOverlay);
    const spinner = document.createElement("div");
    spinner.innerHTML = ICONS.sync;
    spinner.style.animation = "excalishare-spin 1s linear infinite";
    spinner.style.color = "var(--text-muted)";
    overlay.appendChild(spinner);
    panel.style.position = "relative";
    panel.appendChild(overlay);
  }
  flashSuccess(message) {
    new import_obsidian2.Notice(message, 2e3);
  }
  addClickOutsideListener() {
    this.removeClickOutsideListener();
    this.clickOutsideHandler = (e) => {
      if (this.rootEl && !this.rootEl.contains(e.target)) {
        this.collapse();
      }
    };
    setTimeout(() => {
      if (this.clickOutsideHandler) {
        document.addEventListener("click", this.clickOutsideHandler, true);
      }
    }, 50);
  }
  removeClickOutsideListener() {
    if (this.clickOutsideHandler) {
      document.removeEventListener("click", this.clickOutsideHandler, true);
      this.clickOutsideHandler = null;
    }
  }
};

// main.ts
var blobToBase64 = async (blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};
var cropCanvas = (canvas, crop) => {
  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = Math.round(crop.width);
  croppedCanvas.height = Math.round(crop.height);
  const croppedCtx = croppedCanvas.getContext("2d");
  if (croppedCtx) {
    croppedCtx.fillStyle = "#ffffff";
    croppedCtx.fillRect(0, 0, croppedCanvas.width, croppedCanvas.height);
    croppedCtx.drawImage(
      canvas,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );
  }
  return croppedCanvas.toDataURL("image/png").split(",")[1];
};
var pdfToPng = async (app, file, pageNum = 1, cropRect, scale = 1.5) => {
  try {
    await (0, import_obsidian3.loadPdfJs)();
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error("PDF.js not loaded");
    const url = app.vault.getResourcePath(file);
    const pdfDoc = await pdfjsLib.getDocument(url).promise;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.height = Math.round(viewport.height);
    canvas.width = Math.round(viewport.width);
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    const validRect = cropRect && cropRect.length === 4 && cropRect.every((x) => !isNaN(x));
    if (validRect) {
      const [pageLeft, pageBottom, pageRight, pageTop] = page.view;
      const pageHeight = pageTop - pageBottom;
      return cropCanvas(canvas, {
        left: (cropRect[0] - pageLeft) * scale,
        top: (pageBottom + pageHeight - cropRect[3]) * scale,
        width: (cropRect[2] - cropRect[0]) * scale,
        height: (cropRect[3] - cropRect[1]) * scale
      });
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob) {
          resolve(await blobToBase64(blob));
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      }, "image/png");
    });
  } catch (e) {
    console.error("ExcaliShare: PDF conversion failed", e);
    throw e;
  }
};
var ExcaliSharePlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.activeCollabSessionId = null;
    this.activeCollabDrawingId = null;
    this.collabStatusBarItem = null;
    this.collabHealthInterval = null;
    // Toolbar management
    this.toolbarInstances = /* @__PURE__ */ new Map();
    this.autoSyncTimer = null;
  }
  async onload() {
    await this.loadSettings();
    console.log("ExcaliShare: Plugin loaded");
    injectGlobalStyles();
    this.addRibbonIcon("upload", "Publish Drawing", async () => {
      const file = this.app.workspace.getActiveFile();
      if (file && this.isExcalidrawFile(file)) {
        await this.publishDrawing(file);
      } else {
        new import_obsidian3.Notice("No Excalidraw file open. Open a .excalidraw file first.");
      }
    });
    this.addRibbonIcon("book-open", "Browse Shared Drawings", async () => {
      const url = this.settings.baseUrl;
      if (this.app.openUrlInPane) {
        this.app.openUrlInPane(url);
      } else {
        window.open(url, "_blank");
      }
    });
    this.addCommand({
      id: "publish-drawing",
      name: "Publish to ExcaliShare",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (!publishedId) {
            if (!checking) this.publishDrawing(file);
            return true;
          }
        }
        return false;
      }
    });
    this.addCommand({
      id: "sync-drawing",
      name: "Sync to ExcaliShare",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) this.publishDrawing(file, publishedId);
            return true;
          }
        }
        return false;
      }
    });
    this.addCommand({
      id: "copy-share-link",
      name: "Copy Share Link",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) {
              const url = `${this.settings.baseUrl}/d/${publishedId}`;
              navigator.clipboard.writeText(url);
              new import_obsidian3.Notice("Share link copied to clipboard!");
            }
            return true;
          }
        }
        return false;
      }
    });
    this.addCommand({
      id: "browse-shared-drawings",
      name: "Browse Shared Drawings",
      callback: () => {
        const url = this.settings.baseUrl;
        if (this.app.openUrlInPane) {
          this.app.openUrlInPane(url);
        } else {
          window.open(url, "_blank");
        }
      }
    });
    this.addCommand({
      id: "start-live-collab",
      name: "Start Live Collab Session",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId && !this.activeCollabSessionId) {
            if (!checking) this.startCollabSession(file, publishedId);
            return true;
          }
        }
        return false;
      }
    });
    this.addCommand({
      id: "stop-live-collab",
      name: "Stop Live Collab Session",
      checkCallback: (checking) => {
        if (this.activeCollabSessionId) {
          if (!checking) this.stopCollabSession();
          return true;
        }
        return false;
      }
    });
    this.addCommand({
      id: "open-live-session",
      name: "Open Live Session in Browser",
      checkCallback: (checking) => {
        if (this.activeCollabDrawingId) {
          if (!checking) {
            const url = `${this.settings.baseUrl}/d/${this.activeCollabDrawingId}`;
            window.open(url, "_blank");
          }
          return true;
        }
        return false;
      }
    });
    this.addCommand({
      id: "pull-from-excalishare",
      name: "Pull from ExcaliShare",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) this.pullFromServer(file, publishedId);
            return true;
          }
        }
        return false;
      }
    });
    this.registerEvent(
      // @ts-ignore
      this.app.workspace.on("file-menu", (menu, file) => {
        if (this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            menu.addItem((item) => {
              item.setTitle("Sync to ExcaliShare").setIcon("refresh-cw").onClick(() => this.publishDrawing(file, publishedId));
            });
            menu.addItem((item) => {
              item.setTitle("Copy Share Link").setIcon("link").onClick(() => {
                const url = `${this.settings.baseUrl}/d/${publishedId}`;
                navigator.clipboard.writeText(url);
                new import_obsidian3.Notice("Share link copied to clipboard!");
              });
            });
            if (this.activeCollabSessionId && this.activeCollabDrawingId === publishedId) {
              menu.addItem((item) => {
                item.setTitle("Stop Live Collab").setIcon("users").onClick(() => this.stopCollabSession());
              });
              menu.addItem((item) => {
                item.setTitle("Open Live Session").setIcon("external-link").onClick(() => {
                  const url = `${this.settings.baseUrl}/d/${publishedId}`;
                  window.open(url, "_blank");
                });
              });
            } else if (!this.activeCollabSessionId) {
              menu.addItem((item) => {
                item.setTitle("Start Live Collab").setIcon("users").onClick(() => this.startCollabSession(file, publishedId));
              });
            }
            menu.addItem((item) => {
              item.setTitle("Pull from ExcaliShare").setIcon("download").onClick(() => this.pullFromServer(file, publishedId));
            });
            menu.addSeparator();
            menu.addItem((item) => {
              item.setTitle("Unpublish from Share").setIcon("trash").onClick(() => this.unpublishDrawing(file, publishedId));
            });
          } else {
            menu.addItem((item) => {
              item.setTitle("Publish to ExcaliShare").setIcon("upload").onClick(() => this.publishDrawing(file));
            });
          }
        }
      })
    );
    this.addSettingTab(new ExcaliShareSettingTab(this.app, this));
    this.collabStatusBarItem = this.addStatusBarItem();
    this.collabStatusBarItem.setText("");
    this.collabStatusBarItem.hide();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.handleLeafChange(leaf);
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const leaf = this.app.workspace.activeLeaf;
        if (leaf) this.handleLeafChange(leaf);
      })
    );
    this.registerEvent(
      // @ts-ignore - 'modify' event exists but may not be in older type definitions
      this.app.vault.on("modify", (file) => {
        this.handleFileModify(file);
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.handleMetadataChange(file);
      })
    );
    setTimeout(() => {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf) this.handleLeafChange(leaf);
    }, 500);
  }
  onunload() {
    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }
    for (const toolbar of this.toolbarInstances.values()) {
      toolbar.remove();
    }
    this.toolbarInstances.clear();
    removeGlobalStyles();
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }
  // ── Toolbar Management ──
  handleLeafChange(leaf) {
    if (!this.settings.showFloatingToolbar) return;
    if (!leaf) return;
    const view = leaf.view;
    const viewType = view.getViewType();
    const leafId = leaf.id || "default";
    if (viewType === "excalidraw") {
      const file = this.app.workspace.getActiveFile();
      if (!file) return;
      let toolbar = this.toolbarInstances.get(leafId);
      if (!toolbar) {
        toolbar = this.createToolbar(file);
        this.toolbarInstances.set(leafId, toolbar);
      }
      const containerEl = view.containerEl;
      const excalidrawContainer = containerEl.querySelector(".excalidraw-wrapper") || containerEl.querySelector(".excalidraw") || containerEl;
      if (!toolbar.isInjected()) {
        toolbar.inject(excalidrawContainer);
      }
      this.updateToolbarState(toolbar, file);
    } else {
      const toolbar = this.toolbarInstances.get(leafId);
      if (toolbar) {
        toolbar.remove();
        this.toolbarInstances.delete(leafId);
      }
    }
  }
  createToolbar(file) {
    const callbacks = {
      onPublish: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile && this.isExcalidrawFile(currentFile)) {
          await this.publishDrawing(currentFile);
          this.refreshActiveToolbar();
        }
      },
      onSync: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile && this.isExcalidrawFile(currentFile)) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.publishDrawing(currentFile, publishedId);
            this.refreshActiveToolbar();
          }
        }
      },
      onCopyLink: () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            const url = `${this.settings.baseUrl}/d/${publishedId}`;
            navigator.clipboard.writeText(url);
          }
        }
      },
      onPull: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.pullFromServer(currentFile, publishedId);
          }
        }
      },
      onStartCollab: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.startCollabSession(currentFile, publishedId);
            this.refreshActiveToolbar();
          }
        }
      },
      onStopCollab: async () => {
        await this.stopCollabSession();
        this.refreshActiveToolbar();
      },
      onOpenInBrowser: () => {
        if (this.activeCollabDrawingId) {
          const url = `${this.settings.baseUrl}/d/${this.activeCollabDrawingId}`;
          window.open(url, "_blank");
        }
      },
      onUnpublish: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.unpublishDrawing(currentFile, publishedId);
            this.refreshActiveToolbar();
          }
        }
      },
      onOpenSettings: () => {
        this.app.setting?.open?.();
        this.app.setting?.openTabById?.("excalishare");
      }
    };
    return new ExcaliShareToolbar(
      callbacks,
      this.settings.toolbarPosition,
      this.settings.toolbarCollapsedByDefault
    );
  }
  updateToolbarState(toolbar, file) {
    const publishedId = this.getPublishedId(file);
    let status = "unpublished";
    if (publishedId) {
      if (this.activeCollabSessionId && this.activeCollabDrawingId === publishedId) {
        status = "collabActive";
      } else {
        status = "published";
      }
    }
    toolbar.updateState({
      status,
      publishedId,
      collabSessionId: this.activeCollabSessionId,
      collabDrawingId: this.activeCollabDrawingId,
      hasApiKey: !!this.settings.apiKey
    });
    toolbar.setPosition(this.settings.toolbarPosition);
  }
  refreshActiveToolbar() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;
    const leafId = leaf.id || "default";
    const toolbar = this.toolbarInstances.get(leafId);
    if (toolbar) {
      const file = this.app.workspace.getActiveFile();
      if (file) {
        this.updateToolbarState(toolbar, file);
      }
    }
  }
  // ── Auto-Sync ──
  handleFileModify(file) {
    if (!this.settings.autoSyncOnSave) return;
    if (!this.isExcalidrawFile(file)) return;
    const publishedId = this.getPublishedId(file);
    if (!publishedId) return;
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    this.autoSyncTimer = setTimeout(async () => {
      console.log("ExcaliShare: Auto-syncing", file.name);
      try {
        this.refreshActiveToolbar();
        await this.publishDrawing(file, publishedId, true);
        this.refreshActiveToolbar();
      } catch (e) {
        console.error("ExcaliShare: Auto-sync failed", e);
      }
    }, this.settings.autoSyncDelaySecs * 1e3);
  }
  // ── Metadata Change ──
  handleMetadataChange(file) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === file.path) {
      this.refreshActiveToolbar();
    }
  }
  // ── Excalidraw Plugin Integration ──
  getExcalidrawPlugin() {
    try {
      const plugin = this.app.plugins.getPlugin("obsidian-excalidraw-plugin");
      if (plugin) return plugin;
      const plugin2 = this.app.plugins.getPlugin("excalidraw");
      if (plugin2) return plugin2;
      const plugins = this.app.plugins.plugins;
      console.log("ExcaliShare: Available plugins:", Object.keys(plugins));
      return null;
    } catch (e) {
      console.log("ExcaliShare: Error getting plugin", e);
      return null;
    }
  }
  isExcalidrawFile(file) {
    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (excalidrawPlugin?.ea?.isExcalidrawFile) {
      return excalidrawPlugin.ea.isExcalidrawFile(file);
    }
    const name = file.name.toLowerCase();
    return file.extension === "md" && (name.includes(".excalidraw") || name.endsWith("excalidraw"));
  }
  getPublishedId(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache && cache.frontmatter && cache.frontmatter["excalishare-id"]) {
      return cache.frontmatter["excalishare-id"];
    }
    return null;
  }
  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshActiveToolbar();
  }
  // ── API Methods ──
  async publishDrawing(file, existingId, silent = false) {
    console.log("ExcaliShare: Publishing", file.name);
    if (!this.settings.apiKey) {
      if (!silent) new import_obsidian3.Notice("Please configure API key in plugin settings");
      return;
    }
    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      if (!silent) new import_obsidian3.Notice("Excalidraw plugin not found. Please install Excalidraw.");
      return;
    }
    if (!silent) new import_obsidian3.Notice(existingId ? "Syncing drawing..." : "Publishing drawing...");
    try {
      const scene = await excalidrawPlugin.ea.getSceneFromFile(file);
      if (!scene || !scene.elements || scene.elements.length === 0) {
        if (!silent) new import_obsidian3.Notice("Drawing is empty.");
        return;
      }
      let files = {};
      const elementCropRects = {};
      if (scene.elements) {
        for (const el of scene.elements) {
          if (el && typeof el === "object") {
            const element = el;
            if (element.type === "image" && element.fileId && element.link) {
              const link = element.link;
              const rectMatch = link.match(/[&#]rect=(\d+),(\d+),(\d+),(\d+)/);
              if (rectMatch) {
                const rect = [rectMatch[1], rectMatch[2], rectMatch[3], rectMatch[4]].map(Number);
                elementCropRects[element.fileId] = rect;
              }
            }
          }
        }
      }
      try {
        excalidrawPlugin.ea.setView("active");
        const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
        if (excalidrawAPI && typeof excalidrawAPI.getFiles === "function") {
          const apiFiles = excalidrawAPI.getFiles();
          if (apiFiles && Object.keys(apiFiles).length > 0) {
            for (const [fileId, fileData] of Object.entries(apiFiles)) {
              if (fileData && fileData.dataURL) {
                files[fileId] = {
                  mimeType: fileData.mimeType,
                  id: fileData.id,
                  dataURL: fileData.dataURL,
                  created: fileData.created
                };
              }
            }
            console.log("ExcaliShare: Fetched images from active Excalidraw view", Object.keys(files).length);
          }
        }
      } catch (e) {
        console.log("ExcaliShare: Could not fetch files from active view, falling back to manual parse", e);
      }
      if (Object.keys(files).length === 0) {
        console.log("ExcaliShare: Parsing embedded files manually from markdown");
        const fileContent = await this.app.vault.read(file);
        const embeddedFilesMatch = fileContent.match(/## Embedded Files\n([\s\S]*?)(?:# |$)/);
        if (embeddedFilesMatch) {
          const filesSection = embeddedFilesMatch[1];
          const fileRegex = /([a-f0-9]+):\s*\[\[(.*?)\]\]/g;
          let match;
          while ((match = fileRegex.exec(filesSection)) !== null) {
            const fileId = match[1];
            let linkPath = match[2];
            let pageNum = 1;
            if (linkPath.includes("#page=")) {
              const pageMatch = linkPath.match(/#page=(\d+)/);
              if (pageMatch) pageNum = parseInt(pageMatch[1]);
            }
            let cropRect;
            const rectMatch = linkPath.match(/[&#]rect=(\d+),(\d+),(\d+),(\d+)/);
            if (rectMatch) {
              cropRect = [rectMatch[1], rectMatch[2], rectMatch[3], rectMatch[4]].map(Number);
            } else if (elementCropRects[fileId]) {
              cropRect = elementCropRects[fileId];
            }
            if (linkPath.includes("|")) linkPath = linkPath.split("|")[0];
            if (linkPath.includes("#")) linkPath = linkPath.split("#")[0];
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
            if (linkedFile && linkedFile instanceof import_obsidian3.TFile) {
              const ext = linkedFile.extension.toLowerCase();
              if (ext === "pdf") {
                try {
                  const pngBase64 = await pdfToPng(this.app, linkedFile, pageNum, cropRect, this.settings.pdfScale);
                  files[fileId] = {
                    mimeType: "image/png",
                    id: fileId,
                    dataURL: `data:image/png;base64,${pngBase64}`,
                    created: linkedFile.stat.ctime
                  };
                  console.log(`ExcaliShare: Converted PDF ${linkPath} page ${pageNum} to PNG (${fileId})`);
                } catch (e) {
                  console.error(`ExcaliShare: Failed to convert PDF ${linkPath}`, e);
                }
                continue;
              }
              const supportedImageTypes = ["png", "jpg", "jpeg", "svg", "gif"];
              if (!supportedImageTypes.includes(ext)) {
                console.log(`ExcaliShare: Skipping unsupported embedded file type ${ext} for ${linkPath}`);
                continue;
              }
              try {
                const arrayBuffer = await this.app.vault.readBinary(linkedFile);
                const base64 = (0, import_obsidian3.arrayBufferToBase64)(arrayBuffer);
                let mimeType = "image/png";
                if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
                else if (ext === "svg") mimeType = "image/svg+xml";
                else if (ext === "gif") mimeType = "image/gif";
                files[fileId] = {
                  mimeType,
                  id: fileId,
                  dataURL: `data:${mimeType};base64,${base64}`,
                  created: linkedFile.stat.ctime
                };
                console.log(`ExcaliShare: Processed image ${linkPath} (${fileId})`);
              } catch (e) {
                console.error(`ExcaliShare: Failed to read image ${linkPath}`, e);
              }
            }
          }
        }
      }
      const appState = scene.appState || {};
      const payload = {
        type: "excalidraw",
        version: 2,
        elements: scene.elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
          theme: appState.theme ?? "light",
          ...appState
        },
        files
      };
      const sourcePath = file.path;
      const bodyData = {
        ...payload,
        source_path: sourcePath
      };
      if (existingId) {
        bodyData.id = existingId;
      }
      const response = await fetch(`${this.settings.baseUrl}/api/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify(bodyData)
      });
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      const result = await response.json();
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter["excalishare-id"] = result.id;
      });
      await navigator.clipboard.writeText(result.url);
      if (!silent) {
        new import_obsidian3.Notice(`Drawing ${existingId ? "synced" : "published"}! URL copied to clipboard.`);
      }
    } catch (error) {
      console.error("ExcaliShare: Publish error", error);
      if (!silent) {
        new import_obsidian3.Notice(`Failed to publish: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }
  async unpublishDrawing(file, existingId) {
    if (!this.settings.apiKey) {
      new import_obsidian3.Notice("Please configure API key in plugin settings");
      return false;
    }
    const idToDelete = existingId || this.getPublishedId(file);
    if (!idToDelete) {
      new import_obsidian3.Notice("This drawing does not appear to be published.");
      return false;
    }
    try {
      const deleteResponse = await fetch(`${this.settings.baseUrl}/api/drawings/${idToDelete}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${this.settings.apiKey}`
        }
      });
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        throw new Error("Delete failed");
      }
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        delete frontmatter["excalishare-id"];
      });
      new import_obsidian3.Notice("Drawing unpublished successfully");
      return true;
    } catch (error) {
      console.error(error);
      new import_obsidian3.Notice(`Failed to unpublish: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    }
  }
  async isDrawingPublished(file) {
    return this.getPublishedId(file) !== null;
  }
  // ── Collab Methods ──
  async startCollabSession(file, drawingId) {
    if (!this.settings.apiKey) {
      new import_obsidian3.Notice("Please configure API key in plugin settings");
      return;
    }
    if (this.activeCollabSessionId) {
      new import_obsidian3.Notice("A collab session is already active. Stop it first.");
      return;
    }
    new import_obsidian3.Notice("Starting live collab session...");
    try {
      const response = await fetch(`${this.settings.baseUrl}/api/collab/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          drawing_id: drawingId,
          timeout_secs: this.settings.collabTimeoutSecs
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to start session: ${response.status}`);
      }
      const result = await response.json();
      this.activeCollabSessionId = result.session_id;
      this.activeCollabDrawingId = drawingId;
      if (this.collabStatusBarItem) {
        this.collabStatusBarItem.setText("\u{1F534} Live Collab");
        this.collabStatusBarItem.show();
      }
      this.collabHealthInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${this.settings.baseUrl}/api/collab/status/${drawingId}`);
          const status = await statusRes.json();
          if (!status.active) {
            this.cleanupCollabState();
            new import_obsidian3.Notice("Collab session ended.");
            this.refreshActiveToolbar();
          }
        } catch {
        }
      }, 3e4);
      const viewUrl = `${this.settings.baseUrl}/d/${drawingId}`;
      new import_obsidian3.Notice(`Live collab session started! Session ID: ${result.session_id}`);
      if (this.settings.collabAutoOpenBrowser) {
        window.open(viewUrl, "_blank");
      }
      console.log("ExcaliShare: Collab session started", result);
    } catch (error) {
      console.error("ExcaliShare: Failed to start collab session", error);
      new import_obsidian3.Notice(`Failed to start collab: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  async stopCollabSession() {
    if (!this.activeCollabSessionId) {
      new import_obsidian3.Notice("No active collab session.");
      return;
    }
    if (!this.settings.apiKey) {
      new import_obsidian3.Notice("Please configure API key in plugin settings");
      return;
    }
    const save = await new Promise((resolve) => {
      const modal = new CollabStopModal(this.app, resolve);
      modal.open();
    });
    if (save === null) return;
    new import_obsidian3.Notice(save ? "Saving and stopping collab session..." : "Discarding and stopping collab session...");
    try {
      const response = await fetch(`${this.settings.baseUrl}/api/collab/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          session_id: this.activeCollabSessionId,
          save
        })
      });
      if (!response.ok) {
        throw new Error(`Failed to stop session: ${response.status}`);
      }
      const drawingId = this.activeCollabDrawingId;
      this.cleanupCollabState();
      if (save && drawingId) {
        const file = this.app.workspace.getActiveFile();
        if (file && this.getPublishedId(file) === drawingId) {
          await this.pullFromServer(file, drawingId);
        } else {
          new import_obsidian3.Notice('Collab session saved. Use "Pull from ExcaliShare" to sync changes to your vault.');
        }
      } else {
        new import_obsidian3.Notice("Collab session ended. Changes discarded.");
      }
    } catch (error) {
      console.error("ExcaliShare: Failed to stop collab session", error);
      new import_obsidian3.Notice(`Failed to stop collab: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  cleanupCollabState() {
    this.activeCollabSessionId = null;
    this.activeCollabDrawingId = null;
    if (this.collabStatusBarItem) {
      this.collabStatusBarItem.setText("");
      this.collabStatusBarItem.hide();
    }
    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }
  }
  async pullFromServer(file, drawingId) {
    new import_obsidian3.Notice("Pulling drawing from server...");
    try {
      const response = await fetch(`${this.settings.baseUrl}/api/view/${drawingId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch drawing: ${response.status}`);
      }
      const data = await response.json();
      const excalidrawPlugin = this.getExcalidrawPlugin();
      if (excalidrawPlugin?.ea) {
        try {
          excalidrawPlugin.ea.setView("active");
          const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
          if (excalidrawAPI && typeof excalidrawAPI.updateScene === "function") {
            excalidrawAPI.updateScene({
              elements: data.elements || [],
              appState: data.appState || {}
            });
            new import_obsidian3.Notice("Drawing synced back to vault!");
            return;
          }
        } catch {
        }
      }
      const content = await this.app.vault.read(file);
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const updatedJson = JSON.stringify({
          type: data.type || "excalidraw",
          version: data.version || 2,
          elements: data.elements || [],
          appState: data.appState || {}
        }, null, 2);
        const newContent = content.replace(
          /```json\n[\s\S]*?\n```/,
          "```json\n" + updatedJson + "\n```"
        );
        await this.app.vault.modify(file, newContent);
        new import_obsidian3.Notice("Drawing synced back to vault!");
      } else {
        new import_obsidian3.Notice("Could not update file format. Please manually sync.");
      }
    } catch (error) {
      console.error("ExcaliShare: Pull failed", error);
      new import_obsidian3.Notice(`Failed to pull: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
};
var CollabStopModal = class extends import_obsidian3.Modal {
  constructor(app, resolve) {
    super(app);
    this.resolve = resolve;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Stop Live Collab Session" });
    contentEl.createEl("p", { text: "Do you want to save the changes made during the collaboration session?" });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.marginTop = "16px";
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
    const discardBtn = buttonContainer.createEl("button", { text: "Discard Changes" });
    discardBtn.style.backgroundColor = "#f44336";
    discardBtn.style.color = "#fff";
    discardBtn.addEventListener("click", () => {
      this.resolve(false);
      this.close();
    });
    const saveBtn = buttonContainer.createEl("button", { text: "Save Changes", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => {
      this.resolve(true);
      this.close();
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
