// ──────────────────────────────────────────────
// CollabManager — orchestrates live collaboration
// within the Obsidian Excalidraw view.
//
// Responsibilities:
// - WebSocket lifecycle (connect, reconnect, disconnect)
// - Event-driven change detection via excalidrawAPI.onChange()
//   with lightweight polling fallback for older Excalidraw versions
// - Pointer tracking via DOM pointermove listener
// - Remote update application with merge logic
// - Deferred updates during active drawing (prevents stutter)
// - Version-based echo suppression (no timing hacks)
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
  /** Called when follow mode changes (userId being followed, or null to stop) */
  onFollowChanged?: (followingUserId: string | null) => void;
  /** Called when all reconnect attempts have been exhausted.
   *  For persistent sessions, the caller should re-activate the session. */
  onReconnectFailed?: () => void;
}

/** Detection strategy currently in use */
type DetectionStrategy = 'event-driven' | 'polling' | 'none';

export class CollabManager {
  // ── State ──
  private client: CollabClient | null = null;
  private sessionId: string | null = null;
  private drawingId: string | null = null;
  private baseUrl: string;
  private displayName: string;
  private callbacks: CollabManagerCallbacks;

  // ── Excalidraw API ──
  private getExcalidrawAPIFn: () => ExcalidrawAPI | null;
  /** Cached API reference — avoids calling ea.setView('active') on every cycle */
  private cachedAPI: ExcalidrawAPI | null = null;

  // ── Change detection strategy ──
  private detectionStrategy: DetectionStrategy = 'none';

  // ── Event-driven subscriptions (preferred) ──
  private onChangeUnsubscribe: (() => void) | null = null;
  private onPointerDownUnsubscribe: (() => void) | null = null;
  private onPointerUpUnsubscribe: (() => void) | null = null;

  // ── Pointer tracking via DOM ──
  private pointerMoveCleanup: (() => void) | null = null;
  private pointerTrackingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerTrackingRetryCount = 0;
  private static readonly POINTER_TRACKING_RETRY_DELAYS = [500, 1000, 2000, 4000];

  // ── Viewport broadcast (ensures follow mode works on scroll/zoom, not just pointer movement) ──
  private viewportBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly VIEWPORT_BROADCAST_INTERVAL_MS = 500;
  private lastBroadcastViewport: { scrollX: number; scrollY: number; zoom: number } | null = null;
  /** Last known cursor position from DOM pointermove, reused by viewport broadcast */
  private lastKnownPointer: { x: number; y: number; button: 'down' | 'up'; tool: 'pointer' | 'laser' } = { x: 0, y: 0, button: 'up', tool: 'pointer' };

  // ── Fallback polling (only used when onChange is unavailable) ──
  private static readonly FALLBACK_POLL_INTERVAL_MS = 2000;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Version tracking & echo suppression ──
  private lastKnownVersions: Map<string, number> = new Map();
  private remoteAppliedVersions: Map<string, number> = new Map();
  private isApplyingRemoteUpdate = false;

  // ── Drawing state (event-driven via onPointerDown/Up) ──
  private isUserActivelyDrawing = false;

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
  /** True after the first snapshot has been received (i.e. initial join completed).
   *  Used to suppress duplicate "Joined collab session" notices on WS reconnect. */
  private _hasJoinedOnce = false;

  // ── Follow mode (lerp-based viewport interpolation) ──
  private followingUserId: string | null = null;
  private followTarget: { scrollX: number; scrollY: number; zoom: number | null } | null = null;
  private followCurrent: { scrollX: number; scrollY: number; zoom: number } | null = null;
  private followLerpRaf: ReturnType<typeof requestAnimationFrame> | null = null;
  private static readonly FOLLOW_LERP_FACTOR = 0.25;

  // ── Bridge: track Excalidraw's built-in userToFollow to connect to our follow system ──
  private lastDetectedUserToFollow: string | null = null;

  // ── Canvas element finder (for pointer tracking) ──
  private getCanvasContainerFn: (() => HTMLElement | null) | null = null;

