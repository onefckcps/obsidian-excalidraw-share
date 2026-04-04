import type { CollabClient } from './collabClient';

export interface ScreenShareManagerCallbacks {
  onRemoteStream: (stream: MediaStream, sharerUserId: string) => void;
  onRemoteStreamEnded: () => void;
  onSharingStarted: () => void;
  onSharingStopped: () => void;
  onError: (error: string) => void;
}

const FALLBACK_ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

async function fetchIceConfig(): Promise<RTCConfiguration> {
  try {
    // Try to fetch from backend (requires API key — only available in admin/plugin context)
    // For browser viewers without API key, fall back to public STUN servers
    const apiKey = sessionStorage.getItem('excalishare-api-key');
    if (!apiKey) {
      console.log('[ScreenShare] No API key, using fallback STUN config');
      return FALLBACK_ICE_CONFIG;
    }

    const response = await fetch('/api/ice-config', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      console.log('[ScreenShare] ICE config fetch failed, using fallback');
      return FALLBACK_ICE_CONFIG;
    }

    const config = await response.json();
    console.log('[ScreenShare] ICE config fetched from server:', config);
    return config;
  } catch {
    console.log('[ScreenShare] ICE config fetch error, using fallback');
    return FALLBACK_ICE_CONFIG;
  }
}

export class ScreenShareManager {
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private client: CollabClient;
  private callbacks: ScreenShareManagerCallbacks;
  private isSharing = false;
  private sharerUserId: string | null = null;
  private myUserId: string;
  private iceConfig: RTCConfiguration | null = null;

  constructor(client: CollabClient, myUserId: string, callbacks: ScreenShareManagerCallbacks) {
    this.client = client;
    this.myUserId = myUserId;
    this.callbacks = callbacks;
    console.log('[ScreenShare] Manager created for user', myUserId);
  }

  private async getIceConfig(): Promise<RTCConfiguration> {
    if (!this.iceConfig) {
      this.iceConfig = await fetchIceConfig();
    }
    return this.iceConfig;
  }

  // Called when the user wants to start sharing their screen
  async startSharing(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });

      // Handle user stopping share via browser UI (clicking "Stop sharing")
      this.localStream.getVideoTracks()[0].onended = () => {
        this.stopSharing();
      };

      this.isSharing = true;
      console.log('[ScreenShare] Local stream acquired, sending screen_share_start');
      this.client.sendScreenShareStart();
      this.callbacks.onSharingStarted();
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') {
        this.callbacks.onError(`Failed to start screen share: ${(err as Error).message}`);
      }
      // NotAllowedError = user cancelled the picker, not an error
    }
  }

  // Called when the user stops sharing
  stopSharing(): void {
    if (!this.isSharing) return;
    this.isSharing = false;

    // Stop all tracks
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    // Close all peer connections
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    this.client.sendScreenShareStop();
    this.callbacks.onSharingStopped();
  }

  // Called when a remote user starts sharing — we (as viewer) initiate the WebRTC offer
  async onRemoteShareStarted(sharerUserId: string): Promise<void> {
    console.log('[ScreenShare] Remote share started by', sharerUserId, '— creating offer');
    this.sharerUserId = sharerUserId;
    const pc = await this._createPeerConnection(sharerUserId);

    // Use offerToReceiveVideo to include a video media line in the offer.
    // This tells the browser we want to receive video, so the sharer can
    // attach their video track in the answer.
    const offer = await pc.createOffer({ offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);

    // Send the offer immediately — ICE candidates will be trickled separately
    // via onicecandidate as they are gathered.
    console.log('[ScreenShare] Sending offer to', sharerUserId);
    this.client.sendRtcSignal(sharerUserId, { type: 'offer', sdp: offer.sdp! });
  }

  // Called when a remote user stops sharing
  onRemoteShareStopped(): void {
    this.sharerUserId = null;
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.callbacks.onRemoteStreamEnded();
  }

  // Called when we receive an RTC signal (offer or answer)
  async onRtcSignal(fromUserId: string, signal: { type: 'offer' | 'answer'; sdp: string }): Promise<void> {
    console.log('[ScreenShare] Received RTC signal:', signal.type, 'from', fromUserId);
    if (signal.type === 'offer') {
      // We are the sharer, a viewer sent us an offer
      const pc = await this._createPeerConnection(fromUserId);

      // Set remote description FIRST so the browser knows about the offer's media lines,
      // then add our local tracks so they're properly associated with the transceivers.
      await pc.setRemoteDescription(new RTCSessionDescription(signal));

      // Add our local stream tracks to the connection
      const trackCount = this.localStream?.getTracks().length || 0;
      console.log('[ScreenShare] Adding', trackCount, 'local tracks to peer connection');
      this.localStream?.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send the answer immediately — ICE candidates will be trickled separately
      // via onicecandidate as they are gathered.
      console.log('[ScreenShare] Sending answer to', fromUserId);
      this.client.sendRtcSignal(fromUserId, { type: 'answer', sdp: pc.localDescription!.sdp });
    } else if (signal.type === 'answer') {
      // We are the viewer, the sharer sent us an answer
      const pc = this.peerConnections.get(fromUserId);
      if (pc) {
        console.log('[ScreenShare] Setting remote description (answer) from', fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else {
        console.warn('[ScreenShare] No peer connection found for answer from', fromUserId);
      }
    }
  }

  // Called when we receive an ICE candidate
  async onRtcIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(fromUserId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (_e) {
        // Ignore ICE candidate errors (can happen during renegotiation)
      }
    } else {
      console.warn('[ScreenShare] No peer connection for ICE candidate from', fromUserId);
    }
  }

  private async _createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    // Close existing connection if any
    this.peerConnections.get(peerId)?.close();

    const iceConfig = await this.getIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    this.peerConnections.set(peerId, pc);
    console.log('[ScreenShare] Created peer connection for', peerId);

    // Send ICE candidates to the peer via signaling (trickle ICE).
    // Each candidate is sent individually as it's gathered.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.client.sendRtcIceCandidate(peerId, event.candidate.toJSON());
      }
    };

    // When we receive a remote track (viewer side)
    pc.ontrack = (event) => {
      console.log('[ScreenShare] ontrack fired — received remote stream from', peerId);
      if (event.streams[0]) {
        this.callbacks.onRemoteStream(event.streams[0], peerId);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[ScreenShare] Connection state:', pc.connectionState, 'for peer', peerId);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peerConnections.delete(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ScreenShare] ICE connection state:', pc.iceConnectionState, 'for peer', peerId);
    };

    pc.onsignalingstatechange = () => {
      console.log('[ScreenShare] Signaling state:', pc.signalingState, 'for peer', peerId);
    };

    return pc;
  }

  destroy(): void {
    this.stopSharing();
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
  }

  get sharing(): boolean {
    return this.isSharing;
  }

  get currentSharerUserId(): string | null {
    return this.sharerUserId;
  }

  get myId(): string {
    return this.myUserId;
  }
}
