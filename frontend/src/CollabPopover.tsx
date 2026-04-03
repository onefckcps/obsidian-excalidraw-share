import { useEffect, useRef } from 'react';
import type { Theme } from '@excalidraw/excalidraw/element/types';
import type { CollaboratorInfo } from './types';

// Replicate Excalidraw's getClientColor algorithm so our popover colors
// match the native user badge colors exactly.
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

interface CollabPopoverProps {
  theme: Theme;
  isConnected: boolean;
  collaborators: CollaboratorInfo[];
  displayName: string;
  followingUserId: string | null;
  onLeave: () => void;
  onStartFollowing: (userId: string) => void;
  onStopFollowing: () => void;
  onClose: () => void;
  isPhone?: boolean;
  /** Whether to use bottom-sheet style (only relevant when isPhone=true) */
  useBottomSheet?: boolean;
  /** Called when user toggles the bottom-sheet preference on mobile */
  onToggleBottomSheet?: (value: boolean) => void;
}

function CollabPopover({
  theme,
  isConnected,
  collaborators,
  displayName,
  followingUserId,
  onLeave,
  onStartFollowing,
  onStopFollowing,
  onClose,
  isPhone = false,
  useBottomSheet = true,
  onToggleBottomSheet,
}: CollabPopoverProps) {
  const isDark = theme === 'dark';
  const popoverRef = useRef<HTMLDivElement>(null);

  // Effective bottom-sheet mode: only when on phone AND useBottomSheet is true
  const isBottomSheet = isPhone && useBottomSheet;

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Bottom sheet style (phone + useBottomSheet=true)
  // Dropdown style (desktop/tablet, or phone with useBottomSheet=false)
  const popoverStyle: React.CSSProperties = isBottomSheet
    ? {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1001,
        backgroundColor: isDark ? '#232323' : '#fff',
        borderTop: `1px solid ${isDark ? '#444' : '#ddd'}`,
        borderRadius: '16px 16px 0 0',
        boxShadow: isDark
          ? '0 -8px 24px rgba(0,0,0,0.5)'
          : '0 -8px 24px rgba(0,0,0,0.15)',
        padding: '8px 16px 24px',
        maxHeight: '60vh',
        overflowY: 'auto',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }
    : {
        position: 'absolute',
        top: '48px',
        right: '8px',
        zIndex: 1000,
        backgroundColor: isDark ? '#232323' : '#fff',
        border: `1px solid ${isDark ? '#444' : '#ddd'}`,
        borderRadius: '12px',
        boxShadow: isDark
          ? '0 8px 24px rgba(0,0,0,0.5)'
          : '0 8px 24px rgba(0,0,0,0.15)',
        padding: '12px',
        minWidth: '220px',
        maxWidth: '300px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      };

  return (
    <>
      {/* Backdrop overlay on bottom sheet */}
      {isBottomSheet && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
          }}
          onClick={onClose}
        />
      )}
    <div
      ref={popoverRef}
      style={popoverStyle}
    >
      {/* Drag handle on bottom sheet */}
      {isBottomSheet && (
        <div style={{
          width: 40,
          height: 4,
          borderRadius: 2,
          background: isDark ? '#555' : '#ccc',
          margin: '4px auto 12px',
        }} />
      )}
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: `1px solid ${isDark ? '#333' : '#eee'}`,
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#4CAF50' : '#ff9800',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: isDark ? '#e0e0e0' : '#333',
        }}>
          Live Session
        </span>
        <span style={{
          fontSize: '12px',
          color: isDark ? '#888' : '#999',
          marginLeft: 'auto',
        }}>
          {collaborators.length} {collaborators.length === 1 ? 'user' : 'users'}
        </span>
      </div>

      {/* Participants */}
      <div style={{ marginBottom: '12px' }}>
        {collaborators.map((c) => {
          const isFollowing = followingUserId === c.id;
          const isSelf = c.name === displayName;
          const color = getClientColor(c.id);

          return (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '8px',
                backgroundColor: isFollowing
                  ? (isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)')
                  : 'transparent',
                cursor: isSelf ? 'default' : 'pointer',
                transition: 'background-color 0.15s',
              }}
              onClick={() => {
                if (isSelf) return;
                if (isFollowing) {
                  onStopFollowing();
                } else {
                  onStartFollowing(c.id);
                }
              }}
              onMouseEnter={(e) => {
                if (!isSelf && !isFollowing) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isFollowing) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                }
              }}
              title={isSelf ? 'You' : (isFollowing ? 'Click to stop following' : `Click to follow ${c.name}`)}
            >
              {/* Color dot */}
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: color,
                flexShrink: 0,
                border: `2px solid ${color}`,
              }} />

              {/* Name */}
              <span style={{
                fontSize: '13px',
                color: isDark ? '#e0e0e0' : '#333',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {c.name}
                {isSelf && (
                  <span style={{ color: isDark ? '#888' : '#999', fontSize: '11px', marginLeft: '4px' }}>
                    (you)
                  </span>
                )}
              </span>

              {/* Follow indicator */}
              {!isSelf && (
                <span style={{
                  fontSize: '11px',
                  color: isFollowing ? '#4CAF50' : (isDark ? '#666' : '#bbb'),
                  flexShrink: 0,
                }}>
                  {isFollowing ? '👁 Following' : '👁'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Following banner */}
      {followingUserId && (
        <div style={{
          padding: '6px 10px',
          borderRadius: '8px',
          backgroundColor: isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{ fontSize: '12px', color: isDark ? '#aaa' : '#666' }}>
            👁 Following {collaborators.find((c) => c.id === followingUserId)?.name || 'user'}
          </span>
          <button
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: isDark ? '#aaa' : '#666',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 4px',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onStopFollowing();
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Leave button */}
      <button
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: '8px',
          border: `1px solid ${isDark ? '#555' : '#ddd'}`,
          backgroundColor: isDark ? '#333' : '#f5f5f5',
          color: '#f44336',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          transition: 'background-color 0.15s',
        }}
        onClick={onLeave}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            isDark ? '#442222' : '#ffebee';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            isDark ? '#333' : '#f5f5f5';
        }}
      >
        Leave Session
      </button>

      {/* Mobile display style toggle — only shown on phone */}
      {isPhone && onToggleBottomSheet && (
        <div style={{
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: `1px solid ${isDark ? '#333' : '#eee'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '11px',
            color: isDark ? '#777' : '#aaa',
          }}>
            Bottom sheet on mobile
          </span>
          {/* Toggle switch */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBottomSheet(!useBottomSheet);
            }}
            title={useBottomSheet ? 'Switch to dropdown style' : 'Switch to bottom sheet style'}
            style={{
              position: 'relative',
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: useBottomSheet
                ? (isDark ? '#4CAF50' : '#4CAF50')
                : (isDark ? '#555' : '#ccc'),
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'background-color 0.2s',
            }}
          >
            <span style={{
              position: 'absolute',
              top: '2px',
              left: useBottomSheet ? '18px' : '2px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>
      )}
    </div>
    </>
  );
}

export default CollabPopover;
