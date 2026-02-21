import { Link } from 'react-router-dom'

function Landing() {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>Excalidraw Share</h1>
        <p style={styles.subtitle}>
          Self-hosted Excalidraw drawing viewer
        </p>
        <div style={styles.info}>
          <p>
            This is a self-hosted instance of the Excalidraw viewer.
          </p>
          <p style={styles.hint}>
            To share a drawing from Obsidian, use the "Share Drawing" 
            script in the Excalidraw plugin.
          </p>
          <div style={styles.links}>
            <Link to="/drawings" style={styles.link}>Browse Drawings</Link>
            <Link to="/admin" style={styles.link}>Admin</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#fafafa',
    padding: '20px',
  },
  content: {
    textAlign: 'center',
    maxWidth: '500px',
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '1.1rem',
    color: '#666',
    marginBottom: '32px',
  },
  info: {
    padding: '24px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    textAlign: 'left',
  },
  hint: {
    marginTop: '16px',
    color: '#666',
    fontSize: '0.95rem',
    lineHeight: '1.6',
  },
  links: {
    display: 'flex',
    gap: '16px',
    marginTop: '24px',
  },
  link: {
    padding: '10px 20px',
    backgroundColor: '#1976d2',
    color: '#fff',
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
  },
}

export default Landing
