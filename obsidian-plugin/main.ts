import { Plugin, TFile, arrayBufferToBase64, Menu, Notice, App, PluginSettingTab, Setting, loadPdfJs, Modal } from 'obsidian';

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

const cropCanvas = (
  canvas: HTMLCanvasElement,
  crop: { left: number; top: number; width: number; height: number }
): string => {
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = Math.round(crop.width);
  croppedCanvas.height = Math.round(crop.height);
  const croppedCtx = croppedCanvas.getContext('2d');
  if (croppedCtx) {
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
  
  return croppedCanvas.toDataURL('image/png').split(',')[1];
};

const pdfToPng = async (
  app: App,
  file: TFile,
  pageNum: number = 1,
  cropRect?: number[],
  scale: number = 1.5
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
    
    let resultBase64: string;
    
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
    } else {
      resultBase64 = await new Promise<string>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (blob) {
            const base64 = await blobToBase64(blob);
            resolve(base64);
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/png');
      });
    }
    
    return resultBase64;
  } catch (e) {
    console.error('ExcaliShare: PDF conversion failed', e);
    throw e;
  }
};

interface ExcaliShareSettings {
  apiKey: string;
  baseUrl: string;
  pdfScale: number;
  collabTimeoutSecs: number;
  collabAutoOpenBrowser: boolean;
}

const DEFAULT_SETTINGS: ExcaliShareSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:8184',
  pdfScale: 1.5,
  collabTimeoutSecs: 7200,
  collabAutoOpenBrowser: true,
};

interface DrawingMeta {
  id: string;
  created_at: string;
  source_path: string | null;
}

interface ExcalidrawPlugin {
  ea: {
    getSceneFromFile: (file: TFile) => Promise<{ elements: unknown[]; appState: unknown }>;
    getExcalidrawAPI: () => {
      getFiles: () => Record<string, unknown>;
      updateScene: (data: { elements?: unknown[]; appState?: unknown }) => void;
      getSceneElements: () => unknown[];
    };
    isExcalidrawFile: (file: TFile) => boolean;
  };
}

export default class ExcaliSharePlugin extends Plugin {
  settings: ExcaliShareSettings = DEFAULT_SETTINGS;
  activeCollabSessionId: string | null = null;
  activeCollabDrawingId: string | null = null;
  collabStatusBarItem: HTMLElement | null = null;
  collabHealthInterval: ReturnType<typeof setInterval> | null = null;

