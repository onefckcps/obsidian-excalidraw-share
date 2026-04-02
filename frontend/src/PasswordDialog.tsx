import { useState, useCallback } from 'react';
import type { Theme } from '@excalidraw/excalidraw/element/types';

interface PasswordDialogProps {
  theme: Theme;
  title?: string;
  description?: string;
  error?: string | null;
  onSubmit: (password: string) => void;
  onCancel?: () => void;
}

function PasswordDialog({
  theme,
  title = '🔒 Password Required',
  description = 'This drawing is password-protected. Enter the password to view it.',
  error,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isDark = theme === 'dark';

  const handleSubmit = useCallback(() => {
    if (password.trim()) {
      onSubmit(password);
    }
  }, [password, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape' && onCancel) {
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

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
          {title}
        </h3>
        <p style={{ margin: '0 0 16px 0', color: isDark ? '#aaa' : '#666', fontSize: '14px' }}>
          {description}
        </p>
        {error && (
          <p style={{ margin: '0 0 12px 0', color: '#f44336', fontSize: '13px' }}>
            {error}
          </p>
        )}
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter password..."
            autoFocus
            style={{
              ...styles.input,
              backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
              color: isDark ? '#e0e0e0' : '#333',
              borderColor: error ? '#f44336' : (isDark ? '#444' : '#ddd'),
              paddingRight: '40px',
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              ...styles.toggleButton,
              color: isDark ? '#aaa' : '#666',
            }}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {onCancel && (
            <button
              style={{
                ...styles.button,
                backgroundColor: 'transparent',
                color: isDark ? '#e0e0e0' : '#333',
                border: `1px solid ${isDark ? '#444' : '#ddd'}`,
              }}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button
            style={{
              ...styles.button,
              backgroundColor: '#4CAF50',
              color: '#fff',
              border: 'none',
              opacity: password.trim() ? 1 : 0.5,
              cursor: password.trim() ? 'pointer' : 'not-allowed',
            }}
            onClick={handleSubmit}
            disabled={!password.trim()}
          >
            Unlock
          </button>
        </div>
      </div>
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
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  toggleButton: {
    position: 'absolute' as const,
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '4px',
    lineHeight: 1,
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
};

export default PasswordDialog;
