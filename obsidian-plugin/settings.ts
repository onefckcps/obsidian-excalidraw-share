import { App, PluginSettingTab, Setting } from 'obsidian';
import type { ToolbarPosition } from './styles';

export interface ExcaliShareSettings {
  apiKey: string;
  baseUrl: string;
  pdfScale: number;
  collabTimeoutSecs: number;
  collabAutoOpenBrowser: boolean;
  // Native collab (in-Obsidian participation)
  collabJoinFromObsidian: boolean;
  collabDisplayName: string;
  // Toolbar settings
  showFloatingToolbar: boolean;
  toolbarPosition: ToolbarPosition;
  autoSyncOnSave: boolean;
  autoSyncDelaySecs: number;
  toolbarCollapsedByDefault: boolean;
  /** Use bottom-sheet style for the toolbar popover on mobile devices (default: true).
   *  When false, the same dropdown style as desktop is used on mobile. */
  mobilePopoverBottomSheet: boolean;
  /** Auto-pull server changes when opening a persistent collab drawing */
  persistentCollabAutoSync: boolean;
  // ── Excalidraw Scripts ──
  /** Enable zoom-adaptive stroke width script */
  enableZoomAdaptiveStroke: boolean;
  /** Base stroke width at 100% zoom */
  zoomAdaptiveBaseStrokeWidth: number;
  /** Polling interval in ms for zoom detection (fallback only — event-driven is preferred) */
  zoomAdaptivePollIntervalMs: number;
  /** Disable smoothing and streamline for more precise pen input */
  disableSmoothing: boolean;
  /** Enable right-click eraser toggle in freedraw mode */
  enableRightClickEraser: boolean;
}

export const DEFAULT_SETTINGS: ExcaliShareSettings = {
  apiKey: '',
  baseUrl: 'https://notes.leyk.me',
  pdfScale: 1.5,
  collabTimeoutSecs: 7200,
  collabAutoOpenBrowser: true,
  collabJoinFromObsidian: true,
  collabDisplayName: 'Host',
  showFloatingToolbar: true,
  toolbarPosition: 'auto',
  autoSyncOnSave: false,
  autoSyncDelaySecs: 5,
  toolbarCollapsedByDefault: true,
  mobilePopoverBottomSheet: true,
  persistentCollabAutoSync: true,
  enableZoomAdaptiveStroke: true,
  zoomAdaptiveBaseStrokeWidth: 0.7,
  zoomAdaptivePollIntervalMs: 200,
  disableSmoothing: true,
  enableRightClickEraser: true,
};

/** Interface for the plugin reference needed by the settings tab */
export interface ExcaliSharePluginRef {
  settings: ExcaliShareSettings;
  saveSettings(): Promise<void>;
}

export class ExcaliShareSettingTab extends PluginSettingTab {
  private pluginRef: ExcaliSharePluginRef;

