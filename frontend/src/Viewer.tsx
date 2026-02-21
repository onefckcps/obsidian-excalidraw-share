import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
import DrawingsBrowser from './DrawingsBrowser'

interface ExcalidrawData {
  type: string
  version: number
  elements: ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

function Viewer() {
  const { id } = useParams<{ id: string }>()
  const [sceneData, setSceneData] = useState<ExcalidrawData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    if (!id) return

    setLoading(true)
    fetch(`/api/drawings/${id}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Drawing not found' : 'Failed to load drawing')
        }
        return res.json()
      })
      .then((data) => {
        setSceneData(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={styles.text}>Loading drawing...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.center}>
        <div style={styles.errorBox}>
          <h2 style={styles.errorTitle}>Error</h2>
          <p style={styles.errorText}>{error}</p>
          <Link to="/" style={styles.link}>Go to homepage</Link>
          <button 
            style={{...styles.link, background: 'none', border: 'none', cursor: 'pointer', display: 'block', margin: '16px auto 0'}} 
            onClick={() => setShowOverlay(true)}
          >
            Browse other drawings
          </button>
        </div>
        {showOverlay && (
          <DrawingsBrowser mode="overlay" onClose={() => setShowOverlay(false)} />
        )}
      </div>
    )
  }

  if (!sceneData) return null

  const theme = sceneData.appState?.theme || 'light'

  return (
    <div style={styles.container}>
      <Excalidraw
        initialData={{
          elements: sceneData.elements || [],
          appState: {
            viewBackgroundColor: sceneData.appState?.viewBackgroundColor || '#ffffff',
            theme: theme,
            ...sceneData.appState,
          },
          files: sceneData.files || {},
        }}
        viewModeEnabled={true}
        zenModeEnabled={true}
        theme={theme}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: true,
            toggleTheme: true,
          },
        }}
      />
      
      {/* Floating Action Button for Browser */}
      <button 
        style={{
          ...styles.floatingButton,
          backgroundColor: theme === 'dark' ? '#2b2b2b' : '#fff',
          borderColor: theme === 'dark' ? '#444' : '#ddd',
          boxShadow: theme === 'dark' ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
        }}
        onClick={() => setShowOverlay(true)}
        title="Browse all drawings"
      >
        <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>📂</span>
      </button>
      
      {showOverlay && (
        <DrawingsBrowser key={Date.now()} mode="overlay" theme={theme} onClose={() => setShowOverlay(false)} />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
  },
  floatingButton: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    width: '48px',
    height: '48px',
    borderRadius: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    cursor: 'pointer',
    zIndex: 100, // Above Excalidraw UI
    transition: 'all 0.2s ease',
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
  errorBox: {
    padding: '24px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    textAlign: 'center',
    maxWidth: '400px',
  },
  errorTitle: {
    color: '#d32f2f',
    marginBottom: '8px',
  },
  errorText: {
    color: '#666',
    marginBottom: '16px',
  },
  link: {
    color: '#1976d2',
    textDecoration: 'none',
  },
}

export default Viewer