  constructor(options: {
    baseUrl: string;
    displayName: string;
    getExcalidrawAPI: () => ExcalidrawAPI | null;
    callbacks?: CollabManagerCallbacks;
    /** Optional: function to find the Excalidraw canvas container element for pointer tracking */
    getCanvasContainer?: () => HTMLElement | null;
  }) {
    this.baseUrl = options.baseUrl;
    this.displayName = options.displayName;
    this.getExcalidrawAPIFn = options.getExcalidrawAPI;
    this.callbacks = options.callbacks || {};
    this.getCanvasContainerFn = options.getCanvasContainer || null;
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

  /** Which change detection strategy is currently active */
  get activeDetectionStrategy(): DetectionStrategy {
    return this.detectionStrategy;
  }

  /** The user ID we are currently following (null if not following anyone) */
  get currentFollowingUserId(): string | null {
    return this.followingUserId;
  }

  /**
   * Start following a user's viewport (smooth lerp interpolation).
   * The host's viewport will smoothly track the followed user's scroll/zoom.
   */
  startFollowing(userId: string): void {
    if (this.followingUserId === userId) return; // Already following this user
    this.followingUserId = userId;
    this.followTarget = null;
    this.followCurrent = null;
    this.callbacks.onFollowChanged?.(userId);
  }

  /**
   * Stop following a user's viewport.
   */
  stopFollowing(): void {
    if (!this.followingUserId) return; // Not following anyone
    this.followingUserId = null;
    this.followTarget = null;
    this.followCurrent = null;
    if (this.followLerpRaf !== null) {
      cancelAnimationFrame(this.followLerpRaf);
      this.followLerpRaf = null;
    }
    this.callbacks.onFollowChanged?.(null);
  }

  /**
   * Connect to a collab session via WebSocket and start participating.
   */
  async startAndJoin(drawingId: string, sessionId: string, password?: string | null, apiKey?: string | null): Promise<void> {
    if (this.client) {
      this.leave();
    }

    this.drawingId = drawingId;
    this.sessionId = sessionId;

    // Cache the API reference once at join time
    this.cachedAPI = this.getExcalidrawAPIFn();

    const client = new CollabClient(this.baseUrl, sessionId, this.displayName, password, apiKey);

    // ── Register message handlers ──

    client.on('_connected', () => {
      this._isConnected = true;
      this._isJoined = true;
      this.callbacks.onConnectionChanged?.(true);
    });

    client.on('_disconnected', () => {
      this._isConnected = false;
      this.callbacks.onConnectionChanged?.(false);
    });

    client.on('_reconnect_failed', () => {
      console.log('ExcaliShare Collab: All reconnect attempts exhausted');
      this.leave();
      // Notify the caller so it can re-activate persistent sessions
      this.callbacks.onReconnectFailed?.();
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

    client.on('files_update', (msg: ServerMessage) => {
      if (msg.type !== 'files_update') return;
      this.handleRemoteFilesUpdate(msg.files);
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
    this._hasJoinedOnce = false;
    this.sessionId = null;
    this.drawingId = null;
    this.collaborators = [];
    this.collaboratorMap.clear();
    this.lastKnownVersions.clear();
    this.remoteAppliedVersions.clear();
    this.isApplyingRemoteUpdate = false;
    this.isUserActivelyDrawing = false;
    this.pendingRemoteUpdates = [];
    this.cachedAPI = null;

    // Clean up follow mode
    this.followingUserId = null;
    this.followTarget = null;
    this.followCurrent = null;
    this.lastDetectedUserToFollow = null;
    if (this.followLerpRaf !== null) {
      cancelAnimationFrame(this.followLerpRaf);
      this.followLerpRaf = null;
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
   * In event-driven mode, this uses the flag set by onPointerDown/Up.
   * In polling mode, falls back to checking appState.
   */
  private isUserDrawing(): boolean {
    // In event-driven mode, use the flag set by onPointerDown/Up
    if (this.detectionStrategy === 'event-driven') {
      return this.isUserActivelyDrawing;
    }

    // Fallback: check appState directly (polling mode)
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

      // Apply binary files (images) from the snapshot
      this.applyRemoteFiles(api, msg.files);
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to apply snapshot', e);
    }
    this.scheduleRemoteUpdateCooldown();

    // Initialize version tracking from the snapshot
    this.initializeVersionTracking(msg.elements as ExcalidrawElement[]);

    // Start change detection (event-driven or polling fallback)
    this.startChangeDetection();

    // Start the flush timer for deferred updates
    this.startFlushTimer();

    this.callbacks.onCollaboratorsChanged?.(this.collaborators);
    // Only show the "joined" notice on the initial connection, not on every WS reconnect.
    // On reconnect the server sends a fresh snapshot, but the user is already in the session.
    if (!this._hasJoinedOnce) {
      this._hasJoinedOnce = true;
      new Notice(`ExcaliShare: Joined collab session with ${this.collaborators.length} participant(s)`);
    } else {
      console.log('ExcaliShare Collab: Reconnected to session (snapshot received, suppressing duplicate notice)');
    }
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
        this.remoteAppliedVersions.set(el.id, el.version);
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

    this.isApplyingRemoteUpdate = true;
    try {
      api.updateScene({
        elements: msg.elements,
        appState: msg.appState,
      });

      // Apply binary files (images) from the full sync
      this.applyRemoteFiles(api, msg.files);
    } catch (e) {
      console.error('ExcaliShare Collab: Failed to apply full sync', e);
    }
    this.scheduleRemoteUpdateCooldown();

    // Re-initialize version tracking
    this.initializeVersionTracking(msg.elements as ExcalidrawElement[]);
  }

  /**
   * Apply binary files (images) from a server message to the Excalidraw canvas.
   * Uses addFiles API if available, otherwise falls back to no-op (files will be missing).
   */
  private applyRemoteFiles(api: ExcalidrawAPI, files: Record<string, unknown>): void {
    if (!files || Object.keys(files).length === 0) return;

    // Mark these files as known so we don't re-send them back
    if (this.client) {
      this.client.markFilesAsKnown(Object.keys(files));
    }

    // Use addFiles API if available (Excalidraw 0.17+)
    if (typeof api.addFiles === 'function') {
      try {
        const fileArray = Object.values(files) as { id: string; mimeType: string; dataURL: string; created: number; lastRetrieved?: number }[];
        api.addFiles(fileArray);
      } catch (e) {
        console.error('ExcaliShare Collab: Failed to add files via addFiles API', e);
      }
    } else {
      console.warn('ExcaliShare Collab: addFiles API not available — images from remote users may not display');
    }
  }

  /**
   * Handle incoming files_update from other users.
   * Applies new binary files to the Excalidraw canvas.
   */
  private handleRemoteFilesUpdate(files: Record<string, unknown>): void {
    const api = this.getAPI();
    if (!api) return;

    this.applyRemoteFiles(api, files);
  }

  /**
   * Handle local file changes detected via onChange callback.
   * Sends new files to the server via the CollabClient.
   */
  private handleLocalFilesChange(files: Record<string, unknown>): void {
    // Skip if we're in the middle of applying a remote update
    if (this.isApplyingRemoteUpdate) return;

    // Skip if not connected
    if (!this.client?.isConnected) return;

    // Send files update — CollabClient handles delta tracking (only sends new files)
    if (files && Object.keys(files).length > 0) {
      this.client.sendFilesUpdate(files);
    }
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

    // ── Follow mode: update the lerp target ──
    if (this.followingUserId === msg.userId && msg.scrollX !== undefined && msg.scrollY !== undefined) {
      this.followTarget = {
        scrollX: msg.scrollX,
        scrollY: msg.scrollY,
        zoom: msg.zoom !== undefined ? msg.zoom : null,
      };

      // Initialize current position from Excalidraw's state on first target
      if (this.followCurrent === null) {
        const api = this.getAPI();
        if (api?.getAppState) {
          try {
            const appState = api.getAppState() as {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
            };
            this.followCurrent = {
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom?.value ?? 1,
            };
          } catch { /* ignore */ }
        }
      }

      // Start the lerp loop if not already running
      if (this.followLerpRaf === null) {
        this.startFollowLerpLoop();
      }
    }
  }

  private handleUserJoined(msg: Extract<ServerMessage, { type: 'user_joined' }>): void {
    this.collaborators = msg.collaborators;
    this.buildCollaboratorMap(msg.collaborators);
    this.syncCollaboratorsToExcalidraw();
    this.callbacks.onCollaboratorsChanged?.(this.collaborators);
    // Suppress the notice when the joining user is ourselves (happens on WS reconnect:
    // the server broadcasts user_joined to all participants including the reconnecting client).
    if (msg.name !== this.displayName) {
      new Notice(`ExcaliShare: ${msg.name} joined the session`);
    } else {
      console.log(`ExcaliShare Collab: Suppressed self-join notice for "${msg.name}" (WS reconnect)`);
    }
  }

  private handleUserLeft(msg: Extract<ServerMessage, { type: 'user_left' }>): void {
    this.collaborators = msg.collaborators;
    this.buildCollaboratorMap(msg.collaborators);
    this.syncCollaboratorsToExcalidraw();
    this.callbacks.onCollaboratorsChanged?.(this.collaborators);

    // If we were following this user, stop following
    if (this.followingUserId === msg.userId) {
      this.stopFollowing();
    }

    new Notice(`ExcaliShare: ${msg.name} left the session`);
  }

  private handleSessionEnded(msg: Extract<ServerMessage, { type: 'session_ended' }>): void {
    new Notice(msg.saved
      ? 'ExcaliShare: Collab session ended and saved.'
      : 'ExcaliShare: Collab session ended. Changes discarded.');

    this.callbacks.onSessionEnded?.(msg.saved);
    this.leave();
  }

  // ──────────────────────────────────────────────
  // Change Detection (Event-Driven + Polling Fallback)
  // ──────────────────────────────────────────────

  /**
   * Start change detection using the best available strategy:
   * 1. Event-driven via excalidrawAPI.onChange() (preferred — zero-latency, zero-waste)
   * 2. Lightweight polling fallback (2s interval) if onChange is unavailable
   */
  private startChangeDetection(): void {
    if (this.detectionStrategy !== 'none') return;

    const api = this.getAPI();
    if (!api) return;

    // Try event-driven detection first (preferred)
    if (typeof api.onChange === 'function') {
      this.startEventDrivenDetection(api);
    } else {
      // Fallback to lightweight polling
      this.startPollingDetection();
    }

    // Always start pointer tracking regardless of detection strategy.
    // Previously this was only called inside startEventDrivenDetection(),
    // which meant pointer tracking was never started when using polling fallback.
    this.startPointerTracking();

    // Start viewport broadcast as a fallback for follow mode.
    // This ensures the host's viewport data (scrollX, scrollY, zoom) is
    // periodically sent even if DOM pointer tracking fails.
    this.startViewportBroadcast();
  }

  /**
   * Event-driven change detection using Excalidraw's imperative API.
   * - onChange: fires on every scene change (elements, appState, files)
   * - onPointerDown/Up: tracks drawing state for deferred updates
   * - DOM pointermove: tracks cursor position for broadcasting
   */
  private startEventDrivenDetection(api: ExcalidrawAPI): void {
    this.detectionStrategy = 'event-driven';

    // ── Subscribe to scene changes ──
    this.onChangeUnsubscribe = api.onChange!(
      (elements: readonly ExcalidrawElement[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
        this.handleLocalSceneChange(elements);
        // Send any new binary files (images) — CollabClient handles delta tracking
        this.handleLocalFilesChange(files);
        // Bridge Excalidraw's built-in follow mode to our follow system
        this.handleAppStateFollowChange(appState);
      }
    );

    // ── Subscribe to pointer down (track drawing state) ──
    if (typeof api.onPointerDown === 'function') {
      this.onPointerDownUnsubscribe = api.onPointerDown(
        (_activeTool: unknown, _pointerDownState: unknown, _event: PointerEvent) => {
          this.isUserActivelyDrawing = true;
        }
      );
    }

    // ── Subscribe to pointer up (flush deferred updates) ──
    if (typeof api.onPointerUp === 'function') {
      this.onPointerUpUnsubscribe = api.onPointerUp(
        (_activeTool: unknown, _pointerDownState: unknown, _event: PointerEvent) => {
          this.isUserActivelyDrawing = false;
          // Flush any deferred remote updates now that drawing ended
          if (this.pendingRemoteUpdates.length > 0) {
            this.flushPendingRemoteUpdates();
          }
        }
      );
    }

    // Note: pointer tracking is now started in startChangeDetection() so it
    // runs regardless of whether event-driven or polling detection is used.
  }

  /**
   * Handle a local scene change detected via onChange callback.
   * Performs version-diff filtering to avoid echoing remote changes back.
   */
  private handleLocalSceneChange(elements: readonly ExcalidrawElement[]): void {
    // Skip if we're in the middle of applying a remote update
    if (this.isApplyingRemoteUpdate) return;

    // Skip if not connected
    if (!this.client?.isConnected) return;

    // Fast version-diff: only collect elements whose version exceeds our tracking
    const changedElements: ExcalidrawElement[] = [];
    for (const el of elements) {
      if (!el.id) continue;

      const lastVersion = this.lastKnownVersions.get(el.id) ?? -1;
      if (el.version > lastVersion) {
        // Check if this is an echo of a remote update we applied
        const remoteVersion = this.remoteAppliedVersions.get(el.id);
        if (remoteVersion !== undefined && el.version <= remoteVersion) {
          // This is an echo — skip it but update tracking
          this.lastKnownVersions.set(el.id, el.version);
          continue;
        }

        changedElements.push(el);
        this.lastKnownVersions.set(el.id, el.version);
      }
    }

    // Clean up stale remote version entries for elements that have been locally modified
    for (const el of changedElements) {
      this.remoteAppliedVersions.delete(el.id);
    }

    if (changedElements.length === 0) return;

    // Send changes via WebSocket (CollabClient handles delta vs full + debouncing)
    // Pass the full elements array so CollabClient can compute delta/full correctly
    // The isDrawing flag enables adaptive debouncing
    this.client.sendSceneUpdate(
      elements as ExcalidrawElement[],
      this.isUserActivelyDrawing,
    );
  }

  /**
   * Fallback: lightweight polling for older Excalidraw versions
   * that don't expose the onChange imperative API.
   * Polls at 2s intervals (much less aggressive than the old 250ms).
   */
  private startPollingDetection(): void {
    if (this.pollTimer) return;

    this.detectionStrategy = 'polling';

    this.pollTimer = setInterval(() => {
      this.detectAndSendChanges();
      // Also check for follow mode changes in polling mode
      this.pollAppStateForFollow();
    }, CollabManager.FALLBACK_POLL_INTERVAL_MS);
  }

  /**
   * Polling-based change detection (fallback only).
   * Same logic as before but runs much less frequently.
   */
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
    this.client.sendSceneUpdate(currentElements, this.isUserDrawing());

    // Also send any new files (polling fallback doesn't get onChange files param)
    try {
      const files = api.getFiles();
      if (files && Object.keys(files).length > 0) {
        this.client.sendFilesUpdate(files);
      }
    } catch {
      // getFiles might not be available
    }
  }

  // ──────────────────────────────────────────────
  // Follow Mode Bridge (Excalidraw built-in → our system)
  // ──────────────────────────────────────────────

  /**
   * Bridge Excalidraw's built-in follow mode to our WebSocket-based follow system.
   *
   * When the user clicks a collaborator avatar in Excalidraw's built-in UI,
   * Excalidraw sets `appState.userToFollow = { socketId, username }`.
   * The `socketId` corresponds to the key we used in the collaborators Map
   * (which is our userId from the WebSocket server).
   *
   * This method detects those changes and calls our startFollowing()/stopFollowing().
   */
  private handleAppStateFollowChange(appState: Record<string, unknown>): void {
    const userToFollow = appState.userToFollow as
      | { socketId?: string; username?: string }
      | null
      | undefined;
    const followSocketId = userToFollow?.socketId ?? null;

    if (followSocketId === this.lastDetectedUserToFollow) return; // No change

    this.lastDetectedUserToFollow = followSocketId;

    if (followSocketId) {
      // Excalidraw's UI activated follow — bridge to our system
      if (this.followingUserId !== followSocketId) {
        this.startFollowing(followSocketId);
        this.callbacks.onFollowChanged?.(followSocketId);
      }
    } else {
      // Excalidraw's UI deactivated follow
      if (this.followingUserId) {
        this.stopFollowing();
        this.callbacks.onFollowChanged?.(null);
      }
    }
  }

  /**
   * Polling fallback for detecting Excalidraw's userToFollow changes.
   * Used when onChange API is not available (older Excalidraw versions).
   */
  private pollAppStateForFollow(): void {
    const api = this.getAPI();
    if (!api?.getAppState) return;

    try {
      const appState = api.getAppState();
      this.handleAppStateFollowChange(appState);
    } catch {
      // Silently ignore — API might be stale
    }
  }

  /**
   * Stop all change detection (event subscriptions + polling + pointer tracking).
   */
  private stopChangeDetection(): void {
    // Unsubscribe from Excalidraw event-driven API
    if (this.onChangeUnsubscribe) {
      try { this.onChangeUnsubscribe(); } catch { /* ignore */ }
      this.onChangeUnsubscribe = null;
    }
    if (this.onPointerDownUnsubscribe) {
      try { this.onPointerDownUnsubscribe(); } catch { /* ignore */ }
      this.onPointerDownUnsubscribe = null;
    }
    if (this.onPointerUpUnsubscribe) {
      try { this.onPointerUpUnsubscribe(); } catch { /* ignore */ }
      this.onPointerUpUnsubscribe = null;
    }

    // Stop pointer tracking
    if (this.pointerMoveCleanup) {
      try { this.pointerMoveCleanup(); } catch { /* ignore */ }
      this.pointerMoveCleanup = null;
    }

    // Stop pointer tracking retry timer
    if (this.pointerTrackingRetryTimer) {
      clearTimeout(this.pointerTrackingRetryTimer);
      this.pointerTrackingRetryTimer = null;
    }
    this.pointerTrackingRetryCount = 0;

    // Stop viewport broadcast fallback
    if (this.viewportBroadcastTimer) {
      clearInterval(this.viewportBroadcastTimer);
      this.viewportBroadcastTimer = null;
    }

    // Stop fallback polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear version tracking
    this.remoteAppliedVersions.clear();
    this.detectionStrategy = 'none';
  }

  // ──────────────────────────────────────────────
  // Pointer Tracking (DOM-based)
  // ──────────────────────────────────────────────

  /**
   * Set up pointer tracking by attaching a pointermove listener
   * to the Excalidraw canvas element. This enables the host's cursor
   * to be visible to other participants.
   *
   * The listener is throttled to 50ms to avoid flooding the WebSocket.
   * Screen coordinates are converted to Excalidraw scene coordinates.
   *
   * Uses exponential backoff retry (500ms, 1s, 2s, 4s) if the canvas
   * element is not found immediately (it may not be rendered yet).
   */
  private startPointerTracking(): void {
    // Don't start if already tracking
    if (this.pointerMoveCleanup) return;

    this.pointerTrackingRetryCount = 0;
    this.attemptPointerTracking();
  }

  /**
   * Attempt to find the canvas and attach the pointer listener.
   * Retries with exponential backoff if the canvas is not found.
   */
  private attemptPointerTracking(): void {
    const canvasEl = this.findExcalidrawCanvas();
    if (canvasEl) {
      this.attachPointerListener(canvasEl);
      return;
    }

    // Schedule retry with exponential backoff
    if (this.pointerTrackingRetryCount < CollabManager.POINTER_TRACKING_RETRY_DELAYS.length) {
      const delay = CollabManager.POINTER_TRACKING_RETRY_DELAYS[this.pointerTrackingRetryCount];
      this.pointerTrackingRetryTimer = setTimeout(() => {
        this.pointerTrackingRetryTimer = null;
        if (this.detectionStrategy !== 'none' && !this.pointerMoveCleanup) {
          this.pointerTrackingRetryCount++;
          this.attemptPointerTracking();
        }
      }, delay);
    }
  }

  private attachPointerListener(canvasEl: HTMLElement): void {
    let lastSendTime = 0;
    const THROTTLE_MS = 50;

    // Track active touch/pointer count to detect multi-touch gestures (pan/pinch).
    // During a two-finger pan, both touch points fire pointermove events — we must
    // suppress all broadcasts while more than one pointer is active to prevent the
    // cursor from jumping between fingers and the laser/pen from drawing lines.
    let activePointerCount = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        activePointerCount++;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        activePointerCount = Math.max(0, activePointerCount - 1);
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        activePointerCount = Math.max(0, activePointerCount - 1);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - lastSendTime < THROTTLE_MS) return;
      lastSendTime = now;

      if (!this.client?.isConnected) return;

      // Suppress multi-touch gestures (two-finger pan/pinch-zoom).
      // When more than one touch point is active, skip broadcasting to prevent
      // the cursor from jumping between fingers and the laser/pen from drawing
      // lines between touch positions.
      if (activePointerCount > 1) return;

      // Also skip non-primary pointer events (secondary touch points).
      // isPrimary is false for all touch points except the first one.
      if (!event.isPrimary) return;

      // Convert screen coordinates to Excalidraw scene coordinates
      const api = this.getAPI();
      if (!api?.getAppState) return;

      try {
        const appState = api.getAppState() as {
          scrollX: number;
          scrollY: number;
          zoom: { value: number };
          activeTool?: { type: string };
        };

        const zoom = appState.zoom?.value || 1;
        const rect = canvasEl.getBoundingClientRect();
        const sceneX = (event.clientX - rect.left) / zoom - appState.scrollX;
        const sceneY = (event.clientY - rect.top) / zoom - appState.scrollY;

        const button: 'down' | 'up' = event.buttons > 0 ? 'down' : 'up';

        // Detect active tool: laser pointer vs regular pointer
        const tool: 'pointer' | 'laser' =
          appState.activeTool?.type === 'laser' ? 'laser' : 'pointer';

        // Track last known pointer for viewport broadcast reuse
        this.lastKnownPointer = { x: sceneX, y: sceneY, button, tool };
        // Also update last broadcast viewport to avoid redundant sends
        this.lastBroadcastViewport = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom };

        this.client.sendPointerUpdate(
          sceneX, sceneY, button, tool,
          appState.scrollX, appState.scrollY, zoom,
        );
      } catch {
        // Silently ignore — API might be stale
      }
    };

    canvasEl.addEventListener('pointerdown', handlePointerDown, { passive: true });
    canvasEl.addEventListener('pointerup', handlePointerUp, { passive: true });
    canvasEl.addEventListener('pointercancel', handlePointerCancel, { passive: true });
    canvasEl.addEventListener('pointermove', handlePointerMove, { passive: true });
    this.pointerMoveCleanup = () => {
      canvasEl.removeEventListener('pointerdown', handlePointerDown);
      canvasEl.removeEventListener('pointerup', handlePointerUp);
      canvasEl.removeEventListener('pointercancel', handlePointerCancel);
      canvasEl.removeEventListener('pointermove', handlePointerMove);
    };

  }

  /**
   * Canvas selectors to try, in priority order.
   * Covers different Excalidraw versions and the Obsidian Excalidraw plugin's DOM structure.
   */
  private static readonly CANVAS_SELECTORS = [
    '.excalidraw__canvas.interactive',   // Newer Excalidraw (interactive layer)
    '.excalidraw__canvas',               // Standard Excalidraw canvas
    '.excalidraw canvas',                // Generic: any canvas inside .excalidraw
    'canvas.interactive',                // Canvas with interactive class (no parent prefix)
    'canvas',                            // Last resort: any canvas element
  ];

  /**
   * Find the Excalidraw canvas element in the DOM.
   * Uses the provided getCanvasContainer function or falls back to
   * searching the active workspace leaf and then the full document.
   *
   * Tries multiple selectors to handle different Excalidraw versions
   * and the Obsidian Excalidraw plugin's DOM structure.
   */
  private findExcalidrawCanvas(): HTMLElement | null {
    // Strategy 1: Use the provided canvas container finder
    if (this.getCanvasContainerFn) {
      const container = this.getCanvasContainerFn();
      if (container) {
        for (const selector of CollabManager.CANVAS_SELECTORS) {
          const el = container.querySelector<HTMLElement>(selector);
          if (el) {
            return el;
          }
        }
        // If no child matched, use the container itself (it might be the canvas)
        if (container.tagName === 'CANVAS') {
          return container;
        }
      }
    }

    // Strategy 2: Search the full document
    for (const selector of CollabManager.CANVAS_SELECTORS) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        return el;
      }
    }

    // Strategy 3: Search inside iframes (some Excalidraw setups use iframes)
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc) continue;
          for (const selector of CollabManager.CANVAS_SELECTORS) {
            const el = iframeDoc.querySelector<HTMLElement>(selector);
            if (el) {
              return el;
            }
          }
        } catch {
          // Cross-origin iframe — skip
        }
      }
    } catch {
      // Ignore iframe search errors
    }

    return null;
  }

  // ──────────────────────────────────────────────
  // Follow Mode (Lerp-based Viewport Interpolation)
  // ──────────────────────────────────────────────

  /**
   * Start the follow mode lerp loop. Smoothly interpolates the host's
   * viewport toward the followed user's viewport using requestAnimationFrame.
   * Same algorithm as the frontend's useCollab.ts follow mode.
   */
  private startFollowLerpLoop(): void {
    const lerpLoop = () => {
      const api = this.getAPI();
      const target = this.followTarget;
      const current = this.followCurrent;

      if (!api || !target || !current || !this.followingUserId) {
        this.followLerpRaf = null;
        return;
      }

      // Lerp toward target using self-tracked position
      const dx = target.scrollX - current.scrollX;
      const dy = target.scrollY - current.scrollY;
      const dz = target.zoom !== null ? target.zoom - current.zoom : 0;

      // Check if close enough to snap
      const threshold = 0.5;
      const isClose = Math.abs(dx) < threshold && Math.abs(dy) < threshold && Math.abs(dz) < 0.005;

      try {
        if (isClose) {
          // Snap to exact target and stop the loop
          current.scrollX = target.scrollX;
          current.scrollY = target.scrollY;
          if (target.zoom !== null) current.zoom = target.zoom;

          const finalState: Record<string, unknown> = {
            scrollX: target.scrollX,
            scrollY: target.scrollY,
          };
          if (target.zoom !== null) {
            finalState.zoom = { value: target.zoom };
          }
          api.updateScene({ appState: finalState });
          this.followLerpRaf = null;
        } else {
          // Interpolate and update self-tracked position
          current.scrollX += dx * CollabManager.FOLLOW_LERP_FACTOR;
          current.scrollY += dy * CollabManager.FOLLOW_LERP_FACTOR;
          if (target.zoom !== null) current.zoom += dz * CollabManager.FOLLOW_LERP_FACTOR;

          const lerpState: Record<string, unknown> = {
            scrollX: current.scrollX,
            scrollY: current.scrollY,
          };
          if (target.zoom !== null) {
            lerpState.zoom = { value: current.zoom };
          }
          api.updateScene({ appState: lerpState });
          this.followLerpRaf = requestAnimationFrame(lerpLoop);
        }
      } catch {
        // API might be stale — stop the loop
        this.followLerpRaf = null;
      }
    };

    this.followLerpRaf = requestAnimationFrame(lerpLoop);
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
  // Version Tracking & Echo Suppression
  // ──────────────────────────────────────────────

  private initializeVersionTracking(elements: ExcalidrawElement[]): void {
    this.lastKnownVersions.clear();
    this.remoteAppliedVersions.clear();
    for (const el of elements) {
      if (el.id) {
        this.lastKnownVersions.set(el.id, el.version);
      }
    }
  }

  /**
   * Schedule clearing the isApplyingRemoteUpdate flag.
   * Uses requestAnimationFrame to ensure React has processed the updateScene
   * call before we start listening for changes again.
   */
  private scheduleRemoteUpdateCooldown(): void {
    // Use requestAnimationFrame for precise timing — clears the flag
    // after the browser has had a chance to process the React update.
    // This is more reliable than the old fixed-timeout approach.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        // Double-rAF to ensure React's commit phase has completed
        requestAnimationFrame(() => {
          this.isApplyingRemoteUpdate = false;
        });
      });
    } else {
      // Fallback for environments without rAF (shouldn't happen in Electron)
      setTimeout(() => {
        this.isApplyingRemoteUpdate = false;
      }, 50);
    }
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

  // ──────────────────────────────────────────────
  // Viewport Broadcast Fallback
  // ──────────────────────────────────────────────

  /**
   * Start a periodic viewport broadcast that sends the host's current
   * viewport state (scrollX, scrollY, zoom) when it changes.
   *
   * This ensures follow mode works for browser users even when the host
   * scrolls or zooms without moving the mouse (e.g., scroll wheel, pinch zoom,
   * keyboard shortcuts). The pointermove handler only fires on mouse movement,
   * so this periodic check catches viewport-only changes.
   */
  private startViewportBroadcast(): void {
    if (this.viewportBroadcastTimer) return;

    this.viewportBroadcastTimer = setInterval(() => {
      if (!this.client?.isConnected) return;

      const api = this.getAPI();
      if (!api?.getAppState) return;

      try {
        const appState = api.getAppState() as {
          scrollX: number;
          scrollY: number;
          zoom: { value: number };
          width?: number;
          height?: number;
          activeTool?: { type: string };
          cursorButton?: string;
        };

        // Skip during active dragging — the pointermove handler already sends viewport data
        // during mouse movement, and sending here would use stale cursor positions
        if (appState.cursorButton === 'down' || this.lastKnownPointer.button === 'down') {
          return;
        }

        const zoom = appState.zoom?.value || 1;
        const scrollX = appState.scrollX;
        const scrollY = appState.scrollY;

        // Check if viewport has actually changed since last broadcast
        const last = this.lastBroadcastViewport;
        if (last && Math.abs(last.scrollX - scrollX) < 0.5 && Math.abs(last.scrollY - scrollY) < 0.5 && Math.abs(last.zoom - zoom) < 0.001) {
          return; // No meaningful viewport change — skip
        }

        // Viewport changed — send update with last known pointer position
        this.lastBroadcastViewport = { scrollX, scrollY, zoom };

        const lp = this.lastKnownPointer;
        this.client.sendPointerUpdate(
          lp.x, lp.y, lp.button, lp.tool,
          scrollX, scrollY, zoom,
        );
      } catch {
        // Silently ignore — API might be stale
      }
    }, CollabManager.VIEWPORT_BROADCAST_INTERVAL_MS);

  }
}
