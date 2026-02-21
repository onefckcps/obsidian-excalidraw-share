import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Drawing {
  id: string
  created_at: string
  size_bytes: number
  source_path: string | null
}

function AdminPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('excalidraw-api-key') || '')
  const [showApiInput, setShowApiInput] = useState(!apiKey)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchDrawings = () => {
    if (!apiKey) return

    fetch('/api/drawings', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
      .then((res) => {
        if (res.status === 401) {
          setError('Invalid API key')
          setShowApiInput(true)
          return
        }
        if (!res.ok) throw new Error('Failed to load drawings')
        return res.json()
      })
      .then((data) => {
        setDrawings(data?.drawings || [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }

  useEffect(() => {
    if (apiKey) {
      fetchDrawings()
    } else {
      setLoading(false)
    }
  }, [apiKey])

  const handleApiKeySave = (e: React.FormEvent) => {
    e.preventDefault()
    localStorage.setItem('excalidraw-api-key', apiKey)
    setShowApiInput(false)
    fetchDrawings()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this drawing? This cannot be undone.')) {
      return
    }

    setDeleting(id)
    try {
      const res = await fetch(`/api/drawings/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      if (!res.ok) throw new Error('Failed to delete')

      setDrawings(drawings.filter(d => d.id !== id))
    } catch (err) {
      alert('Failed to delete drawing')
    } finally {
      setDeleting(null)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileName = (path: string | null) => {
    if (!path) return 'Untitled'
    return path.split('/').pop() || 'Untitled'
  }

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={styles.text}>Loading...</p>
      </div>
    )
  }

  if (showApiInput) {
    return (
      <div style={styles.container}>
        <div style={styles.loginBox}>
          <h2 style={styles.loginTitle}>Admin Access</h2>
          <p style={styles.loginDesc}>Enter your API key to manage drawings</p>
          <form onSubmit={handleApiKeySave}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key"
              style={styles.input}
              autoFocus
            />
            <button type="submit" style={styles.loginBtn}>
              Continue
            </button>
          </form>
          <Link to="/" style={styles.backLink}>← Back to drawings</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <Link to="/" style={styles.logo}>Excalidraw Share</Link>
        <nav style={styles.nav}>
          <Link to="/drawings" style={styles.navLink}>Browse</Link>
        </nav>
      </header>

      <main style={styles.main}>
        <div style={styles.titleRow}>
          <h1 style={styles.title}>Manage Drawings</h1>
          <button
            onClick={() => { localStorage.removeItem('excalidraw-api-key'); setApiKey(''); setShowApiInput(true); }}
            style={styles.logoutBtn}
          >
            Change API Key
          </button>
        </div>

        {error && (
          <div style={styles.error}>{error}</div>
        )}

        {drawings.length === 0 ? (
          <div style={styles.empty}>
            <p>No drawings found.</p>
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Size</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drawings.map(drawing => (
                <tr key={drawing.id} style={styles.tr}>
                  <td style={styles.td}>
                    <Link to={`/d/${drawing.id}`} style={styles.idLink}>
                      {drawing.id}
                    </Link>
                  </td>
                  <td style={styles.td}>{getFileName(drawing.source_path)}</td>
                  <td style={styles.td}>{formatDate(drawing.created_at)}</td>
                  <td style={styles.td}>{formatSize(drawing.size_bytes)}</td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleDelete(drawing.id)}
                      disabled={deleting === drawing.id}
                      style={styles.deleteBtn}
                    >
                      {deleting === drawing.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  logo: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    textDecoration: 'none',
  },
  nav: {
    display: 'flex',
    gap: '16px',
  },
  navLink: {
    color: '#1976d2',
    textDecoration: 'none',
    fontSize: '14px',
  },
  main: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '24px',
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    margin: 0,
    color: '#333',
  },
  logoutBtn: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#666',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#f5f5f5',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #e0e0e0',
    borderTopColor: '#333',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  text: {
    marginTop: '16px',
    color: '#666',
  },
  loginBox: {
    maxWidth: '400px',
    margin: '100px auto',
    padding: '32px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    textAlign: 'center',
  },
  loginTitle: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    color: '#333',
  },
  loginDesc: {
    margin: '0 0 24px 0',
    color: '#666',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    marginBottom: '16px',
    boxSizing: 'border-box',
  },
  loginBtn: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    backgroundColor: '#1976d2',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  backLink: {
    display: 'block',
    marginTop: '16px',
    color: '#666',
    textDecoration: 'none',
    fontSize: '14px',
  },
  error: {
    padding: '12px 16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    marginBottom: '16px',
  },
  empty: {
    textAlign: 'center',
    padding: '48px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    color: '#666',
  },
  table: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '8px',
    borderCollapse: 'collapse',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    backgroundColor: '#f5f5f5',
    fontWeight: '600',
    fontSize: '14px',
    color: '#666',
    borderBottom: '1px solid #eee',
  },
  tr: {
    borderBottom: '1px solid #eee',
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#333',
  },
  idLink: {
    color: '#1976d2',
    textDecoration: 'none',
    fontFamily: 'monospace',
    fontSize: '13px',
  },
  deleteBtn: {
    padding: '6px 12px',
    backgroundColor: '#d32f2f',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
}

export default AdminPage
