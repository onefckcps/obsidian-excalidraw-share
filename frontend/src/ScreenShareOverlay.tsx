import { useEffect, useRef, useState, useCallback } from 'react';
import type { Theme } from '@excalidraw/excalidraw/element/types';

// Replicate Excalidraw's getClientColor algorithm (same as CollabPopover.tsx)
function hashToInteger(id: string): number {
  let hash = 0;
  if (id.length === 0) return hash;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
  }
  return hash;
}

function getClientColor(id: string): string {
  const hash = Math.abs(hashToInteger(id));
  const hue = (hash % 37) * 10;
  return `hsl(${hue}, 100%, 83%)`;
}

interface ScreenShareOverlayProps {
  theme: Theme;
  stream: MediaStream;
  sharerName: string;
  sharerUserId: string;
  onClose: () => void;
}

function ScreenShareOverlay({
  theme,
  stream,
  sharerName,
  sharerUserId,
  onClose,
}: ScreenShareOverlayProps) {
  const isDark = theme === 'dark';
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Dragging state (refs to avoid re-renders)
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Resizing state
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Position and size state
  const defaultWidth = Math.max(320, Math.round(window.innerWidth * 0.3));
  const [pos, setPos] = useState({
    x: window.innerWidth - defaultWidth - 24,
    y: window.innerHeight - Math.round(defaultWidth * 0.5625) - 80, // 16:9 ratio
  });
  const [size, setSize] = useState({
    w: defaultWidth,
    h: Math.round(defaultWidth * 0.5625),
  });

  // Attach stream to video element — videoRef is always mounted so this only
  // needs to run when the stream prop changes.
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const tracks = stream.getVideoTracks();
      console.log('[ScreenShareOverlay] Attaching stream with', tracks.length, 'video tracks');
      tracks.forEach((t, i) => {
        console.log(`[ScreenShareOverlay] Track ${i}: enabled=${t.enabled}, muted=${t.muted}, readyState=${t.readyState}, settings=`, t.getSettings());
      });
      video.srcObject = stream;
      // Ensure playback starts — some browsers ignore autoPlay for WebRTC streams
      video.play().catch((err) => {
        console.warn('[ScreenShareOverlay] play() failed:', err);
      });
      video.onloadedmetadata = () => {
        console.log('[ScreenShareOverlay] Video metadata loaded:', video.videoWidth, 'x', video.videoHeight);
      };
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Re-trigger play() when restoring from minimized state (some browsers pause
  // hidden video elements).
  useEffect(() => {
    if (!isMinimized) {
      const video = videoRef.current;
      if (video && video.srcObject) {
        video.play().catch(() => {/* ignore */});
      }
    }
  }, [isMinimized]);

  // Helper: get pointer position from mouse or touch event
  const getEventPos = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  };

  // Drag start — shared logic for mouse and touch
  const startDrag = useCallback((clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffsetRef.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    }
  }, []);

  // Mouse drag handler on title bar / bubble
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  }, [startDrag]);

  // Touch drag handler on title bar / bubble
  const handleTitleTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, [startDrag]);

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const pt = getEventPos(e);
      if (!pt) return;

      if (isDraggingRef.current) {
        if ('touches' in e) e.preventDefault();
        const newX = pt.x - dragOffsetRef.current.x;
        const newY = pt.y - dragOffsetRef.current.y;
        // Clamp to viewport — use bubble width (200px) when minimized
        const currentW = isMinimized ? 200 : size.w;
        const clampedX = Math.max(0, Math.min(window.innerWidth - currentW, newX));
        const clampedY = Math.max(0, Math.min(window.innerHeight - 36, newY));
        setPos({ x: clampedX, y: clampedY });
      } else if (isResizingRef.current) {
        const dx = pt.x - resizeStartRef.current.x;
        const dy = pt.y - resizeStartRef.current.y;
        const newW = Math.max(240, resizeStartRef.current.w + dx);
        const newH = Math.max(135, resizeStartRef.current.h + dy);
        setSize({ w: newW, h: newH });
      }
    };

    const handleEnd = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
    };
  }, [size.w, isMinimized]);

  // Resize handle — shared start logic
  const startResize = useCallback((clientX: number, clientY: number) => {
    isResizingRef.current = true;
    resizeStartRef.current = {
      x: clientX,
      y: clientY,
      w: size.w,
      h: size.h,
    };
  }, [size.w, size.h]);

  // Resize handle mouse down
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startResize(e.clientX, e.clientY);
  }, [startResize]);

  // Resize handle touch start
  const handleResizeTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    startResize(e.touches[0].clientX, e.touches[0].clientY);
  }, [startResize]);

  // Fullscreen
  const handleFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.requestFullscreen) {
        video.requestFullscreen().catch(() => {/* ignore */});
      }
    }
  }, []);

  // Picture-in-Picture
  const handlePiP = useCallback(async () => {
    const video = videoRef.current;
    if (video && document.pictureInPictureEnabled) {
      try {
        if (document.pictureInPictureElement === video) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch (_e) {
        // PiP not supported or failed
      }
    }
  }, []);

  const borderColor = getClientColor(sharerUserId);

  // ── Shared button style ────────────────────────────────────────────────────
  const iconBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: '4px',
    fontSize: '13px',
    color: isDark ? '#aaa' : '#666',
    lineHeight: 1,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // ── Container style switches between bubble pill and full overlay ──────────
  const containerStyle: React.CSSProperties = isMinimized
    ? {
        // Bubble / pill
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: 'auto',
        maxWidth: '200px',
        height: '36px',
        zIndex: 1100,
        backgroundColor: isDark ? '#2b2b2b' : '#f5f5f5',
        border: `2px solid ${borderColor}`,
        borderRadius: '18px',
        boxShadow: isDark
          ? '0 4px 16px rgba(0,0,0,0.6)'
          : '0 4px 16px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 8px 0 10px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
        cursor: 'grab',
        touchAction: 'none',
        overflow: 'hidden',
      }
    : {
        // Full overlay
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        zIndex: 1100,
        backgroundColor: isDark ? '#1e1e1e' : '#fff',
        border: `2px solid ${borderColor}`,
        borderRadius: '8px',
        boxShadow: isDark
          ? '0 8px 32px rgba(0,0,0,0.7)'
          : '0 8px 32px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
        touchAction: 'none',
      };

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      onMouseDown={isMinimized ? handleTitleMouseDown : undefined}
      onTouchStart={isMinimized ? handleTitleTouchStart : undefined}
    >
      {/* ── BUBBLE contents (only visible when minimized) ── */}
      {isMinimized && (
        <>
          {/* Colored dot */}
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: borderColor,
            flexShrink: 0,
          }} />

          {/* Screen icon + name */}
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isDark ? '#e0e0e0' : '#333',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={`${sharerName} is sharing their screen`}
          >
            📺 {sharerName}
          </span>

          {/* Restore */}
          <button
            style={iconBtnStyle}
            title="Restore"
            onClick={() => setIsMinimized(false)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ▲
          </button>

          {/* Close */}
          <button
            style={{ ...iconBtnStyle, color: '#f44336' }}
            title="Close"
            onClick={onClose}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#442222' : '#ffebee'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ✕
          </button>
        </>
      )}

      {/* ── FULL OVERLAY contents (hidden when minimized, but DOM stays mounted) ── */}
      <div style={{ display: isMinimized ? 'none' : 'contents' }}>
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 8px',
            backgroundColor: isDark ? '#2b2b2b' : '#f5f5f5',
            borderBottom: `1px solid ${isDark ? '#333' : '#e0e0e0'}`,
            cursor: 'grab',
            height: '36px',
            boxSizing: 'border-box',
          }}
          onMouseDown={handleTitleMouseDown}
          onTouchStart={handleTitleTouchStart}
        >
          {/* Colored dot */}
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: borderColor,
            flexShrink: 0,
          }} />

          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isDark ? '#e0e0e0' : '#333',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`${sharerName} is sharing their screen`}
          >
            📺 {sharerName}
          </span>

          {/* Minimize → bubble */}
          <button
            style={iconBtnStyle}
            title="Minimize to bubble"
            onClick={() => setIsMinimized(true)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ▼
          </button>

          {/* Fullscreen */}
          <button
            style={iconBtnStyle}
            title="Fullscreen"
            onClick={handleFullscreen}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ⛶
          </button>

          {/* Picture-in-Picture */}
          <button
            style={iconBtnStyle}
            title="Picture-in-Picture"
            onClick={handlePiP}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ⧉
          </button>

          {/* Close */}
          <button
            style={{ ...iconBtnStyle, color: '#f44336' }}
            title="Close"
            onClick={onClose}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#442222' : '#ffebee'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Video — always mounted to keep srcObject alive; hidden via display:none when minimized */}
      <video
        ref={videoRef}
        style={{
          display: isMinimized ? 'none' : 'block',
          width: '100%',
          height: isMinimized ? 0 : size.h,
          objectFit: 'contain',
          backgroundColor: '#000',
        }}
        autoPlay
        playsInline
        muted
      />

      {/* Resize handle (bottom-right corner) — hidden when minimized.
          32×32px touch target, visual indicator aligned to corner. */}
      {!isMinimized && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '32px',
            height: '32px',
            cursor: 'nwse-resize',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: '2px',
            color: isDark ? '#555' : '#bbb',
            fontSize: '10px',
            lineHeight: 1,
            userSelect: 'none',
            touchAction: 'none',
          }}
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          title="Resize"
        >
          ◢
        </div>
      )}
    </div>
  );
}

export default ScreenShareOverlay;
