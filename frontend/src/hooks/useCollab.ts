import { useState, useEffect, useCallback, useRef } from 'react';
import { CollabClient } from '../utils/collabClient';
import type {
  CollaboratorInfo,
  CollabStatusResponse,
  ServerMessage,
} from '../types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type { Collaborator, UserIdleState } from '@excalidraw/excalidraw/types/types';

const DISPLAY_NAME_KEY = 'excalishare-collab-name';

function getStoredName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) || '';
}

function storeName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}

// ──────────────────────────────────────────────
// Color palette for collaborators (deterministic by colorIndex from server)
// ──────────────────────────────────────────────

const COLLAB_COLORS: { background: string; stroke: string }[] = [
  { background: '#FF6B6B33', stroke: '#FF6B6B' },  // Red
  { background: '#4ECDC433', stroke: '#4ECDC4' },  // Teal
  { background: '#45B7D133', stroke: '#45B7D1' },  // Blue
  { background: '#96CEB433', stroke: '#96CEB4' },  // Green
  { background: '#DDA0DD33', stroke: '#DDA0DD' },  // Plum
  { background: '#F7DC6F33', stroke: '#F7DC6F' },  // Gold
  { background: '#E8915633', stroke: '#E89156' },  // Orange
  { background: '#98D8C833', stroke: '#98D8C8' },  // Mint
];

function getCollaboratorColor(colorIndex: number): { background: string; stroke: string } {
  return COLLAB_COLORS[colorIndex % COLLAB_COLORS.length];
}

interface UseCollabOptions {
  drawingId: string | undefined;
  excalidrawAPI: unknown | null;
}

interface UseCollabReturn {
  /** Whether a collab session is active for this drawing */
  isCollabActive: boolean;
  /** The session ID if active */
  sessionId: string | null;
  /** Whether this client is connected to the session */
  isJoined: boolean;
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** List of collaborators in the session */
  collaborators: CollaboratorInfo[];
  /** Number of participants (from status check, before joining) */
  participantCount: number;
  /** The user's display name */
  displayName: string;
  /** Whether the session just ended */
  sessionEnded: { saved: boolean } | null;
  /** The user ID we are currently following (null if not following anyone) */
  followingUserId: string | null;
  /** Join the collab session */
  joinSession: (name: string) => void;
  /** Leave the collab session */
  leaveSession: () => void;
  /** Send a scene update */
  sendSceneUpdate: (elements: ExcalidrawElement[]) => void;
  /** Send a pointer update (with optional tool type and viewport data) */
  sendPointerUpdate: (x: number, y: number, button: 'down' | 'up', tool?: 'pointer' | 'laser', scrollX?: number, scrollY?: number, zoom?: number) => void;
  /** Update display name */
  setDisplayName: (name: string) => void;
  /** Dismiss session ended notification */
  dismissSessionEnded: () => void;
  /** Refresh collab status */
  refreshStatus: () => void;
  /** Start following a user */
  startFollowing: (userId: string) => void;
  /** Stop following */
  stopFollowing: () => void;
  /** Flush any pending scene updates that were deferred during active drawing */
  flushPendingSceneUpdates: () => void;
  /** Get collaborator IDs in the same order as the Excalidraw collaborator Map (for badge matching) */
  getCollaboratorIds: () => string[];
}

