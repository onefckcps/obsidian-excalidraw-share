"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const blobToBase64 = async (blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    let len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};
const cropCanvas = (canvas, crop) => {
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = Math.round(crop.width);
    croppedCanvas.height = Math.round(crop.height);
    const croppedCtx = croppedCanvas.getContext('2d');
    if (croppedCtx) {
        croppedCtx.drawImage(canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    }
    return croppedCanvas.toDataURL('image/png').split(',')[1];
};
const pdfToPng = async (app, file, pageNum = 1, cropRect, scale = 1.5) => {
    try {
        await (0, obsidian_1.loadPdfJs)();
        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js not loaded');
        }
        const url = app.vault.getResourcePath(file);
        const pdfDoc = await pdfjsLib.getDocument(url).promise;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = Math.round(viewport.height);
        canvas.width = Math.round(viewport.width);
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
        };
        await page.render(renderContext).promise;
        const validRect = cropRect && cropRect.length === 4 && cropRect.every(x => !isNaN(x));
        let resultBase64;
        if (validRect) {
            const [pageLeft, pageBottom, pageRight, pageTop] = page.view;
            const pageHeight = pageTop - pageBottom;
            const pageWidth = pageRight - pageLeft;
            const crop = {
                left: (cropRect[0] - pageLeft) * scale,
                top: (pageBottom + pageHeight - cropRect[3]) * scale,
                width: (cropRect[2] - cropRect[0]) * scale,
                height: (cropRect[3] - cropRect[1]) * scale,
            };
            resultBase64 = cropCanvas(canvas, crop);
        }
        else {
            resultBase64 = await new Promise((resolve, reject) => {
                canvas.toBlob(async (blob) => {
                    if (blob) {
                        const base64 = await blobToBase64(blob);
                        resolve(base64);
                    }
                    else {
                        reject(new Error('Failed to create blob from canvas'));
                    }
                }, 'image/png');
            });
        }
        return resultBase64;
    }
    catch (e) {
        console.error('Excalidraw Share: PDF conversion failed', e);
        throw e;
    }
};
const DEFAULT_SETTINGS = {
    apiKey: '',
    baseUrl: 'http://localhost:8184',
    pdfScale: 1.5,
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
            // Get embedded files if available from active view
            let files = {};
            // Extract rect info from elements for PDF cropping
            const elementCropRects = {};
            if (scene.elements) {
                for (const el of scene.elements) {
                    if (el && typeof el === 'object') {
                        const element = el;
                        if (element.type === 'image' && element.fileId && element.link) {
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
                const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
                if (excalidrawAPI && typeof excalidrawAPI.getFiles === 'function') {
                    const apiFiles = excalidrawAPI.getFiles();
                    if (apiFiles && Object.keys(apiFiles).length > 0) {
                        for (const [fileId, fileData] of Object.entries(apiFiles)) {
                            if (fileData && fileData.dataURL) {
                                files[fileId] = {
                                    mimeType: fileData.mimeType,
                                    id: fileData.id,
                                    dataURL: fileData.dataURL,
                                    created: fileData.created,
                                };
                            }
                        }
                        console.log('Excalidraw Share: Fetched images from active Excalidraw view', Object.keys(files).length);
                    }
                }
            }
            catch (e) {
                console.log('Excalidraw Share: Could not fetch files from active view, falling back to manual parse', e);
            }
            // If active view didn't have the files (e.g. published from file explorer), parse manually
            if (Object.keys(files).length === 0) {
                console.log('Excalidraw Share: Parsing embedded files manually from markdown');
                const fileContent = await this.app.vault.read(file);
                // Look for the "Embedded Files" section
                const embeddedFilesMatch = fileContent.match(/## Embedded Files\n([\s\S]*?)(?:# |$)/);
                if (embeddedFilesMatch) {
                    const filesSection = embeddedFilesMatch[1];
                    const fileRegex = /([a-f0-9]+):\s*\[\[(.*?)\]\]/g;
                    let match;
                    while ((match = fileRegex.exec(filesSection)) !== null) {
                        const fileId = match[1];
                        let linkPath = match[2];
                        // Parse page number from link before stripping (e.g., [[Doc.pdf#page=3]])
                        let pageNum = 1;
                        if (linkPath.includes('#page=')) {
                            const pageMatch = linkPath.match(/#page=(\d+)/);
                            if (pageMatch)
                                pageNum = parseInt(pageMatch[1]);
                        }
                        // Parse rect parameter for PDF cropping (e.g., &rect=17,23,437,226 or #rect=...)
                        // First check if rect is in the embedded files link
                        let cropRect;
                        const rectMatch = linkPath.match(/[&#]rect=(\d+),(\d+),(\d+),(\d+)/);
                        if (rectMatch) {
                            cropRect = [rectMatch[1], rectMatch[2], rectMatch[3], rectMatch[4]].map(Number);
                        }
                        else if (elementCropRects[fileId]) {
                            // Fallback: get rect from element data
                            cropRect = elementCropRects[fileId];
                        }
                        // Strip aliases and subpaths from link e.g. [[Image.png|Alias]] -> Image.png
                        if (linkPath.includes('|'))
                            linkPath = linkPath.split('|')[0];
                        if (linkPath.includes('#'))
                            linkPath = linkPath.split('#')[0];
                        // Try to find the file in the vault
                        const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
                        if (linkedFile && linkedFile instanceof obsidian_1.TFile) {
                            const ext = linkedFile.extension.toLowerCase();
                            // Handle PDF files - convert to PNG
                            if (ext === 'pdf') {
                                try {
                                    const pngBase64 = await pdfToPng(this.app, linkedFile, pageNum, cropRect, this.settings.pdfScale);
                                    files[fileId] = {
                                        mimeType: 'image/png',
                                        id: fileId,
                                        dataURL: `data:image/png;base64,${pngBase64}`,
                                        created: linkedFile.stat.ctime,
                                    };
                                    console.log(`Excalidraw Share: Converted PDF ${linkPath} page ${pageNum} to PNG (${fileId})`);
                                }
                                catch (e) {
                                    console.error(`Excalidraw Share: Failed to convert PDF ${linkPath}`, e);
                                }
                                continue;
                            }
                            // Only process image files for manual parsing
                            const supportedImageTypes = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
                            if (!supportedImageTypes.includes(ext)) {
                                console.log(`Excalidraw Share: Skipping unsupported embedded file type ${ext} for ${linkPath}`);
                                continue;
                            }
                            try {
                                // Read file as binary
                                const arrayBuffer = await this.app.vault.readBinary(linkedFile);
                                // Convert ArrayBuffer to base64 safely using Obsidian's built-in function
                                const base64 = (0, obsidian_1.arrayBufferToBase64)(arrayBuffer);
                                // Determine mime type
                                let mimeType = 'image/png';
                                if (ext === 'jpg' || ext === 'jpeg')
                                    mimeType = 'image/jpeg';
                                else if (ext === 'svg')
                                    mimeType = 'image/svg+xml';
                                else if (ext === 'gif')
                                    mimeType = 'image/gif';
                                files[fileId] = {
                                    mimeType,
                                    id: fileId,
                                    dataURL: `data:${mimeType};base64,${base64}`,
                                    created: linkedFile.stat.ctime,
                                };
                                console.log(`Excalidraw Share: Processed image ${linkPath} (${fileId})`);
                            }
                            catch (e) {
                                console.error(`Excalidraw Share: Failed to read image ${linkPath}`, e);
                            }
                        }
                    }
                }
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
        new obsidian_1.Setting(containerEl)
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
    }
}
