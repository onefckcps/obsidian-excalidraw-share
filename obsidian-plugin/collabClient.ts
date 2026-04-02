// ──────────────────────────────────────────────
// WebSocket client for live collaboration
// Adapted from frontend/src/utils/collabClient.ts
// for use in the Obsidian plugin (no React/browser deps)
// ──────────────────────────────────────────────

import type { ClientMessage, ServerMessage, ExcalidrawElement } from './collabTypes';

type MessageHandler = (msg: ServerMessage) => void;

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

// ── Adaptive debounce intervals ──
// During active drawing we batch more aggressively to reduce WS traffic.
// For idle single-element changes we send almost immediately.
const DEBOUNCE_IDLE_MS = 16;            // Single change while idle (~1 frame)
const DEBOUNCE_BATCH_MS = 50;           // Multiple rapid changes
const DEBOUNCE_ACTIVE_DRAWING_MS = 80;  // During active drawing strokes

// Pointer updates are throttled at the caller (CollabManager), but we
// still guard against bursts here.
const POINTER_THROTTLE_MS = 50;

export class CollabClient {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private sessionId: string;
  private displayName: string;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private sceneUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSceneUpdate: ClientMessage | null = null;
  private lastSentVersions: Map<string, number> = new Map();
  private localSeq: number = 0;

  // ── Pointer throttle state ──
  private lastPointerSendTime = 0;
  private pendingPointerUpdate: ClientMessage | null = null;
  private pointerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(baseUrl: string, sessionId: string, displayName: string) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
    this.displayName = displayName;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this._connect();
  }

  private _connect(): void {
    // Derive WebSocket URL from the HTTP base URL
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss:' : 'ws:';
    const urlObj = new URL(this.baseUrl);
    const host = urlObj.host;
    const url = `${wsProtocol}//${host}/ws/collab/${this.sessionId}?name=${encodeURIComponent(this.displayName)}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to create WebSocket', e);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.resetDeltaTracking();
      this._emit('_connected', {} as ServerMessage);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);
        this._emit(msg.type, msg);
      } catch (e) {
        console.error('ExcaliShare Collab: Failed to parse message', e);
      }
    };

    this.ws.onclose = () => {
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
    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      this._emit('_reconnect_failed', {} as ServerMessage);
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempt];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
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
    if (this.pointerTimer) {
      clearTimeout(this.pointerTimer);
      this.pointerTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.lastSentVersions.clear();
    this.localSeq = 0;
    this.lastPointerSendTime = 0;
    this.pendingPointerUpdate = null;
    this.handlers.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ──────────────────────────────────────────────
  // Send methods (with adaptive debounce)
  // ──────────────────────────────────────────────

  /**
   * Send a scene update with adaptive debouncing.
   * @param elements  All current scene elements
   * @param isDrawing Whether the user is actively drawing (longer debounce)
   */
  sendSceneUpdate(elements: ExcalidrawElement[], isDrawing: boolean = false): void {
    // Compute delta: find elements that changed since last send
    const changedElements: ExcalidrawElement[] = [];
    for (const el of elements) {
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
    const useDelta = changedElements.length < elements.length * 0.5;

    let msg: ClientMessage;
    if (useDelta) {
      this.localSeq++;
      msg = {
        type: 'scene_delta',
        elements: changedElements,
        seq: this.localSeq,
      };
    } else {
      msg = {
        type: 'scene_update',
        elements: elements,
      };
    }

    // Update tracking map with ALL current elements (not just changed ones)
    for (const el of elements) {
      if (el.id) {
        this.lastSentVersions.set(el.id, el.version);
      }
    }

    // ── Adaptive debounce based on context ──
    const debounceMs = isDrawing
      ? DEBOUNCE_ACTIVE_DRAWING_MS
      : changedElements.length > 3
        ? DEBOUNCE_BATCH_MS
        : DEBOUNCE_IDLE_MS;

    // Always replace the pending update with the latest
    this.pendingSceneUpdate = msg;

    // Clear existing timer and set a new one with the appropriate delay
    if (this.sceneUpdateTimer) {
      clearTimeout(this.sceneUpdateTimer);
    }
    this.sceneUpdateTimer = setTimeout(() => {
      this.sceneUpdateTimer = null;
      if (this.pendingSceneUpdate) {
        this._send(this.pendingSceneUpdate);
        this.pendingSceneUpdate = null;
      }
    }, debounceMs);
  }

  /**
   * Send a pointer position update, throttled to avoid flooding.
   */
  sendPointerUpdate(
    x: number,
    y: number,
    button: 'down' | 'up',
    tool: 'pointer' | 'laser' = 'pointer',
    scrollX?: number,
    scrollY?: number,
    zoom?: number,
  ): void {
    const msg: ClientMessage = {
      type: 'pointer_update',
      x,
      y,
      button,
      tool,
      scrollX,
      scrollY,
      zoom,
    };

    const now = Date.now();
    const elapsed = now - this.lastPointerSendTime;

    if (elapsed >= POINTER_THROTTLE_MS) {
      // Enough time has passed — send immediately
      this.lastPointerSendTime = now;
      this._send(msg);
      // Clear any pending pointer update
      if (this.pointerTimer) {
        clearTimeout(this.pointerTimer);
        this.pointerTimer = null;
      }
      this.pendingPointerUpdate = null;
    } else {
      // Too soon — queue for later
      this.pendingPointerUpdate = msg;
      if (!this.pointerTimer) {
        this.pointerTimer = setTimeout(() => {
          this.pointerTimer = null;
          if (this.pendingPointerUpdate) {
            this.lastPointerSendTime = Date.now();
            this._send(this.pendingPointerUpdate);
            this.pendingPointerUpdate = null;
          }
        }, POINTER_THROTTLE_MS - elapsed);
      }
    }
  }

  resetDeltaTracking(): void {
    this.lastSentVersions.clear();
    this.localSeq = 0;
  }

  sendSetName(name: string): void {
    this.displayName = name;
    this._send({ type: 'set_name', name });
  }

  private _send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
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
