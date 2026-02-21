import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface PublicDrawing {
  id: string
  created_at: string
  source_path: string | null
}

interface TreeNode {
  name: string
  path: string
  children: Record<string, TreeNode>
  drawings: PublicDrawing[]
  isExpanded?: boolean
}

interface DrawingsBrowserProps {
  mode?: 'standalone' | 'overlay'
  theme?: string
  onClose?: () => void
}

function DrawingsBrowser({ mode = 'standalone', theme, onClose }: DrawingsBrowserProps) {
  const [drawings, setDrawings] = useState<PublicDrawing[]>([])
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['_root']))
  const [selectedFolder, setSelectedFolder] = useState<string>('_root')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Use provided theme, or check system preference for standalone mode
  const [currentTheme, setCurrentTheme] = useState(theme || 'light')
  
  useEffect(() => {
    if (theme) {
      setCurrentTheme(theme)
    } else if (mode === 'standalone') {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      setCurrentTheme(isDark ? 'dark' : 'light')
      
      const listener = (e: MediaQueryListEvent) => setCurrentTheme(e.matches ? 'dark' : 'light')
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    }
  }, [theme, mode])

  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/public/drawings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load drawings')
        return res.json()
      })
      .then((data) => {
        const fetchedDrawings = data.drawings || []
        setDrawings(fetchedDrawings)
        
        // Build tree structure
        const root: TreeNode = { name: 'Root', path: '_root', children: {}, drawings: [] }
        
        fetchedDrawings.forEach((d: PublicDrawing) => {
          if (!d.source_path) {
            root.drawings.push(d)
            return
          }

          const parts = d.source_path.split('/')
          parts.pop() // Remove filename
          
          let currentNode = root
          let currentPath = '_root'

          // Create folder structure
          parts.forEach((part: string) => {
            currentPath = currentPath === '_root' ? part : `${currentPath}/${part}`
            if (!currentNode.children[part]) {
              currentNode.children[part] = {
                name: part,
                path: currentPath,
                children: {},
                drawings: []
              }
            }
            currentNode = currentNode.children[part]
          })

          // Add drawing to leaf folder
          currentNode.drawings.push(d)
        })
        
        setTree(root)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const toggleFolder = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const selectFolder = (path: string) => {
    setSelectedFolder(path)
    // Also expand it if not already
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }

  // Get drawings for currently selected folder
  const getSelectedDrawings = () => {
    if (!tree) return []
    if (selectedFolder === '_root') return tree.drawings

    const parts = selectedFolder.split('/')
    if (parts[0] === '_root') parts.shift()

    let node = tree
    for (const part of parts) {
      if (!node.children[part]) return []
      node = node.children[part]
    }
    return node.drawings
  }

  // Count all drawings recursively
  const countAllDrawings = (node: TreeNode): number => {
    let count = node.drawings.length
    for (const child of Object.values(node.children)) {
      count += countAllDrawings(child)
    }
    return count
  }

  const styles = getStyles(currentTheme)

  const renderTree = (node: TreeNode, level = 0) => {
    const isRoot = node.path === '_root'
    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedFolder === node.path
    
    const folderKeys = Object.keys(node.children).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}))
    const hasChildren = folderKeys.length > 0
    const totalCount = countAllDrawings(node)

    return (
      <div key={node.path} style={{ marginLeft: isRoot ? 0 : '16px' }}>
        <div 
          style={{
            ...styles.treeItem,
            ...(isSelected ? styles.treeItemActive : {})
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) toggleFolder(node.path)
            selectFolder(node.path)
          }}
        >
          <span style={styles.treeIcon}>
            {hasChildren ? (isExpanded ? '📂' : '📁') : '📁'}
          </span>
          <span style={styles.treeLabel}>
            {isRoot ? 'All Drawings' : node.name}
          </span>
          <span style={{...styles.treeCount, color: isSelected ? styles.treeItemActive.color : styles.treeCount.color}}>
            ({totalCount})
          </span>
        </div>
        
        {isExpanded && folderKeys.length > 0 && (
          <div style={styles.treeChildren}>
            {folderKeys.map(key => renderTree(node.children[key], level + 1))}
          </div>
        )}
      </div>
    )
  }

  const handleDrawingClick = (e: React.MouseEvent, id: string) => {
    if (mode === 'overlay') {
      e.preventDefault()
      if (onClose) onClose()
      navigate(`/d/${id}`)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    })
  }

  const getFileName = (path: string | null) => {
    if (!path) return 'Untitled'
    return path.split('/').pop() || 'Untitled'
  }

  const content = (
    <div style={mode === 'overlay' ? styles.overlayContainer : styles.container}>
      {mode === 'overlay' && (
        <div style={styles.overlayBackdrop} onClick={onClose} />
      )}
      
      <div style={mode === 'overlay' ? styles.overlayModal : styles.mainWrapper}>
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            {mode === 'standalone' ? (
              <Link to="/" style={styles.logo}>Excalidraw Share</Link>
            ) : (
              <h2 style={styles.overlayTitle}>Browse Drawings</h2>
            )}
          </div>
          
          <div style={styles.headerRight}>
            {mode === 'standalone' ? (
              <Link to="/admin" style={styles.adminLink}>Admin</Link>
            ) : (
              <button style={styles.closeBtn} onClick={onClose} title="Close">
                ✕
              </button>
            )}
          </div>
        </header>

        <main style={styles.main}>
          {loading ? (
            <div style={styles.center}>
              <div style={styles.spinner} />
              <p style={styles.text}>Loading drawings...</p>
            </div>
          ) : error ? (
            <div style={styles.center}>
              <div style={styles.errorBox}>
                <h2 style={styles.errorTitle}>Error</h2>
                <p style={styles.errorText}>{error}</p>
              </div>
            </div>
          ) : drawings.length === 0 ? (
            <div style={styles.empty}>
              <p>No drawings published yet.</p>
              <p>Use the Obsidian plugin to publish drawings.</p>
            </div>
          ) : (
            <div style={styles.layout}>
              {/* Left Sidebar - Tree View */}
              <div style={styles.sidebar}>
                <div style={styles.treeContainer}>
                  {tree && renderTree(tree)}
                </div>
              </div>

              {/* Right Content - Drawings Grid */}
              <div style={styles.content}>
                <div style={styles.contentHeader}>
                  <h2 style={styles.folderTitle}>
                    {selectedFolder === '_root' ? 'Root' : selectedFolder.split('/').pop()}
                  </h2>
                  <span style={styles.folderCount}>{getSelectedDrawings().length} items</span>
                </div>

                {getSelectedDrawings().length === 0 ? (
                  <div style={styles.emptyFolder}>
                    <p>This folder has no direct drawings.</p>
                    <p style={{fontSize: '13px', marginTop: '8px', color: currentTheme === 'dark' ? '#888' : '#666'}}>Select a subfolder to view its contents.</p>
                  </div>
                ) : (
                  <div style={styles.grid}>
                    {getSelectedDrawings().map(drawing => (
                      <Link 
                        key={drawing.id} 
                        to={`/d/${drawing.id}`}
                        onClick={(e) => handleDrawingClick(e, drawing.id)}
                        style={styles.card}
                      >
                        <div style={styles.cardPreview}>
                          <span style={styles.cardIcon}>🎨</span>
                        </div>
                        <div style={styles.cardContent}>
                          <h3 style={styles.cardTitle}>{getFileName(drawing.source_path)}</h3>
                          <p style={styles.cardDate}>{formatDate(drawing.created_at)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )

  return content
}

const getStyles = (theme: string): Record<string, React.CSSProperties> => {
  const isDark = theme === 'dark';
  
  // Color palette
  const colors = {
    bgApp: isDark ? '#121212' : '#f5f5f5',
    bgPanel: isDark ? '#1e1e1e' : '#fff',
    bgHeader: isDark ? '#1e1e1e' : '#fff',
    bgHover: isDark ? '#2c2c2c' : '#f0f0f0',
    bgActive: isDark ? '#1a2e3f' : '#e3f2fd', // Muted blue for dark mode
    bgPreview: isDark ? '#252525' : '#f8f9fa',
    bgBadge: isDark ? '#333' : '#e0e0e0',
    
    textMain: isDark ? '#e0e0e0' : '#333',
    textMuted: isDark ? '#aaaaaa' : '#666',
    textDim: isDark ? '#888888' : '#888',
    textActive: isDark ? '#64b5f6' : '#1976d2', // Lighter blue for dark mode
    textLink: isDark ? '#64b5f6' : '#1976d2',
    textError: isDark ? '#ef5350' : '#d32f2f',
    
    border: isDark ? '#333333' : '#eaeaea',
    borderLight: isDark ? '#2a2a2a' : '#eee',
    
    shadow: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)',
    shadowModal: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0, 0, 0, 0.2)',
  };

  return {
    // Standalone mode styles
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bgApp,
      display: 'flex',
      flexDirection: 'column',
    },
    mainWrapper: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
    },
    
    // Overlay mode styles
    overlayContainer: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    overlayBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    },
    overlayModal: {
      position: 'relative',
      width: '90vw',
      maxWidth: '1200px',
      height: '85vh',
      backgroundColor: colors.bgApp,
      borderRadius: '12px',
      boxShadow: `0 10px 40px ${colors.shadowModal}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    overlayTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: colors.textMain,
      margin: 0,
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: colors.textMuted,
      padding: '4px 8px',
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    },
    
    // Shared styles
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 24px',
      backgroundColor: colors.bgHeader,
      borderBottom: `1px solid ${colors.border}`,
      zIndex: 10,
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
    },
    logo: {
      fontSize: '20px',
      fontWeight: 'bold',
      color: colors.textMain,
      textDecoration: 'none',
    },
    adminLink: {
      color: colors.textLink,
      textDecoration: 'none',
      fontSize: '14px',
    },
    main: {
      flex: 1,
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    layout: {
      display: 'flex',
      gap: '24px',
      alignItems: 'flex-start',
      flex: 1,
      overflow: 'hidden',
    },
    sidebar: {
      width: '300px',
      flexShrink: 0,
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      boxShadow: `0 2px 8px ${colors.shadow}`,
      padding: '16px',
      height: '100%',
      overflowY: 'auto',
      border: `1px solid ${colors.border}`,
    },
    content: {
      flex: 1,
      minWidth: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    },
    contentHeader: {
      display: 'flex',
      alignItems: 'baseline',
      gap: '12px',
      marginBottom: '16px',
      flexShrink: 0,
    },
    folderTitle: {
      fontSize: '22px',
      color: colors.textMain,
      margin: 0,
      fontWeight: '600',
    },
    folderCount: {
      color: colors.textMuted,
      fontSize: '14px',
      backgroundColor: colors.bgBadge,
      padding: '2px 8px',
      borderRadius: '12px',
    },
    treeContainer: {
      fontSize: '14px',
    },
    treeItem: {
      display: 'flex',
      alignItems: 'center',
      padding: '6px 8px',
      cursor: 'pointer',
      borderRadius: '4px',
      color: colors.textMain,
      userSelect: 'none',
      transition: 'background-color 0.2s',
    },
    treeItemActive: {
      backgroundColor: colors.bgActive,
      color: colors.textActive,
      fontWeight: '500',
    },
    treeIcon: {
      marginRight: '8px',
      fontSize: '16px',
      width: '16px',
      textAlign: 'center',
      filter: isDark ? 'brightness(0.9) contrast(1.2)' : 'none',
    },
    treeLabel: {
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    treeCount: {
      color: colors.textDim,
      fontSize: '12px',
      marginLeft: '8px',
    },
    treeChildren: {
      borderLeft: `1px solid ${colors.borderLight}`,
      marginLeft: '11px',
      paddingLeft: '4px',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: '16px',
      overflowY: 'auto',
      paddingBottom: '24px',
      paddingRight: '8px',
    },
    card: {
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      boxShadow: `0 2px 4px ${colors.shadow}`,
      textDecoration: 'none',
      color: 'inherit',
      overflow: 'hidden',
      transition: 'transform 0.2s, box-shadow 0.2s',
      border: `1px solid ${colors.border}`,
    },
    cardPreview: {
      height: '100px',
      backgroundColor: colors.bgPreview,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderBottom: `1px solid ${colors.border}`,
    },
    cardIcon: {
      fontSize: '32px',
      filter: isDark ? 'brightness(0.9) contrast(1.2)' : 'none',
    },
    cardContent: {
      padding: '12px',
    },
    cardTitle: {
      margin: '0 0 4px 0',
      fontSize: '13px',
      fontWeight: '600',
      color: colors.textMain,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      lineHeight: '1.3',
    },
    cardDate: {
      margin: 0,
      fontSize: '11px',
      color: colors.textDim,
    },
    center: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      flex: 1,
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: `3px solid ${colors.border}`,
      borderTopColor: colors.textMain,
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    },
    text: {
      marginTop: '16px',
      color: colors.textMuted,
    },
    errorBox: {
      padding: '24px',
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      boxShadow: `0 2px 8px ${colors.shadow}`,
      textAlign: 'center',
      maxWidth: '400px',
      border: `1px solid ${colors.border}`,
    },
    errorTitle: {
      color: colors.textError,
      marginBottom: '8px',
    },
    errorText: {
      color: colors.textMuted,
      marginBottom: '16px',
    },
    empty: {
      textAlign: 'center',
      padding: '48px',
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      color: colors.textMuted,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      border: `1px solid ${colors.border}`,
    },
    emptyFolder: {
      padding: '48px',
      textAlign: 'center',
      color: colors.textDim,
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      border: `1px dashed ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
  };
}

export default DrawingsBrowser
