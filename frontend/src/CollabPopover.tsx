import { useEffect, useRef } from 'react';
import type { Theme } from '@excalidraw/excalidraw/types/element/types';
import type { CollaboratorInfo } from './types';

const COLLAB_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#DDA0DD', // Plum
  '#F7DC6F', // Gold
  '#E89156', // Orange
  '#98D8C8', // Mint
];

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
}: CollabPopoverProps) {
  const isDark = theme === 'dark';
  const popoverRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={popoverRef}
      style={{
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
      }}
    >
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
          const color = COLLAB_COLORS[c.colorIndex % COLLAB_COLORS.length];

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
    </div>
  );
}

export default CollabPopover;
