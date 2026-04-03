import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ClientMessage, ServerMessage } from '../types';

type MessageHandler = (msg: ServerMessage) => void;

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const RECONNECT_DELAYS_PERSISTENT = [1000, 2000, 4000, 8000, 16000, 30000]; // last delay repeats indefinitely
const SCENE_UPDATE_DEBOUNCE_MS = 100;
const POINTER_UPDATE_THROTTLE_MS = 50;
const FILES_UPDATE_DEBOUNCE_MS = 200;
/** Max number of outgoing scene updates to buffer while disconnected */
const MAX_BUFFERED_UPDATES = 10;

export class CollabClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private drawingId: string;
  private displayName: string;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private sceneUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSceneUpdate: ClientMessage | null = null;
  private lastPointerUpdate = 0;
  private lastSentVersions: Map<string, number> = new Map();
  private localSeq: number = 0;
  /** Track which file IDs have already been sent to avoid re-sending immutable files */
  private sentFileIds: Set<string> = new Set();
  private filesUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFilesUpdate: BinaryFiles | null = null;
  /** Buffer of outgoing scene updates accumulated while disconnected */
  private bufferedUpdates: ClientMessage[] = [];

  private password?: string;
  /** When true, reconnect indefinitely (for persistent collab sessions) */
  private persistentMode: boolean = false;

  constructor(sessionId: string, drawingId: string, displayName: string, password?: string, persistentMode?: boolean) {
    this.sessionId = sessionId;
    this.drawingId = drawingId;
    this.displayName = displayName;
    this.password = password;
    this.persistentMode = persistentMode ?? false;
  }

  /** Update the session ID (e.g., after re-activating a persistent session) */
  updateSessionId(newSessionId: string): void {
    this.sessionId = newSessionId;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this._connect();
  }

  /** Manually trigger a reconnect attempt, resetting the attempt counter.
   *  Checks session status via HTTP first to handle stale session IDs (e.g., after server restart). */
  async manualReconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.intentionalClose = false;

    // Check session status before attempting WebSocket reconnect
    try {
      const statusRes = await fetch(`/api/collab/status/${this.drawingId}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.active && statusData.session_id) {
          // Session exists — update session ID if it changed
          if (statusData.session_id !== this.sessionId) {
            console.log(`ExcaliShare Collab: Session ID changed (${this.sessionId} → ${statusData.session_id}), updating`);
            this.sessionId = statusData.session_id;
          }
          this._connect();
          return;
        } else if (statusData.persistent) {
          // Persistent collab but no active session — activate it
          console.log('ExcaliShare Collab: Persistent session not active, activating...');
          try {
            const activateRes = await fetch(`/api/persistent-collab/activate/${this.drawingId}`, { method: 'POST' });
            if (activateRes.ok) {
              const activateData = await activateRes.json();
              console.log(`ExcaliShare Collab: Activated new persistent session ${activateData.session_id}`);
              this.sessionId = activateData.session_id;
              this._emit('_session_reactivated', { session_id: activateData.session_id } as unknown as ServerMessage);
              this._connect();
              return;
            }
          } catch (activateErr) {
            console.error('ExcaliShare Collab: Failed to activate persistent session', activateErr);
          }
        }
        // Session is gone and not persistent — emit session_lost
        console.log('ExcaliShare Collab: Session no longer exists on server');
        this._emit('_session_lost', {} as ServerMessage);
        return;
      }
    } catch (err) {
      // Network error — server may still be down, try WS anyway
      console.warn('ExcaliShare Collab: Failed to check session status, attempting WS reconnect', err);
    }

    this._connect();
  }

  get reconnectState(): 'connected' | 'reconnecting' | 'disconnected' {
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    if (this.reconnectTimer !== null || this.reconnectAttempt > 0) return 'reconnecting';
    return 'disconnected';
  }

  get currentReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  get maxReconnectAttempts(): number {
    return this.persistentMode ? Infinity : RECONNECT_DELAYS.length;
  }

  private _connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let url = `${protocol}//${host}/ws/collab/${this.sessionId}?name=${encodeURIComponent(this.displayName)}`;
    if (this.password) {
      url += `&password=${encodeURIComponent(this.password)}`;
    }

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to create WebSocket', e);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('ExcaliShare Collab: WebSocket connected');
      const wasReconnecting = this.reconnectAttempt > 0;
      this.reconnectAttempt = 0;
      this.resetDeltaTracking();
      this._emit('_connected', {} as ServerMessage);
      // Flush buffered updates on reconnect
      if (wasReconnecting && this.bufferedUpdates.length > 0) {
        console.log(`ExcaliShare Collab: Flushing ${this.bufferedUpdates.length} buffered updates`);
        for (const msg of this.bufferedUpdates) {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
          }
        }
        this.bufferedUpdates = [];
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        this._emit(msg.type, msg);
      } catch (e) {
        console.error('ExcaliShare Collab: Failed to parse message', e);
      }
    };

    this.ws.onclose = (event) => {
      console.log('ExcaliShare Collab: WebSocket closed', event.code, event.reason);
      this.ws = null;
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
      this._emit('_disconnected', {} as ServerMessage);
    };

    this.ws.onerror = (event) => {
      console.error('ExcaliShare Collab: WebSocket error', event);
    };
  }

  private _scheduleReconnect(): void {
    const delays = this.persistentMode ? RECONNECT_DELAYS_PERSISTENT : RECONNECT_DELAYS;
    const maxAttempts = this.persistentMode ? Infinity : delays.length;

    if (!this.persistentMode && this.reconnectAttempt >= delays.length) {
      console.log('ExcaliShare Collab: Max reconnect attempts reached');
      this._emit('_reconnect_failed', {} as ServerMessage);
      return;
    }

    // In persistent mode, cap the delay at the last value
    const delayIndex = Math.min(this.reconnectAttempt, delays.length - 1);
    const delay = delays[delayIndex];
    console.log(`ExcaliShare Collab: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1}${this.persistentMode ? '' : `/${maxAttempts}`})`);

    // Emit reconnecting event so UI can show progress
    this._emit('_reconnecting', { attempt: this.reconnectAttempt + 1, maxAttempts } as unknown as ServerMessage);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;

      // Before attempting WebSocket reconnect, check if the session still exists
      // via HTTP. This avoids wasting reconnect attempts on a stale session ID
      // (e.g., after server restart where all in-memory sessions are lost).
      try {
        const statusRes = await fetch(`/api/collab/status/${this.drawingId}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.active && statusData.session_id) {
            // Session exists — update session ID if it changed (e.g., persistent session re-created)
            if (statusData.session_id !== this.sessionId) {
              console.log(`ExcaliShare Collab: Session ID changed (${this.sessionId} → ${statusData.session_id}), updating`);
              this.sessionId = statusData.session_id;
            }
            this._connect();
            return;
          } else if (statusData.persistent) {
            // Persistent collab but no active session — try to activate it
            console.log('ExcaliShare Collab: Persistent session not active, activating...');
            try {
              const activateRes = await fetch(`/api/persistent-collab/activate/${this.drawingId}`, { method: 'POST' });
              if (activateRes.ok) {
                const activateData = await activateRes.json();
                console.log(`ExcaliShare Collab: Activated new persistent session ${activateData.session_id}`);
                this.sessionId = activateData.session_id;
                this._emit('_session_reactivated', { session_id: activateData.session_id } as unknown as ServerMessage);
                this._connect();
                return;
              }
            } catch (activateErr) {
              console.error('ExcaliShare Collab: Failed to activate persistent session', activateErr);
            }
          }
          // Session is gone and not persistent — emit session_lost
          console.log('ExcaliShare Collab: Session no longer exists on server');
          this._emit('_session_lost', {} as ServerMessage);
          return;
        }
      } catch (err) {
        // Network error checking status — server may still be down, continue with WS reconnect
        console.warn('ExcaliShare Collab: Failed to check session status, attempting WS reconnect anyway', err);
      }

      this._connect();
    }, delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sceneUpdateTimer) {
      clearTimeout(this.sceneUpdateTimer);
      this.sceneUpdateTimer = null;
    }
    if (this.filesUpdateTimer) {
      clearTimeout(this.filesUpdateTimer);
      this.filesUpdateTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.lastSentVersions.clear();
    this.localSeq = 0;
    this.sentFileIds.clear();
    this.pendingFilesUpdate = null;
    this.bufferedUpdates = [];
    this.handlers.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ──────────────────────────────────────────────
  // Send methods (with debounce/throttle)
  // ──────────────────────────────────────────────

  sendSceneUpdate(elements: unknown[]): void {
    const typedElements = elements as Array<{ id: string; version: number; [key: string]: unknown }>;

    // Compute delta: find elements that changed since last send
    const changedElements: unknown[] = [];
    for (const el of typedElements) {
      if (!el.id) continue;
      const lastVersion = this.lastSentVersions.get(el.id) ?? -1;
      if (el.version > lastVersion) {
        changedElements.push(el);
      }
    }

    // If no changes, skip
    if (changedElements.length === 0) return;

    // Decide: send delta or full state
    // Use delta if changed elements are less than 50% of total, otherwise full state
    const useDelta = changedElements.length < typedElements.length * 0.5;

    let msg: ClientMessage;
    if (useDelta) {
      this.localSeq++;
      msg = {
        type: 'scene_delta',
        elements: changedElements as ClientMessage extends { type: 'scene_delta'; elements: infer E } ? E : never,
        seq: this.localSeq,
      };
    } else {
      msg = {
        type: 'scene_update',
        elements: elements as ClientMessage extends { type: 'scene_update'; elements: infer E } ? E : never,
      };
    }

    // Update tracking map with ALL current elements (not just changed ones)
    for (const el of typedElements) {
      if (el.id) {
        this.lastSentVersions.set(el.id, el.version);
      }
    }

    // Debounce: batch scene updates
    this.pendingSceneUpdate = msg;
    if (!this.sceneUpdateTimer) {
      this.sceneUpdateTimer = setTimeout(() => {
        this.sceneUpdateTimer = null;
        if (this.pendingSceneUpdate) {
          this._send(this.pendingSceneUpdate);
          this.pendingSceneUpdate = null;
        }
      }, SCENE_UPDATE_DEBOUNCE_MS);
    }
  }

  resetDeltaTracking(): void {
    this.lastSentVersions.clear();
    this.localSeq = 0;
    this.sentFileIds.clear();
    this.pendingFilesUpdate = null;
  }

  /**
   * Cancel any pending debounced scene update without sending it.
   * Used to discard in-progress freedraw strokes accumulated during multi-touch gestures
   * (two-finger pan/pinch-zoom) that should not be broadcast to other clients.
   * Also resets the delta tracking versions for the discarded elements so they will be
   * re-sent correctly on the next real scene change.
   */
  cancelPendingSceneUpdate(): void {
    if (this.sceneUpdateTimer) {
      clearTimeout(this.sceneUpdateTimer);
      this.sceneUpdateTimer = null;
    }
    this.pendingSceneUpdate = null;
    // Reset delta tracking so the next real scene change sends a full diff
    // (the cancelled elements may have had their versions bumped during the gesture)
    this.lastSentVersions.clear();
  }

  /**
   * Send new binary files (images) to the server.
   * Only sends files that haven't been sent before (delta tracking via sentFileIds).
   * Debounced to batch multiple file additions.
   */
  sendFilesUpdate(files: BinaryFiles): void {
    if (!files || Object.keys(files).length === 0) return;

    // Find new files that haven't been sent yet
    const newFiles: BinaryFiles = {};
    let hasNew = false;
    for (const [fileId, fileData] of Object.entries(files)) {
      if (!this.sentFileIds.has(fileId)) {
        newFiles[fileId] = fileData;
        hasNew = true;
      }
    }

    if (!hasNew) return;

    // Merge with any pending files update
    if (this.pendingFilesUpdate) {
      Object.assign(this.pendingFilesUpdate, newFiles);
    } else {
      this.pendingFilesUpdate = { ...newFiles };
    }

    // Debounce: batch file updates
    if (this.filesUpdateTimer) {
      clearTimeout(this.filesUpdateTimer);
    }
    this.filesUpdateTimer = setTimeout(() => {
      this.filesUpdateTimer = null;
      if (this.pendingFilesUpdate) {
        const filesToSend = this.pendingFilesUpdate;
        this.pendingFilesUpdate = null;

        // Mark as sent before sending
        for (const fileId of Object.keys(filesToSend)) {
          this.sentFileIds.add(fileId);
        }

        this._send({
          type: 'files_update',
          files: filesToSend,
        });
      }
    }, FILES_UPDATE_DEBOUNCE_MS);
  }

  /**
   * Mark file IDs as already known (e.g., from snapshot or initial load).
   * Prevents re-sending files that were received from the server.
   */
  markFilesAsKnown(fileIds: string[]): void {
    for (const id of fileIds) {
      this.sentFileIds.add(id);
    }
  }

  sendPointerUpdate(x: number, y: number, button: 'down' | 'up', tool?: 'pointer' | 'laser', scrollX?: number, scrollY?: number, zoom?: number): void {
    // Throttle pointer updates
    const now = Date.now();
    if (now - this.lastPointerUpdate < POINTER_UPDATE_THROTTLE_MS) {
      return;
    }
    this.lastPointerUpdate = now;

    this._send({
      type: 'pointer_update',
      x,
      y,
      button,
      tool,
      scrollX,
      scrollY,
      zoom,
    });
  }

  sendSetName(name: string): void {
    this.displayName = name;
    this._send({ type: 'set_name', name });
  }

  private _send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (!this.intentionalClose && msg.type === 'scene_update' || msg.type === 'scene_delta') {
      // Buffer scene updates while disconnected (up to MAX_BUFFERED_UPDATES)
      // Only buffer the latest update per type to avoid stale data
      this.bufferedUpdates = this.bufferedUpdates.filter(
        (m) => m.type !== 'scene_update' && m.type !== 'scene_delta'
      );
      if (this.bufferedUpdates.length < MAX_BUFFERED_UPDATES) {
        this.bufferedUpdates.push(msg);
      }
    }
  }

  // ──────────────────────────────────────────────
  // Event handling
  // ──────────────────────────────────────────────

  on(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type) || [];
    this.handlers.set(
      type,
      handlers.filter((h) => h !== handler)
    );
  }

  private _emit(type: string, msg: ServerMessage): void {
    const handlers = this.handlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(msg);
      } catch (e) {
        console.error('ExcaliShare Collab: Handler error', e);
      }
    }
  }
}
