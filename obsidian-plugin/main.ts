import { Plugin, TFile, arrayBufferToBase64, Menu, Notice, App, Modal, loadPdfJs, WorkspaceLeaf, requestUrl } from 'obsidian';
import { ExcaliShareSettingTab, DEFAULT_SETTINGS } from './settings';
import type { ExcaliShareSettings } from './settings';
import { ExcaliShareToolbar } from './toolbar';
import type { ToolbarStatus, ToolbarCallbacks } from './toolbar';
import { injectGlobalStyles, removeGlobalStyles } from './styles';
import { CollabManager } from './collabManager';
import type { ExcalidrawAPI } from './collabTypes';

// ── Utility Functions ──

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const len = bytes.byteLength;
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
    croppedCtx.fillStyle = '#ffffff';
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
    if (!pdfjsLib) throw new Error('PDF.js not loaded');

    const url = app.vault.getResourcePath(file);
    const pdfDoc = await pdfjsLib.getDocument(url).promise;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = Math.round(viewport.height);
    canvas.width = Math.round(viewport.width);

    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page.render({ canvasContext: ctx, viewport }).promise;

    const validRect = cropRect && cropRect.length === 4 && cropRect.every(x => !isNaN(x));
    if (validRect) {
      const [pageLeft, pageBottom, pageRight, pageTop] = page.view;
      const pageHeight = pageTop - pageBottom;
      return cropCanvas(canvas, {
        left: (cropRect![0] - pageLeft) * scale,
        top: (pageBottom + pageHeight - cropRect![3]) * scale,
        width: (cropRect![2] - cropRect![0]) * scale,
        height: (cropRect![3] - cropRect![1]) * scale,
      });
    }

    return await new Promise<string>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob) {
          resolve(await blobToBase64(blob));
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, 'image/png');
    });
  } catch (e) {
    console.error('ExcaliShare: PDF conversion failed', e);
    throw e;
  }
};

// ── Interfaces ──

interface DrawingMeta {
  id: string;
  created_at: string;
  source_path: string | null;
}

interface ExcalidrawPlugin {
  ea: {
    setView: (view: unknown | 'first' | 'active') => unknown;
    getSceneFromFile: (file: TFile) => Promise<{ elements: unknown[]; appState: unknown }>;
    getExcalidrawAPI: () => {
      getFiles: () => Record<string, unknown>;
      updateScene: (data: {
        elements?: unknown[];
        appState?: unknown;
        collaborators?: Map<string, unknown>;
        commitToHistory?: boolean;
      }) => void;
      getSceneElements: () => unknown[];
      getSceneElementsIncludingDeleted?: () => unknown[];
      getAppState: () => Record<string, unknown>;
    };
    isExcalidrawFile: (file: TFile) => boolean;
  };
}

// ── Main Plugin ──

export default class ExcaliSharePlugin extends Plugin {
  settings: ExcaliShareSettings = DEFAULT_SETTINGS;
  activeCollabSessionId: string | null = null;
  activeCollabDrawingId: string | null = null;
  collabStatusBarItem: HTMLElement | null = null;
  collabHealthInterval: ReturnType<typeof setInterval> | null = null;

  // Native collab (in-Obsidian participation)
  private collabManager: CollabManager | null = null;

  // Toolbar management
  private toolbarInstances: Map<string, ExcaliShareToolbar> = new Map();
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** MutationObservers watching for .excalidraw-wrapper to appear, keyed by leafId */
  private _mountObservers: Map<string, MutationObserver> = new Map();
  /** MutationObservers watching for toolbar orphaning (removed from DOM), keyed by leafId */
  private _orphanObservers: Map<string, MutationObserver> = new Map();
  /** Fallback retry timers for initial injection, keyed by leafId */
  private _retryTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Track which file path is associated with each leaf's toolbar */
  private _leafFilePaths: Map<string, string> = new Map();
  /** Debounce timer for layout-change events */
  private _layoutChangeTimer: ReturnType<typeof setTimeout> | null = null;

