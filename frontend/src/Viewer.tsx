import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'

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
        </div>
      </div>
    )
  }

  if (!sceneData) return null

  const initialData = {
    elements: sceneData.elements || [],
    appState: {
      viewBackgroundColor: sceneData.appState?.viewBackgroundColor || '#ffffff',
      theme: sceneData.appState?.theme || 'light',
      ...sceneData.appState,
    },
    files: sceneData.files || {},
  }

  return (
    <div style={styles.container}>
      <Excalidraw
        initialData={initialData}
        viewModeEnabled={true}
        zenModeEnabled={true}
        theme={sceneData.appState?.theme || 'light'}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: true,
            toggleTheme: true,
          },
        }}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
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
