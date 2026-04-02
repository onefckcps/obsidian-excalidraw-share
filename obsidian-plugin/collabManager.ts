// ──────────────────────────────────────────────
// CollabManager — orchestrates live collaboration
// within the Obsidian Excalidraw view.
//
// Responsibilities:
// - WebSocket lifecycle (connect, reconnect, disconnect)
// - Polling-based change detection (since we can't hook onChange)
// - Remote update application with merge logic
// - Deferred updates during active drawing (prevents stutter)
// - Collaborator cursor display
// - Status notifications
// ──────────────────────────────────────────────

import { Notice } from 'obsidian';
import { CollabClient } from './collabClient';
import type {
  CollaboratorInfo,
  ExcalidrawAPI,
  ExcalidrawElement,
  ExcalidrawCollaborator,
  ServerMessage,
} from './collabTypes';
import { getCollaboratorColor } from './collabTypes';

export interface CollabManagerCallbacks {
  /** Called when the participant list changes */
  onCollaboratorsChanged?: (collaborators: CollaboratorInfo[]) => void;
  /** Called when the connection state changes */
  onConnectionChanged?: (connected: boolean) => void;
  /** Called when the session ends (from server) */
  onSessionEnded?: (saved: boolean) => void;
}

export class CollabManager {
  // ── State ──
  private client: CollabClient | null = null;
  private sessionId: string | null = null;
  private drawingId: string | null = null;
  private baseUrl: string;
  private displayName: string;
  private pollIntervalMs: number;
  private callbacks: CollabManagerCallbacks;

  // ── Excalidraw API ──
  private getExcalidrawAPIFn: () => ExcalidrawAPI | null;
  /** Cached API reference — avoids calling ea.setView('active') on every cycle */
  private cachedAPI: ExcalidrawAPI | null = null;

  // ── Change detection ──
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastKnownVersions: Map<string, number> = new Map();
  private isApplyingRemoteUpdate = false;
  private remoteUpdateCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Deferred remote updates (prevents stutter during drawing) ──
  private pendingRemoteUpdates: ExcalidrawElement[][] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 300;

  // ── Collaborator state ──
  private collaborators: CollaboratorInfo[] = [];
  private collaboratorMap: Map<string, ExcalidrawCollaborator> = new Map();

  // ── Connection state ──
  private _isConnected = false;
  private _isJoined = false;

