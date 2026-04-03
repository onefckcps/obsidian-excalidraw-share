import { Plugin, TFile, arrayBufferToBase64, Menu, Notice, App, Modal, loadPdfJs, WorkspaceLeaf, requestUrl } from 'obsidian';
import { ExcaliShareSettingTab, DEFAULT_SETTINGS } from './settings';
import type { ExcaliShareSettings } from './settings';
import { ExcaliShareToolbar } from './toolbar';
import type { ToolbarStatus, ToolbarCallbacks } from './toolbar';
import { injectGlobalStyles, removeGlobalStyles } from './styles';
import { CollabManager } from './collabManager';
import type { ExcalidrawAPI } from './collabTypes';
import { ExcalidrawScriptManager } from './excalidrawScripts';
import type { ScriptSettings } from './excalidrawScripts';

// ── Password Modal ──

class PasswordModal extends Modal {
  private resolve: (value: string | null) => void;
  private title: string;
  private description: string;

  constructor(app: App, title: string, description: string, resolve: (value: string | null) => void) {
    super(app);
    this.title = title;
    this.description = description;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', { text: this.description, cls: 'setting-item-description' });

    const inputContainer = contentEl.createDiv({ cls: 'setting-item' });
    const input = inputContainer.createEl('input', {
      type: 'password',
      placeholder: 'Enter password (leave empty to skip)',
    });
    input.style.width = '100%';
    input.style.padding = '8px';
    input.style.marginBottom = '16px';

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';

    const skipBtn = buttonContainer.createEl('button', { text: 'Skip (no password)' });
    skipBtn.addEventListener('click', () => {
      this.resolve(null);
      this.close();
    });

    const setBtn = buttonContainer.createEl('button', { text: 'Set Password', cls: 'mod-cta' });
    setBtn.addEventListener('click', () => {
      const value = input.value.trim();
      this.resolve(value || null);
      this.close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        this.resolve(value || null);
        this.close();
      } else if (e.key === 'Escape') {
        this.resolve(null);
        this.close();
      }
    });

    input.focus();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function promptPassword(app: App, title: string, description: string): Promise<string | null> {
  return new Promise((resolve) => {
    new PasswordModal(app, title, description, resolve).open();
  });
}

// ── Utility Functions ──

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
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
      setActiveTool?: (tool: { type: string; [key: string]: unknown }) => void;
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
  // Embedded Excalidraw scripts (zoom-adaptive stroke, right-click eraser)
  private scriptManager: ExcalidrawScriptManager = new ExcalidrawScriptManager();
  /** Snapshot of the Excalidraw scene captured before joining a collab session.
   *  Used to restore the drawing when the host discards collab changes. */
  private preCollabSnapshot: { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> } | null = null;

  // Toolbar management
  private toolbarInstances: Map<string, ExcaliShareToolbar> = new Map();
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Tracks which file paths have already been synced for persistent collab in this session.
   *  Prevents repeated syncs on every leaf-change for the same file. */
  private _persistentSyncedFiles: Set<string> = new Set();
  /** MutationObservers watching for .excalidraw-wrapper to appear, keyed by leafId */
  private _mountObservers: Map<string, MutationObserver> = new Map();
  /** MutationObservers watching for toolbar orphaning (removed from DOM), keyed by leafId */
  private _orphanObservers: Map<string, MutationObserver> = new Map();
  /** MutationObservers watching for excalidraw-loading → excalidraw transition, keyed by leafId */
  private _loadingLeafObservers: Map<string, MutationObserver> = new Map();
  /** Polling intervals for excalidraw-loading → excalidraw transition fallback, keyed by leafId */
  private _loadingLeafPollers: Map<string, ReturnType<typeof setInterval>> = new Map();
  /** Fallback retry timers for initial injection, keyed by leafId */
  private _retryTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Track which file path is associated with each leaf's toolbar */
  private _leafFilePaths: Map<string, string> = new Map();
  /** Debounce timer for layout-change events */
  private _layoutChangeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Server health check ──
  /** Whether the server is currently reachable */
  private _serverReachable: boolean = true;
  /** Interval handle for periodic server health checks */
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  /** Pending operations queue: publish/sync operations that failed due to server being unreachable */
  private _pendingOperations: Array<{ type: 'publish' | 'sync'; file: TFile; existingId?: string }> = [];

  // ── Collab join guard ──
  /** Prevents concurrent join attempts (race between backgroundReconcile, handleLeafChange, etc.) */
  private _joiningCollabInProgress = false;

  // ── Server State Reconciliation ──
  /** Dedup guard: drawing IDs currently being reconciled */
  private _reconcileInFlight: Set<string> = new Set();
  /** TTL cache for reconciliation results to avoid redundant server calls on tab switching */
  private _reconcileCache: Map<string, { timestamp: number; persistent: boolean }> = new Map();
  /** Background reconciliation interval (checks active drawing against server periodically) */
  private _backgroundReconcileInterval: ReturnType<typeof setInterval> | null = null;
  /** TTL for reconciliation cache entries (30 seconds) */
  private static RECONCILE_CACHE_TTL = 30_000;
  /** Background reconciliation interval (60 seconds) */
  private static BACKGROUND_RECONCILE_INTERVAL = 60_000;

  // ── Published ID Memory Cache ──
  /** In-memory cache of filePath → drawingId, survives frontmatter overwrites by third-party sync plugins.
   *  Updated on publish, unpublish, recovery, and initial load. Used to detect when frontmatter
   *  is lost (e.g., LiveSync overwrites) and trigger server-side recovery. */
  private _publishedIdCache: Map<string, string> = new Map();
  /** Dedup guard: file paths currently being recovered via server lookup */
  private _recoveryInFlight: Set<string> = new Set();

  // ── LiveSync Integration ──
  /** Whether LiveSync is currently suspended by us */
  private _liveSyncSuspended = false;
  /** Original LiveSync settings before we suspended them (for restoration) */
  private _liveSyncOriginalSettings: {
    suspendFileWatching: boolean;
    suspendParseReplicationResult: boolean;
  } | null = null;

