import { Plugin, TFile, arrayBufferToBase64, Menu, Notice, App, PluginSettingTab, Setting, loadPdfJs } from 'obsidian';

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  let len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const pdfToPng = async (
  app: App,
  file: TFile,
  pageNum: number = 1
): Promise<string> => {
  try {
    await loadPdfJs();
    const pdfjsLib = (window as any).pdfjsLib;
    
    if (!pdfjsLib) {
      throw new Error('PDF.js not loaded');
    }

    const url = app.vault.getResourcePath(file);
    const pdfDoc = await pdfjsLib.getDocument(url).promise;
    const page = await pdfDoc.getPage(pageNum);
    
    const scale = 1.5;
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
    
    return new Promise<string>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob) {
          const base64 = await blobToBase64(blob);
          resolve(base64);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, 'image/png');
    });
  } catch (e) {
    console.error('Excalidraw Share: PDF conversion failed', e);
    throw e;
  }
};

interface ExcalidrawShareSettings {
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_SETTINGS: ExcalidrawShareSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:8184',
};

interface DrawingMeta {
  id: string;
  created_at: string;
  source_path: string | null;
}

interface ExcalidrawPlugin {
  ea: {
    getSceneFromFile: (file: TFile) => Promise<{ elements: unknown[]; appState: unknown }>;
    getExcalidrawAPI: () => { getFiles: () => Record<string, unknown> };
    isExcalidrawFile: (file: TFile) => boolean;
  };
}

export default class ExcalidrawSharePlugin extends Plugin {
  settings: ExcalidrawShareSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    console.log('Excalidraw Share: Plugin loaded');

    // Add ribbon icon in sidebar
    this.addRibbonIcon('upload', 'Publish Drawing', async () => {
      const file = this.app.workspace.getActiveFile();
      if (file && this.isExcalidrawFile(file)) {
        await this.publishDrawing(file);
      } else {
        new Notice('No Excalidraw file open. Open a .excalidraw file first.');
      }
    });