export function useCollab({ drawingId, excalidrawAPI }: UseCollabOptions): UseCollabReturn {
  const [isCollabActive, setIsCollabActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [displayName, setDisplayNameState] = useState(getStoredName);
  const [sessionEnded, setSessionEnded] = useState<{ saved: boolean } | null>(null);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);

  const clientRef = useRef<CollabClient | null>(null);
  const excalidrawAPIRef = useRef(excalidrawAPI);
  /** Tracks which drawing ID the collab session was joined for */
  const collabDrawingIdRef = useRef<string | null>(null);
  /** Persistent collaborator state map for Excalidraw (includes pointer, color, etc.) */
  const collaboratorMapRef = useRef<Map<string, Collaborator>>(new Map());
  /** Track the followed user ID in a ref for use in callbacks */
  const followingUserIdRef = useRef<string | null>(null);
  /** Queue of remote scene updates deferred while user is actively drawing */
  const pendingSceneUpdatesRef = useRef<ExcalidrawElement[][]>([]);
  /** Timer for safety flush of pending scene updates */
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** rAF handle for batched pointer/collaborator updates */
  const pointerRafRef = useRef<number | null>(null);
  /** Pending batched collaborator data for next rAF frame */
  const pendingCollabUpdateRef = useRef<Map<string, Collaborator> | null>(null);
  /** Follow mode: target viewport for lerp interpolation */
  const followTargetRef = useRef<{ scrollX: number; scrollY: number; zoom: number | null } | null>(null);
  /** Follow mode: current interpolated viewport position (self-tracked, not read from Excalidraw) */
  const followCurrentRef = useRef<{ scrollX: number; scrollY: number; zoom: number } | null>(null);
  /** Follow mode: rAF handle for the viewport interpolation loop */
  const followLerpRafRef = useRef<number | null>(null);
  /** Follow mode: lerp factor (0-1, higher = faster convergence) */
  const FOLLOW_LERP_FACTOR = 0.25;

  // Keep refs in sync
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  useEffect(() => {
    followingUserIdRef.current = followingUserId;
  }, [followingUserId]);

  // Auto-disconnect when navigating away from the collab drawing
  useEffect(() => {
    if (
      collabDrawingIdRef.current &&
      drawingId !== collabDrawingIdRef.current &&
      clientRef.current
    ) {
      console.log(
        `ExcaliShare Collab: Drawing changed (${collabDrawingIdRef.current} → ${drawingId}), auto-disconnecting`
      );
      clientRef.current.disconnect();
      clientRef.current = null;
      collabDrawingIdRef.current = null;
      setIsJoined(false);
      setIsConnected(false);
      setCollaborators([]);
      setFollowingUserId(null);
      collaboratorMapRef.current = new Map();

      // Clear collaborators from Excalidraw
      const api = excalidrawAPIRef.current as {
        updateScene: (data: unknown) => void;
      } | null;
      if (api) {
        api.updateScene({ collaborators: new Map() });
      }
    }
  }, [drawingId]);

  // Check collab status on mount and when drawingId changes
  const refreshStatus = useCallback(() => {
    if (!drawingId) return;

    fetch(`/api/collab/status/${drawingId}`)
      .then((res) => res.json())
      .then((data: CollabStatusResponse) => {
        setIsCollabActive(data.active);
        setSessionId(data.session_id || null);
        setParticipantCount(data.participant_count || 0);
      })
      .catch((err) => {
        console.error('ExcaliShare Collab: Failed to check status', err);
        setIsCollabActive(false);
        setSessionId(null);
      });
  }, [drawingId]);

  useEffect(() => {
    refreshStatus();
    // Poll status every 10 seconds when not joined
    const interval = setInterval(() => {
      if (!clientRef.current) {
        refreshStatus();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Helper: build the Excalidraw collaborator map from our collaborator info list
  const buildCollaboratorMap = useCallback((collabList: CollaboratorInfo[]) => {
    const map = collaboratorMapRef.current;

    // Remove collaborators that are no longer in the list
    const currentIds = new Set(collabList.map((c) => c.id));
    for (const key of map.keys()) {
      if (!currentIds.has(key)) {
        map.delete(key);
      }
    }

    // Add/update collaborators
    for (const c of collabList) {
      const existing = map.get(c.id);
      const color = getCollaboratorColor(c.colorIndex);
      map.set(c.id, {
        ...existing,
        username: c.name,
        color,
        id: c.id,
        userState: existing?.userState || ('active' as UserIdleState),
      });
    }

    return map;
  }, []);

  // Helper: push the collaborator map to Excalidraw
  const syncCollaboratorsToExcalidraw = useCallback(() => {
    const api = excalidrawAPIRef.current as {
      updateScene: (data: unknown) => void;
    } | null;
    if (api) {
      // Create a new Map copy so React/Excalidraw detects the change
      api.updateScene({ collaborators: new Map(collaboratorMapRef.current) });
    }
  }, []);

  // Helper: check if user is actively drawing/resizing (mid-stroke)
  const isUserDrawing = useCallback((): boolean => {
    const api = excalidrawAPIRef.current as {
      getAppState: () => { draggingElement: unknown; resizingElement: unknown; editingElement: unknown };
    } | null;
    if (!api?.getAppState) return false;
    const appState = api.getAppState();
    return !!(appState.draggingElement || appState.resizingElement || appState.editingElement);
  }, []);

  // Helper: apply a remote scene update (merge with current elements)
  // Uses getSceneElementsIncludingDeleted() to preserve deleted elements in the
  // merge base — without this, deleted elements would be missing from the local
  // side, allowing stale remote updates to resurrect them.
  const applyRemoteSceneUpdate = useCallback((remoteElements: ExcalidrawElement[]) => {
    const api = excalidrawAPIRef.current as {
      updateScene: (data: unknown) => void;
      getSceneElements: () => ExcalidrawElement[];
      getSceneElementsIncludingDeleted?: () => ExcalidrawElement[];
    } | null;
    if (!api) return;

    const currentElements = api.getSceneElementsIncludingDeleted
      ? api.getSceneElementsIncludingDeleted()
      : api.getSceneElements();
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
    api.updateScene({ elements: merged });
  }, []);

  // Flush all pending scene updates (called when user finishes drawing)
  const flushPendingSceneUpdates = useCallback(() => {
    const pending = pendingSceneUpdatesRef.current;
    if (pending.length === 0) return;

    // Merge all pending updates into one combined update
    const combined = new Map<string, ExcalidrawElement>();
    for (const elements of pending) {
      for (const el of elements) {
        const existing = combined.get(el.id);
        if (!existing || el.version >= existing.version) {
          combined.set(el.id, el);
        }
      }
    }

    // Clear the queue
    pendingSceneUpdatesRef.current = [];

    // Apply the combined update
    applyRemoteSceneUpdate(Array.from(combined.values()));
  }, [applyRemoteSceneUpdate]);

  // Safety interval: flush pending updates when user stops drawing
  useEffect(() => {
    if (!isJoined) {
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      return;
    }

    flushTimerRef.current = setInterval(() => {
      if (pendingSceneUpdatesRef.current.length > 0 && !isUserDrawing()) {
        flushPendingSceneUpdates();
      }
    }, 300);

    return () => {
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [isJoined, isUserDrawing, flushPendingSceneUpdates]);

  // Join session
  const joinSession = useCallback(
    (name: string) => {
      if (!sessionId || clientRef.current) return;

      const finalName = name || 'Anonymous';
      setDisplayNameState(finalName);
      storeName(finalName);

      // Track which drawing this collab session belongs to
      collabDrawingIdRef.current = drawingId || null;

      const client = new CollabClient(sessionId, finalName);

      // Handle snapshot (initial state)
      client.on('snapshot', (msg: ServerMessage) => {
        if (msg.type !== 'snapshot') return;

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          // Build the collaborator map with full Collaborator objects
          const collabMap = buildCollaboratorMap(msg.collaborators);

          api.updateScene({
            elements: msg.elements,
            appState: msg.appState,
            collaborators: new Map(collabMap),
          });
        }

        setCollaborators(msg.collaborators);
      });

      // Handle scene updates from other users
      // Defers updates while user is actively drawing to prevent stroke interruption
      client.on('scene_update', (msg: ServerMessage) => {
        if (msg.type !== 'scene_update') return;

        const remoteElements = msg.elements as ExcalidrawElement[];

        // If user is actively drawing, queue the update to avoid interrupting the stroke
        if (isUserDrawing()) {
          pendingSceneUpdatesRef.current.push(remoteElements);
          return;
        }

        // Flush any previously queued updates first, then apply this one
        if (pendingSceneUpdatesRef.current.length > 0) {
          pendingSceneUpdatesRef.current.push(remoteElements);
          flushPendingSceneUpdates();
        } else {
          applyRemoteSceneUpdate(remoteElements);
        }
      });

      // Handle delta scene updates from other users (only changed elements)
      client.on('scene_delta', (msg: ServerMessage) => {
        if (msg.type !== 'scene_delta') return;

        const remoteElements = msg.elements as ExcalidrawElement[];

        // If user is actively drawing, queue the update to avoid interrupting the stroke
        if (isUserDrawing()) {
          pendingSceneUpdatesRef.current.push(remoteElements);
          return;
        }

        // Flush any previously queued updates first, then apply this one
        if (pendingSceneUpdatesRef.current.length > 0) {
          pendingSceneUpdatesRef.current.push(remoteElements);
          flushPendingSceneUpdates();
        } else {
          applyRemoteSceneUpdate(remoteElements);
        }
      });

      // Handle full sync (server-initiated resync, e.g., after gap detection)
      client.on('full_sync', (msg: ServerMessage) => {
        if (msg.type !== 'full_sync') return;

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          api.updateScene({
            elements: msg.elements,
            appState: msg.appState,
          });
        }
      });

      // Handle pointer updates from other users
      // Collaborator cursors are batched via rAF for efficiency.
      // Follow mode viewport uses lerp interpolation for smooth scrolling.
      client.on('pointer_update', (msg: ServerMessage) => {
        if (msg.type !== 'pointer_update') return;

        const color = getCollaboratorColor(msg.colorIndex);

        // Update the specific collaborator's full state including pointer
        const pointerTool = (msg.tool === 'laser' ? 'laser' : 'pointer') as 'pointer' | 'laser';
        collaboratorMapRef.current.set(msg.userId, {
          ...collaboratorMapRef.current.get(msg.userId),
          pointer: { x: msg.x, y: msg.y, tool: pointerTool },
          button: msg.button as 'up' | 'down',
          username: msg.name,
          color,
          id: msg.userId,
        });

        // Stage collaborator map for the next rAF frame
        pendingCollabUpdateRef.current = new Map(collaboratorMapRef.current);

        // Follow mode: update the lerp target (the interpolation loop handles the actual scrolling)
        if (followingUserIdRef.current === msg.userId && msg.scrollX !== undefined && msg.scrollY !== undefined) {
          followTargetRef.current = {
            scrollX: msg.scrollX,
            scrollY: msg.scrollY,
            zoom: msg.zoom !== undefined ? msg.zoom : null,
          };

          // Initialize current position from Excalidraw's state on first target
          if (followCurrentRef.current === null) {
            const api = excalidrawAPIRef.current as {
              getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number } };
            } | null;
            if (api?.getAppState) {
              const appState = api.getAppState();
              followCurrentRef.current = {
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
                zoom: appState.zoom?.value ?? 1,
              };
            }
          }

          // Start the lerp loop if not already running
          if (followLerpRafRef.current === null) {
            const lerpLoop = () => {
              const api = excalidrawAPIRef.current as {
                updateScene: (data: unknown) => void;
              } | null;
              const target = followTargetRef.current;
              const current = followCurrentRef.current;

              if (!api || !target || !current || !followingUserIdRef.current) {
                followLerpRafRef.current = null;
                return;
              }

              // Lerp toward target using self-tracked position
              const dx = target.scrollX - current.scrollX;
              const dy = target.scrollY - current.scrollY;
              const dz = target.zoom !== null ? target.zoom - current.zoom : 0;

              // Check if close enough to snap
              const threshold = 0.5;
              const isClose = Math.abs(dx) < threshold && Math.abs(dy) < threshold && Math.abs(dz) < 0.005;

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
                followLerpRafRef.current = null;
              } else {
                // Interpolate and update self-tracked position
                current.scrollX += dx * FOLLOW_LERP_FACTOR;
                current.scrollY += dy * FOLLOW_LERP_FACTOR;
                if (target.zoom !== null) current.zoom += dz * FOLLOW_LERP_FACTOR;

                const lerpState: Record<string, unknown> = {
                  scrollX: current.scrollX,
                  scrollY: current.scrollY,
                };
                if (target.zoom !== null) {
                  lerpState.zoom = { value: current.zoom };
                }
                api.updateScene({ appState: lerpState });
                followLerpRafRef.current = requestAnimationFrame(lerpLoop);
              }
            };
            followLerpRafRef.current = requestAnimationFrame(lerpLoop);
          }
        }

        // Schedule a single batched updateScene() call for collaborator cursors
        if (pointerRafRef.current === null) {
          pointerRafRef.current = requestAnimationFrame(() => {
            pointerRafRef.current = null;
            const pendingCollabs = pendingCollabUpdateRef.current;
            const api = excalidrawAPIRef.current as {
              updateScene: (data: unknown) => void;
            } | null;

            if (api && pendingCollabs) {
              api.updateScene({ collaborators: pendingCollabs });
            }

            pendingCollabUpdateRef.current = null;
          });
        }
      });

      // Handle user joined
      client.on('user_joined', (msg: ServerMessage) => {
        if (msg.type !== 'user_joined') return;
        setCollaborators(msg.collaborators);

        buildCollaboratorMap(msg.collaborators);
        syncCollaboratorsToExcalidraw();
      });

      // Handle user left
      client.on('user_left', (msg: ServerMessage) => {
        if (msg.type !== 'user_left') return;
        setCollaborators(msg.collaborators);

        // If we were following this user, stop following
        if (followingUserIdRef.current === msg.userId) {
          setFollowingUserId(null);
        }

        buildCollaboratorMap(msg.collaborators);
        syncCollaboratorsToExcalidraw();
      });

      // Handle session ended
      client.on('session_ended', (msg: ServerMessage) => {
        if (msg.type !== 'session_ended') return;
        setSessionEnded({ saved: msg.saved });
        setIsJoined(false);
        setIsConnected(false);
        setIsCollabActive(false);
        setSessionId(null);
        setCollaborators([]);
        setFollowingUserId(null);
        collabDrawingIdRef.current = null;
        collaboratorMapRef.current = new Map();
        client.disconnect();
        clientRef.current = null;
      });

      // Handle connection state
      client.on('_connected', () => {
        setIsConnected(true);
      });

      client.on('_disconnected', () => {
        setIsConnected(false);
      });

      client.on('_reconnect_failed', () => {
        setIsJoined(false);
        setIsConnected(false);
        clientRef.current = null;
      });

      // Handle errors
      client.on('error', (msg: ServerMessage) => {
        if (msg.type !== 'error') return;
        console.error('ExcaliShare Collab: Server error', msg.message);
      });

      clientRef.current = client;
      client.connect();
      setIsJoined(true);
    },
    [sessionId, drawingId, buildCollaboratorMap, syncCollaboratorsToExcalidraw]
  );

  // Leave session
  const leaveSession = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    // Cancel any pending rAF updates
    if (pointerRafRef.current !== null) {
      cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = null;
    }
    if (followLerpRafRef.current !== null) {
      cancelAnimationFrame(followLerpRafRef.current);
      followLerpRafRef.current = null;
    }
    pendingCollabUpdateRef.current = null;
    followTargetRef.current = null;
    followCurrentRef.current = null;
    collabDrawingIdRef.current = null;
    setIsJoined(false);
    setIsConnected(false);
    setCollaborators([]);
    setFollowingUserId(null);
    collaboratorMapRef.current = new Map();

    // Clear collaborators from Excalidraw
    const api = excalidrawAPIRef.current as {
      updateScene: (data: unknown) => void;
    } | null;
    if (api) {
      api.updateScene({ collaborators: new Map() });
    }
  }, []);

  // Send scene update — only if we're on the drawing the collab session was started for
  const sendSceneUpdate = useCallback((elements: ExcalidrawElement[]) => {
    if (collabDrawingIdRef.current && collabDrawingIdRef.current === drawingId) {
      clientRef.current?.sendSceneUpdate(elements);
    }
  }, [drawingId]);

  // Send pointer update (with optional tool type and viewport data for follow mode)
  const sendPointerUpdate = useCallback(
    (x: number, y: number, button: 'down' | 'up', tool?: 'pointer' | 'laser', scrollX?: number, scrollY?: number, zoom?: number) => {
      clientRef.current?.sendPointerUpdate(x, y, button, tool, scrollX, scrollY, zoom);
    },
    []
  );

  // Update display name
  const setDisplayName = useCallback(
    (name: string) => {
      setDisplayNameState(name);
      storeName(name);
      clientRef.current?.sendSetName(name);
    },
    []
  );

  // Dismiss session ended notification
  const dismissSessionEnded = useCallback(() => {
    setSessionEnded(null);
  }, []);

  // Follow mode
  const startFollowing = useCallback((userId: string) => {
    setFollowingUserId(userId);
  }, []);

  const stopFollowing = useCallback(() => {
    setFollowingUserId(null);
    // Stop the lerp loop immediately and reset state
    followTargetRef.current = null;
    followCurrentRef.current = null;
    if (followLerpRafRef.current !== null) {
      cancelAnimationFrame(followLerpRafRef.current);
      followLerpRafRef.current = null;
    }
  }, []);

  // Get collaborator IDs in the same order as the Excalidraw collaborator Map
  // This matches the order Excalidraw's UserList renders the avatars
  const getCollaboratorIds = useCallback((): string[] => {
    return Array.from(collaboratorMapRef.current.keys());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      if (followLerpRafRef.current !== null) {
        cancelAnimationFrame(followLerpRafRef.current);
        followLerpRafRef.current = null;
      }
    };
  }, []);

  return {
    isCollabActive,
    sessionId,
    isJoined,
    isConnected,
    collaborators,
    participantCount,
    displayName,
    sessionEnded,
    followingUserId,
    joinSession,
    leaveSession,
    sendSceneUpdate,
    sendPointerUpdate,
    setDisplayName,
    dismissSessionEnded,
    refreshStatus,
    startFollowing,
    stopFollowing,
    flushPendingSceneUpdates,
    getCollaboratorIds,
  };
}