  constructor(app: App, plugin: ExcaliSharePluginRef & { app: App; manifest: any }) {
    super(app, plugin as any);
    this.pluginRef = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Server Settings ──
    containerEl.createEl('h2', { text: 'ExcaliShare Settings' });

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('API key for the share server')
      .addText(text => {
        text.setPlaceholder('Enter API key').setValue(this.pluginRef.settings.apiKey)
          .onChange(value => {
            this.pluginRef.settings.apiKey = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Base URL of the Excalidraw Share server')
      .addText(text => {
        text.setPlaceholder('http://localhost:8184').setValue(this.pluginRef.settings.baseUrl)
          .onChange(value => {
            this.pluginRef.settings.baseUrl = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('PDF Scale')
      .setDesc('Scale factor for PDF to PNG conversion (0.5 - 5.0). Higher values = better quality but larger file size.')
      .addSlider(slider => {
        slider.setValue(this.pluginRef.settings.pdfScale)
          .setLimits(0.5, 5.0, 0.1)
          .setDynamicTooltip()
          .onChange(value => {
            this.pluginRef.settings.pdfScale = value;
            this.pluginRef.saveSettings();
          });
      });

    // ── Toolbar Settings ──
    containerEl.createEl('h3', { text: 'Toolbar' });

    new Setting(containerEl)
      .setName('Show Toolbar')
      .setDesc('Display the ExcaliShare toolbar for quick access to all actions (publish, sync, collab, etc.).')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.showFloatingToolbar)
          .onChange(value => {
            this.pluginRef.settings.showFloatingToolbar = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Toolbar Mode')
      .setDesc('Auto: inject into Excalidraw\'s native toolbar (recommended). Floating: overlay at a fixed position.')
      .addDropdown(dropdown => {
        dropdown
          .addOption('auto', 'Auto (Native Toolbar)')
          .addOption('top-right', 'Floating — Top Right')
          .addOption('top-left', 'Floating — Top Left')
          .addOption('bottom-right', 'Floating — Bottom Right')
          .addOption('bottom-left', 'Floating — Bottom Left')
          .setValue(this.pluginRef.settings.toolbarPosition)
          .onChange(value => {
            this.pluginRef.settings.toolbarPosition = value as ToolbarPosition;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Start Collapsed')
      .setDesc('Start the toolbar in collapsed mode (small icon). Click to expand.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.toolbarCollapsedByDefault)
          .onChange(value => {
            this.pluginRef.settings.toolbarCollapsedByDefault = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Mobile: Bottom Sheet Popover')
      .setDesc('On mobile devices, show the toolbar popover as a bottom sheet (slides up from the bottom). Disable to use the same dropdown style as on desktop.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.mobilePopoverBottomSheet)
          .onChange(value => {
            this.pluginRef.settings.mobilePopoverBottomSheet = value;
            this.pluginRef.saveSettings();
          });
      });

    // ── Auto-Sync Settings ──
    containerEl.createEl('h3', { text: 'Auto-Sync' });

    new Setting(containerEl)
      .setName('Auto-Sync on Save')
      .setDesc('Automatically sync published drawings to the server when you save changes.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.autoSyncOnSave)
          .onChange(value => {
            this.pluginRef.settings.autoSyncOnSave = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Auto-Sync Delay')
      .setDesc('Seconds to wait after the last change before auto-syncing (1-30).')
      .addSlider(slider => {
        slider.setValue(this.pluginRef.settings.autoSyncDelaySecs)
          .setLimits(1, 30, 1)
          .setDynamicTooltip()
          .onChange(value => {
            this.pluginRef.settings.autoSyncDelaySecs = value;
            this.pluginRef.saveSettings();
          });
      });

    // ── Live Collaboration ──
    containerEl.createEl('h3', { text: 'Live Collaboration' });

    new Setting(containerEl)
      .setName('Session Timeout')
      .setDesc('How long a collab session stays alive (in hours). Default: 2 hours.')
      .addSlider(slider => {
        slider.setValue(this.pluginRef.settings.collabTimeoutSecs / 3600)
          .setLimits(0.5, 12, 0.5)
          .setDynamicTooltip()
          .onChange(value => {
            this.pluginRef.settings.collabTimeoutSecs = value * 3600;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Join from Obsidian')
      .setDesc('Participate in collab sessions directly within the Obsidian Excalidraw canvas (see other users\' cursors and changes in real-time).')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.collabJoinFromObsidian)
          .onChange(value => {
            this.pluginRef.settings.collabJoinFromObsidian = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Display Name')
      .setDesc('Your display name shown to other collaborators.')
      .addText(text => {
        text.setPlaceholder('Host').setValue(this.pluginRef.settings.collabDisplayName)
          .onChange(value => {
            this.pluginRef.settings.collabDisplayName = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Auto-open Browser')
      .setDesc('Automatically open the web viewer when starting a collab session.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.collabAutoOpenBrowser)
          .onChange(value => {
            this.pluginRef.settings.collabAutoOpenBrowser = value;
            this.pluginRef.saveSettings();
          });
      });

    // ── Persistent Collaboration ──
    containerEl.createEl('h3', { text: 'Persistent Collaboration' });

    new Setting(containerEl)
      .setName('Auto-sync on open')
      .setDesc('Automatically pull latest changes from server when opening a persistent collab drawing.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.persistentCollabAutoSync)
          .onChange(value => {
            this.pluginRef.settings.persistentCollabAutoSync = value;
            this.pluginRef.saveSettings();
          });
      });

    // ── Excalidraw Scripts ──
    containerEl.createEl('h3', { text: 'Excalidraw Scripts' });
    containerEl.createEl('p', {
      text: 'Built-in scripts that enhance the Excalidraw drawing experience. They activate automatically on every drawing.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Zoom-Adaptive Stroke Width')
      .setDesc('Automatically adjusts stroke width based on zoom level. Uses event-driven detection when available, with polling fallback for older Excalidraw versions.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.enableZoomAdaptiveStroke)
          .onChange(value => {
            this.pluginRef.settings.enableZoomAdaptiveStroke = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Base Stroke Width')
      .setDesc('Stroke width at 100% zoom. The actual width is scaled inversely with zoom (0.1 - 5.0).')
      .addSlider(slider => {
        slider.setValue(this.pluginRef.settings.zoomAdaptiveBaseStrokeWidth)
          .setLimits(0.1, 5.0, 0.1)
          .setDynamicTooltip()
          .onChange(value => {
            this.pluginRef.settings.zoomAdaptiveBaseStrokeWidth = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Zoom Poll Interval (Fallback)')
      .setDesc('Polling interval in ms for older Excalidraw versions without event-driven zoom detection (50 - 1000). Ignored when event-driven mode is active.')
      .addSlider(slider => {
        slider.setValue(this.pluginRef.settings.zoomAdaptivePollIntervalMs)
          .setLimits(50, 1000, 50)
          .setDynamicTooltip()
          .onChange(value => {
            this.pluginRef.settings.zoomAdaptivePollIntervalMs = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Disable Smoothing & Streamline')
      .setDesc('Disables stroke smoothing and streamline for more precise pen/stylus input. Independent from zoom-adaptive stroke width.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.disableSmoothing)
          .onChange(value => {
            this.pluginRef.settings.disableSmoothing = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Right-Click Eraser in Freedraw')
      .setDesc('Hold right mouse button or S Pen side button in freedraw mode to temporarily switch to eraser. Release to return to freedraw.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.enableRightClickEraser)
          .onChange(value => {
            this.pluginRef.settings.enableRightClickEraser = value;
            this.pluginRef.saveSettings();
          });
      });
  }
}
