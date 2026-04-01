import { useState, useCallback } from 'react';
import type { Theme } from '@excalidraw/excalidraw/types/element/types';
import type { CollaboratorInfo } from './types';

interface CollabStatusProps {
  theme: Theme;
  isCollabActive: boolean;
  isJoined: boolean;
  isConnected: boolean;
  collaborators: CollaboratorInfo[];
  participantCount: number;
  displayName: string;
  sessionEnded: { saved: boolean } | null;
  onJoin: (name: string) => void;
  onLeave: () => void;
  onSetName: (name: string) => void;
  onDismissSessionEnded: () => void;
}

function CollabStatus({
  theme,
  isCollabActive,
  isJoined,
  isConnected,
  collaborators,
  participantCount,
  displayName,
  sessionEnded,
  onJoin,
  onLeave,
  onSetName: _onSetName,
  onDismissSessionEnded,
}: CollabStatusProps) {
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  const [showParticipants, setShowParticipants] = useState(false);

  const isDark = theme === 'dark';

  const handleJoin = useCallback(() => {
    const name = nameInput.trim() || 'Anonymous';
    onJoin(name);
    setShowJoinDialog(false);
  }, [nameInput, onJoin]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleJoin();
      } else if (e.key === 'Escape') {
        setShowJoinDialog(false);
      }
    },
    [handleJoin]
  );

  // Session ended notification
  if (sessionEnded) {
    return (
      <div style={styles.overlay}>
        <div
          style={{
            ...styles.dialog,
            backgroundColor: isDark ? '#2b2b2b' : '#fff',
            color: isDark ? '#e0e0e0' : '#333',
          }}
        >
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
            {sessionEnded.saved ? '✅ Session Ended' : '❌ Session Ended'}
          </h3>
          <p style={{ margin: '0 0 16px 0', color: isDark ? '#aaa' : '#666' }}>
            {sessionEnded.saved
              ? 'The collaboration session has ended and changes were saved.'
              : 'The collaboration session has ended. Changes were discarded.'}
          </p>
          <button
            style={{
              ...styles.button,
              backgroundColor: '#4CAF50',
              color: '#fff',
              border: 'none',
            }}
            onClick={onDismissSessionEnded}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // Not active - don't render anything
  if (!isCollabActive && !isJoined) {
    return null;
  }

  // Join dialog
  if (showJoinDialog) {
    return (
      <div style={styles.overlay}>
        <div
          style={{
            ...styles.dialog,
            backgroundColor: isDark ? '#2b2b2b' : '#fff',
            color: isDark ? '#e0e0e0' : '#333',
          }}
        >
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
            🤝 Join Live Session
          </h3>
          <p style={{ margin: '0 0 16px 0', color: isDark ? '#aaa' : '#666', fontSize: '14px' }}>
            Enter your display name to join the collaboration session.
          </p>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Your name..."
            autoFocus
            style={{
              ...styles.input,
              backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
              color: isDark ? '#e0e0e0' : '#333',
              borderColor: isDark ? '#444' : '#ddd',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              style={{
                ...styles.button,
                backgroundColor: 'transparent',
                color: isDark ? '#e0e0e0' : '#333',
                border: `1px solid ${isDark ? '#444' : '#ddd'}`,
              }}
              onClick={() => setShowJoinDialog(false)}
            >
              Cancel
            </button>
            <button
              style={{
                ...styles.button,
                backgroundColor: '#4CAF50',
                color: '#fff',
                border: 'none',
              }}
              onClick={handleJoin}
            >
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Joined state - show status badge
  if (isJoined) {
    return (
      <div
        style={{
          ...styles.badge,
          backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
          borderColor: isDark ? '#444' : '#ddd',
        }}
      >
        <div
          style={{
            ...styles.liveDot,
            backgroundColor: isConnected ? '#4CAF50' : '#ff9800',
          }}
        />
        <span
          style={{
            color: isDark ? '#e0e0e0' : '#333',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer',
          }}
          onClick={() => setShowParticipants(!showParticipants)}
          title="Click to show participants"
        >
          Live · {collaborators.length} {collaborators.length === 1 ? 'user' : 'users'}
        </span>
        <button
          style={{
            ...styles.smallButton,
            backgroundColor: isDark ? '#333' : '#f5f5f5',
            borderColor: isDark ? '#555' : '#ccc',
            color: isDark ? '#e0e0e0' : '#333',
          }}
          onClick={onLeave}
          title="Leave session"
        >
          ✕
        </button>

        {/* Participants dropdown */}
        {showParticipants && (
          <div
            style={{
              ...styles.participantsDropdown,
              backgroundColor: isDark ? '#2b2b2b' : '#fff',
              borderColor: isDark ? '#444' : '#ddd',
            }}
          >
            <div style={{ fontSize: '12px', color: isDark ? '#888' : '#999', marginBottom: '6px' }}>
              Participants
            </div>
            {collaborators.map((c) => (
              <div
                key={c.id}
                style={{
                  fontSize: '13px',
                  color: isDark ? '#e0e0e0' : '#333',
                  padding: '2px 0',
                }}
              >
                👤 {c.name}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Not joined but session is active - show join button
  return (
    <div
      style={{
        ...styles.badge,
        backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
        borderColor: isDark ? '#444' : '#ddd',
      }}
    >
      <div style={{ ...styles.liveDot, backgroundColor: '#f44336' }} />
      <span
        style={{
          color: isDark ? '#e0e0e0' : '#333',
          fontSize: '13px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Live Session · {participantCount} {participantCount === 1 ? 'user' : 'users'}
      </span>
      <button
        style={{
          ...styles.joinButton,
          backgroundColor: '#4CAF50',
        }}
        onClick={() => setShowJoinDialog(true)}
      >
        Join
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '360px',
    width: '90%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid',
    fontSize: '14px',
    marginBottom: '16px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  badge: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderRadius: '20px',
    border: '1px solid',
    zIndex: 100,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  liveDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    animation: 'pulse 2s ease-in-out infinite',
  },
  smallButton: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    cursor: 'pointer',
    border: '1px solid',
    padding: 0,
  },
  joinButton: {
    padding: '4px 12px',
    borderRadius: '12px',
    border: 'none',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  participantsDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    minWidth: '150px',
  },
};

export default CollabStatus;
