import { useState, useRef, useCallback, useEffect } from 'react';
import { ScreenShareManager } from '../utils/screenShareManager';
import type { CollabClient } from '../utils/collabClient';
import type { ServerMessage } from '../types';

export interface ActiveSharer {
  userId: string;
  name: string;
}

export interface UseScreenShareReturn {
  isSharing: boolean;
  activeSharer: ActiveSharer | null;
  remoteStream: MediaStream | null;
  isViewerConnected: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  handleServerMessage: (msg: ServerMessage) => void;
}

export function useScreenShare(
  client: CollabClient | null,
  myUserId: string,
  isJoined: boolean,
): UseScreenShareReturn {
  const [isSharing, setIsSharing] = useState(false);
  const [activeSharer, setActiveSharer] = useState<ActiveSharer | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isViewerConnected, setIsViewerConnected] = useState(false);
  const managerRef = useRef<ScreenShareManager | null>(null);

  // Keep myUserId in a ref so callbacks always have the latest value
  const myUserIdRef = useRef(myUserId);
  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  // Create/destroy manager when client or join state changes
  useEffect(() => {
    if (!client || !isJoined) {
      managerRef.current?.destroy();
      managerRef.current = null;
      setIsSharing(false);
      setActiveSharer(null);
      setRemoteStream(null);
      setIsViewerConnected(false);
      return;
    }

    managerRef.current = new ScreenShareManager(client, myUserId, {
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setIsViewerConnected(true);
      },
      onRemoteStreamEnded: () => {
        setRemoteStream(null);
        setIsViewerConnected(false);
      },
      onSharingStarted: () => setIsSharing(true),
      onSharingStopped: () => setIsSharing(false),
      onError: (err) => console.error('[ScreenShare]', err),
    });

    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, isJoined]);
  // Note: myUserId intentionally excluded — manager is recreated when client/isJoined changes.
  // myUserId changes are handled via myUserIdRef for the handleServerMessage callback.

  const startSharing = useCallback(async () => {
    await managerRef.current?.startSharing();
  }, []);

  const stopSharing = useCallback(() => {
    managerRef.current?.stopSharing();
  }, []);

  // Handle incoming server messages related to screen sharing
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (!managerRef.current) return;

    switch (msg.type) {
      case 'screen_share_started':
        setActiveSharer({ userId: msg.userId, name: msg.name });
        // If we're not the sharer, initiate WebRTC connection as viewer
        if (msg.userId !== myUserIdRef.current) {
          managerRef.current.onRemoteShareStarted(msg.userId);
        }
        break;

      case 'screen_share_stopped':
        setActiveSharer(null);
        if (msg.userId !== myUserIdRef.current) {
          managerRef.current.onRemoteShareStopped();
        }
        break;

      case 'rtc_signal':
        managerRef.current.onRtcSignal(msg.fromUserId, msg.signal);
        break;

      case 'rtc_ice_candidate':
        managerRef.current.onRtcIceCandidate(msg.fromUserId, msg.candidate);
        break;
    }
  }, []);

  return {
    isSharing,
    activeSharer,
    remoteStream,
    isViewerConnected,
    startSharing,
    stopSharing,
    handleServerMessage,
  };
}
