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
  collabPollIntervalMs: number;
  // Toolbar settings
  showFloatingToolbar: boolean;
  toolbarPosition: ToolbarPosition;
  autoSyncOnSave: boolean;
  autoSyncDelaySecs: number;
  toolbarCollapsedByDefault: boolean;
}

export const DEFAULT_SETTINGS: ExcaliShareSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:8184',
  pdfScale: 1.5,
  collabTimeoutSecs: 7200,
  collabAutoOpenBrowser: true,
  collabJoinFromObsidian: true,
  collabDisplayName: 'Host',
  collabPollIntervalMs: 250,
  showFloatingToolbar: true,
  toolbarPosition: 'top-left',
  autoSyncOnSave: false,
  autoSyncDelaySecs: 5,
  toolbarCollapsedByDefault: true,
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
    containerEl.createEl('h3', { text: 'Floating Toolbar' });

    new Setting(containerEl)
      .setName('Show Floating Toolbar')
      .setDesc('Display the ExcaliShare toolbar directly inside the Excalidraw canvas for quick access to all actions.')
      .addToggle(toggle => {
        toggle.setValue(this.pluginRef.settings.showFloatingToolbar)
          .onChange(value => {
            this.pluginRef.settings.showFloatingToolbar = value;
            this.pluginRef.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Toolbar Position')
      .setDesc('Where to place the floating toolbar in the Excalidraw view.')
      .addDropdown(dropdown => {
        dropdown
          .addOption('top-right', 'Top Right')
          .addOption('top-left', 'Top Left')
          .addOption('bottom-right', 'Bottom Right')
          .addOption('bottom-left', 'Bottom Left')
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
  }
}