  constructor(options: {
    baseUrl: string;
    displayName: string;
    pollIntervalMs: number;
    getExcalidrawAPI: () => ExcalidrawAPI | null;
    callbacks?: CollabManagerCallbacks;
  }) {
    this.baseUrl = options.baseUrl;
    this.displayName = options.displayName;
    this.pollIntervalMs = options.pollIntervalMs;
    this.getExcalidrawAPIFn = options.getExcalidrawAPI;
    this.callbacks = options.callbacks || {};
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isJoined(): boolean {
    return this._isJoined;
  }

  get currentCollaborators(): CollaboratorInfo[] {
    return this.collaborators;
  }

  get participantCount(): number {
    return this.collaborators.length;
  }

  /**
   * Connect to a collab session via WebSocket and start participating.
   */
  async startAndJoin(drawingId: string, sessionId: string): Promise<void> {
    if (this.client) {
      console.log('ExcaliShare Collab: Already connected, disconnecting first');
      this.leave();
    }

    this.drawingId = drawingId;
    this.sessionId = sessionId;

    // Cache the API reference once at join time
    this.cachedAPI = this.getExcalidrawAPIFn();

    const client = new CollabClient(this.baseUrl, sessionId, this.displayName);

    // ── Register message handlers ──

    client.on('_connected', () => {
      this._isConnected = true;
      this._isJoined = true;
      this.callbacks.onConnectionChanged?.(true);
      console.log('ExcaliShare Collab: Connected to session', sessionId);
    });

    client.on('_disconnected', () => {
      this._isConnected = false;
      this.callbacks.onConnectionChanged?.(false);
      console.log('ExcaliShare Collab: Disconnected from session');
    });

    client.on('_reconnect_failed', () => {
      new Notice('ExcaliShare: Failed to reconnect to collab session after multiple attempts.');
      this.leave();
    });

    client.on('snapshot', (msg: ServerMessage) => {
      if (msg.type !== 'snapshot') return;
      this.handleSnapshot(msg);
    });

    client.on('scene_update', (msg: ServerMessage) => {
      if (msg.type !== 'scene_update') return;
      this.handleRemoteSceneUpdate(msg.elements as ExcalidrawElement[]);
    });

    client.on('scene_delta', (msg: ServerMessage) => {
      if (msg.type !== 'scene_delta') return;
      this.handleRemoteSceneUpdate(msg.elements as ExcalidrawElement[]);
    });

    client.on('full_sync', (msg: ServerMessage) => {
      if (msg.type !== 'full_sync') return;
      this.handleFullSync(msg);
    });

    client.on('pointer_update', (msg: ServerMessage) => {
      if (msg.type !== 'pointer_update') return;
      this.handlePointerUpdate(msg);
    });

    client.on('user_joined', (msg: ServerMessage) => {
      if (msg.type !== 'user_joined') return;
      this.handleUserJoined(msg);
    });

    client.on('user_left', (msg: ServerMessage) => {
      if (msg.type !== 'user_left') return;
      this.handleUserLeft(msg);
    });

    client.on('session_ended', (msg: ServerMessage) => {
      if (msg.type !== 'session_ended') return;
      this.handleSessionEnded(msg);
    });

    client.on('error', (msg: ServerMessage) => {
      if (msg.type !== 'error') return;
      console.error('ExcaliShare Collab: Server error:', msg.message);
      new Notice(`ExcaliShare Collab error: ${msg.message}`);
    });

    this.client = client;
    client.connect();
  }

  /**
   * Disconnect from the collab session and clean up.
   */
  leave(): void {
    this.stopChangeDetection();
    this.stopFlushTimer();

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    // Clear collaborator cursors from Excalidraw
    const api = this.getAPI();
    if (api) {
      try {
        api.updateScene({ collaborators: new Map() });
      } catch (e) {
        console.error('ExcaliShare Collab: Failed to clear collaborators', e);
      }
    }

    this._isConnected = false;
    this._isJoined = false;
    this.sessionId = null;
    this.drawingId = null;
    this.collaborators = [];
    this.collaboratorMap.clear();
    this.lastKnownVersions.clear();
    this.isApplyingRemoteUpdate = false;
    this.pendingRemoteUpdates = [];
    this.cachedAPI = null;

    if (this.remoteUpdateCooldownTimer) {
      clearTimeout(this.remoteUpdateCooldownTimer);
      this.remoteUpdateCooldownTimer = null;
    }

    this.callbacks.onConnectionChanged?.(false);
    this.callbacks.onCollaboratorsChanged?.([]);
  }

  /**
   * Clean up all resources. Call on plugin unload.
   */
  destroy(): void {
    this.leave();
  }

  // ──────────────────────────────────────────────
  // API Access (cached to avoid expensive setView calls)
  // ──────────────────────────────────────────────

  /**
   * Get the Excalidraw API, using cached reference when possible.
   * Falls back to the factory function if cache is stale.
   */
  private getAPI(): ExcalidrawAPI | null {
    // Try cached API first — quick validation that it's still alive
    if (this.cachedAPI) {
      try {
        // If getSceneElements works, the API is still valid
        this.cachedAPI.getSceneElements();
        return this.cachedAPI;
      } catch {
        // Cache is stale (view was closed/changed), refresh
        this.cachedAPI = null;
      }
    }

    // Fall back to factory function (calls ea.setView('active'))
    this.cachedAPI = this.getExcalidrawAPIFn();
    return this.cachedAPI;
  }

  // ──────────────────────────────────────────────
  // Drawing State Detection
  // ──────────────────────────────────────────────

  /**
   * Check if the user is actively drawing, resizing, or editing an element.
   * When true, we defer remote updates to avoid interrupting the stroke.
   * This is the same check the frontend uses in useCollab.ts.
   */
  private isUserDrawing(): boolean {
    const api = this.getAPI();
    if (!api?.getAppState) return false;
    try {
      const appState = api.getAppState() as {
        draggingElement?: unknown;
        resizingElement?: unknown;
        editingElement?: unknown;
      };
      return !!(appState.draggingElement || appState.resizingElement || appState.editingElement);
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────
  // Message Handlers
  // ──────────────────────────────────────────────

  private handleSnapshot(msg: Extract<ServerMessage, { type: 'snapshot' }>): void {
    console.log('ExcaliShare Collab: Received snapshot with', (msg.elements as unknown[]).length, 'elements');

    const api = this.getAPI();
    if (!api) {
      console.error('ExcaliShare Collab: No Excalidraw API available for snapshot');
      return;
    }

    // Update collaborator list
    this.collaborators = msg.collaborators;
    this.buildCollaboratorMap(msg.collaborators);

    // Apply snapshot to Excalidraw (always apply snapshots immediately, even during drawing)
    this.isApplyingRemoteUpdate = true;
    try {
      api.updateScene({
        elements: msg.elements,
        appState: msg.appState,
        collaborators: new Map(this.collaboratorMap),
      });
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to apply snapshot', e);
    }
    this.scheduleRemoteUpdateCooldown();

    // Initialize version tracking from the snapshot
    this.initializeVersionTracking(msg.elements as ExcalidrawElement[]);

    // Start polling for local changes
    this.startChangeDetection();

    // Start the flush timer for deferred updates
    this.startFlushTimer();

    this.callbacks.onCollaboratorsChanged?.(this.collaborators);
    new Notice(`ExcaliShare: Joined collab session with ${this.collaborators.length} participant(s)`);
  }

  /**
   * Handle incoming remote scene updates.
   * If the user is actively drawing, queue the update to avoid interrupting the stroke.
   * Otherwise, apply immediately.
   */
  private handleRemoteSceneUpdate(remoteElements: ExcalidrawElement[]): void {
    // Update version tracking for remote elements to avoid echoing them back
    for (const el of remoteElements) {
      if (el.id) {
        this.lastKnownVersions.set(el.id, el.version);
      }
    }

    // If user is actively drawing, defer the update
    if (this.isUserDrawing()) {
      this.pendingRemoteUpdates.push(remoteElements);
      return;
    }

    // If there are queued updates, flush them all together with this one
    if (this.pendingRemoteUpdates.length > 0) {
      this.pendingRemoteUpdates.push(remoteElements);
      this.flushPendingRemoteUpdates();
    } else {
      this.applyRemoteSceneUpdate(remoteElements);
    }
  }

  /**
   * Apply a remote scene update by merging with current local elements.
   * Uses version-based conflict resolution (same as frontend).
   */
  private applyRemoteSceneUpdate(remoteElements: ExcalidrawElement[]): void {
    const api = this.getAPI();
    if (!api) return;

    // Merge remote elements with current local elements
    let currentElements: ExcalidrawElement[];
    try {
      const getElements = api.getSceneElementsIncludingDeleted || api.getSceneElements;
      currentElements = getElements.call(api);
    } catch {
      return;
    }

    const allElements = new Map<string, ExcalidrawElement>();

    for (const el of currentElements) {
      allElements.set(el.id, el);
    }

    for (const el of remoteElements) {
      const existing = allElements.get(el.id);
      if (!existing || el.version >= existing.version) {
        allElements.set(el.id, el);
      }
    }

    const merged = Array.from(allElements.values());

    this.isApplyingRemoteUpdate = true;
    try {
      api.updateScene({ elements: merged });
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to apply remote scene update', e);
    }
    this.scheduleRemoteUpdateCooldown();
  }

  /**
   * Flush all pending remote updates into a single merged update.
   * Called when the user stops drawing or by the periodic flush timer.
   */
  private flushPendingRemoteUpdates(): void {
    if (this.pendingRemoteUpdates.length === 0) return;

    // Merge all pending updates into one combined update
    const combined = new Map<string, ExcalidrawElement>();
    for (const elements of this.pendingRemoteUpdates) {
      for (const el of elements) {
        const existing = combined.get(el.id);
        if (!existing || el.version >= existing.version) {
          combined.set(el.id, el);
        }
      }
    }

    // Clear the queue
    this.pendingRemoteUpdates = [];

    // Apply the combined update
    this.applyRemoteSceneUpdate(Array.from(combined.values()));
  }

  private handleFullSync(msg: Extract<ServerMessage, { type: 'full_sync' }>): void {
    const api = this.getAPI();
    if (!api) return;

    console.log('ExcaliShare Collab: Received full sync');

    this.isApplyingRemoteUpdate = true;
    try {
      api.updateScene({
        elements: msg.elements,
        appState: msg.appState,
      });
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to apply full sync', e);
    }
    this.scheduleRemoteUpdateCooldown();

    // Re-initialize version tracking
    this.initializeVersionTracking(msg.elements as ExcalidrawElement[]);
  }

  private handlePointerUpdate(msg: Extract<ServerMessage, { type: 'pointer_update' }>): void {
    const color = getCollaboratorColor(msg.colorIndex);
    const pointerTool = (msg.tool === 'laser' ? 'laser' : 'pointer') as 'pointer' | 'laser';

    this.collaboratorMap.set(msg.userId, {
      ...this.collaboratorMap.get(msg.userId),
      pointer: { x: msg.x, y: msg.y, tool: pointerTool },
      button: msg.button as 'up' | 'down',
      username: msg.name,
      color,
      id: msg.userId,
    });

    // Push updated collaborator map to Excalidraw
    // Cursor updates are lightweight and should not cause stutter
    this.syncCollaboratorsToExcalidraw();
  }

  private handleUserJoined(msg: Extract<ServerMessage, { type: 'user_joined' }>): void {
    console.log('ExcaliShare Collab: User joined:', msg.name);
    this.collaborators = msg.collaborators;
    this.buildCollaboratorMap(msg.collaborators);
    this.syncCollaboratorsToExcalidraw();
    this.callbacks.onCollaboratorsChanged?.(this.collaborators);
    new Notice(`ExcaliShare: ${msg.name} joined the session`);
  }

  private handleUserLeft(msg: Extract<ServerMessage, { type: 'user_left' }>): void {
    console.log('ExcaliShare Collab: User left:', msg.name);
    this.collaborators = msg.collaborators;
    this.buildCollaboratorMap(msg.collaborators);
    this.syncCollaboratorsToExcalidraw();
    this.callbacks.onCollaboratorsChanged?.(this.collaborators);
    new Notice(`ExcaliShare: ${msg.name} left the session`);
  }

  private handleSessionEnded(msg: Extract<ServerMessage, { type: 'session_ended' }>): void {
    console.log('ExcaliShare Collab: Session ended, saved:', msg.saved);
    new Notice(msg.saved
      ? 'ExcaliShare: Collab session ended and saved.'
      : 'ExcaliShare: Collab session ended. Changes discarded.');

    this.callbacks.onSessionEnded?.(msg.saved);
    this.leave();
  }

  // ──────────────────────────────────────────────
  // Change Detection (Polling)
  // ──────────────────────────────────────────────

  private startChangeDetection(): void {
    if (this.pollTimer) return;

    console.log(`ExcaliShare Collab: Starting change detection (${this.pollIntervalMs}ms interval)`);

    this.pollTimer = setInterval(() => {
      this.detectAndSendChanges();
    }, this.pollIntervalMs);
  }

  private stopChangeDetection(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private detectAndSendChanges(): void {
    // Skip if we just applied a remote update (avoid echo)
    if (this.isApplyingRemoteUpdate) return;

    // Skip if not connected
    if (!this.client?.isConnected) return;

    const api = this.getAPI();
    if (!api) return;

    let currentElements: ExcalidrawElement[];
    try {
      currentElements = api.getSceneElements();
    } catch {
      // View might have been closed
      return;
    }

    // Find elements that changed since last poll
    const changedElements: ExcalidrawElement[] = [];
    for (const el of currentElements) {
      if (!el.id) continue;
      const lastVersion = this.lastKnownVersions.get(el.id) ?? -1;
      if (el.version > lastVersion) {
        changedElements.push(el);
      }
    }

    if (changedElements.length === 0) return;

    // Update version tracking
    for (const el of currentElements) {
      if (el.id) {
        this.lastKnownVersions.set(el.id, el.version);
      }
    }

    // Send changes via WebSocket
    this.client.sendSceneUpdate(currentElements);
  }

  // ──────────────────────────────────────────────
  // Deferred Update Flush Timer
  // ──────────────────────────────────────────────

  /**
   * Start a periodic timer that flushes deferred remote updates
   * when the user stops drawing. Same pattern as the frontend's
   * 300ms flush interval in useCollab.ts.
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      if (this.pendingRemoteUpdates.length > 0 && !this.isUserDrawing()) {
        this.flushPendingRemoteUpdates();
      }
    }, CollabManager.FLUSH_INTERVAL_MS);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ──────────────────────────────────────────────
  // Version Tracking
  // ──────────────────────────────────────────────

  private initializeVersionTracking(elements: ExcalidrawElement[]): void {
    this.lastKnownVersions.clear();
    for (const el of elements) {
      if (el.id) {
        this.lastKnownVersions.set(el.id, el.version);
      }
    }
  }

  private scheduleRemoteUpdateCooldown(): void {
    // Keep the flag set for a short period to skip the next poll cycle
    if (this.remoteUpdateCooldownTimer) {
      clearTimeout(this.remoteUpdateCooldownTimer);
    }
    this.remoteUpdateCooldownTimer = setTimeout(() => {
      this.isApplyingRemoteUpdate = false;
      this.remoteUpdateCooldownTimer = null;
    }, 100);
  }

  // ──────────────────────────────────────────────
  // Collaborator Cursor Management
  // ──────────────────────────────────────────────

  private buildCollaboratorMap(collabList: CollaboratorInfo[]): void {
    // Remove collaborators that are no longer in the list
    const currentIds = new Set(collabList.map((c) => c.id));
    for (const key of this.collaboratorMap.keys()) {
      if (!currentIds.has(key)) {
        this.collaboratorMap.delete(key);
      }
    }

    // Add/update collaborators
    for (const c of collabList) {
      const existing = this.collaboratorMap.get(c.id);
      const color = getCollaboratorColor(c.colorIndex);
      this.collaboratorMap.set(c.id, {
        ...existing,
        username: c.name,
        color,
        id: c.id,
        userState: existing?.userState || 'active',
      });
    }
  }

  private syncCollaboratorsToExcalidraw(): void {
    const api = this.getAPI();
    if (!api) return;

    try {
      // Create a new Map copy so Excalidraw detects the change
      api.updateScene({ collaborators: new Map(this.collaboratorMap) });
    } catch {
      // Silently ignore — view might have been closed
    }
  }
}
