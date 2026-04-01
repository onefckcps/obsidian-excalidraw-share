import { useState, useEffect, useCallback, useRef } from 'react';
import { CollabClient } from '../utils/collabClient';
import type {
  CollaboratorInfo,
  CollabStatusResponse,
  ServerMessage,
} from '../types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';

const DISPLAY_NAME_KEY = 'excalishare-collab-name';

function getStoredName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) || '';
}

function storeName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
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
  /** Join the collab session */
  joinSession: (name: string) => void;
  /** Leave the collab session */
  leaveSession: () => void;
  /** Send a scene update */
  sendSceneUpdate: (elements: ExcalidrawElement[]) => void;
  /** Send a pointer update */
  sendPointerUpdate: (x: number, y: number, button: 'down' | 'up') => void;
  /** Update display name */
  setDisplayName: (name: string) => void;
  /** Dismiss session ended notification */
  dismissSessionEnded: () => void;
  /** Refresh collab status */
  refreshStatus: () => void;
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

  const clientRef = useRef<CollabClient | null>(null);
  const excalidrawAPIRef = useRef(excalidrawAPI);

  // Keep excalidrawAPI ref up to date
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

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

  // Join session
  const joinSession = useCallback(
    (name: string) => {
      if (!sessionId || clientRef.current) return;

      const finalName = name || 'Anonymous';
      setDisplayNameState(finalName);
      storeName(finalName);

      const client = new CollabClient(sessionId, finalName);

      // Handle snapshot (initial state)
      client.on('snapshot', (msg: ServerMessage) => {
        if (msg.type !== 'snapshot') return;

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          const collabMap = new Map<string, { username: string }>();
          for (const c of msg.collaborators) {
            collabMap.set(c.id, { username: c.name });
          }

          api.updateScene({
            elements: msg.elements,
            appState: msg.appState,
            collaborators: collabMap,
          });
        }

        setCollaborators(msg.collaborators);
      });

      // Handle scene updates from other users
      client.on('scene_update', (msg: ServerMessage) => {
        if (msg.type !== 'scene_update') return;

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
          getSceneElements: () => ExcalidrawElement[];
        } | null;

        if (api) {
          // Merge incoming elements with current scene
          const currentElements = api.getSceneElements();
          const incomingMap = new Map<string, ExcalidrawElement>();
          for (const el of msg.elements as ExcalidrawElement[]) {
            incomingMap.set(el.id, el);
          }

          // Merge: use incoming version if it's newer
          const merged = currentElements.map((el) => {
            const incoming = incomingMap.get(el.id);
            if (incoming && incoming.version > el.version) {
              return incoming;
            }
            return el;
          });

          // Add any new elements that don't exist locally
          for (const [id, el] of incomingMap) {
            if (!currentElements.find((e) => e.id === id)) {
              merged.push(el);
            }
          }

          api.updateScene({ elements: merged });
        }
      });

      // Handle pointer updates from other users
      client.on('pointer_update', (msg: ServerMessage) => {
        if (msg.type !== 'pointer_update') return;

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          // Update the collaborator's pointer position
          setCollaborators((prev) => {
            const collabMap = new Map<string, { username: string }>();
            for (const c of prev) {
              collabMap.set(c.id, { username: c.name });
            }
            // Add pointer info for this user
            collabMap.set(msg.userId, {
              username: msg.name,
            });
            api.updateScene({ collaborators: collabMap });
            return prev;
          });
        }
      });

      // Handle user joined
      client.on('user_joined', (msg: ServerMessage) => {
        if (msg.type !== 'user_joined') return;
        setCollaborators(msg.collaborators);

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          const collabMap = new Map<string, { username: string }>();
          for (const c of msg.collaborators) {
            collabMap.set(c.id, { username: c.name });
          }
          api.updateScene({ collaborators: collabMap });
        }
      });

      // Handle user left
      client.on('user_left', (msg: ServerMessage) => {
        if (msg.type !== 'user_left') return;
        setCollaborators(msg.collaborators);

        const api = excalidrawAPIRef.current as {
          updateScene: (data: unknown) => void;
        } | null;

        if (api) {
          const collabMap = new Map<string, { username: string }>();
          for (const c of msg.collaborators) {
            collabMap.set(c.id, { username: c.name });
          }
          api.updateScene({ collaborators: collabMap });
        }
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
    [sessionId]
  );

  // Leave session
  const leaveSession = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsJoined(false);
    setIsConnected(false);
    setCollaborators([]);

    // Clear collaborators from Excalidraw
    const api = excalidrawAPIRef.current as {
      updateScene: (data: unknown) => void;
    } | null;
    if (api) {
      api.updateScene({ collaborators: new Map() });
    }
  }, []);

  // Send scene update
  const sendSceneUpdate = useCallback((elements: ExcalidrawElement[]) => {
    clientRef.current?.sendSceneUpdate(elements);
  }, []);

  // Send pointer update
  const sendPointerUpdate = useCallback(
    (x: number, y: number, button: 'down' | 'up') => {
      clientRef.current?.sendPointerUpdate(x, y, button);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
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
    joinSession,
    leaveSession,
    sendSceneUpdate,
    sendPointerUpdate,
    setDisplayName,
    dismissSessionEnded,
    refreshStatus,
  };
}
