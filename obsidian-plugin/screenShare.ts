// ──────────────────────────────────────────────
// ScreenShareManager — WebRTC screen sharing for the Obsidian plugin
//
// Uses Electron's desktopCapturer API for capturing screens/windows,
// and RTCPeerConnection for peer-to-peer video streaming.
// Signaling goes through the existing CollabClient WebSocket.
// ──────────────────────────────────────────────

import { App, Modal, Notice } from 'obsidian';
import type { CollabClient } from './collabClient';

const FALLBACK_ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export interface ScreenShareCallbacks {
  onRemoteStream: (stream: MediaStream, sharerUserId: string, sharerName: string) => void;
  onRemoteStreamEnded: () => void;
  onSharingStarted: () => void;
  onSharingStopped: () => void;
}

export class ScreenShareManager {
  private app: App;
  private client: CollabClient;
  private baseUrl: string;
  private apiKey: string;
  private callbacks: ScreenShareCallbacks;
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private isSharing = false;
  /** Name of the remote sharer (for viewer modal title) */
  private sharerName = '';
  private iceConfig: RTCConfiguration | null = null;

  constructor(app: App, client: CollabClient, baseUrl: string, apiKey: string, callbacks: ScreenShareCallbacks) {
    this.app = app;
    this.client = client;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  private async fetchIceConfig(): Promise<RTCConfiguration> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ice-config`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) throw new Error('Failed to fetch ICE config');
      return await response.json();
    } catch {
      return FALLBACK_ICE_CONFIG;
    }
  }

  private async getIceConfig(): Promise<RTCConfiguration> {
    if (!this.iceConfig) {
      this.iceConfig = await this.fetchIceConfig();
    }
    return this.iceConfig;
  }

  /**
   * Start sharing — shows Electron source picker, then starts WebRTC.
   */
  async startSharing(): Promise<void> {
    try {
      // Use Electron's desktopCapturer (available in Obsidian's Electron environment)
      let desktopCapturer: any;
      try {
        desktopCapturer = (window as any).require('electron').desktopCapturer;
      } catch (e) {
        new Notice('Screen sharing is only available in the Obsidian desktop app.');
        return;
      }

      if (!desktopCapturer) {
        new Notice('Screen sharing is not available in this environment.');
        return;
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });

      if (sources.length === 0) {
        new Notice('No screens or windows available to share.');
        return;
      }

      // Show source picker modal
      const selectedSource = await new Promise<any | null>((resolve) => {
        new SourcePickerModal(this.app, sources, resolve).open();
      });

      if (!selectedSource) return; // User cancelled

      // Get stream using the selected source via Electron-specific constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // @ts-ignore — Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id,
          },
        },
        audio: false,
      });

      this.localStream = stream;

      // Handle user stopping share via OS (track ending)
      stream.getVideoTracks()[0].onended = () => {
        this.stopSharing();
      };

      this.isSharing = true;
      this.client.sendScreenShareStart();
      this.callbacks.onSharingStarted();
      new Notice('Screen sharing started.');
    } catch (err) {
      console.error('[ExcaliShare ScreenShare] Failed to start:', err);
      new Notice(`Screen sharing failed: ${(err as Error).message}`);
    }
  }

  /**
   * Stop sharing and clean up all peer connections.
   */
  stopSharing(): void {
    if (!this.isSharing) return;
    this.isSharing = false;

    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    this.client.sendScreenShareStop();
    this.callbacks.onSharingStopped();
    new Notice('Screen sharing stopped.');
  }

  /**
   * Called when a remote user starts sharing — we (as viewer) initiate WebRTC offer.
   */
  async onRemoteShareStarted(sharerUserId: string, sharerName: string): Promise<void> {
    this.sharerName = sharerName;
    const pc = await this._createPeerConnection(sharerUserId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.client.sendRtcSignal(sharerUserId, { type: 'offer', sdp: offer.sdp! });
  }

  /**
   * Called when the remote sharer stops sharing.
   */
  onRemoteShareStopped(): void {
    this.sharerName = '';
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.callbacks.onRemoteStreamEnded();
  }

  /**
   * Handle an incoming WebRTC signal (offer or answer).
   */
  async onRtcSignal(fromUserId: string, signal: { type: 'offer' | 'answer'; sdp: string }): Promise<void> {
    if (signal.type === 'offer') {
      // We are the sharer — a viewer sent us an offer
      const pc = await this._createPeerConnection(fromUserId);

      // Add our local tracks to the connection
      this.localStream?.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.client.sendRtcSignal(fromUserId, { type: 'answer', sdp: answer.sdp! });
    } else if (signal.type === 'answer') {
      // We are the viewer — the sharer sent us an answer
      const pc = this.peerConnections.get(fromUserId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      }
    }
  }

  /**
   * Handle an incoming ICE candidate.
   */
  async onRtcIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(fromUserId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        // Ignore ICE errors during renegotiation
      }
    }
  }

  private async _createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    // Close any existing connection to this peer
    this.peerConnections.get(peerId)?.close();

    const iceConfig = await this.getIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.client.sendRtcIceCandidate(peerId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      if (event.streams[0]) {
        this.callbacks.onRemoteStream(event.streams[0], peerId, this.sharerName);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peerConnections.delete(peerId);
      }
    };

    return pc;
  }

  /**
   * Clean up all resources. Call when leaving the collab session.
   */
  destroy(): void {
    this.stopSharing();
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
  }

  get sharing(): boolean {
    return this.isSharing;
  }
}

// ──────────────────────────────────────────────
// Source picker modal — shows thumbnails of available screens/windows
// ──────────────────────────────────────────────

class SourcePickerModal extends Modal {
  private sources: any[]; // Electron.DesktopCapturerSource[]
  private onSelect: (source: any | null) => void;

  constructor(app: App, sources: any[], onSelect: (source: any | null) => void) {
    super(app);
    this.sources = sources;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText('Choose what to share');

    const grid = contentEl.createDiv({
      attr: {
        style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; padding: 16px;',
      },
    });

    for (const source of this.sources) {
      const card = grid.createDiv({
        attr: {
          style: 'cursor: pointer; border: 2px solid transparent; border-radius: 8px; overflow: hidden; transition: border-color 0.15s;',
        },
      });

      card.addEventListener('mouseenter', () => {
        card.style.borderColor = '#4CAF50';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'transparent';
      });

      // Thumbnail
      if (source.thumbnail) {
        card.createEl('img', {
          attr: {
            src: source.thumbnail.toDataURL(),
            style: 'width: 100%; display: block; border-radius: 6px 6px 0 0;',
          },
        });
      }

      // Name label
      card.createDiv({
        text: source.name,
        attr: {
          style: 'padding: 8px; font-size: 12px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
        },
      });

      card.addEventListener('click', () => {
        this.onSelect(source);
        this.close();
      });
    }

    // Cancel button
    const cancelBtn = contentEl.createEl('button', {
      text: 'Cancel',
      attr: {
        style: 'display: block; margin: 0 auto 16px; padding: 8px 24px; cursor: pointer;',
      },
    });
    cancelBtn.addEventListener('click', () => {
      this.onSelect(null);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ──────────────────────────────────────────────
// Screen share viewer modal — shows incoming video stream
// ──────────────────────────────────────────────

export class ScreenShareViewerModal extends Modal {
  private stream: MediaStream;
  private sharerName: string;
  private videoEl: HTMLVideoElement | null = null;

  constructor(app: App, stream: MediaStream, sharerName: string) {
    super(app);
    this.stream = stream;
    this.sharerName = sharerName;
    this.modalEl.style.width = '80vw';
    this.modalEl.style.maxWidth = '1200px';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText(`📺 ${this.sharerName} is sharing their screen`);

    this.videoEl = contentEl.createEl('video', {
      attr: {
        autoplay: '',
        playsinline: '',
        muted: '',
        style: 'width: 100%; border-radius: 8px; background: #000; display: block;',
      },
    }) as HTMLVideoElement;

    this.videoEl.srcObject = this.stream;
  }

  onClose() {
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.contentEl.empty();
  }

  /**
   * Update the video stream (e.g., if the sharer restarts sharing).
   */
  updateStream(stream: MediaStream) {
    this.stream = stream;
    if (this.videoEl) {
      this.videoEl.srcObject = stream;
    }
  }
}
