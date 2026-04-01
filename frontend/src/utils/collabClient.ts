import type { ClientMessage, ServerMessage } from '../types';

type MessageHandler = (msg: ServerMessage) => void;

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const SCENE_UPDATE_DEBOUNCE_MS = 100;
const POINTER_UPDATE_THROTTLE_MS = 50;

export class CollabClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private displayName: string;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private sceneUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSceneUpdate: ClientMessage | null = null;
  private lastPointerUpdate = 0;

  constructor(sessionId: string, displayName: string) {
    this.sessionId = sessionId;
    this.displayName = displayName;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this._connect();
  }

  private _connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/collab/${this.sessionId}?name=${encodeURIComponent(this.displayName)}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to create WebSocket', e);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('ExcaliShare Collab: WebSocket connected');
      this.reconnectAttempt = 0;
      this._emit('_connected', {} as ServerMessage);
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
    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      console.log('ExcaliShare Collab: Max reconnect attempts reached');
      this._emit('_reconnect_failed', {} as ServerMessage);
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempt];
    console.log(`ExcaliShare Collab: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
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
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.handlers.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ──────────────────────────────────────────────
  // Send methods (with debounce/throttle)
  // ──────────────────────────────────────────────

  sendSceneUpdate(elements: unknown[]): void {
    const msg: ClientMessage = {
      type: 'scene_update',
      elements: elements as ClientMessage extends { type: 'scene_update'; elements: infer E } ? E : never,
    };

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
