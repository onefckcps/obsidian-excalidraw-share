import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types'
import type { ExcalidrawElement, Theme } from '@excalidraw/excalidraw/types/element/types'
import DrawingsBrowser from './DrawingsBrowser'

const spinKeyframes = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`

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
  const [theme, setTheme] = useState<Theme>('light')
  const [refreshing, setRefreshing] = useState(false)

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
        setTheme(data.appState?.theme || 'light')
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [id])

  const handleExcalidrawChange = (_elements: unknown, appState: { theme?: Theme }) => {
    if (appState.theme && appState.theme !== theme) {
      setTheme(appState.theme)
    }
  }

  const refreshDrawing = useCallback(() => {
    if (!id || refreshing) return
    
    setRefreshing(true)
    fetch(`/api/drawings/${id}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Drawing not found' : 'Failed to load drawing')
        }
        return res.json()
      })
      .then((data) => {
        setSceneData(data)
        setTheme(data.appState?.theme || 'light')
        setError(null)
        setRefreshing(false)
      })
      .catch((err) => {
        setError(err.message)
        setRefreshing(false)
      })
  }, [id, refreshing])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      if (e.key === 'e' || e.key === 'E') {
        setShowOverlay(prev => !prev)
      } else if (e.key === 'r' || e.key === 'R') {
        refreshDrawing()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [refreshDrawing])

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
          <DrawingsBrowser mode="overlay" theme={theme} onClose={() => setShowOverlay(false)} currentDrawingId={id} />
        )}
      </div>
    )
  }

  if (!sceneData) return null

  return (
    <div style={styles.container}>
      <style>{spinKeyframes}</style>
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
        onChange={handleExcalidrawChange}
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
      
      {/* Floating Action Buttons */}
      <div style={styles.floatingButtons}>
        <button 
          style={{
            ...styles.floatingButton,
            backgroundColor: theme === 'dark' ? '#2b2b2b' : '#fff',
            borderColor: theme === 'dark' ? '#444' : '#ddd',
            boxShadow: theme === 'dark' ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
          }}
          onClick={refreshDrawing}
          disabled={refreshing}
          title="Refresh drawing (r)"
        >
          <span style={{ 
            filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none',
            animation: refreshing ? 'spin 1s linear infinite' : 'none'
          }}>🔄</span>
        </button>
        
        <button 
          style={{
            ...styles.floatingButton,
            backgroundColor: theme === 'dark' ? '#2b2b2b' : '#fff',
            borderColor: theme === 'dark' ? '#444' : '#ddd',
            boxShadow: theme === 'dark' ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
          }}
          onClick={() => setShowOverlay(true)}
          title="Browse all drawings (e)"
        >
          <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>📂</span>
        </button>
      </div>
      
      {showOverlay && (
        <DrawingsBrowser key={Date.now()} mode="overlay" theme={theme} onClose={() => setShowOverlay(false)} currentDrawingId={id} />
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
  floatingButtons: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    display: 'flex',
    gap: '12px',
    zIndex: 100,
  },
  floatingButton: {
    width: '48px',
    height: '48px',
    borderRadius: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    cursor: 'pointer',
    border: 'none',
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
