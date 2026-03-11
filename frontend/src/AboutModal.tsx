interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
  theme?: 'light' | 'dark'
}

function AboutModal({ isOpen, onClose, theme = 'light' }: AboutModalProps) {
  if (!isOpen) return null

  const isDark = theme === 'dark'

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
    modal: {
      backgroundColor: isDark ? '#2b2b2b' : '#fff',
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '400px',
      width: '90%',
      textAlign: 'center',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    },
    icon: {
      fontSize: '48px',
      marginBottom: '12px',
    },
    title: {
      fontSize: '24px',
      fontWeight: 'bold',
      color: isDark ? '#e0e0e0' : '#333',
      margin: '0 0 8px 0',
    },
    version: {
      fontSize: '14px',
      color: isDark ? '#888' : '#666',
      margin: '0 0 16px 0',
    },
    description: {
      fontSize: '14px',
      color: isDark ? '#aaa' : '#666',
      lineHeight: 1.5,
      margin: '0 0 20px 0',
    },
    link: {
      display: 'inline-block',
      color: '#1976d2',
      textDecoration: 'none',
      fontSize: '14px',
      marginBottom: '20px',
    },
    linkHover: {
      textDecoration: 'underline',
    },
    closeBtn: {
      padding: '10px 24px',
      borderRadius: '6px',
      border: `1px solid ${isDark ? '#444' : '#ddd'}`,
      background: isDark ? '#333' : '#f5f5f5',
      color: isDark ? '#e0e0e0' : '#333',
      cursor: 'pointer',
      fontSize: '14px',
    },
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        <div style={styles.icon}>🎨</div>
        <h2 style={styles.title}>ExcaliShare</h2>
        <p style={styles.version}>v1.0.1</p>
        <p style={styles.description}>
          Self-hosted Excalidraw sharing solution.<br />
          Share your drawings from Obsidian easily.
        </p>
        <a
          href="https://github.com/onefckcps/obsidian-excalidraw-share"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          View on GitHub →
        </a>
        <br />
        <button style={styles.closeBtn} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default AboutModal