  async onload() {
    await this.loadSettings();
    console.log('ExcaliShare: Plugin loaded');

    // Inject global CSS for animations
    injectGlobalStyles();

    // Start periodic server health check (every 60 seconds)
    this.startHealthCheck();

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
              const url = this.buildShareUrl(publishedId, file);
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
          if (publishedId && !(this.activeCollabSessionId && this.activeCollabDrawingId === publishedId)) {
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

    this.addCommand({
      id: 'enable-persistent-collab',
      name: 'Enable Persistent Collaboration',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId && !this.isPersistentCollabEnabled(file)) {
            if (!checking) this.enablePersistentCollab(file, publishedId);
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: 'disable-persistent-collab',
      name: 'Disable Persistent Collaboration',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const publishedId = this.getPublishedId(file);
          if (publishedId && this.isPersistentCollabEnabled(file)) {
            if (!checking) this.disablePersistentCollab(file, publishedId);
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
                  const url = this.buildShareUrl(publishedId, file);
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
            } else if (!this.activeCollabSessionId || this.activeCollabDrawingId !== publishedId) {
              menu.addItem((item) => {
                item.setTitle('Start Live Collab').setIcon('users')
                  .onClick(() => this.startCollabSession(file, publishedId));
              });
            }

            menu.addItem((item) => {
              item.setTitle('Pull from ExcaliShare').setIcon('download')
                .onClick(() => this.pullFromServer(file, publishedId));
            });

            // Persistent collab menu items
            const isPersistentCollab = this.isPersistentCollabEnabled(file);
            if (publishedId && !isPersistentCollab) {
              menu.addItem((item: any) => {
                item.setTitle('Enable Persistent Collab').setIcon('globe')
                  .onClick(() => this.enablePersistentCollab(file, publishedId));
              });
            } else if (publishedId && isPersistentCollab) {
              menu.addItem((item: any) => {
                item.setTitle('Disable Persistent Collab').setIcon('globe')
                  .onClick(() => this.disablePersistentCollab(file, publishedId));
              });
            }

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

    // Initial toolbar injection for the current view.
    // Use onLayoutReady to wait for the workspace to be fully restored after startup,
    // instead of a fragile setTimeout. This ensures Excalidraw views are ready.
    this.app.workspace.onLayoutReady(() => {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf) {
        this.handleLeafChange(leaf);
      }
      // Also scan all open leaves — on startup, multiple Excalidraw tabs may be open
      // but only the active one gets handled above. Scan the rest with a short delay
      // to let Excalidraw finish initializing.
      setTimeout(() => {
        this.app.workspace.iterateAllLeaves((l: WorkspaceLeaf) => {
          const leafId = (l as any).id || 'default';
          if (l.view.getViewType() === 'excalidraw' && !this.toolbarInstances.has(leafId)) {
            this.handleLeafChange(l);
          } else if (l.view.getViewType() === 'excalidraw-loading' && !this._loadingLeafObservers.has(leafId)) {
            this.watchLoadingLeaf(l, leafId);
          }
        });
      }, 500);
    });

    // ── Background Reconciliation: periodically check active drawing against server ──
    this._backgroundReconcileInterval = setInterval(() => {
      this.backgroundReconcile();
    }, ExcaliSharePlugin.BACKGROUND_RECONCILE_INTERVAL);
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

    // Stop all embedded Excalidraw scripts
    this.scriptManager.deactivateAll();

    // Remove all toolbar instances
    for (const toolbar of this.toolbarInstances.values()) {
      toolbar.remove();
    }
    this.toolbarInstances.clear();

    // Disconnect all MutationObservers and polling intervals
    for (const obs of this._mountObservers.values()) obs.disconnect();
    this._mountObservers.clear();
    for (const obs of this._orphanObservers.values()) obs.disconnect();
    this._orphanObservers.clear();
    for (const obs of this._loadingLeafObservers.values()) obs.disconnect();
    this._loadingLeafObservers.clear();
    for (const poller of this._loadingLeafPollers.values()) clearInterval(poller);
    this._loadingLeafPollers.clear();

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

    // Clear background reconciliation interval
    if (this._backgroundReconcileInterval) {
      clearInterval(this._backgroundReconcileInterval);
      this._backgroundReconcileInterval = null;
    }
    this._reconcileCache.clear();
    this._reconcileInFlight.clear();

    // Stop health check interval
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }

    // Resume LiveSync if we suspended it (safety net)
    this.resumeLiveSync();
  }

  // ── LiveSync Integration ──

  /**
   * Suspend LiveSync file watching and database reflecting during active collab sessions.
   * This prevents file-level sync from conflicting with real-time WebSocket collaboration.
   * LiveSync's "Scram Switches" (suspendFileWatching, suspendParseReplicationResult) are
   * toggled via the plugin's settings object, accessed through Obsidian's plugin API.
   */
  private async suspendLiveSync(): Promise<void> {
    if (!this.settings.suspendLiveSyncDuringCollab) return;
    if (this._liveSyncSuspended) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugins = (this.app as any).plugins;
      const liveSyncPlugin = plugins?.getPlugin?.('obsidian-livesync');
      if (!liveSyncPlugin?.settings) {
        console.log('ExcaliShare: LiveSync not found, skipping suspension');
        return;
      }

      // Save original settings so we can restore them later
      this._liveSyncOriginalSettings = {
        suspendFileWatching: liveSyncPlugin.settings.suspendFileWatching ?? false,
        suspendParseReplicationResult: liveSyncPlugin.settings.suspendParseReplicationResult ?? false,
      };

      // If LiveSync is already suspended by the user, don't touch it
      if (this._liveSyncOriginalSettings.suspendFileWatching &&
          this._liveSyncOriginalSettings.suspendParseReplicationResult) {
        console.log('ExcaliShare: LiveSync already suspended by user, skipping');
        this._liveSyncOriginalSettings = null;
        return;
      }

      // Suspend both file watching and database reflecting
      liveSyncPlugin.settings.suspendFileWatching = true;
      liveSyncPlugin.settings.suspendParseReplicationResult = true;

      if (typeof liveSyncPlugin.saveSettings === 'function') {
        await liveSyncPlugin.saveSettings();
      }

      this._liveSyncSuspended = true;
      console.log('ExcaliShare: LiveSync suspended for collab session');
      new Notice('ExcaliShare: LiveSync paused during collab');
    } catch (e) {
      console.error('ExcaliShare: Failed to suspend LiveSync', e);
    }
  }

