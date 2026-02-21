import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  const [sceneData, setSceneData] = useState<ExcalidrawData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOverlay, setShowOverlay] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [mode, setMode] = useState<'view' | 'edit' | 'present'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('viewerMode')
      if (saved === 'present') return 'present'
    }
    return 'view'
  })
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  const [showEditWarning, setShowEditWarning] = useState(false)
  const [drawingsList, setDrawingsList] = useState<{id: string}[]>([])
  const [loadingDrawings, setLoadingDrawings] = useState(false)

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      const currentMode = modeRef.current
      
      if (e.key === 'e' || e.key === 'E') {
        setShowOverlay(prev => !prev)
      } else if (e.key === 'w' || e.key === 'W') {
        if (currentMode === 'edit') {
          setMode('view')
        } else if (currentMode === 'present') {
          setShowEditWarning(true)
        } else if (currentMode === 'view') {
          setShowEditWarning(true)
        }
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'q' || e.key === 'Q') {
        const willBePresent = currentMode !== 'present'
        setMode(prev => prev === 'present' ? 'view' : 'present')
        if (willBePresent) {
          if (!loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => {
                const drawings = data.drawings || []
                setDrawingsList(drawings.map((d: {id: string}) => ({ id: d.id })))
                setLoadingDrawings(false)
              })
              .catch(() => {
                setLoadingDrawings(false)
              })
          }
        }
      } else if (e.key === 'ArrowLeft') {
        if (drawingsList.length === 0) {
          if (!loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => {
                const drawings = data.drawings || []
                setDrawingsList(drawings.map((d: {id: string}) => ({ id: d.id })))
                setLoadingDrawings(false)
              })
              .catch(() => {
                setLoadingDrawings(false)
              })
          }
          return
        }
        const currentIndex = drawingsList.findIndex(d => d.id === id)
        if (currentIndex > 0) {
          navigate(`/d/${drawingsList[currentIndex - 1].id}`)
        }
      } else if (e.key === 'ArrowRight') {
        if (drawingsList.length === 0) {
          if (!loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => {
                const drawings = data.drawings || []
                setDrawingsList(drawings.map((d: {id: string}) => ({ id: d.id })))
                setLoadingDrawings(false)
              })
              .catch(() => {
                setLoadingDrawings(false)
              })
          }
          return
        }
        const currentIndex = drawingsList.findIndex(d => d.id === id)
        if (currentIndex < drawingsList.length - 1) {
          navigate(`/d/${drawingsList[currentIndex + 1].id}`)
        }
      } else if (e.key === 'Escape') {
        if (currentMode === 'present') {
          setMode('view')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawingsList, id, loadingDrawings, navigate])

  const loadDrawingsList = useCallback(() => {
    if (loadingDrawings) return
    setLoadingDrawings(true)
    fetch('/api/public/drawings')
      .then(res => res.json())
      .then(data => {
        const drawings = data.drawings || []
        const flatList: {id: string}[] = drawings.map((d: {id: string}) => ({ id: d.id }))
        setDrawingsList(flatList)
        setLoadingDrawings(false)
      })
      .catch(() => {
        setLoadingDrawings(false)
      })
  }, []) // loadingDrawings entfernt

  const navigateToPrevDrawing = useCallback(() => {
    if (drawingsList.length === 0) {
      loadDrawingsList()
      return
    }
    const currentIndex = drawingsList.findIndex(d => d.id === id)
    if (currentIndex > 0) {
      const prevId = drawingsList[currentIndex - 1].id
      navigate(`/d/${prevId}`)
    }
  }, [drawingsList, id, navigate, loadDrawingsList])

  const navigateToNextDrawing = useCallback(() => {
    if (drawingsList.length === 0) {
      loadDrawingsList()
      return
    }
    const currentIndex = drawingsList.findIndex(d => d.id === id)
    if (currentIndex < drawingsList.length - 1) {
      const nextId = drawingsList[currentIndex + 1].id
      navigate(`/d/${nextId}`)
    }
  }, [drawingsList, id, navigate, loadDrawingsList])

  useEffect(() => {
    localStorage.setItem('viewerMode', mode)
  }, [mode])

  useEffect(() => {
    if (!showEditWarning) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') {
        setMode('edit')
        setShowEditWarning(false)
      } else if (e.key === 'Escape') {
        setShowEditWarning(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showEditWarning])

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
        viewModeEnabled={mode === 'view' || mode === 'present'}
        zenModeEnabled={mode !== 'edit'}
        theme={theme}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: mode === 'edit' ? { saveFileToDisk: true } : false,
            saveAsImage: mode === 'edit',
            toggleTheme: true,
          },
        }}
      />
      
      {/* Floating Action Buttons */}
      <div style={styles.floatingButtons}>
        <button 
          style={{
            ...styles.floatingButton,
            backgroundColor: mode === 'present' ? '#2196F3' : (theme === 'dark' ? '#1e1e1e' : '#fff'),
            borderColor: mode === 'present' ? '#1976D2' : (theme === 'dark' ? '#555' : '#ccc'),
          }}
          onClick={() => {
            if (mode === 'present') {
              setMode('view')
            } else {
              setMode('present')
              loadDrawingsList()
            }
          }}
          title="Present mode (p/q)"
        >
          <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>▶️</span>
        </button>

        <button 
          style={{
            ...styles.floatingButton,
            backgroundColor: mode === 'edit' ? '#ff9800' : (theme === 'dark' ? '#1e1e1e' : '#fff'),
            borderColor: mode === 'edit' ? '#f57c00' : (theme === 'dark' ? '#555' : '#ccc'),
          }}
          onClick={() => {
            if (mode === 'edit') {
              setMode('view')
            } else if (mode === 'present') {
              setShowEditWarning(true)
            } else if (mode === 'view') {
              setShowEditWarning(true)
            }
          }}
          title={mode === 'edit' ? 'Exit edit mode' : 'Edit mode (w)'}
        >
          <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>
            {mode === 'edit' ? '✏️' : '🔒'}
          </span>
        </button>
        
        <button 
          style={{
            ...styles.floatingButton,
            backgroundColor: theme === 'dark' ? '#1e1e1e' : '#fff',
            borderColor: theme === 'dark' ? '#555' : '#ccc',
          }}
          onClick={() => setShowOverlay(true)}
          title="Browse all drawings (e)"
        >
          <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>📂</span>
        </button>
      </div>

      {/* Presentation Mode Navigation - Bottom Center */}
      {mode === 'present' && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 100,
          backgroundColor: theme === 'dark' ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
          padding: '6px 12px',
          borderRadius: '4px',
          border: `1px solid ${theme === 'dark' ? '#444' : '#ddd'}`,
        }}>
          <button 
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              cursor: 'pointer',
              border: '1px solid',
              backgroundColor: theme === 'dark' ? '#1e1e1e' : '#fff',
              borderColor: theme === 'dark' ? '#555' : '#ccc',
              color: theme === 'dark' ? '#aaa' : '#666',
            }}
            onClick={navigateToPrevDrawing}
            title="Previous (←)"
          >
            <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>◀</span>
          </button>
          <span style={{ 
            color: theme === 'dark' ? '#e0e0e0' : '#333',
            fontSize: '13px',
            padding: '0 8px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            {drawingsList.length > 0 ? (
              `${drawingsList.findIndex(d => d.id === id) + 1} / ${drawingsList.length}`
            ) : (
              '...'
            )}
          </span>
          <button 
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              cursor: 'pointer',
              border: '1px solid',
              backgroundColor: theme === 'dark' ? '#1e1e1e' : '#fff',
              borderColor: theme === 'dark' ? '#555' : '#ccc',
              color: theme === 'dark' ? '#aaa' : '#666',
            }}
            onClick={navigateToNextDrawing}
            title="Next (→)"
          >
            <span style={{ filter: theme === 'dark' ? 'brightness(0.9) contrast(1.2)' : 'none' }}>▶</span>
          </button>
        </div>
      )}
      
      {/* Edit Warning Modal */}
      {showEditWarning && (
        <div style={styles.modalOverlay}>
          <div style={{
            backgroundColor: theme === 'dark' ? '#2b2b2b' : '#fff',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '400px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <h2 style={{ 
              color: theme === 'dark' ? '#e0e0e0' : '#333',
              margin: '0 0 16px 0',
              fontSize: '20px',
            }}>⚠️ Edit Mode</h2>
            <p style={{ 
              color: theme === 'dark' ? '#aaa' : '#666',
              margin: '0 0 24px 0',
              lineHeight: '1.5',
            }}>
              Changes will only be saved locally and will be lost when you refresh the page!
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button 
                style={{
                  padding: '10px 20px',
                  borderRadius: '6px',
                  border: `1px solid ${theme === 'dark' ? '#444' : '#ddd'}`,
                  background: 'none',
                  color: theme === 'dark' ? '#e0e0e0' : '#333',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                onClick={() => setShowEditWarning(false)}
              >
                Cancel
              </button>
              <button 
                style={{
                  padding: '10px 20px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#ff9800',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                onClick={() => {
                  setMode('edit')
                  setShowEditWarning(false)
                }}
              >
                Edit anyway (w)
              </button>
            </div>
          </div>
        </div>
      )}
      
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
    top: '1rem',
    left: '60px',
    display: 'flex',
    gap: '6px',
    zIndex: 100,
  },
floatingButton: {
    width: '36px',
    height: '36px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    cursor: 'pointer',
    border: '1px solid',
    transition: 'all 0.15s ease',
  },
  modalOverlay: {
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
