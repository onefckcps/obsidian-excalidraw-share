"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const DEFAULT_SETTINGS = {
    apiKey: '',
    baseUrl: 'http://localhost:8184',
};
class ExcalidrawSharePlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
    }
    async onload() {
        await this.loadSettings();
        console.log('Excalidraw Share: Plugin loaded');
        // Add ribbon icon in sidebar
        this.addRibbonIcon('upload', 'Publish Drawing', async () => {
            const file = this.app.workspace.getActiveFile();
            if (file && this.isExcalidrawFile(file)) {
                await this.publishDrawing(file);
            }
            else {
                new obsidian_1.Notice('No Excalidraw file open. Open a .excalidraw file first.');
            }
        });
        // Add command
        this.addCommand({
            id: 'publish-drawing',
            name: 'Publish to Excalidraw Share',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (file && this.isExcalidrawFile(file)) {
                    if (!checking) {
                        this.publishDrawing(file);
                    }
                    return true;
                }
                return false;
            },
        });
        // File context menu
        this.registerEvent(
        // @ts-ignore
        this.app.workspace.on('file-menu', (menu, file) => {
            if (this.isExcalidrawFile(file)) {
                const publishedId = this.getPublishedId(file);
                if (publishedId) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Sync to Excalidraw Share')
                            .setIcon('refresh-cw')
                            .onClick(() => this.publishDrawing(file, publishedId));
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle('Copy Share Link')
                            .setIcon('link')
                            .onClick(() => {
                            const url = `${this.settings.baseUrl}/d/${publishedId}`;
                            navigator.clipboard.writeText(url);
                            new obsidian_1.Notice('Share link copied to clipboard!');
                        });
                    });
                    menu.addSeparator();
                    menu.addItem((item) => {
                        item
                            .setTitle('Unpublish from Share')
                            .setIcon('trash')
                            .onClick(() => this.unpublishDrawing(file, publishedId));
                    });
                }
                else {
                    menu.addItem((item) => {
                        item
                            .setTitle('Publish to Excalidraw Share')
                            .setIcon('upload')
                            .onClick(() => this.publishDrawing(file));
                    });
                }
            }
        }));
        this.addSettingTab(new ExcalidrawShareSettingTab(this.app, this));
    }
    getExcalidrawPlugin() {
        try {
            // Try different plugin IDs
            // The official Excalidraw plugin ID is 'obsidian-excalidraw-plugin'
            const plugin = this.app.plugins.getPlugin('obsidian-excalidraw-plugin');
            if (plugin) {
                console.log('Excalidraw Share: Found Excalidraw plugin');
                return plugin;
            }
            // Also try 'excalidraw'
            const plugin2 = this.app.plugins.getPlugin('excalidraw');
            if (plugin2) {
                console.log('Excalidraw Share: Found Excalidraw plugin (alt ID)');
                return plugin2;
            }
            // Log available plugins for debugging
            const plugins = this.app.plugins.plugins;
            console.log('Excalidraw Share: Available plugins:', Object.keys(plugins));
            return null;
        }
        catch (e) {
            console.log('Excalidraw Share: Error getting plugin', e);
            return null;
        }
    }
    isExcalidrawFile(file) {
        const excalidrawPlugin = this.getExcalidrawPlugin();
        if (excalidrawPlugin?.ea?.isExcalidrawFile) {
            return excalidrawPlugin.ea.isExcalidrawFile(file);
        }
        // Fallback check
        const name = file.name.toLowerCase();
        return file.extension === 'md' &&
            (name.includes('.excalidraw') || name.endsWith('excalidraw'));
    }
    getPublishedId(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache && cache.frontmatter && cache.frontmatter['excalidraw-share-id']) {
            return cache.frontmatter['excalidraw-share-id'];
        }
        return null;
    }
    async loadSettings() {
        this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async publishDrawing(file, existingId) {
        console.log('Excalidraw Share: Publishing', file.name);
        if (!this.settings.apiKey) {
            new obsidian_1.Notice('Please configure API key in plugin settings');
            return;
        }
        const excalidrawPlugin = this.getExcalidrawPlugin();
        if (!excalidrawPlugin?.ea) {
            new obsidian_1.Notice('Excalidraw plugin not found. Please install Excalidraw.');
            return;
        }
        new obsidian_1.Notice(existingId ? 'Syncing drawing...' : 'Publishing drawing...');
        try {
            // Use ExcalidrawAutomate to get scene data
            const scene = await excalidrawPlugin.ea.getSceneFromFile(file);
            if (!scene || !scene.elements || scene.elements.length === 0) {
                new obsidian_1.Notice('Drawing is empty.');
                return;
            }
            // Get embedded files if available
            let files = {};
            const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
            if (excalidrawAPI?.getFiles) {
                files = excalidrawAPI.getFiles();
            }
            // Build payload in Excalidraw format
            const appState = scene.appState || {};
            const payload = {
                type: 'excalidraw',
                version: 2,
                elements: scene.elements,
                appState: {
                    viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
                    theme: appState.theme ?? 'light',
                    ...appState,
                },
                files: files,
            };
            const sourcePath = file.path;
            const bodyData = {
                ...payload,
                source_path: sourcePath,
            };
            // If we are updating an existing published drawing, pass its ID
            if (existingId) {
                bodyData.id = existingId;
            }
            const response = await fetch(`${this.settings.baseUrl}/api/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                },
                body: JSON.stringify(bodyData),
            });
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
            }
            const result = await response.json();
            // Save the ID in the file's frontmatter
            // @ts-ignore - processFrontMatter is available in newer Obsidian APIs
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter['excalidraw-share-id'] = result.id;
            });
            await navigator.clipboard.writeText(result.url);
            new obsidian_1.Notice(`Drawing ${existingId ? 'synced' : 'published'}! URL copied to clipboard.`);
        }
        catch (error) {
            console.error('Excalidraw Share: Publish error', error);
            new obsidian_1.Notice(`Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async unpublishDrawing(file, existingId) {
        if (!this.settings.apiKey) {
            new obsidian_1.Notice('Please configure API key in plugin settings');
            return false;
        }
        const idToDelete = existingId || this.getPublishedId(file);
        if (!idToDelete) {
            new obsidian_1.Notice('This drawing does not appear to be published.');
            return false;
        }
        try {
            const deleteResponse = await fetch(`${this.settings.baseUrl}/api/drawings/${idToDelete}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                },
            });
            // Even if it fails with 404 (already deleted on server), we should still clean up the local frontmatter
            if (!deleteResponse.ok && deleteResponse.status !== 404) {
                throw new Error('Delete failed');
            }
            // Remove the ID from the file's frontmatter
            // @ts-ignore - processFrontMatter is available in newer Obsidian APIs
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                delete frontmatter['excalidraw-share-id'];
            });
            new obsidian_1.Notice('Drawing unpublished successfully');
            return true;
        }
        catch (error) {
            console.error(error);
            new obsidian_1.Notice(`Failed to unpublish: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }
    // We no longer need this slow API-based check since we use frontmatter now
    // keeping it just in case, but unused.
    async isDrawingPublished(file) {
        return this.getPublishedId(file) !== null;
    }
}
exports.default = ExcalidrawSharePlugin;
class ExcalidrawShareSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.pluginRef = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Excalidraw Share Settings' });
        new obsidian_1.Setting(containerEl)
            .setName('API Key')
            .setDesc('API key for the share server')
            .addText(text => {
            text.setPlaceholder('Enter API key').setValue(this.pluginRef.settings.apiKey)
                .onChange(value => {
                this.pluginRef.settings.apiKey = value;
                this.pluginRef.saveSettings();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName('Server URL')
            .setDesc('Base URL of the Excalidraw Share server')
            .addText(text => {
            text.setPlaceholder('http://localhost:8184').setValue(this.pluginRef.settings.baseUrl)
                .onChange(value => {
                this.pluginRef.settings.baseUrl = value;
                this.pluginRef.saveSettings();
            });
        });
    }
}