  /**
   * Resume LiveSync by restoring the original settings that were saved before suspension.
   * Called when a collab session ends or on plugin unload (safety net).
   */
  private async resumeLiveSync(): Promise<void> {
    if (!this._liveSyncSuspended) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugins = (this.app as any).plugins;
      const liveSyncPlugin = plugins?.getPlugin?.('obsidian-livesync');
      if (!liveSyncPlugin?.settings || !this._liveSyncOriginalSettings) {
        this._liveSyncSuspended = false;
        this._liveSyncOriginalSettings = null;
        return;
      }

      // Restore original settings
      liveSyncPlugin.settings.suspendFileWatching = this._liveSyncOriginalSettings.suspendFileWatching;
      liveSyncPlugin.settings.suspendParseReplicationResult = this._liveSyncOriginalSettings.suspendParseReplicationResult;

      if (typeof liveSyncPlugin.saveSettings === 'function') {
        await liveSyncPlugin.saveSettings();
      }

      this._liveSyncSuspended = false;
      this._liveSyncOriginalSettings = null;
      console.log('ExcaliShare: LiveSync resumed after collab session');
      new Notice('ExcaliShare: LiveSync resumed');
    } catch (e) {
      console.error('ExcaliShare: Failed to resume LiveSync', e);
      // Force-clear state even on error to avoid permanent suspension
      this._liveSyncSuspended = false;
      this._liveSyncOriginalSettings = null;
    }
  }

  // ── Server Health Check ──

  /**
   * Start periodic server health check.
   * Checks every 60 seconds and updates toolbar/status bar when reachability changes.
   */
  private startHealthCheck(): void {
    // Initial check after 2 seconds (give plugin time to fully load)
    setTimeout(() => this.checkServerHealth(), 2000);

    // Periodic check every 60 seconds
    this._healthCheckInterval = setInterval(() => {
      this.checkServerHealth();
    }, 60_000);
  }

  /**
   * Check if the server is reachable by hitting /api/health.
   * Updates toolbar state and status bar when reachability changes.
   */
  private async checkServerHealth(): Promise<boolean> {
    if (!this.settings.baseUrl || !this.settings.apiKey) {
      return false; // Not configured yet
    }

    try {
      const res = await requestUrl({
        url: `${this.settings.baseUrl}/api/health`,
        method: 'GET',
        throw: false,
      });
      const reachable = res.status >= 200 && res.status < 500;

      if (reachable !== this._serverReachable) {
        this._serverReachable = reachable;
        this.onServerReachabilityChanged(reachable);
      }
      return reachable;
    } catch {
      if (this._serverReachable) {
        this._serverReachable = false;
        this.onServerReachabilityChanged(false);
      }
      return false;
    }
  }

  /**
   * Called when server reachability changes.
   * Updates toolbar state, status bar, and processes pending operations if server came back.
   */
  private onServerReachabilityChanged(reachable: boolean): void {
    // Update all toolbar instances
    for (const toolbar of this.toolbarInstances.values()) {
      toolbar.updateState({ serverReachable: reachable });
    }

    // Update status bar
    if (this.collabStatusBarItem) {
      if (!reachable) {
        this.collabStatusBarItem.setText('ExcaliShare: ❌ Server unreachable');
        this.collabStatusBarItem.show();
      } else if (!this.activeCollabSessionId) {
        // Only hide/reset if not in a collab session
        this.collabStatusBarItem.hide();
      }
    }

    if (reachable) {
      // Process pending operations now that server is back
      if (this._pendingOperations.length > 0) {
        const pending = [...this._pendingOperations];
        this._pendingOperations = [];
        new Notice(`Server reconnected. Syncing ${pending.length} pending change${pending.length !== 1 ? 's' : ''}...`);
        for (const op of pending) {
          if (op.type === 'publish' || op.type === 'sync') {
            this.publishDrawing(op.file, op.existingId, true).catch((e) => {
              console.error('ExcaliShare: Failed to process pending operation', e);
            });
          }
        }
      }

      // Auto-join persistent collab session for the currently open drawing (if applicable)
      if (this.settings.collabJoinFromObsidian && !this.collabManager?.isJoined) {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isExcalidrawFile(file)) {
          const drawingId = this.getPublishedId(file);
          if (drawingId && this.isPersistentCollabEnabled(file)) {
            this.autoJoinPersistentCollab(drawingId).catch((e) => {
              console.error('ExcaliShare: Failed to auto-join persistent collab after reconnect', e);
            });
          }
        }
      }
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
    // Disconnect loading observer (excalidraw-loading → excalidraw transition watcher)
    const loadingObs = this._loadingLeafObservers.get(leafId);
    if (loadingObs) {
      loadingObs.disconnect();
      this._loadingLeafObservers.delete(leafId);
    }
    // Clear loading leaf polling interval
    const loadingPoller = this._loadingLeafPollers.get(leafId);
    if (loadingPoller) {
      clearInterval(loadingPoller);
      this._loadingLeafPollers.delete(leafId);
    }
  }

  /**
   * Watch a leaf that is in the 'excalidraw-loading' state.
   * Sets up a MutationObserver on the leaf's container to detect when Excalidraw
   * finishes loading (i.e. .excalidraw-wrapper appears), then calls handleLeafChange again.
   * This handles the startup case where active-leaf-change fires before Excalidraw is ready.
   */
  private watchLoadingLeaf(leaf: WorkspaceLeaf, leafId: string): void {
    // Don't set up duplicate observers
    if (this._loadingLeafObservers.has(leafId)) return;

    const containerEl = leaf.view.containerEl;

    // Cleanup helper: stops both the MutationObserver and the polling interval
    const cleanup = () => {
      observer.disconnect();
      this._loadingLeafObservers.delete(leafId);
      const poller = this._loadingLeafPollers.get(leafId);
      if (poller) {
        clearInterval(poller);
        this._loadingLeafPollers.delete(leafId);
      }
    };

    const onReady = () => {
      cleanup();
      // Now handle the leaf as a fully loaded Excalidraw view
      this.handleLeafChange(leaf);
    };

    const observer = new MutationObserver(() => {
      // Check if Excalidraw has finished loading
      const viewType = leaf.view.getViewType();
      if (viewType === 'excalidraw') {
        onReady();
      }
    });

    observer.observe(containerEl, { childList: true, subtree: true, attributes: true });
    this._loadingLeafObservers.set(leafId, observer);

    // Polling fallback: the MutationObserver watches DOM mutations on containerEl,
    // but the view type transition (excalidraw-loading → excalidraw) may happen
    // without triggering a DOM mutation on the observed container (e.g., the Excalidraw
    // plugin may swap the entire view object internally). Poll every 500ms as a safety net.
    const pollInterval = setInterval(() => {
      try {
        const viewType = leaf.view.getViewType();
        if (viewType === 'excalidraw') {
          onReady();
        }
      } catch {
        // Leaf may have been detached — clean up
        cleanup();
      }
    }, 500);
    this._loadingLeafPollers.set(leafId, pollInterval);

    // Safety timeout: stop watching after 30s to avoid memory leaks
    setTimeout(() => {
      if (this._loadingLeafObservers.has(leafId)) {
        cleanup();
        // One final attempt in case both observer and polling missed the transition
        try {
          if (leaf.view.getViewType() === 'excalidraw') {
            this.handleLeafChange(leaf);
          }
        } catch {
          // Leaf may have been detached
        }
      }
    }, 30_000);
  }

  private handleLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!this.settings.showFloatingToolbar) return;
    if (!leaf) return;

    const view = leaf.view;
    const viewType = view.getViewType();
    const leafId = (leaf as any).id || 'default';

    // Handle the transitional 'excalidraw-loading' state:
    // Excalidraw uses this view type while it initialises on startup.
    // active-leaf-change fires with this type, but the view isn't ready yet.
    // We watch for the transition to 'excalidraw' and then inject the toolbar.
    if (viewType === 'excalidraw-loading') {
      this.watchLoadingLeaf(leaf, leafId);
      return;
    }

    // Check if this is an Excalidraw view
    if (viewType === 'excalidraw') {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        return;
      }

      // Check if we already have a toolbar for this exact leaf+file combo
      // and it's still properly injected — skip re-creation to avoid churn
      const existingToolbar = this.toolbarInstances.get(leafId);
      const existingFilePath = this._leafFilePaths.get(leafId);
      if (existingToolbar && existingToolbar.isInjected() && existingFilePath === file.path) {
        this.updateToolbarState(existingToolbar, file);
        // Still reconcile server state even when toolbar is reused
        // (ensures persistent collab auto-join works on tab switches)
        const publishedId = this.getPublishedId(file);
        if (publishedId) {
          this.reconcileServerState(file, publishedId);
        } else {
          // Check memory cache for recovery (frontmatter may have been overwritten)
          const cachedId = this._publishedIdCache.get(file.path);
          if (cachedId) {
            this.recoverPublishedState(file);
          }
        }
        // Ensure scripts are active (may not have been started yet if API wasn't ready)
        if (!this.scriptManager.hasActiveScripts(leafId)) {
          this.activateScriptsForLeaf(leafId, view.containerEl);
        }
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

      // Reconcile local state with server for published drawings, then sync if persistent collab
      const publishedId = this.getPublishedId(file);
      if (publishedId) {
        this.reconcileServerState(file, publishedId);
      } else {
        // No published ID in frontmatter — check if we had one in memory cache
        // (frontmatter may have been overwritten by a third-party sync plugin like LiveSync)
        const cachedId = this._publishedIdCache.get(file.path);
        if (cachedId) {
          console.log(`ExcaliShare: No frontmatter ID for ${file.path} but memory cache has ${cachedId}. Recovering...`);
          this.recoverPublishedState(file);
        }
      }

      // Activate embedded Excalidraw scripts (zoom-adaptive stroke, right-click eraser)
      this.activateScriptsForLeaf(leafId, view.containerEl);
    } else {
      // Not an Excalidraw view — clean up everything for this leaf
      this.cleanupLeafObservers(leafId);
      this.scriptManager.deactivateForLeaf(leafId);
      const toolbar = this.toolbarInstances.get(leafId);
      if (toolbar) {
        toolbar.remove();
        this.toolbarInstances.delete(leafId);
      }
      this._leafFilePaths.delete(leafId);

      // If we had an active persistent collab session, disconnect gracefully
      // so it can auto-rejoin when the drawing is reopened.
      // For persistent collab, the session stays alive on the server — we just leave the WS.
      if (this.collabManager?.isJoined && this.activeCollabDrawingId) {
        // Check if this is a persistent session (don't auto-disconnect regular live collab)
        const drawingFile = this.activeCollabDrawingId
          ? this.app.vault.getFiles().find(f => {
              const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
              return fm?.['excalishare-id'] === this.activeCollabDrawingId;
            })
          : null;
        if (drawingFile && this.isPersistentCollabEnabled(drawingFile)) {
          // Disconnect from persistent collab — will auto-rejoin on next open
          this.collabManager.destroy();
          this.collabManager = null;
          // Keep activeCollabSessionId/activeCollabDrawingId so toolbar shows session exists
          // but clear the status bar since we're not actively connected
          if (this.collabStatusBarItem) {
            this.collabStatusBarItem.setText('');
            this.collabStatusBarItem.hide();
          }
        }
      }
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
      this.doInject(toolbar, wrapper, file, leafId);
      return;
    }

    // .excalidraw-wrapper not yet in DOM — Excalidraw hasn't mounted yet.
    // Inject into a temporary container so the toolbar is visible while waiting,
    // then use MutationObserver to re-inject into the ideal container.
    const tempContainer = (containerEl.querySelector('.view-content') || containerEl) as HTMLElement;
    toolbar.inject(tempContainer);
    this.updateToolbarState(toolbar, file);

    // Set up MutationObserver to watch for .excalidraw-wrapper appearing
    const observer = new MutationObserver((mutations, obs) => {
      const wrapper = containerEl.querySelector('.excalidraw-wrapper') as HTMLElement | null;
      if (wrapper) {
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
            const url = this.buildShareUrl(publishedId, currentFile);
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
      onEnablePersistentCollab: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.enablePersistentCollab(currentFile, publishedId);
            this.refreshActiveToolbar();
          }
        }
      },
      onDisablePersistentCollab: async () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          const publishedId = this.getPublishedId(currentFile);
          if (publishedId) {
            await this.disablePersistentCollab(currentFile, publishedId);
            this.refreshActiveToolbar();
          }
        }
      },
      onManualReconnect: () => {
        if (this.collabManager?.isJoined) {
          this.collabManager.manualReconnect();
        }
      },
      onRetryServer: () => {
        this.checkServerHealth();
      },
    };

    return new ExcaliShareToolbar(
      callbacks,
      this.settings.toolbarPosition,
      this.settings.toolbarCollapsedByDefault,
      this.settings.mobilePopoverBottomSheet,
    );
  }

  private updateToolbarState(toolbar: ExcaliShareToolbar, file: TFile): void {
    const publishedId = this.getPublishedId(file);
    let status: ToolbarStatus = 'unpublished';

    // Check if drawing is password-protected from frontmatter
    const cache = this.app.metadataCache.getFileCache(file);
    const passwordProtected = cache?.frontmatter?.['excalishare-password'] === true;

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
      passwordProtected,
      collabParticipantCount: this.collabManager?.participantCount,
      collabNativeJoined: this.collabManager?.isJoined,
      collabCollaborators: this.collabManager?.currentCollaborators,
      collabFollowingUserId: this.collabManager?.currentFollowingUserId,
      collabDisplayName: this.settings.collabDisplayName || 'Host',
      persistentCollabEnabled: this.isPersistentCollabEnabled(file),
      serverReachable: this._serverReachable,
      collabReconnectState: this.collabManager?.isJoined
        ? (this.collabManager?.isConnected ? 'connected' : 'reconnecting')
        : null,
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

    // Skip auto-sync upload for persistent collab drawings when natively joined
    // (changes are synced via WebSocket in real-time)
    if (this.isPersistentCollabEnabled(file) && this.collabManager?.isJoined) return;

    // Debounce: reset timer on each modification
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }

    this.autoSyncTimer = setTimeout(async () => {
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
    // Skip metadata change handling for the active collab file — during a live collab session,
    // file-level sync (e.g., LiveSync) may overwrite frontmatter, triggering unnecessary
    // recovery attempts and toolbar refreshes that disrupt the session.
    if (this.collabManager?.isJoined && this.activeCollabDrawingId) {
      const publishedId = this.getPublishedId(file) || this._publishedIdCache.get(file.path);
      if (publishedId === this.activeCollabDrawingId) return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === file.path) {
      // Check if frontmatter just lost excalishare-id but we had it in memory cache.
      // This happens when a third-party sync plugin (e.g., LiveSync) overwrites the file
      // with an older version that doesn't have the ExcaliShare frontmatter fields.
      const currentId = this.getPublishedId(file);
      const cachedId = this._publishedIdCache.get(file.path);

      if (!currentId && cachedId) {
        // Frontmatter was lost! Trigger server-side recovery instead of showing Draft.
        console.log(`ExcaliShare: Frontmatter lost for ${file.path} (had ID ${cachedId}). Triggering server recovery...`);
        this.recoverPublishedState(file);
        // Don't refresh toolbar yet — recovery will do it after restoring frontmatter
        return;
      }

      this.refreshActiveToolbar();
    }
  }

  // ── Embedded Excalidraw Scripts ──

  /**
   * Activate embedded scripts (zoom-adaptive stroke, right-click eraser) for a leaf.
   * Acquires the Excalidraw API and container, then delegates to the script manager.
   * Uses a delayed retry if the API isn't ready yet (Excalidraw may still be mounting).
   */
  private activateScriptsForLeaf(leafId: string, containerEl: HTMLElement, retryCount = 0): void {
    // Skip if neither script is enabled
    if (!this.settings.enableZoomAdaptiveStroke && !this.settings.enableRightClickEraser) return;

    // Skip if scripts are already active for this leaf
    if (this.scriptManager.hasActiveScripts(leafId)) return;

    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      // Retry with backoff if Excalidraw plugin not yet loaded
      if (retryCount < 4) {
        const delay = [500, 1000, 2000, 4000][retryCount];
        setTimeout(() => this.activateScriptsForLeaf(leafId, containerEl, retryCount + 1), delay);
      }
      return;
    }

    try {
      excalidrawPlugin.ea.setView('active');
      const api = excalidrawPlugin.ea.getExcalidrawAPI();
      if (!api) {
        // API not ready — retry
        if (retryCount < 4) {
          const delay = [500, 1000, 2000, 4000][retryCount];
          setTimeout(() => this.activateScriptsForLeaf(leafId, containerEl, retryCount + 1), delay);
        }
        return;
      }

      // Find the best container element for event listeners
      const container =
        containerEl.querySelector<HTMLElement>('.excalidraw-wrapper') ||
        containerEl.querySelector<HTMLElement>('.excalidraw') ||
        containerEl.querySelector<HTMLElement>('[class*="excalidraw"]') ||
        containerEl;

      const scriptSettings: ScriptSettings = {
        enableZoomAdaptive: this.settings.enableZoomAdaptiveStroke,
        baseStrokeWidth: this.settings.zoomAdaptiveBaseStrokeWidth,
        pollIntervalMs: this.settings.zoomAdaptivePollIntervalMs,
        disableSmoothing: this.settings.disableSmoothing,
        enableRightClickEraser: this.settings.enableRightClickEraser,
      };

      this.scriptManager.activateForLeaf(leafId, api as ExcalidrawAPI, container, scriptSettings);
    } catch (e) {
      console.error('ExcaliShare: Failed to activate embedded scripts', e);
      // Retry on error
      if (retryCount < 4) {
        const delay = [500, 1000, 2000, 4000][retryCount];
        setTimeout(() => this.activateScriptsForLeaf(leafId, containerEl, retryCount + 1), delay);
      }
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
      return null;
    } catch (e) {
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
      const id = cache.frontmatter['excalishare-id'] as string;
      // Keep in-memory cache in sync with frontmatter
      this._publishedIdCache.set(file.path, id);
      return id;
    }
    return null;
  }

  /** Check if a file has persistent collab enabled (from frontmatter) */
  private isPersistentCollabEnabled(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.['excalishare-persistent-collab'] === true;
  }

  /** Get the last sync version from frontmatter */
  private getLastSyncVersion(file: TFile): number {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.['excalishare-last-sync-version'] ?? 0;
  }

  /**
   * Build the share URL for a published drawing.
   * If the drawing has a stored password key (excalishare-password-key in frontmatter),
   * appends it as a URL fragment (#key=...) so the recipient can view without entering a password.
   */
  private buildShareUrl(publishedId: string, file: TFile): string {
    const url = `${this.settings.baseUrl}/d/${publishedId}`;
    const cache = this.app.metadataCache.getFileCache(file);
    const passwordKey = cache?.frontmatter?.['excalishare-password-key'];
    if (passwordKey) {
      return url + `#key=${encodeURIComponent(passwordKey)}`;
    }
    return url;
  }

  /** Element-level merge: server elements + local elements, highest version wins.
   *  Includes safety checks to avoid corrupted elements (undefined text, missing type, etc.) */
  private mergeElements(local: any[], server: any[]): any[] {
    const merged = new Map<string, any>();
    const order: string[] = [];

    // Helper: validate that an element is not corrupted
    const isValidElement = (el: any): boolean => {
      if (!el || !el.id || !el.type) return false;
      // Text elements must have a valid text property
      if (el.type === 'text') {
        if (el.text === undefined || el.text === null) return false;
      }
      return true;
    };

    // Start with server elements (source of truth)
    for (const el of server) {
      if (!isValidElement(el)) continue;
      merged.set(el.id, el);
      order.push(el.id);
    }

    // Merge local elements
    for (const el of local) {
      if (!isValidElement(el)) continue;
      const existing = merged.get(el.id);
      if (!existing) {
        // New local element — add it
        merged.set(el.id, el);
        order.push(el.id);
      } else if ((el.version ?? 0) > (existing.version ?? 0)) {
        // Local has higher version — use local
        merged.set(el.id, el);
      }
      // Otherwise server version wins (already in map)
    }

    return order.map(id => merged.get(id)!).filter(Boolean);
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Refresh all toolbars when settings change
    this.refreshActiveToolbar();
    // Propagate script settings to all running instances (handles enable/disable/update)
    this.scriptManager.updateSettings({
      enableZoomAdaptive: this.settings.enableZoomAdaptiveStroke,
      baseStrokeWidth: this.settings.zoomAdaptiveBaseStrokeWidth,
      pollIntervalMs: this.settings.zoomAdaptivePollIntervalMs,
      disableSmoothing: this.settings.disableSmoothing,
      enableRightClickEraser: this.settings.enableRightClickEraser,
    });
  }

  // ── API Methods ──

  async publishDrawing(file: TFile, existingId?: string, silent = false) {

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
          }
        }
      } catch {
        // Fall back to manual parse below
      }

      if (Object.keys(files).length === 0) {
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
                } catch (e) {
                  console.error(`ExcaliShare: Failed to convert PDF ${linkPath}`, e);
                }
                continue;
              }

              const supportedImageTypes = ['png', 'jpg', 'jpeg', 'svg', 'gif'];
              if (!supportedImageTypes.includes(ext)) {
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

      // Prompt for password on first publish (not on sync/silent)
      let drawingPassword: string | null = null;
      if (!existingId && !silent) {
        drawingPassword = await promptPassword(
          this.app,
          '🔒 Password Protection',
          'Optionally set a password to protect this drawing. Only people with the password (or the share link) can view it.'
        );
        if (drawingPassword) {
          bodyData.password = drawingPassword;
        }
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
        // Store the server URL used for this publish — used to guard against
        // cross-server 404 clearing when reconciling with a different server instance
        frontmatter['excalishare-server'] = this.settings.baseUrl;
        if (result.password_protected) {
          frontmatter['excalishare-password'] = true;
          // Store the actual password value so "Copy Share Link" can include it inline.
          // This is intentional: the admin set the password and needs it in the share URL.
          if (drawingPassword) {
            frontmatter['excalishare-password-key'] = drawingPassword;
          }
        } else {
          // Clear stale password keys if re-publishing/syncing without a password
          delete frontmatter['excalishare-password'];
          delete frontmatter['excalishare-password-key'];
        }
      });

      // Update in-memory published ID cache
      this._publishedIdCache.set(file.path, result.id);

      // Build share URL — include password in fragment if set
      let shareUrl = result.url;
      if (drawingPassword) {
        shareUrl += `#key=${encodeURIComponent(drawingPassword)}`;
      }

      await navigator.clipboard.writeText(shareUrl);
      if (!silent) {
        const pwNote = drawingPassword ? ' (password-protected 🔒)' : '';
        new Notice(`Drawing ${existingId ? 'synced' : 'published'}${pwNote}! URL copied to clipboard.`);
      }
    } catch (error) {
      console.error('ExcaliShare: Publish error', error);
      // Check if this is a network error (server unreachable)
      const isNetworkError = error instanceof Error && (
        error.message.includes('net::') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network request failed') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      );
      if (isNetworkError && !silent) {
        // Queue for retry when server comes back
        this._pendingOperations.push({ type: existingId ? 'sync' : 'publish', file, existingId });
        this._serverReachable = false;
        this.onServerReachabilityChanged(false);
        new Notice('Server unreachable. Will retry when connection is restored.');
      } else if (!silent) {
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
        delete frontmatter['excalishare-server'];
        delete frontmatter['excalishare-persistent-collab'];
        delete frontmatter['excalishare-last-sync-version'];
        delete frontmatter['excalishare-password'];
        delete frontmatter['excalishare-password-key'];
      });

      // Clear in-memory tracking for this file/drawing
      this._publishedIdCache.delete(file.path);
      this._persistentSyncedFiles.delete(file.path);
      this._reconcileCache.delete(idToDelete);

      // Disconnect native collab WebSocket if currently joined to this drawing's session.
      // Without this, collabManager.isJoined stays true and the auto-join check in
      // autoJoinPersistentCollab would be skipped if the user re-publishes and re-enables
      // persistent collab on the same drawing (or a new drawing after unpublishing).
      if (this.collabManager?.isJoined && this.activeCollabDrawingId === idToDelete) {
        this.cleanupCollabState();
      }

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

    if (this.activeCollabSessionId && this.activeCollabDrawingId === drawingId) {
      new Notice('A collab session is already active for this drawing. Stop it first.');
      return;
    }

    // Prompt for collab session password
    const collabPassword = await promptPassword(
      this.app,
      '🔒 Collab Password',
      'Optionally set a password for this collab session. Users will need to enter it to join.'
    );

    new Notice('Starting live collab session...');

    try {
      const collabBody: any = {
        drawing_id: drawingId,
        timeout_secs: this.settings.collabTimeoutSecs,
      };
      if (collabPassword) {
        collabBody.password = collabPassword;
      }

      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/collab/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify(collabBody),
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
      const pwNote = collabPassword ? ' (password-protected 🔒)' : '';
      new Notice(`Live collab session started${pwNote}! Session ID: ${result.session_id}`);

      // Auto-join from Obsidian if enabled
      if (this.settings.collabJoinFromObsidian) {
        // Capture pre-collab scene state so we can restore it if the host discards changes
        try {
          const plugin = this.getExcalidrawPlugin();
          if (plugin?.ea) {
            plugin.ea.setView('active');
            const api = plugin.ea.getExcalidrawAPI();
            if (api) {
              this.preCollabSnapshot = {
                elements: JSON.parse(JSON.stringify(api.getSceneElements())),
                appState: JSON.parse(JSON.stringify(api.getAppState())),
                files: JSON.parse(JSON.stringify(api.getFiles())),
              };
            }
          }
        } catch (e) {
          console.error('ExcaliShare: Failed to capture pre-collab snapshot', e);
        }

        await this.joinCollabFromObsidian(drawingId, result.session_id, collabPassword);
      }

      if (this.settings.collabAutoOpenBrowser) {
        window.open(viewUrl, '_blank');
      }

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

    // Check if native collab was active (changes already synced locally via WebSocket)
    const wasNativeCollabActive = this.collabManager?.isJoined ?? false;

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
      // Grab the snapshot before cleanupCollabState clears it
      const snapshot = this.preCollabSnapshot;
      this.cleanupCollabState();

      if (save && drawingId) {
        if (wasNativeCollabActive) {
          // Native collab was active — local scene already has all changes via live sync.
          // Skip pulling from server to avoid duplicate/buggy elements.
          console.log('ExcaliShare: Skipping pull — native collab was active, local state is up-to-date.');
          new Notice('Collab session saved! Changes already synced locally.');
        } else {
          const file = this.app.workspace.getActiveFile();
          if (file && this.getPublishedId(file) === drawingId) {
            await this.pullFromServer(file, drawingId);
          } else {
            new Notice('Collab session saved. Use "Pull from ExcaliShare" to sync changes to your vault.');
          }
        }
      } else {
        // Restore the pre-collab scene state so the drawing reverts to before the session
        this.restorePreCollabSnapshot(snapshot);
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
    this.preCollabSnapshot = null;

    if (this.collabStatusBarItem) {
      this.collabStatusBarItem.setText('');
      this.collabStatusBarItem.hide();
    }

    if (this.collabHealthInterval) {
      clearInterval(this.collabHealthInterval);
      this.collabHealthInterval = null;
    }

    // Resume LiveSync if we suspended it for this collab session
    this.resumeLiveSync();
  }

  /**
   * Restore the Excalidraw scene to the pre-collab snapshot.
   * Called when the host discards collab changes.
   */
  private restorePreCollabSnapshot(snapshot: typeof this.preCollabSnapshot): void {
    if (!snapshot) {
      return;
    }

    try {
      const plugin = this.getExcalidrawPlugin();
      if (plugin?.ea) {
        plugin.ea.setView('active');
        const api = plugin.ea.getExcalidrawAPI();
        if (api && typeof api.updateScene === 'function') {
          // Only restore elements — appState may contain non-serializable fields
          // (e.g. collaborators is a Map that doesn't survive JSON.stringify).
          // Also clear collaborator cursors with an empty Map.
          api.updateScene({
            elements: snapshot.elements,
            collaborators: new Map(),
          });
        }
      }
    } catch (e) {
      console.error('ExcaliShare: Failed to restore pre-collab snapshot', e);
    }
  }

  /**
   * Join the collab session from within Obsidian using a WebSocket connection.
   * This allows the host to participate directly in the Excalidraw canvas
   * without opening a browser.
   */
  private async joinCollabFromObsidian(drawingId: string, sessionId: string, password?: string | null, persistentMode?: boolean): Promise<void> {
    const excalidrawPlugin = this.getExcalidrawPlugin();
    if (!excalidrawPlugin?.ea) {
      return;
    }

    // Destroy any existing collabManager to prevent zombie WebSocket connections.
    // This can happen when _reconnect_failed fires (sets _isJoined=false but doesn't null the manager)
    // and then a new join is triggered by backgroundReconcile or handleLeafChange.
    if (this.collabManager) {
      console.log('ExcaliShare: Destroying existing collabManager before creating new one');
      this.collabManager.destroy();
      this.collabManager = null;
    }

    // Suspend LiveSync to prevent file-level sync from conflicting with WebSocket collab
    await this.suspendLiveSync();

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
            // Update toolbar reconnect state when connection is restored
            if (connected) {
              for (const toolbar of this.toolbarInstances.values()) {
                toolbar.updateState({
                  collabReconnectState: 'connected',
                  collabReconnectAttempt: 0,
                });
              }
              // Restore status bar to normal collab state
              if (this.collabStatusBarItem) {
                this.collabStatusBarItem.setText('🔴 Live Collab');
              }
            } else {
              // Disconnected — will be updated by onReconnecting
              for (const toolbar of this.toolbarInstances.values()) {
                toolbar.updateState({
                  collabReconnectState: 'reconnecting',
                });
              }
            }
          },
          onSessionEnded: (saved) => {
            // Session was ended by someone else (or server timeout)
            // Grab the snapshot before cleanupCollabState clears it
            const snapshot = this.preCollabSnapshot;
            this.cleanupCollabState();
            this.refreshActiveToolbar();

            if (saved) {
              // Native collab was active (this callback only fires from joinCollabFromObsidian),
              // so the local scene already has all changes via live sync.
              // Skip pulling from server to avoid duplicate/buggy elements.
              console.log('ExcaliShare: Session ended with save — skipping pull, native collab kept local state up-to-date.');
              new Notice('Collab session ended and saved. Changes already synced locally.');
            } else {
              // Restore the pre-collab scene state
              this.restorePreCollabSnapshot(snapshot);
            }
          },
          onFollowChanged: (_followingUserId) => {
            // Refresh toolbar to update follow state in the collaborator list
            this.refreshActiveToolbar();
          },
          onReconnecting: (attempt, maxAttempts) => {
            // Update all toolbar instances to show reconnect state
            for (const toolbar of this.toolbarInstances.values()) {
              toolbar.updateState({
                collabReconnectState: 'reconnecting',
                collabReconnectAttempt: attempt,
                collabMaxReconnectAttempts: maxAttempts === Infinity ? 999 : maxAttempts,
              });
            }
            // Update status bar
            if (this.collabStatusBarItem) {
              const maxStr = maxAttempts === Infinity ? '∞' : String(maxAttempts);
              this.collabStatusBarItem.setText(`🟡 Reconnecting ${attempt}/${maxStr}`);
            }
          },
          onReconnectFailed: () => {
            // All reconnect attempts exhausted (e.g. after overnight sleep).
            // For persistent collab sessions, clean up and schedule a re-activation attempt.
            // The collabManager already called leave() before this callback.
            // NOTE: With persistentMode=true (set in autoJoinPersistentCollab), this callback
            // should never fire for persistent sessions — the client reconnects indefinitely.
            // This path is only reached for regular (non-persistent) collab sessions.
            console.log('ExcaliShare: Reconnect failed — cleaning up and scheduling re-activation for persistent collab');
            const failedDrawingId = this.activeCollabDrawingId;
            this.cleanupCollabState();
            this.refreshActiveToolbar();
            // Immediately check server health so the toolbar shows the grey/retry state
            // without waiting up to 60s for the next periodic health check.
            this.checkServerHealth();

            if (failedDrawingId) {
              // Check if this was a persistent collab drawing and try to re-activate after a short delay.
              // The delay gives the server time to clean up the old session and allows the network
              // to stabilize (e.g. after waking from sleep).
              setTimeout(async () => {
                try {
                  const file = this.app.workspace.getActiveFile();
                  if (file && this.isExcalidrawFile(file)) {
                    const publishedId = this.getPublishedId(file);
                    if (publishedId === failedDrawingId && this.isPersistentCollabEnabled(file)) {
                      console.log('ExcaliShare: Attempting to re-activate persistent collab after reconnect failure');
                      new Notice('Reconnecting to persistent collab session...');
                      await this.autoJoinPersistentCollab(failedDrawingId);
                    }
                  }
                } catch (e) {
                  console.error('ExcaliShare: Failed to re-activate persistent collab after reconnect failure', e);
                }
              }, 5000); // 5 second delay before re-activation attempt
            }
          },
        },
      });

      await this.collabManager.startAndJoin(drawingId, sessionId, password, this.settings.apiKey || null, persistentMode ?? false);
    } catch (error) {
      console.error('ExcaliShare: Failed to join collab from Obsidian', error);
      new Notice('Failed to join collab session from Obsidian. You can still use the browser.');
      if (this.collabManager) {
        this.collabManager.destroy();
        this.collabManager = null;
      }
    }
  }

  // ── Persistent Collaboration ──

  /** Enable persistent collab for a drawing */
  async enablePersistentCollab(file: TFile, drawingId: string) {
    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return;
    }

    // Prompt for optional password
    const password = await promptPassword(
      this.app,
      '🔒 Persistent Collab Password',
      'Optionally set a password for persistent collaboration. Users will need to enter it to join.'
    );

    new Notice('Enabling persistent collaboration...');

    try {
      const body: any = { drawing_id: drawingId };
      if (password) body.password = password;

      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/persistent-collab/enable`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify(body),
        throw: false,
      });

      if (response.status >= 400) {
        let errorData: any = {};
        try { errorData = response.json; } catch { /* ignore */ }
        throw new Error(errorData.error || `Failed: ${response.status}`);
      }

      // Update frontmatter
      // @ts-ignore
      await this.app.fileManager.processFrontMatter(file, (fm: any) => {
        fm['excalishare-persistent-collab'] = true;
        fm['excalishare-last-sync-version'] = 0;
      });

      new Notice('Persistent collaboration enabled! Anyone with the link can now collaborate.');
      this.refreshActiveToolbar();

      // Immediately auto-join the persistent session.
      // We call autoJoinPersistentCollab directly (not syncPersistentCollabOnOpen) so that
      // the join is NOT gated by the persistentCollabAutoSync setting — the user explicitly
      // enabled persistent collab, so we always want to join immediately.
      if (this.settings.collabJoinFromObsidian) {
        this.autoJoinPersistentCollab(drawingId);
      }
    } catch (error) {
      console.error('ExcaliShare: Failed to enable persistent collab', error);
      new Notice(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** Disable persistent collab for a drawing */
  async disablePersistentCollab(file: TFile, drawingId: string) {
    if (!this.settings.apiKey) {
      new Notice('Please configure API key in plugin settings');
      return;
    }

    new Notice('Disabling persistent collaboration...');

    try {
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/persistent-collab/disable`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({ drawing_id: drawingId }),
        throw: false,
      });

      if (response.status >= 400) {
        let errorData: any = {};
        try { errorData = response.json; } catch { /* ignore */ }
        throw new Error(errorData.error || `Failed: ${response.status}`);
      }

      // Update frontmatter
      // @ts-ignore
      await this.app.fileManager.processFrontMatter(file, (fm: any) => {
        delete fm['excalishare-persistent-collab'];
        delete fm['excalishare-last-sync-version'];
      });

      // Remove from synced files tracking
      this._persistentSyncedFiles.delete(file.path);

      // Disconnect native collab WebSocket if currently joined to this drawing's session.
      // Without this, collabManager.isJoined stays true and the auto-join check in
      // syncPersistentCollabOnOpen would be skipped if the user re-enables persistent collab.
      if (this.collabManager?.isJoined && this.activeCollabDrawingId === drawingId) {
        this.collabManager.destroy();
        this.collabManager = null;
        this.activeCollabSessionId = null;
        this.activeCollabDrawingId = null;
        if (this.collabStatusBarItem) {
          this.collabStatusBarItem.setText('');
          this.collabStatusBarItem.hide();
        }
      }

      // Pull final state from server
      await this.pullFromServer(file, drawingId);

      new Notice('Persistent collaboration disabled.');
      this.refreshActiveToolbar();
    } catch (error) {
      console.error('ExcaliShare: Failed to disable persistent collab', error);
      new Notice(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ── Server State Reconciliation ──

  /**
   * Recover published state for a file whose frontmatter was lost (e.g., overwritten by LiveSync).
   * Queries the server by source_path to find the drawing and restores all frontmatter fields.
   * Returns the recovered drawing ID, or null if the file is genuinely unpublished.
   */
  private async recoverPublishedState(file: TFile): Promise<string | null> {
    if (!this.settings.apiKey || !this.settings.baseUrl) return null;

    // Dedup guard: skip if already recovering this file
    if (this._recoveryInFlight.has(file.path)) return null;
    this._recoveryInFlight.add(file.path);

    try {
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/lookup?source_path=${encodeURIComponent(file.path)}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.settings.apiKey}`,
        },
        throw: false,
      });

      if (response.status === 404) {
        // No drawing found for this source_path — file is genuinely unpublished
        // Also clear the in-memory cache since the server doesn't know about it
        this._publishedIdCache.delete(file.path);
        return null;
      }

      if (response.status >= 400) {
        console.warn(`ExcaliShare: Lookup failed with status ${response.status}`);
        return null;
      }

      const data = response.json;
      if (!data.id) return null;

      console.log(`ExcaliShare: Recovered published state for ${file.path} → ${data.id} (server lookup by source_path)`);

      // Restore all frontmatter fields from server response
      // @ts-ignore
      await this.app.fileManager.processFrontMatter(file, (fm: any) => {
        fm['excalishare-id'] = data.id;
        fm['excalishare-server'] = this.settings.baseUrl;
        if (data.persistent_collab) {
          fm['excalishare-persistent-collab'] = true;
          if (data.persistent_collab_version) {
            fm['excalishare-last-sync-version'] = data.persistent_collab_version;
          }
        }
        if (data.password_protected) {
          fm['excalishare-password'] = true;
        }
      });

      // Update in-memory cache
      this._publishedIdCache.set(file.path, data.id);

      new Notice('Published state recovered from server.');
      this.refreshActiveToolbar();

      // Trigger full reconciliation (collab session recovery, persistent sync, etc.)
      await this.reconcileServerState(file, data.id);

      return data.id;
    } catch (error) {
      console.warn('ExcaliShare: Failed to recover published state', error);
      return null;
    } finally {
      this._recoveryInFlight.delete(file.path);
    }
  }

  /**
   * Reconcile local frontmatter with server state for a published drawing.
   * Ensures persistent collab state is in sync across devices and after restarts.
   * Also recovers active collab session tracking if lost (e.g., after Obsidian restart).
   * Called every time a published drawing is opened/focused (with TTL cache to avoid spam).
   */
  private async reconcileServerState(file: TFile, drawingId: string): Promise<void> {
    // Deduplicate: skip if already reconciling this drawing
    if (this._reconcileInFlight.has(drawingId)) return;

    // Check cache — skip if recently reconciled
    const cached = this._reconcileCache.get(drawingId);
    if (cached && Date.now() - cached.timestamp < ExcaliSharePlugin.RECONCILE_CACHE_TTL) {
      // Even if cached, still trigger persistent sync if needed (it has its own dedup)
      if (cached.persistent && this.isPersistentCollabEnabled(file)) {
        this.syncPersistentCollabOnOpen(file, drawingId);
      }
      return;
    }

    this._reconcileInFlight.add(drawingId);

    try {
      // Build request headers — include API key to bypass drawing password for admin
      const headers: Record<string, string> = {};
      if (this.settings.apiKey) {
        headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
      }

      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/view/${drawingId}`,
        method: 'GET',
        headers,
        throw: false,
      });

      if (response.status === 404) {
        // Drawing not found on server — but only clear frontmatter if we're talking
        // to the SAME server that the drawing was originally published to.
        // This prevents cross-server 404 from destructively clearing frontmatter
        // (e.g., Device A uses localhost, Device B uses notes.leyk.me).
        const fmCache = this.app.metadataCache.getFileCache(file);
        const publishedServer = fmCache?.frontmatter?.['excalishare-server'];

        if (publishedServer && publishedServer !== this.settings.baseUrl) {
          // Different server — do NOT clear frontmatter
          console.warn(
            `ExcaliShare: Drawing ${drawingId} not found on ${this.settings.baseUrl}, ` +
            `but was published to ${publishedServer}. Keeping frontmatter intact.`
          );
          return;
        }

        // Same server (or no server recorded) — drawing was genuinely deleted
        // @ts-ignore
        await this.app.fileManager.processFrontMatter(file, (fm: any) => {
          delete fm['excalishare-id'];
          delete fm['excalishare-server'];
          delete fm['excalishare-persistent-collab'];
          delete fm['excalishare-last-sync-version'];
        });
        this._publishedIdCache.delete(file.path);
        this._persistentSyncedFiles.delete(file.path);
        this._reconcileCache.delete(drawingId);
        new Notice('Drawing was deleted from server. Unpublished locally.');
        this.refreshActiveToolbar();
        return;
      }

      if (response.status < 400) {
        // Success — full reconciliation with drawing data
        const serverData = response.json;
        const serverPersistent = serverData.persistent_collab === true;
        const localPersistent = this.isPersistentCollabEnabled(file);

        // Update cache
        this._reconcileCache.set(drawingId, { timestamp: Date.now(), persistent: serverPersistent });

        // ── Reconcile persistent collab state ──
        if (serverPersistent && !localPersistent) {
          // Server has persistent collab enabled, but local doesn't know
          // @ts-ignore
          await this.app.fileManager.processFrontMatter(file, (fm: any) => {
            fm['excalishare-persistent-collab'] = true;
            fm['excalishare-last-sync-version'] = serverData.persistent_collab_version ?? 0;
          });
          console.log(`ExcaliShare: Reconciled persistent collab state for ${file.path} (server=enabled, local=disabled → updated local)`);
          new Notice('Persistent collaboration was enabled externally. Syncing...');
          this.refreshActiveToolbar();
        } else if (!serverPersistent && localPersistent) {
          // Server says persistent collab is disabled, but local thinks it's enabled
          // @ts-ignore
          await this.app.fileManager.processFrontMatter(file, (fm: any) => {
            delete fm['excalishare-persistent-collab'];
            delete fm['excalishare-last-sync-version'];
          });
          this._persistentSyncedFiles.delete(file.path);
          console.log(`ExcaliShare: Reconciled persistent collab state for ${file.path} (server=disabled, local=enabled → updated local)`);
          new Notice('Persistent collaboration was disabled externally.');
          this.refreshActiveToolbar();
        }
      }
      // For any non-404 error (e.g. 403 without API key, 500, etc.),
      // we still proceed to check collab status below — it's a public endpoint
      // that doesn't require drawing password.

      // ── Recover collab session tracking ──
      // Check if there's an active collab session on the server that we should know about.
      // Only restore tracking for NON-persistent sessions (regular live collab started by admin).
      // Persistent sessions are handled separately by syncPersistentCollabOnOpen.
      try {
        const statusRes = await requestUrl({
          url: `${this.settings.baseUrl}/api/collab/status/${drawingId}`,
          method: 'GET',
          throw: false,
        });
        if (statusRes.status < 400) {
          const status = statusRes.json;

          // Update cache with persistent info from collab status (fallback if /api/view failed)
          if (!this._reconcileCache.has(drawingId) && status.persistent !== undefined) {
            this._reconcileCache.set(drawingId, { timestamp: Date.now(), persistent: status.persistent });
          }

          if (status.active && status.session_id && !status.persistent) {
            // Server has an active NON-persistent session — restore tracking if we lost it
            if (!this.activeCollabSessionId || this.activeCollabDrawingId !== drawingId) {
              this.activeCollabSessionId = status.session_id;
              this.activeCollabDrawingId = drawingId;
              this.refreshActiveToolbar();
            }
          } else if (this.activeCollabSessionId && this.activeCollabDrawingId === drawingId) {
            // We think a non-persistent session is active, but server says it's not — clean up
            // (Don't clean up if we're natively joined to a persistent session)
            if (!this.collabManager?.isJoined) {
              this.cleanupCollabState();
              this.refreshActiveToolbar();
            }
          }
        }
      } catch {
        // Ignore status check errors
      }

      // ── Trigger persistent collab sync if enabled (after reconciliation) ──
      if (this.isPersistentCollabEnabled(file)) {
        this.syncPersistentCollabOnOpen(file, drawingId);
      }
    } catch (error) {
      console.warn('ExcaliShare: Failed to reconcile server state', error);
    } finally {
      this._reconcileInFlight.delete(drawingId);
    }
  }

  /**
   * Background reconciliation: periodically check the active drawing against the server.
   * Ensures long-running sessions stay in sync even without tab switching.
   */
  private async backgroundReconcile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.isExcalidrawFile(file)) return;
    const publishedId = this.getPublishedId(file);
    if (!publishedId) {
      // No published ID in frontmatter — check memory cache for recovery
      const cachedId = this._publishedIdCache.get(file.path);
      if (cachedId) {
        await this.recoverPublishedState(file);
      }
      return;
    }

    // Force cache invalidation for background reconcile
    this._reconcileCache.delete(publishedId);
    await this.reconcileServerState(file, publishedId);
  }

  /** Auto-sync persistent collab drawing on file open.
   *  Only runs ONCE per file per session to avoid interrupting active drawing.
   *  Does NOT override appState — only merges elements. */
  async syncPersistentCollabOnOpen(file: TFile, drawingId: string) {
    if (!this.settings.persistentCollabAutoSync) return;

    // Element sync is guarded to run only once per file per session.
    // Auto-join is NOT guarded — it should always attempt to (re)join if not connected.
    const needsElementSync = !this._persistentSyncedFiles.has(file.path);

    if (needsElementSync) {
      this._persistentSyncedFiles.add(file.path);

      // Small delay to let Excalidraw fully initialize the view before we touch the scene
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        // Include API key to bypass drawing password for admin
        const headers: Record<string, string> = {};
        if (this.settings.apiKey) {
          headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
        }

        const response = await requestUrl({
          url: `${this.settings.baseUrl}/api/view/${drawingId}`,
          method: 'GET',
          headers,
          throw: false,
        });

        if (response.status < 400) {
          const serverData = response.json;
          if (serverData.persistent_collab) {
            const localVersion = this.getLastSyncVersion(file);
            const serverVersion = serverData.persistent_collab_version ?? 0;

            if (serverVersion > localVersion) {
              // Server has newer changes — merge elements only (do NOT override appState)
              const excalidrawPlugin = this.getExcalidrawPlugin();
              if (excalidrawPlugin?.ea) {
                try {
                  excalidrawPlugin.ea.setView('active');
                  const api = excalidrawPlugin.ea.getExcalidrawAPI();
                  if (api) {
                    const localElements = api.getSceneElements() || [];
                    const serverElements = serverData.elements || [];
                    const merged = this.mergeElements(localElements, serverElements);

                    api.updateScene({
                      elements: merged,
                    });

                    // @ts-ignore
                    await this.app.fileManager.processFrontMatter(file, (fm: any) => {
                      fm['excalishare-last-sync-version'] = serverVersion;
                    });

                    console.log(`ExcaliShare: Persistent collab synced ${serverVersion - localVersion} version(s) from server for ${file.path}`);
                    new Notice(`Persistent collab: synced ${serverVersion - localVersion} version(s) from server`);
                  }
                } catch (e) {
                  console.error('ExcaliShare: Failed to merge persistent collab changes', e);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('ExcaliShare: Persistent collab element sync failed', error);
      }
    }

    // ── Auto-join: always attempt if not already joined ──
    // This runs even on subsequent tab switches (not guarded by _persistentSyncedFiles)
    if (this.settings.collabJoinFromObsidian) {
      await this.autoJoinPersistentCollab(drawingId);
    }
  }

  /**
   * Attempt to auto-join a persistent collab session for the given drawing.
   * Activates the session on demand if it doesn't exist yet.
   * NOT gated by persistentCollabAutoSync — called both from syncPersistentCollabOnOpen
   * and directly from enablePersistentCollab (where the user explicitly requested it).
   */
  private async autoJoinPersistentCollab(drawingId: string): Promise<void> {
    if (this.collabManager?.isJoined) return; // Already joined
    if (this._joiningCollabInProgress) return; // Another join attempt is in progress

    this._joiningCollabInProgress = true;
    try {
      const statusRes = await requestUrl({
        url: `${this.settings.baseUrl}/api/collab/status/${drawingId}`,
        method: 'GET',
        throw: false,
      });
      const status = statusRes.json;

      // Re-check after async call — another path may have joined while we were waiting
      if (this.collabManager?.isJoined) return;

      if (status.active && status.session_id) {
        // Set active session tracking so the toolbar shows collaborator list + follow buttons
        this.activeCollabSessionId = status.session_id;
        this.activeCollabDrawingId = drawingId;

        if (this.collabStatusBarItem) {
          this.collabStatusBarItem.setText('🔴 Live Collab');
          this.collabStatusBarItem.show();
        }

        // Join the persistent session (pass API key to bypass session password, persistentMode=true for infinite reconnect)
        await this.joinCollabFromObsidian(drawingId, status.session_id, null, true);
        this.refreshActiveToolbar();
      } else if (status.persistent && !status.active) {
        // Persistent collab but no active session — need to activate it first
        const activateRes = await requestUrl({
          url: `${this.settings.baseUrl}/api/persistent-collab/activate/${drawingId}`,
          method: 'POST',
          throw: false,
        });

        // Re-check after async call
        if (this.collabManager?.isJoined) return;

        if (activateRes.status < 400 && activateRes.json?.session_id) {
          const sessionId = activateRes.json.session_id;
          this.activeCollabSessionId = sessionId;
          this.activeCollabDrawingId = drawingId;

          if (this.collabStatusBarItem) {
            this.collabStatusBarItem.setText('🔴 Live Collab');
            this.collabStatusBarItem.show();
          }

          // Join the activated session (pass API key to bypass session password, persistentMode=true for infinite reconnect)
          await this.joinCollabFromObsidian(drawingId, sessionId, null, true);
          this.refreshActiveToolbar();
        }
      }
    } catch {
      // Ignore — session may not be active
    } finally {
      this._joiningCollabInProgress = false;
    }
  }

  async pullFromServer(file: TFile, drawingId: string) {
    new Notice('Pulling drawing from server...');

    try {
      const headers: Record<string, string> = {};
      if (this.settings.apiKey) {
        headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
      }
      const response = await requestUrl({
        url: `${this.settings.baseUrl}/api/view/${drawingId}`,
        method: 'GET',
        headers,
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
