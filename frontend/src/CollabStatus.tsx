import { useState, useCallback } from 'react';
import type { Theme } from '@excalidraw/excalidraw/element/types';

interface CollabStatusProps {
  theme: Theme;
  isCollabActive: boolean;
  isJoined: boolean;
  participantCount: number;
  displayName: string;
  sessionEnded: { saved: boolean } | null;
  passwordRequired: boolean;
  passwordError: string | null;
  onJoin: (name: string, password?: string) => void;
  onDismissSessionEnded: () => void;
}

function CollabStatus({
  theme,
  isCollabActive,
  isJoined,
  participantCount,
  displayName,
  sessionEnded,
  passwordRequired,
  passwordError,
  onJoin,
  onDismissSessionEnded,
}: CollabStatusProps) {
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  const [passwordInput, setPasswordInput] = useState('');

  const isDark = theme === 'dark';

  const handleJoin = useCallback(() => {
    const name = nameInput.trim() || 'Anonymous';
    onJoin(name, passwordRequired ? passwordInput : undefined);
    // Only close dialog if no password is required (password errors keep dialog open)
    if (!passwordRequired) {
      setShowJoinDialog(false);
    }
  }, [nameInput, passwordInput, passwordRequired, onJoin]);

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

  // Not active and not joined — don't render anything
  if (!isCollabActive && !isJoined) {
    return null;
  }

  // Already joined — Excalidraw's native UI handles the in-session display
  // (user badges, LiveCollaborationTrigger, CollabPopover)
  if (isJoined) {
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
          {passwordRequired && (
            <>
              <p style={{ margin: '0 0 8px 0', color: isDark ? '#aaa' : '#666', fontSize: '13px' }}>
                🔒 This session requires a password.
              </p>
              {passwordError && (
                <p style={{ margin: '0 0 8px 0', color: '#f44336', fontSize: '13px' }}>
                  ❌ {passwordError}
                </p>
              )}
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Session password..."
                style={{
                  ...styles.input,
                  backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
                  color: isDark ? '#e0e0e0' : '#333',
                  borderColor: isDark ? '#444' : '#ddd',
                }}
              />
            </>
          )}
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

  // Not joined but session is active — show join banner
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
};

export default CollabStatus;