    // Add command
    this.addCommand({
      id: 'publish-drawing',
      name: 'Publish to Excalidraw Share',
      checkCallback: (checking: boolean) => {
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
      this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
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
                  new Notice('Share link copied to clipboard!');
                });
            });
            menu.addSeparator();
            menu.addItem((item) => {
              item
                .setTitle('Unpublish from Share')
                .setIcon('trash')
                .onClick(() => this.unpublishDrawing(file, publishedId));
            });
          } else {
            menu.addItem((item) => {
              item
                .setTitle('Publish to Excalidraw Share')
                .setIcon('upload')
                .onClick(() => this.publishDrawing(file));
            });
          }
        }
      })
    );

    this.addSettingTab(new ExcalidrawShareSettingTab(this.app, this));
  }

  private getExcalidrawPlugin(): ExcalidrawPlugin | null {
    try {
      // Try different plugin IDs
      // The official Excalidraw plugin ID is 'obsidian-excalidraw-plugin'
      const plugin = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('obsidian-excalidraw-plugin');
      
      if (plugin) {
        console.log('Excalidraw Share: Found Excalidraw plugin');
        return plugin as ExcalidrawPlugin;
      }
      
      // Also try 'excalidraw'
      const plugin2 = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('excalidraw');
      if (plugin2) {
        console.log('Excalidraw Share: Found Excalidraw plugin (alt ID)');
        return plugin2 as ExcalidrawPlugin;
      }
      
      // Log available plugins for debugging
      const plugins = (this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
      console.log('Excalidraw Share: Available plugins:', Object.keys(plugins));
      return null;
    } catch (e) {
      console.log('Excalidraw Share: Error getting plugin', e);
      return null;
    }
  }

  private isExcalidrawFile(file: TFile): boolean {
    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (excalidrawPlugin?.ea?.isExcalidrawFile) {
      return excalidrawPlugin.ea.isExcalidrawFile(file);
    }
    // Fallback check
    const name = file.name.toLowerCase();
    return file.extension === 'md' && 
      (name.includes('.excalidraw') || name.endsWith('excalidraw'));
  }

  private getPublishedId(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache && cache.frontmatter && cache.frontmatter['excalidraw-share-id']) {
      return cache.frontmatter['excalidraw-share-id'] as string;
    }
    return null;
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async publishDrawing(file: TFile, existingId?: string) {
    console.log('Excalidraw Share: Publishing', file.name);
    
    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return;
    }

    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      new Notice('Excalidraw plugin not found. Please install Excalidraw.');
      return;
    }

    new Notice(existingId ? 'Syncing drawing...' : 'Publishing drawing...');

    try {
      // Use ExcalidrawAutomate to get scene data
      const scene = await excalidrawPlugin.ea.getSceneFromFile(file);
      
      if (!scene || !scene.elements || scene.elements.length === 0) {
        new Notice('Drawing is empty.');
        return;
      }

      // Get embedded files if available from active view
      let files: Record<string, any> = {};
      
      try {
        const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
        if (excalidrawAPI && typeof excalidrawAPI.getFiles === 'function') {
          const apiFiles = excalidrawAPI.getFiles() as Record<string, any>;
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
      } catch (e) {
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
              if (pageMatch) pageNum = parseInt(pageMatch[1]);
            }

            // Strip aliases and subpaths from link e.g. [[Image.png|Alias]] -> Image.png
            if (linkPath.includes('|')) linkPath = linkPath.split('|')[0];
            if (linkPath.includes('#')) linkPath = linkPath.split('#')[0];

            // Try to find the file in the vault
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
            if (linkedFile && linkedFile instanceof TFile) {
              const ext = linkedFile.extension.toLowerCase();

              // Handle PDF files - convert to PNG
              if (ext === 'pdf') {
                try {
                  const pngBase64 = await pdfToPng(this.app, linkedFile, pageNum);
                  files[fileId] = {
                    mimeType: 'image/png',
                    id: fileId,
                    dataURL: `data:image/png;base64,${pngBase64}`,
                    created: linkedFile.stat.ctime,
                  };
                  console.log(`Excalidraw Share: Converted PDF ${linkPath} page ${pageNum} to PNG (${fileId})`);
                } catch (e) {
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
                const base64 = arrayBufferToBase64(arrayBuffer);
                
                // Determine mime type
                let mimeType = 'image/png';
                if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                else if (ext === 'svg') mimeType = 'image/svg+xml';
                else if (ext === 'gif') mimeType = 'image/gif';

                files[fileId] = {
                  mimeType,
                  id: fileId,
                  dataURL: `data:${mimeType};base64,${base64}`,
                  created: linkedFile.stat.ctime,
                };
                console.log(`Excalidraw Share: Processed image ${linkPath} (${fileId})`);
              } catch (e) {
                console.error(`Excalidraw Share: Failed to read image ${linkPath}`, e);
              }
            }
          }
        }
      }

      // Build payload in Excalidraw format
      const appState = scene.appState as Record<string, unknown> || {};
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

      const bodyData: any = {
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
      await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
        frontmatter['excalidraw-share-id'] = result.id;
      });
      
      await navigator.clipboard.writeText(result.url);
      new Notice(`Drawing ${existingId ? 'synced' : 'published'}! URL copied to clipboard.`);
    } catch (error) {
      console.error('Excalidraw Share: Publish error', error);
      new Notice(`Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async unpublishDrawing(file: TFile, existingId?: string): Promise<boolean> {
    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return false;
    }

    const idToDelete = existingId || this.getPublishedId(file);
    if (!idToDelete) {
      new Notice('This drawing does not appear to be published.');
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
      await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
        delete frontmatter['excalidraw-share-id'];
      });

      new Notice('Drawing unpublished successfully');
      return true;
    } catch (error) {
      console.error(error);
      new Notice(`Failed to unpublish: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  // We no longer need this slow API-based check since we use frontmatter now
  // keeping it just in case, but unused.
  async isDrawingPublished(file: TFile): Promise<boolean> {
    return this.getPublishedId(file) !== null;
  }
}

class ExcalidrawShareSettingTab extends PluginSettingTab {
  pluginRef: ExcalidrawSharePlugin;
  
  constructor(app: App, plugin: ExcalidrawSharePlugin) {
    super(app, plugin);
    this.pluginRef = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Excalidraw Share Settings' });

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
  }
}
