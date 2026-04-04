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

  // Attach stream to video element
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

  // Drag handlers
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // Don't drag when clicking buttons
    e.preventDefault();
    isDraggingRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const newX = e.clientX - dragOffsetRef.current.x;
        const newY = e.clientY - dragOffsetRef.current.y;
        // Clamp to viewport
        const clampedX = Math.max(0, Math.min(window.innerWidth - size.w, newX));
        const clampedY = Math.max(0, Math.min(window.innerHeight - 36, newY));
        setPos({ x: clampedX, y: clampedY });
      } else if (isResizingRef.current) {
        const dx = e.clientX - resizeStartRef.current.x;
        const dy = e.clientY - resizeStartRef.current.y;
        const newW = Math.max(240, resizeStartRef.current.w + dx);
        const newH = Math.max(135, resizeStartRef.current.h + dy);
        setSize({ w: newW, h: newH });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [size.w]);

  // Resize handle mouse down
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.w,
      h: size.h,
    };
  }, [size.w, size.h]);

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

  const containerStyle: React.CSSProperties = {
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
  };

  const titleBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    backgroundColor: isDark ? '#2b2b2b' : '#f5f5f5',
    borderBottom: isMinimized ? 'none' : `1px solid ${isDark ? '#333' : '#e0e0e0'}`,
    cursor: 'grab',
    height: '36px',
    boxSizing: 'border-box',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: isDark ? '#e0e0e0' : '#333',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

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

  const videoStyle: React.CSSProperties = {
    display: isMinimized ? 'none' : 'block',
    width: '100%',
    height: size.h,
    objectFit: 'contain',
    backgroundColor: '#000',
  };

  const resizeHandleStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '16px',
    height: '16px',
    cursor: 'nwse-resize',
    display: isMinimized ? 'none' : 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: isDark ? '#555' : '#bbb',
    fontSize: '10px',
    lineHeight: 1,
    userSelect: 'none',
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* Title bar */}
      <div style={titleBarStyle} onMouseDown={handleTitleMouseDown}>
        {/* Colored dot matching sharer's collab color */}
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: borderColor,
          flexShrink: 0,
        }} />
        <span style={titleStyle} title={`${sharerName} is sharing their screen`}>
          📺 {sharerName}
        </span>

        {/* Minimize/restore */}
        <button
          style={iconBtnStyle}
          title={isMinimized ? 'Restore' : 'Minimize'}
          onClick={() => setIsMinimized(v => !v)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
        >
          {isMinimized ? '▲' : '▼'}
        </button>

        {/* Fullscreen */}
        {!isMinimized && (
          <button
            style={iconBtnStyle}
            title="Fullscreen"
            onClick={handleFullscreen}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ⛶
          </button>
        )}

        {/* Picture-in-Picture */}
        {!isMinimized && (
          <button
            style={iconBtnStyle}
            title="Picture-in-Picture"
            onClick={handlePiP}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark ? '#444' : '#e0e0e0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
          >
            ⧉
          </button>
        )}

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

      {/* Video */}
      <video
        ref={videoRef}
        style={videoStyle}
        autoPlay
        playsInline
        muted
      />

      {/* Resize handle (bottom-right corner) */}
      <div
        style={resizeHandleStyle}
        onMouseDown={handleResizeMouseDown}
        title="Resize"
      >
        ◢
      </div>
    </div>
  );
}

export default ScreenShareOverlay;