  async onload() {
    await this.loadSettings();
    console.log('ExcaliShare: Plugin loaded');

    // Inject global CSS for animations
    injectGlobalStyles();

    // ── Ribbon Icons ──
    this.addRibbonIcon('upload', 'Publish Drawing', async () => {
      const file = this.app.workspace.getActiveFile();
      if (file && this.isExcalidrawFile(file)) {
        await this.publishDrawing(file);
      } else {
        new Notice('No Excalidraw file open. Open a .excalidraw file first.');
      }
    });

    this.addRibbonIcon('book-open', 'Browse Shared Drawings', async () => {
      const url = this.settings.baseUrl;
      // @ts-ignore
      if ((this.app as any).openUrlInPane) {
        (this.app as any).openUrlInPane(url);
      } else {
        window.open(url, '_blank');
      }
    });

    // ── Commands ──
    this.addCommand({
      id: 'publish-drawing',
      name: 'Publish to ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (!publishedId) {
            if (!checking) this.publishDrawing(file);
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: 'sync-drawing',
      name: 'Sync to ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) this.publishDrawing(file, publishedId);
            return true;
          }
        }
        return false;
      },
    });

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

    this.addCommand({
      id: 'browse-shared-drawings',
      name: 'Browse Shared Drawings',
      callback: () => {
        const url = this.settings.baseUrl;
        // @ts-ignore
        if ((this.app as any).openUrlInPane) {
          (this.app as any).openUrlInPane(url);
        } else {
          window.open(url, '_blank');
        }
      },
    });

    this.addCommand({
      id: 'start-live-collab',
      name: 'Start Live Collab Session',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId && !this.activeCollabSessionId) {
            if (!checking) this.startCollabSession(file, publishedId);
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: 'stop-live-collab',
      name: 'Stop Live Collab Session',
      checkCallback: (checking: boolean) => {
        if (this.activeCollabSessionId) {
          if (!checking) this.stopCollabSession();
          return true;
        }
        return false;
      },
    });

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

    this.addCommand({
      id: 'pull-from-excalishare',
      name: 'Pull from ExcaliShare',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId) {
            if (!checking) this.pullFromServer(file, publishedId);
            return true;
          }
        }
        return false;
      },
    });

    // ── File Context Menu ──
    this.registerEvent(
      // @ts-ignore
      this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
        if (this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);

          if (publishedId) {
            menu.addItem((item) => {
              item.setTitle('Sync to ExcaliShare').setIcon('refresh-cw')
                .onClick(() => this.publishDrawing(file, publishedId));
            });
            menu.addItem((item) => {
              item.setTitle('Copy Share Link').setIcon('link')
                .onClick(() => {
                  const url = `${this.settings.baseUrl}/d/${publishedId}`;
                  navigator.clipboard.writeText(url);
                  new Notice('Share link copied to clipboard!');
                });
            });

            if (this.activeCollabSessionId && this.activeCollabDrawingId === publishedId) {
              menu.addItem((item) => {
                item.setTitle('Stop Live Collab').setIcon('users')
                  .onClick(() => this.stopCollabSession());
              });
              menu.addItem((item) => {
                item.setTitle('Open Live Session').setIcon('external-link')
                  .onClick(() => {
                    const url = `${this.settings.baseUrl}/d/${publishedId}`;
                    window.open(url, '_blank');
                  });
              });
            } else if (!this.activeCollabSessionId) {
              menu.addItem((item) => {
                item.setTitle('Start Live Collab').setIcon('users')
                  .onClick(() => this.startCollabSession(file, publishedId));
              });
            }

            menu.addItem((item) => {
              item.setTitle('Pull from ExcaliShare').setIcon('download')
                .onClick(() => this.pullFromServer(file, publishedId));
            });

            menu.addSeparator();
            menu.addItem((item) => {
              item.setTitle('Unpublish from Share').setIcon('trash')
                .onClick(() => this.unpublishDrawing(file, publishedId));
            });
          } else {
            menu.addItem((item) => {
              item.setTitle('Publish to ExcaliShare').setIcon('upload')
                .onClick(() => this.publishDrawing(file));
            });
          }
        }
      })
    );

    // ── Settings Tab ──
    this.addSettingTab(new ExcaliShareSettingTab(this.app, this));

    // ── Status Bar (collab) ──
    this.collabStatusBarItem = this.addStatusBarItem();
    this.collabStatusBarItem.setText('');
    this.collabStatusBarItem.hide();

    // ── Floating Toolbar: Active Leaf Change ──
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        this.handleLeafChange(leaf);
      })
    );

    // ── Floating Toolbar: Layout Change (handles tab switches, splits) ──
    // Debounced to avoid excessive churn on mobile (side panel open/close)
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this._layoutChangeTimer) clearTimeout(this._layoutChangeTimer);
        this._layoutChangeTimer = setTimeout(() => {
          this._layoutChangeTimer = null;
          const leaf = this.app.workspace.activeLeaf;
          if (leaf) this.handleLeafChange(leaf);
        }, 150);
      })
    );

    // ── Auto-Sync: File Modify Listener ──
    this.registerEvent(
      // @ts-ignore - 'modify' event exists but may not be in older type definitions
      this.app.vault.on('modify', (file: TFile) => {
        this.handleFileModify(file);
      })
    );

    // ── Metadata Change: Update toolbar when frontmatter changes ──
    this.registerEvent(
      this.app.metadataCache.on('changed', (file: TFile) => {
        this.handleMetadataChange(file);
      })
    );

    // Initial toolbar injection for the current view
    // Use longer delay on mobile where Excalidraw may take longer to initialize
    setTimeout(() => {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf) {
        console.log('ExcaliShare: Initial leaf check, viewType:', leaf.view.getViewType());
        this.handleLeafChange(leaf);
      }
    }, 1000);
  }

  onunload() {
    // Disconnect native collab if active
    if (this.collabManager) {
      this.collabManager.destroy();
      this.collabManager = null;
    }

    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }

    // Remove all toolbar instances
    for (const toolbar of this.toolbarInstances.values()) {
      toolbar.remove();
    }
    this.toolbarInstances.clear();

    // Disconnect all MutationObservers
    for (const obs of this._mountObservers.values()) obs.disconnect();
    this._mountObservers.clear();
    for (const obs of this._orphanObservers.values()) obs.disconnect();
    this._orphanObservers.clear();

    // Remove global styles
    removeGlobalStyles();

    // Clear auto-sync timer
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    // Clear all retry timers
    for (const timerId of Object.values(this._retryTimers)) {
      clearTimeout(timerId);
    }
    this._retryTimers = {};
    this._leafFilePaths.clear();

    // Clear layout-change debounce timer
    if (this._layoutChangeTimer) {
      clearTimeout(this._layoutChangeTimer);
      this._layoutChangeTimer = null;
    }
  }

  // ── Toolbar Management ──

  /**
   * Clean up all observers and timers for a specific leaf.
   */
  private cleanupLeafObservers(leafId: string): void {
    // Cancel pending retry timer
    if (this._retryTimers[leafId]) {
      clearTimeout(this._retryTimers[leafId]);
      delete this._retryTimers[leafId];
    }
    // Disconnect mount observer
    const mountObs = this._mountObservers.get(leafId);
    if (mountObs) {
      mountObs.disconnect();
      this._mountObservers.delete(leafId);
    }
    // Disconnect orphan observer
    const orphanObs = this._orphanObservers.get(leafId);
    if (orphanObs) {
      orphanObs.disconnect();
      this._orphanObservers.delete(leafId);
    }
  }

  private handleLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!this.settings.showFloatingToolbar) return;
    if (!leaf) return;

    const view = leaf.view;
    const viewType = view.getViewType();
    const leafId = (leaf as any).id || 'default';

    console.log('ExcaliShare: handleLeafChange viewType:', viewType, 'leafId:', leafId);

    // Check if this is an Excalidraw view
    if (viewType === 'excalidraw') {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        console.log('ExcaliShare: No active file for Excalidraw view');
        return;
      }

      // Check if we already have a toolbar for this exact leaf+file combo
      // and it's still properly injected — skip re-creation to avoid churn
      const existingToolbar = this.toolbarInstances.get(leafId);
      const existingFilePath = this._leafFilePaths.get(leafId);
      if (existingToolbar && existingToolbar.isInjected() && existingFilePath === file.path) {
        console.log('ExcaliShare: Toolbar already injected for same file, updating state only');
        this.updateToolbarState(existingToolbar, file);
        return;
      }

      // Clean up any previous observers/timers for this leaf
      this.cleanupLeafObservers(leafId);

      // Remove existing toolbar if any (different file or orphaned)
      if (existingToolbar) {
        existingToolbar.remove();
      }

      // Create a fresh toolbar
      const toolbar = this.createToolbar(file);
      this.toolbarInstances.set(leafId, toolbar);
      this._leafFilePaths.set(leafId, file.path);

      // Try to inject immediately, then set up observer if needed
      this.injectToolbarIntoView(toolbar, view.containerEl, file, leafId);
    } else {
      // Not an Excalidraw view — clean up everything for this leaf
      this.cleanupLeafObservers(leafId);
      const toolbar = this.toolbarInstances.get(leafId);
      if (toolbar) {
        toolbar.remove();
        this.toolbarInstances.delete(leafId);
      }
      this._leafFilePaths.delete(leafId);
    }
  }

  /**
   * Find the best container and inject the toolbar.
   * If .excalidraw-wrapper is not yet available, sets up a MutationObserver
   * to wait for it (with a fallback timeout).
   */
  private injectToolbarIntoView(toolbar: ExcaliShareToolbar, containerEl: HTMLElement, file: TFile, leafId: string): void {
    const wrapper = containerEl.querySelector('.excalidraw-wrapper') as HTMLElement | null;

    if (wrapper) {
      // Ideal container found — inject directly
      console.log('ExcaliShare: ✓ .excalidraw-wrapper found immediately, injecting toolbar');
      this.doInject(toolbar, wrapper, file, leafId);
      return;
    }

    // .excalidraw-wrapper not yet in DOM — Excalidraw hasn't mounted yet.
    // Inject into a temporary container so the toolbar is visible while waiting,
    // then use MutationObserver to re-inject into the ideal container.
    const tempContainer = (containerEl.querySelector('.view-content') || containerEl) as HTMLElement;
    console.log('ExcaliShare: .excalidraw-wrapper not found yet, injecting into temporary container:', tempContainer.className || tempContainer.tagName);
    toolbar.inject(tempContainer);
    this.updateToolbarState(toolbar, file);

    // Set up MutationObserver to watch for .excalidraw-wrapper appearing
    const observer = new MutationObserver((mutations, obs) => {
      const wrapper = containerEl.querySelector('.excalidraw-wrapper') as HTMLElement | null;
      if (wrapper) {
        console.log('ExcaliShare: ✓ MutationObserver detected .excalidraw-wrapper, re-injecting toolbar');
        obs.disconnect();
        this._mountObservers.delete(leafId);

        // Verify this leaf is still active and toolbar still exists
        if (!this.toolbarInstances.has(leafId)) return;

        toolbar.remove();
        this.doInject(toolbar, wrapper, file, leafId);
      }
    });

    observer.observe(containerEl, { childList: true, subtree: true });
    this._mountObservers.set(leafId, observer);

    // Fallback: if MutationObserver doesn't fire within 15s, try one last time
    this._retryTimers[leafId] = setTimeout(() => {
      delete this._retryTimers[leafId];
      if (this._mountObservers.has(leafId)) {
        // Observer still active — wrapper never appeared
        const obs = this._mountObservers.get(leafId);
        if (obs) {
          obs.disconnect();
          this._mountObservers.delete(leafId);
        }
        console.log('ExcaliShare: ✗ Timeout (15s) waiting for .excalidraw-wrapper');

        // Try one final injection with whatever container is available
        if (this.toolbarInstances.has(leafId)) {
          const finalWrapper = containerEl.querySelector('.excalidraw-wrapper') as HTMLElement | null;
          const finalContainer = finalWrapper
            || containerEl.querySelector('.excalidraw') as HTMLElement | null
            || tempContainer;
          toolbar.remove();
          this.doInject(toolbar, finalContainer, file, leafId);
        }
      }
    }, 15000);
  }

  /**
   * Perform the actual toolbar injection and set up orphan detection.
   */
  private doInject(toolbar: ExcaliShareToolbar, container: HTMLElement, file: TFile, leafId: string): void {
    toolbar.inject(container);
    this.updateToolbarState(toolbar, file);

    // Set up orphan detection: watch if the toolbar gets removed from the DOM
    // (e.g., by Excalidraw re-rendering its React tree)
    this.setupOrphanDetection(toolbar, container, file, leafId);
  }

  /**
   * Watch for the toolbar being removed from the DOM by external forces
   * (Excalidraw React re-renders). If detected, re-inject it.
   */
  private setupOrphanDetection(toolbar: ExcaliShareToolbar, container: HTMLElement, file: TFile, leafId: string): void {
    // Disconnect any existing orphan observer for this leaf
    const existing = this._orphanObservers.get(leafId);
    if (existing) existing.disconnect();

    const observer = new MutationObserver(() => {
      // Check if toolbar was removed from DOM
      if (!toolbar.isInjected()) {
        console.log('ExcaliShare: ⚠ Toolbar orphaned (removed from DOM), re-injecting for leaf', leafId);

        // Verify this leaf's toolbar is still managed
        if (!this.toolbarInstances.has(leafId)) {
          observer.disconnect();
          this._orphanObservers.delete(leafId);
          return;
        }

        // Find the best available container again
        const rootEl = container.closest('.workspace-leaf-content') || container.parentElement || container;
        const newWrapper = rootEl.querySelector('.excalidraw-wrapper') as HTMLElement | null;
        const newContainer = newWrapper || container;

        toolbar.inject(newContainer);
        this.updateToolbarState(toolbar, file);
      }
    });

    // Observe the container's parent for child removals (which would include our toolbar's container)
    const observeTarget = container.parentElement || container;
    observer.observe(observeTarget, { childList: true, subtree: true });
    this._orphanObservers.set(leafId, observer);
  }

  private createToolbar(file: TFile): ExcaliShareToolbar {
    const callbacks: ToolbarCallbacks = {
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
          window.open(url, '_blank');
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
        // Open the plugin settings tab
        // @ts-ignore - openSettingTab may not be in type definitions
        (this.app as any).setting?.open?.();
        // @ts-ignore
        (this.app as any).setting?.openTabById?.('excalishare');
      },
      onStartFollowing: (userId: string) => {
        if (this.collabManager?.isJoined) {
          this.collabManager.startFollowing(userId);
          this.refreshActiveToolbar();
        }
      },
      onStopFollowing: () => {
        if (this.collabManager?.isJoined) {
          this.collabManager.stopFollowing();
          this.refreshActiveToolbar();
        }
      },
    };

    return new ExcaliShareToolbar(
      callbacks,
      this.settings.toolbarPosition,
      this.settings.toolbarCollapsedByDefault,
    );
  }

  private updateToolbarState(toolbar: ExcaliShareToolbar, file: TFile): void {
    const publishedId = this.getPublishedId(file);
    let status: ToolbarStatus = 'unpublished';

    if (publishedId) {
      if (this.activeCollabSessionId && this.activeCollabDrawingId === publishedId) {
        status = 'collabActive';
      } else {
        status = 'published';
      }
    }

    toolbar.updateState({
      status,
      publishedId,
      collabSessionId: this.activeCollabSessionId,
      collabDrawingId: this.activeCollabDrawingId,
      hasApiKey: !!this.settings.apiKey,
      collabParticipantCount: this.collabManager?.participantCount,
      collabNativeJoined: this.collabManager?.isJoined,
      collabCollaborators: this.collabManager?.currentCollaborators,
      collabFollowingUserId: this.collabManager?.currentFollowingUserId,
      collabDisplayName: this.settings.collabDisplayName || 'Host',
    });

    toolbar.setPosition(this.settings.toolbarPosition);
  }

  private refreshActiveToolbar(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;
    const leafId = (leaf as any).id || 'default';
    const toolbar = this.toolbarInstances.get(leafId);
    if (toolbar) {
      const file = this.app.workspace.getActiveFile();
      if (file) {
        this.updateToolbarState(toolbar, file);
      }
    }
  }

  // ── Auto-Sync ──

  private handleFileModify(file: TFile): void {
    if (!this.settings.autoSyncOnSave) return;
    if (!this.isExcalidrawFile(file)) return;

    // Skip auto-sync during active collab session to avoid uploading mid-session state
    if (this.collabManager?.isJoined) return;

    const publishedId = this.getPublishedId(file);
    if (!publishedId) return;

    // Debounce: reset timer on each modification
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }

    this.autoSyncTimer = setTimeout(async () => {
      console.log('ExcaliShare: Auto-syncing', file.name);
      try {
        // Update toolbar to show syncing state
        this.refreshActiveToolbar();
        await this.publishDrawing(file, publishedId, true); // silent mode
        this.refreshActiveToolbar();
      } catch (e) {
        console.error('ExcaliShare: Auto-sync failed', e);
      }
    }, this.settings.autoSyncDelaySecs * 1000);
  }

  // ── Metadata Change ──

  private handleMetadataChange(file: TFile): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === file.path) {
      this.refreshActiveToolbar();
    }
  }

  // ── Excalidraw Plugin Integration ──

  private getExcalidrawPlugin(): ExcalidrawPlugin | null {
    try {
      const plugin = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('obsidian-excalidraw-plugin');
      if (plugin) return plugin as ExcalidrawPlugin;

      const plugin2 = (this.app as unknown as { plugins: { getPlugin: (id: string) => unknown } }).plugins.getPlugin('excalidraw');
      if (plugin2) return plugin2 as ExcalidrawPlugin;

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
    // Refresh all toolbars when settings change
    this.refreshActiveToolbar();
  }

  // ── API Methods ──

  async publishDrawing(file: TFile, existingId?: string, silent = false) {
    console.log('ExcaliShare: Publishing', file.name);

    if (!this.settings.apiKey) {
      if (!silent) new Notice('Please configure API key in plugin settings');
      return;
    }

    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      if (!silent) new Notice('Excalidraw plugin not found. Please install Excalidraw.');
      return;
    }

    if (!silent) new Notice(existingId ? 'Syncing drawing...' : 'Publishing drawing...');

    try {
      const scene = await excalidrawPlugin.ea.getSceneFromFile(file);

      if (!scene || !scene.elements || scene.elements.length === 0) {
        if (!silent) new Notice('Drawing is empty.');
        return;
      }

      let files: Record<string, any> = {};
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
        excalidrawPlugin.ea.setView('active');
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

      if (Object.keys(files).length === 0) {
        console.log('ExcaliShare: Parsing embedded files manually from markdown');
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
            if (linkPath.includes('#page=')) {
              const pageMatch = linkPath.match(/#page=(\d+)/);
              if (pageMatch) pageNum = parseInt(pageMatch[1]);
            }

            let cropRect: number[] | undefined;
            const rectMatch = linkPath.match(/[&#]rect=(\d+),(\d+),(\d+),(\d+)/);
            if (rectMatch) {
              cropRect = [rectMatch[1], rectMatch[2], rectMatch[3], rectMatch[4]].map(Number);
            } else if (elementCropRects[fileId]) {
              cropRect = elementCropRects[fileId];
            }

            if (linkPath.includes('|')) linkPath = linkPath.split('|')[0];
            if (linkPath.includes('#')) linkPath = linkPath.split('#')[0];

            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
            if (linkedFile && linkedFile instanceof TFile) {
              const ext = linkedFile.extension.toLowerCase();

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

              const supportedImageTypes = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
              if (!supportedImageTypes.includes(ext)) {
                console.log(`ExcaliShare: Skipping unsupported embedded file type ${ext} for ${linkPath}`);
                continue;
              }

              try {
                const arrayBuffer = await this.app.vault.readBinary(linkedFile);
                const base64 = arrayBufferToBase64(arrayBuffer);

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

      if (existingId) {
        bodyData.id = existingId;
      }

      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/upload`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify(bodyData),
      });

      if (response.status >= 400) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = response.json;

      // @ts-ignore
      await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
        frontmatter['excalishare-id'] = result.id;
      });

      await navigator.clipboard.writeText(result.url);
      if (!silent) {
        new Notice(`Drawing ${existingId ? 'synced' : 'published'}! URL copied to clipboard.`);
      }
    } catch (error) {
      console.error('ExcaliShare: Publish error', error);
      if (!silent) {
        new Notice(`Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
      const deleteResponse = await requestUrl({
        url: `${this.settings.baseUrl}/api/drawings/${idToDelete}`,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        throw: false,
      });

      if (deleteResponse.status >= 400 && deleteResponse.status !== 404) {
        throw new Error('Delete failed');
      }

      // @ts-ignore
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
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/collab/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          drawing_id: drawingId,
          timeout_secs: this.settings.collabTimeoutSecs,
        }),
        throw: false,
      });

      if (response.status >= 400) {
        let errorData: any = {};
        try { errorData = response.json; } catch { /* ignore */ }
        throw new Error(errorData.error || `Failed to start session: ${response.status}`);
      }

      const result = response.json;
      this.activeCollabSessionId = result.session_id;
      this.activeCollabDrawingId = drawingId;

      if (this.collabStatusBarItem) {
        this.collabStatusBarItem.setText('🔴 Live Collab');
        this.collabStatusBarItem.show();
      }

      this.collabHealthInterval = setInterval(async () => {
        try {
          const statusRes = await requestUrl({
            url: `${this.settings.baseUrl}/api/collab/status/${drawingId}`,
            method: 'GET',
            throw: false,
          });
          const status = statusRes.json;
          if (!status.active) {
            this.cleanupCollabState();
            new Notice('Collab session ended.');
            this.refreshActiveToolbar();
          }
        } catch {
          // Ignore health check errors
        }
      }, 30000);

      const viewUrl = `${this.settings.baseUrl}/d/${drawingId}`;
      new Notice(`Live collab session started! Session ID: ${result.session_id}`);

      // Auto-join from Obsidian if enabled
      if (this.settings.collabJoinFromObsidian) {
        await this.joinCollabFromObsidian(drawingId, result.session_id);
      }

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

    const save = await new Promise<boolean | null>((resolve) => {
      const modal = new CollabStopModal(this.app, resolve);
      modal.open();
    });

    if (save === null) return;

    new Notice(save ? 'Saving and stopping collab session...' : 'Discarding and stopping collab session...');

    // Disconnect native collab WebSocket before sending stop request
    if (this.collabManager) {
      this.collabManager.leave();
    }

    try {
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/collab/stop`,
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

      if (response.status >= 400) {
        throw new Error(`Failed to stop session: ${response.status}`);
      }

      const drawingId = this.activeCollabDrawingId;
      this.cleanupCollabState();

      if (save && drawingId) {
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
    // Disconnect native collab WebSocket if active
    if (this.collabManager) {
      this.collabManager.destroy();
      this.collabManager = null;
    }

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

  /**
   * Join the collab session from within Obsidian using a WebSocket connection.
   * This allows the host to participate directly in the Excalidraw canvas
   * without opening a browser.
   */
  private async joinCollabFromObsidian(drawingId: string, sessionId: string): Promise<void> {
    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      console.log('ExcaliShare: Excalidraw plugin not available, skipping native collab join');
      return;
    }

    try {
      this.collabManager = new CollabManager({
        baseUrl: this.settings.baseUrl,
        displayName: this.settings.collabDisplayName || 'Host',
        getExcalidrawAPI: () => {
          try {
            const plugin = this.getExcalidrawPlugin();
            if (!plugin?.ea) return null;
            plugin.ea.setView('active');
            const api = plugin.ea.getExcalidrawAPI();
            return api as ExcalidrawAPI;
          } catch {
            return null;
          }
        },
        getCanvasContainer: () => {
          // Find the active Excalidraw view's container element for pointer tracking.
          // Tries multiple strategies to handle different Excalidraw plugin versions.
          try {
            // Strategy 1: Active leaf's container
            const activeLeaf = this.app.workspace.activeLeaf;
            if (activeLeaf?.view?.containerEl) {
              // Try multiple selectors for the Excalidraw container
              const container =
                activeLeaf.view.containerEl.querySelector<HTMLElement>('.excalidraw') ||
                activeLeaf.view.containerEl.querySelector<HTMLElement>('.excalidraw-wrapper') ||
                activeLeaf.view.containerEl.querySelector<HTMLElement>('[class*="excalidraw"]');
              if (container) return container;

              // If the view itself contains a canvas, return the view container
              if (activeLeaf.view.containerEl.querySelector('canvas')) {
                return activeLeaf.view.containerEl;
              }
            }

            // Strategy 2: Search all workspace leaves for an Excalidraw view
            const leaves = this.app.workspace.getLeavesOfType('excalidraw');
            for (const leaf of leaves) {
              if (leaf.view?.containerEl) {
                const container =
                  leaf.view.containerEl.querySelector<HTMLElement>('.excalidraw') ||
                  leaf.view.containerEl.querySelector<HTMLElement>('.excalidraw-wrapper') ||
                  leaf.view.containerEl.querySelector<HTMLElement>('[class*="excalidraw"]');
                if (container) return container;
                if (leaf.view.containerEl.querySelector('canvas')) {
                  return leaf.view.containerEl;
                }
              }
            }

            return null;
          } catch {
            return null;
          }
        },
        callbacks: {
          onCollaboratorsChanged: (collaborators) => {
            // Update status bar with participant count
            if (this.collabStatusBarItem) {
              const count = collaborators.length;
              this.collabStatusBarItem.setText(`🔴 Live Collab (${count})`);
            }
            // Refresh toolbar to show updated participant count
            this.refreshActiveToolbar();
          },
          onConnectionChanged: (connected) => {
            if (connected) {
              console.log('ExcaliShare: Native collab connected');
            } else {
              console.log('ExcaliShare: Native collab disconnected');
            }
          },
          onSessionEnded: (saved) => {
            // Session was ended by someone else (or server timeout)
            // Clean up our state
            this.cleanupCollabState();
            this.refreshActiveToolbar();

            if (saved) {
              // Try to pull the saved state
              const file = this.app.workspace.getActiveFile();
              if (file && this.getPublishedId(file) === drawingId) {
                this.pullFromServer(file, drawingId);
              }
            }
          },
          onFollowChanged: (_followingUserId) => {
            // Refresh toolbar to update follow state in the collaborator list
            this.refreshActiveToolbar();
          },
        },
      });

      await this.collabManager.startAndJoin(drawingId, sessionId);
      console.log('ExcaliShare: Native collab joined successfully');
    } catch (error) {
      console.error('ExcaliShare: Failed to join collab from Obsidian', error);
      new Notice('Failed to join collab session from Obsidian. You can still use the browser.');
      if (this.collabManager) {
        this.collabManager.destroy();
        this.collabManager = null;
      }
    }
  }

  async pullFromServer(file: TFile, drawingId: string) {
    new Notice('Pulling drawing from server...');

    try {
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/view/${drawingId}`,
        method: 'GET',
      });
      if (response.status >= 400) {
        throw new Error(`Failed to fetch drawing: ${response.status}`);
      }

      const data = response.json;

      const excalidrawPlugin = this.getExcalidrawPlugin();
      if (excalidrawPlugin?.ea) {
        try {
          excalidrawPlugin.ea.setView('active');
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

      const content = await this.app.vault.read(file);
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

// ── Modals ──

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
}