  async onload() {
    await this.loadSettings();
    console.log('ExcaliShare: Plugin loaded');

    // Add ribbon icons in sidebar
    this.addRibbonIcon('upload', 'Publish Drawing', async () => {
      const file = this.app.workspace.getActiveFile();
      if (file && this.isExcalidrawFile(file)) {
        await this.publishDrawing(file);
      } else {
        new Notice('No Excalidraw file open. Open a .excalidraw file first.');
      }
    });

    // Add second ribbon icon for viewing shared drawings
    this.addRibbonIcon('book-open', 'Browse Shared Drawings', async () => {
      // Open the share viewer in a new pane or popup
      const url = this.settings.baseUrl;
      // @ts-ignore - openUrlInPane may not be available in all Obsidian versions
      if ((this.app as any).openUrlInPane) {
        (this.app as any).openUrlInPane(url);
      } else {
        window.open(url, '_blank');
      }
    });

    // Add command for publishing
    this.addCommand({
      id: 'publish-drawing',
      name: 'Publish to ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          // Only show if not yet published
          if (!publishedId) {
            if (!checking) {
              this.publishDrawing(file);
            }
            return true;
          }
        }
        return false;
      },
    });

    // Add command for syncing
    this.addCommand({
      id: 'sync-drawing',
      name: 'Sync to ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) {
              this.publishDrawing(file, publishedId);
            }
            return true;
          }
        }
        return false;
      },
    });

    // Add command for copying share link
    this.addCommand({
      id: 'copy-share-link',
      name: 'Copy Share Link',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) {
              const url = `${this.settings.baseUrl}/d/${publishedId}`;
              navigator.clipboard.writeText(url);
              new Notice('Share link copied to clipboard!');
            }
            return true;
          }
        }
        return false;
      },
    });

    // Add command for browsing shared drawings
    this.addCommand({
      id: 'browse-shared-drawings',
      name: 'Browse Shared Drawings',
      callback: () => {
        const url = this.settings.baseUrl;
        // @ts-ignore - openUrlInPane may not be available in all Obsidian versions
        if ((this.app as any).openUrlInPane) {
          (this.app as any).openUrlInPane(url);
        } else {
          window.open(url, '_blank');
        }
      },
    });

    // ── Collab Commands ──

    // Start live collab
    this.addCommand({
      id: 'start-live-collab',
      name: 'Start Live Collab Session',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId && !this.activeCollabSessionId) {
            if (!checking) {
              this.startCollabSession(file, publishedId);
            }
            return true;
          }
        }
        return false;
      },
    });

    // Stop live collab
    this.addCommand({
      id: 'stop-live-collab',
      name: 'Stop Live Collab Session',
      checkCallback: (checking: boolean) => {
        if (this.activeCollabSessionId) {
          if (!checking) {
            this.stopCollabSession();
          }
          return true;
        }
        return false;
      },
    });

    // Open live session in browser
    this.addCommand({
      id: 'open-live-session',
      name: 'Open Live Session in Browser',
      checkCallback: (checking: boolean) => {
        if (this.activeCollabDrawingId) {
          if (!checking) {
            const url = `${this.settings.baseUrl}/d/${this.activeCollabDrawingId}`;
            window.open(url, '_blank');
          }
          return true;
        }
        return false;
      },
    });

    // Pull from ExcaliShare (sync back to vault)
    this.addCommand({
      id: 'pull-from-excalishare',
      name: 'Pull from ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) {
              this.pullFromServer(file, publishedId);
            }
            return true;
          }
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
                .setTitle('Sync to ExcaliShare')
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

            // Collab menu items
            if (this.activeCollabSessionId && this.activeCollabDrawingId === publishedId) {
              menu.addItem((item) => {
                item
                  .setTitle('Stop Live Collab')
                  .setIcon('users')
                  .onClick(() => this.stopCollabSession());
              });
              menu.addItem((item) => {
                item
                  .setTitle('Open Live Session')
                  .setIcon('external-link')
                  .onClick(() => {
                    const url = `${this.settings.baseUrl}/d/${publishedId}`;
                    window.open(url, '_blank');
                  });
              });
            } else if (!this.activeCollabSessionId) {
              menu.addItem((item) => {
                item
                  .setTitle('Start Live Collab')
                  .setIcon('users')
                  .onClick(() => this.startCollabSession(file, publishedId));
              });
            }

            menu.addItem((item) => {
              item
                .setTitle('Pull from ExcaliShare')
                .setIcon('download')
                .onClick(() => this.pullFromServer(file, publishedId));
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
                .setTitle('Publish to ExcaliShare')
                .setIcon('upload')
                .onClick(() => this.publishDrawing(file));
            });
          }
        }
      })
    );

    this.addSettingTab(new ExcaliShareSettingTab(this.app, this));

    // Status bar item for collab
    this.collabStatusBarItem = this.addStatusBarItem();
    this.collabStatusBarItem.setText('');
    this.collabStatusBarItem.hide();
  }

  onunload() {
    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }
  }

  private getExcalidrawPlugin(): ExcalidrawPlugin | null {
    try {
      // Try different plugin IDs
      // The official Excalidraw plugin ID is 'obsidian-excalidraw-plugin'
      const plugin = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('obsidian-excalidraw-plugin');
      
      if (plugin) {
        console.log('ExcaliShare: Found Excalidraw plugin');
        return plugin as ExcalidrawPlugin;
      }
      
      // Also try 'excalidraw'
      const plugin2 = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('excalidraw');
      if (plugin2) {
        console.log('ExcaliShare: Found Excalidraw plugin (alt ID)');
        return plugin2 as ExcalidrawPlugin;
      }
      
      // Log available plugins for debugging
      const plugins = (this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
      console.log('ExcaliShare: Available plugins:', Object.keys(plugins));
      return null;
    } catch (e) {
      console.log('ExcaliShare: Error getting plugin', e);
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
    if (cache && cache.frontmatter && cache.frontmatter['excalishare-id']) {
      return cache.frontmatter['excalishare-id'] as string;
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
    console.log('ExcaliShare: Publishing', file.name);
    
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
      
      // Extract rect info from elements for PDF cropping
      const elementCropRects: Record<string, number[]> = {};
      
      if (scene.elements) {
        for (const el of scene.elements) {
          if (el && typeof el === 'object') {
            const element = el as any;
            if (element.type === 'image' && element.fileId && element.link) {
              const link = element.link as string;
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
            console.log('ExcaliShare: Fetched images from active Excalidraw view', Object.keys(files).length);
          }
        }
      } catch (e) {
        console.log('ExcaliShare: Could not fetch files from active view, falling back to manual parse', e);
      }

      // If active view didn't have the files (e.g. published from file explorer), parse manually
      if (Object.keys(files).length === 0) {
        console.log('ExcaliShare: Parsing embedded files manually from markdown');
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

            // Parse rect parameter for PDF cropping (e.g., &rect=17,23,437,226 or #rect=...)
            // First check if rect is in the embedded files link
            let cropRect: number[] | undefined;
            const rectMatch = linkPath.match(/[&#]rect=(\d+),(\d+),(\d+),(\d+)/);
            if (rectMatch) {
              cropRect = [rectMatch[1], rectMatch[2], rectMatch[3], rectMatch[4]].map(Number);
            } else if (elementCropRects[fileId]) {
              // Fallback: get rect from element data
              cropRect = elementCropRects[fileId];
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
                  const pngBase64 = await pdfToPng(this.app, linkedFile, pageNum, cropRect, this.settings.pdfScale);
                  files[fileId] = {
                    mimeType: 'image/png',
                    id: fileId,
                    dataURL: `data:image/png;base64,${pngBase64}`,
                    created: linkedFile.stat.ctime,
                  };
                  console.log(`ExcaliShare: Converted PDF ${linkPath} page ${pageNum} to PNG (${fileId})`);
                } catch (e) {
                  console.error(`ExcaliShare: Failed to convert PDF ${linkPath}`, e);
                }
                continue;
              }

              // Only process image files for manual parsing
              const supportedImageTypes = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
              if (!supportedImageTypes.includes(ext)) {
                console.log(`ExcaliShare: Skipping unsupported embedded file type ${ext} for ${linkPath}`);
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
                console.log(`ExcaliShare: Processed image ${linkPath} (${fileId})`);
              } catch (e) {
                console.error(`ExcaliShare: Failed to read image ${linkPath}`, e);
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
        frontmatter['excalishare-id'] = result.id;
      });
      
      await navigator.clipboard.writeText(result.url);
      new Notice(`Drawing ${existingId ? 'synced' : 'published'}! URL copied to clipboard.`);
    } catch (error) {
      console.error('ExcaliShare: Publish error', error);
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
        delete frontmatter['excalishare-id'];
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

  // ── Collab Methods ──

  async startCollabSession(file: TFile, drawingId: string) {
    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return;
    }

    if (this.activeCollabSessionId) {
      new Notice('A collab session is already active. Stop it first.');
      return;
    }

    new Notice('Starting live collab session...');

    try {
      const response = await fetch(`${this.settings.baseUrl}/api/collab/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          drawing_id: drawingId,
          timeout_secs: this.settings.collabTimeoutSecs,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to start session: ${response.status}`);
      }

      const result = await response.json();
      this.activeCollabSessionId = result.session_id;
      this.activeCollabDrawingId = drawingId;

      // Update status bar
      if (this.collabStatusBarItem) {
        this.collabStatusBarItem.setText('🔴 Live Collab');
        this.collabStatusBarItem.show();
      }

      // Start health check interval
      this.collabHealthInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${this.settings.baseUrl}/api/collab/status/${drawingId}`);
          const status = await statusRes.json();
          if (!status.active) {
            // Session ended externally
            this.cleanupCollabState();
            new Notice('Collab session ended.');
          }
        } catch {
          // Ignore health check errors
        }
      }, 30000);

      const viewUrl = `${this.settings.baseUrl}/d/${drawingId}`;
      new Notice(`Live collab session started! Session ID: ${result.session_id}`);

      // Auto-open browser
      if (this.settings.collabAutoOpenBrowser) {
        window.open(viewUrl, '_blank');
      }

      console.log('ExcaliShare: Collab session started', result);
    } catch (error) {
      console.error('ExcaliShare: Failed to start collab session', error);
      new Notice(`Failed to start collab: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async stopCollabSession() {
    if (!this.activeCollabSessionId) {
      new Notice('No active collab session.');
      return;
    }

    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return;
    }

    // Ask user whether to save or discard
    const save = await new Promise<boolean | null>((resolve) => {
      const modal = new CollabStopModal(this.app, resolve);
      modal.open();
    });

    if (save === null) return; // User cancelled

    new Notice(save ? 'Saving and stopping collab session...' : 'Discarding and stopping collab session...');

    try {
      const response = await fetch(`${this.settings.baseUrl}/api/collab/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          session_id: this.activeCollabSessionId,
          save: save,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to stop session: ${response.status}`);
      }

      const drawingId = this.activeCollabDrawingId;
      this.cleanupCollabState();

      if (save && drawingId) {
        // Sync back to vault
        const file = this.app.workspace.getActiveFile();
        if (file && this.getPublishedId(file) === drawingId) {
          await this.pullFromServer(file, drawingId);
        } else {
          new Notice('Collab session saved. Use "Pull from ExcaliShare" to sync changes to your vault.');
        }
      } else {
        new Notice('Collab session ended. Changes discarded.');
      }
    } catch (error) {
      console.error('ExcaliShare: Failed to stop collab session', error);
      new Notice(`Failed to stop collab: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private cleanupCollabState() {
    this.activeCollabSessionId = null;
    this.activeCollabDrawingId = null;

    if (this.collabStatusBarItem) {
      this.collabStatusBarItem.setText('');
      this.collabStatusBarItem.hide();
    }

    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }
  }

  async pullFromServer(file: TFile, drawingId: string) {
    new Notice('Pulling drawing from server...');

    try {
      const response = await fetch(`${this.settings.baseUrl}/api/view/${drawingId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch drawing: ${response.status}`);
      }

      const data = await response.json();

      // Use Excalidraw plugin API to update the file
      const excalidrawPlugin = this.getExcalidrawPlugin();
      if (excalidrawPlugin?.ea) {
        // Try to update via the Excalidraw API if the file is currently open
        try {
          const excalidrawAPI = excalidrawPlugin.ea.getExcalidrawAPI();
          if (excalidrawAPI && typeof excalidrawAPI.updateScene === 'function') {
            excalidrawAPI.updateScene({
              elements: data.elements || [],
              appState: data.appState || {},
            });
            new Notice('Drawing synced back to vault!');
            return;
          }
        } catch {
          // Fall through to manual file update
        }
      }

      // Fallback: Read the file and update the JSON content manually
      // This works for .excalidraw.md files
      const content = await this.app.vault.read(file);

      // Find the JSON block in the markdown file
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const updatedJson = JSON.stringify({
          type: data.type || 'excalidraw',
          version: data.version || 2,
          elements: data.elements || [],
          appState: data.appState || {},
        }, null, 2);

        const newContent = content.replace(
          /```json\n[\s\S]*?\n```/,
          '```json\n' + updatedJson + '\n```'
        );

        await this.app.vault.modify(file, newContent);
        new Notice('Drawing synced back to vault!');
      } else {
        new Notice('Could not update file format. Please manually sync.');
      }
    } catch (error) {
      console.error('ExcaliShare: Pull failed', error);
      new Notice(`Failed to pull: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Modal for stop collab confirmation
class CollabStopModal extends Modal {
  private resolve: (value: boolean | null) => void;

  constructor(app: App, resolve: (value: boolean | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Stop Live Collab Session' });
    contentEl.createEl('p', { text: 'Do you want to save the changes made during the collaboration session?' });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.marginTop = '16px';

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.resolve(null);
      this.close();
    });

    const discardBtn = buttonContainer.createEl('button', { text: 'Discard Changes' });
    discardBtn.style.backgroundColor = '#f44336';
    discardBtn.style.color = '#fff';
    discardBtn.addEventListener('click', () => {
      this.resolve(false);
      this.close();
    });

    const saveBtn = buttonContainer.createEl('button', { text: 'Save Changes', cls: 'mod-cta' });
    saveBtn.addEventListener('click', () => {
      this.resolve(true);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

class ExcaliShareSettingTab extends PluginSettingTab {
  pluginRef: ExcaliSharePlugin;

  constructor(app: App, plugin: ExcaliSharePlugin) {
    super(app, plugin);
    this.pluginRef = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
