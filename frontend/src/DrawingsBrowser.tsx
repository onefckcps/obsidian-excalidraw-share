import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMediaQuery } from './hooks/useMediaQuery'

const spinKeyframes = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`

interface PublicDrawing {
  id: string
  created_at: string
  source_path: string | null
  password_protected?: boolean
  persistent_collab?: boolean
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
  currentDrawingId?: string
  initialDrawings?: PublicDrawing[]
  onRefresh?: () => void
}

function DrawingsBrowser({ mode = 'standalone', theme, onClose, currentDrawingId, initialDrawings, onRefresh }: DrawingsBrowserProps) {
  const [drawings, setDrawings] = useState<PublicDrawing[]>(initialDrawings || [])
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['_root']))
  const [selectedFolder, setSelectedFolder] = useState<string>(() => {
    if (mode === 'standalone') {
      try {
        return localStorage.getItem('drawingsBrowserFolder') || '_root'
      } catch {
        return '_root'
      }
    }
    return '_root'
  })
  const [lastSelectedTreeIndex, setLastSelectedTreeIndex] = useState<number>(0)
  const [selectedTreeIndex, setSelectedTreeIndex] = useState<number>(0)
  const [selectedDrawingIndex, setSelectedDrawingIndex] = useState<number>(-1)
  const [loading, setLoading] = useState(!initialDrawings)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mobileView, setMobileView] = useState<'drawings' | 'tree'>('drawings')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('drawingsBrowserShowSearch')
      return saved === 'true'
    }
    return false
  })
  const [isGlobalSearch, setIsGlobalSearch] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('drawingsBrowserGlobalSearch')
      return saved === 'true'
    }
    return false
  })
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('drawingsBrowserSidebarWidth')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 600) {
          return parsed
        }
      }
    }
    return 300
  })
  const [isResizing, setIsResizing] = useState(false)
  const [treeTooltip, setTreeTooltip] = useState<{ name: string; path: string; x: number; y: number } | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Sync drawings state when initialDrawings changes (e.g., after refresh)
  useEffect(() => {
    if (initialDrawings && initialDrawings.length > 0) {
      setDrawings(initialDrawings)
    }
  }, [initialDrawings])

  // Persist sidebar width to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('drawingsBrowserSidebarWidth', sidebarWidth.toString())
    } catch {
      // localStorage not available
    }
  }, [sidebarWidth])

  // Persist global search state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('drawingsBrowserGlobalSearch', isGlobalSearch.toString())
    } catch {
      // localStorage not available
    }
  }, [isGlobalSearch])

  // Persist search visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('drawingsBrowserShowSearch', showSearch.toString())
    } catch {
      // localStorage not available
    }
  }, [showSearch])


  const isMobile = useMediaQuery('(max-width: 730px)')

  const treeItemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const drawingCardRefs = useRef<Map<number, HTMLAnchorElement>>(new Map())
  const refreshDrawingsRef = useRef<() => void>(() => {})

  // In standalone mode we track system preference, in overlay we strictly follow the theme prop
  const [systemTheme, setSystemTheme] = useState('light')

  useEffect(() => {
    if (mode === 'standalone') {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      setSystemTheme(isDark ? 'dark' : 'light')

      const listener = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light')
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    }
  }, [mode])

  const currentTheme = mode === 'overlay' ? (theme || 'light') : systemTheme

  useEffect(() => {
    if (mode === 'standalone' && selectedFolder) {
      try {
        localStorage.setItem('drawingsBrowserFolder', selectedFolder)
      } catch {
        // localStorage not available
      }
    }
  }, [selectedFolder, mode])

  useEffect(() => {
    if (selectedTreeIndex >= 0) {
      const itemRef = treeItemRefs.current.get(selectedTreeIndex)
      itemRef?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [selectedTreeIndex])

  useEffect(() => {
    if (selectedDrawingIndex >= 0) {
      const cardRef = drawingCardRefs.current.get(selectedDrawingIndex)
      cardRef?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [selectedDrawingIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // 'r' key for refresh - works in both overlay and standalone
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        refreshDrawingsRef.current()
        return
      }

      if (e.key === 'Escape') {
        if (onClose) {
          onClose()
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const items = flattenTreeItems()
        if (items.length > 0) {
          const newIndex = Math.max(0, selectedTreeIndex - 1)
          setSelectedTreeIndex(newIndex)
          setSelectedFolder(items[newIndex].path)
        }
        setSelectedDrawingIndex(-1)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const items = flattenTreeItems()
        if (items.length > 0) {
          const newIndex = Math.min(items.length - 1, selectedTreeIndex + 1)
          setSelectedTreeIndex(newIndex)
          setSelectedFolder(items[newIndex].path)
        }
        setSelectedDrawingIndex(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (selectedDrawingIndex >= 0) {
          // Navigate to next drawing
          const drawings = getFilteredDrawings()
          if (selectedDrawingIndex < drawings.length - 1) {
            setSelectedDrawingIndex(prev => prev + 1)
          }
        } else {
          // From tree: expand folder or go to drawings
          const items = flattenTreeItems()
          if (items.length > 0 && selectedTreeIndex >= 0) {
            const currentItem = items[selectedTreeIndex]
            if (currentItem.hasChildren && !expandedPaths.has(currentItem.path)) {
              setExpandedPaths(prev => new Set([...prev, currentItem.path]))
              return
            }
          }
          // Switch to drawings grid
          setSelectedDrawingIndex(0)
          setSelectedTreeIndex(-1)
          setLastSelectedTreeIndex(selectedTreeIndex >= 0 ? selectedTreeIndex : 0)
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (selectedDrawingIndex >= 0) {
          // Navigate to previous drawing
          if (selectedDrawingIndex > 0) {
            setSelectedDrawingIndex(prev => prev - 1)
          } else {
            // Go back to tree - restore last selected tree index
            setSelectedDrawingIndex(-1)
            setSelectedTreeIndex(lastSelectedTreeIndex)
            const items = flattenTreeItems()
            if (items.length > 0 && items[lastSelectedTreeIndex]) {
              setSelectedFolder(items[lastSelectedTreeIndex].path)
            }
          }
        } else if (selectedTreeIndex >= 0) {
          // In tree: collapse folder
          const items = flattenTreeItems()
          if (items.length > 0) {
            const currentItem = items[selectedTreeIndex]
            if (expandedPaths.has(currentItem.path)) {
              setExpandedPaths(prev => {
                const next = new Set(prev)
                next.delete(currentItem.path)
                return next
              })
            }
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          // Shift+Tab: previous drawing or back to tree
          if (selectedDrawingIndex > 0) {
            setSelectedDrawingIndex(prev => prev - 1)
          } else if (selectedDrawingIndex === 0) {
            setSelectedDrawingIndex(-1)
            setSelectedTreeIndex(lastSelectedTreeIndex)
            const items = flattenTreeItems()
            if (items.length > 0 && items[lastSelectedTreeIndex]) {
              setSelectedFolder(items[lastSelectedTreeIndex].path)
            }
          } else if (selectedTreeIndex >= 0) {
            const items = flattenTreeItems()
            setSelectedTreeIndex(prev => {
              const newIndex = prev > 0 ? prev - 1 : items.length - 1
              setSelectedFolder(items[newIndex]?.path || '_root')
              return newIndex
            })
          } else {
            // No selection yet, go to last tree item
            const items = flattenTreeItems()
            setSelectedTreeIndex(Math.max(0, items.length - 1))
            setSelectedDrawingIndex(-1)
          }
        } else {
          // Tab: next drawing or from tree to drawings
          if (selectedDrawingIndex >= 0) {
            const drawings = getFilteredDrawings()
            setSelectedDrawingIndex(prev => Math.min(drawings.length - 1, prev + 1))
          } else {
            setSelectedDrawingIndex(0)
            setSelectedTreeIndex(-1)
            setLastSelectedTreeIndex(selectedTreeIndex >= 0 ? selectedTreeIndex : 0)
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const drawings = getFilteredDrawings()
        if (selectedDrawingIndex >= 0 && drawings[selectedDrawingIndex]) {
          const drawing = drawings[selectedDrawingIndex]
          if (mode === 'overlay' && onClose) {
            onClose()
            navigate(`/d/${drawing.id}`)
          } else {
            navigate(`/d/${drawing.id}`)
          }
        } else if (selectedTreeIndex >= 0) {
          const items = flattenTreeItems()
          const currentItem = items[selectedTreeIndex]
          if (currentItem.hasChildren) {
            setExpandedPaths(prev => new Set([...prev, currentItem.path]))
          }
          setSelectedFolder(currentItem.path)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mode, onClose, selectedTreeIndex, selectedDrawingIndex, expandedPaths, selectedFolder])

  const navigate = useNavigate()

  const buildTree = (fetchedDrawings: PublicDrawing[]) => {
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

    if (currentDrawingId) {
      const currentDrawing = fetchedDrawings.find((d: PublicDrawing) => d.id === currentDrawingId)
      if (currentDrawing && currentDrawing.source_path) {
        const parts = currentDrawing.source_path.split('/')
        parts.pop()
        if (parts.length > 0) {
          const folderPath = parts.join('/')
          setSelectedFolder(folderPath)
          let path = ''
          const pathsToExpand = new Set<string>(['_root'])
          parts.forEach((part: string) => {
            path = path === '' ? part : `${path}/${part}`
            pathsToExpand.add(path)
          })
          setExpandedPaths(pathsToExpand)
        }
      }
    } else if (selectedFolder && selectedFolder !== '_root') {
      // Expand path to selected folder
      const parts = selectedFolder.split('/')
      let path = ''
      const pathsToExpand = new Set(expandedPaths)
      parts.forEach((part: string) => {
        path = path === '' ? part : `${path}/${part}`
        pathsToExpand.add(path)
      })
      setExpandedPaths(pathsToExpand)
    }
  }

  useEffect(() => {
    if (initialDrawings) {
      buildTree(initialDrawings)
      return
    }

    fetch('/api/public/drawings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load drawings')
        return res.json()
      })
      .then((data) => {
        const fetchedDrawings = data.drawings || []
        setDrawings(fetchedDrawings)
        buildTree(fetchedDrawings)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [initialDrawings])

  const refreshDrawings = () => {
    if (refreshing) return

    setRefreshing(true)
    setError(null)

    fetch('/api/public/drawings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load drawings')
        return res.json()
      })
      .then((data) => {
        const fetchedDrawings = data.drawings || []
        setDrawings(fetchedDrawings)

        const root: TreeNode = { name: 'Root', path: '_root', children: {}, drawings: [] }

        fetchedDrawings.forEach((d: PublicDrawing) => {
          if (!d.source_path) {
            root.drawings.push(d)
            return
          }

          const parts = d.source_path.split('/')
          parts.pop()

          let currentNode = root
          let currentPath = '_root'

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

          currentNode.drawings.push(d)
        })

        setTree(root)

        if (currentDrawingId) {
          const currentDrawing = fetchedDrawings.find((d: PublicDrawing) => d.id === currentDrawingId)
          if (currentDrawing && currentDrawing.source_path) {
            const parts = currentDrawing.source_path.split('/')
            parts.pop()
            if (parts.length > 0) {
              const folderPath = parts.join('/')
              setSelectedFolder(folderPath)
              let path = ''
              const pathsToExpand = new Set<string>(['_root'])
              parts.forEach((part: string) => {
                path = path === '' ? part : `${path}/${part}`
                pathsToExpand.add(path)
              })
              setExpandedPaths(pathsToExpand)
            }
          }
        } else if (selectedFolder && selectedFolder !== '_root') {
          const parts = selectedFolder.split('/')
          let path = ''
          const pathsToExpand = new Set<string>(['_root'])
          parts.forEach((part: string) => {
            path = path === '' ? part : `${path}/${part}`
            pathsToExpand.add(path)
          })
          setExpandedPaths(pathsToExpand)
        }

        if (onRefresh) {
          onRefresh()
        }
        const count = fetchedDrawings.length
        showToast(`🔄 ${count} drawing${count !== 1 ? 's' : ''} loaded`)
        setRefreshing(false)
      })
      .catch((err) => {
        setError(err.message)
        showToast('Failed to load drawings', 'error')
        setRefreshing(false)
      })
  }

  // Keep refreshDrawingsRef updated
  useEffect(() => {
    refreshDrawingsRef.current = refreshDrawings
  }, [refreshDrawings])

  // Auto-refresh drawings list every 30 seconds to keep persistent collab badges current
  useEffect(() => {
    if (initialDrawings) return // Skip auto-refresh when drawings are provided externally
    const interval = setInterval(() => {
      refreshDrawingsRef.current()
    }, 30_000)
    return () => clearInterval(interval)
  }, [initialDrawings])

  // Sidebar resize handlers
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !sidebarRef.current) return
      const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect()
      if (containerRect) {
        const newWidth = e.clientX - containerRect.left
        setSidebarWidth(Math.max(200, Math.min(600, newWidth)))
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  // Toast notification helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2500)
  }

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

  const collectAllPaths = (node: TreeNode | null, paths: Set<string>): Set<string> => {
    if (!node) return paths
    if (node.path !== '_root') {
      paths.add(node.path)
    }
    for (const child of Object.values(node.children)) {
      collectAllPaths(child, paths)
    }
    return paths
  }

  const openAllFolders = () => {
    if (tree) {
      setExpandedPaths(collectAllPaths(tree, new Set(['_root'])))
    }
  }

  const openMobileTree = () => {
    openAllFolders()
    setMobileView('tree')
  }

  const selectFolder = (path: string) => {
    setSelectedFolder(path)
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
    if (isMobile) {
      setMobileView('drawings')
    }
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

  // Get filtered drawings based on search query
  const getFilteredDrawings = () => {
    // On desktop (always visible search), use isGlobalSearch directly
    // On mobile, only use global search when search is visible
    const searchVisible = !isMobile || showSearch
    const useGlobalSearch = searchVisible && isGlobalSearch
    const folderDrawings = useGlobalSearch ? drawings : getSelectedDrawings()
    if (!searchQuery.trim()) return folderDrawings

    const query = searchQuery.toLowerCase()
    return folderDrawings.filter(d => {
      const name = getFileName(d.source_path).toLowerCase()
      const date = formatDate(d.created_at).toLowerCase()
      return name.includes(query) || date.includes(query)
    })
  }

  // Flatten tree for navigation (only expanded items)
  const flattenTreeItems = (node: TreeNode | null = tree, items: {name: string, path: string, hasChildren: boolean}[] = []): {name: string, path: string, hasChildren: boolean}[] => {
    if (!node) return items
    items.push({ name: node.name, path: node.path, hasChildren: Object.keys(node.children).length > 0 })
    if (node.path !== '_root' && !expandedPaths.has(node.path)) {
      return items // Don't traverse into collapsed folders
    }
    const sortedChildren = Object.keys(node.children).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    for (const key of sortedChildren) {
      flattenTreeItems(node.children[key], items)
    }
    return items
  }

  const getTreeIndexForPath = (path: string): number => {
    const items = flattenTreeItems()
    return items.findIndex(item => item.path === path)
  }

  const styles = getStyles(currentTheme)

  const renderTree = (node: TreeNode, level = 0) => {
    const isRoot = node.path === '_root'
    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedFolder === node.path
    const treeIndex = getTreeIndexForPath(node.path)
    const isKeyboardSelected = selectedTreeIndex >= 0 && treeIndex === selectedTreeIndex

    const folderKeys = Object.keys(node.children).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}))
    const hasChildren = folderKeys.length > 0
    const totalCount = node.drawings.length

    return (
      <div key={node.path} style={{ marginLeft: isRoot ? 0 : '16px' }}>
        <div
          ref={(el) => {
            if (el && treeIndex >= 0) {
              treeItemRefs.current.set(treeIndex, el)
            }
          }}
          style={{
            ...styles.treeItem,
            ...(isSelected || isKeyboardSelected ? styles.treeItemActive : {}),
            ...(isKeyboardSelected ? { outline: currentTheme === 'dark' ? '2px solid #64b5f6' : '2px solid #1976d2' } : {})
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) toggleFolder(node.path)
            selectFolder(node.path)
            setSelectedTreeIndex(treeIndex >= 0 ? treeIndex : 0)
          }}
          onTouchStart={(e) => {
            if (!isMobile) return
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()

            // Long press timer - show tooltip after 500ms
            const longPressTimer = setTimeout(() => {
              setTreeTooltip({
                name: node.name,
                path: node.path,
                x: rect.left + rect.width / 2,
                y: rect.top
              })
            }, 500)

            // Store timer reference for cleanup
            ;(e.currentTarget as HTMLElement).dataset.longPressTimer = String(longPressTimer)

            // Track touch move to cancel timer if user moves finger
            const handleTouchMove = () => {
              clearTimeout(longPressTimer)
              e.currentTarget.removeEventListener('touchmove', handleTouchMove)
              e.currentTarget.removeEventListener('touchend', handleTouchEnd)
            }

            // Clean up on touch end
            const handleTouchEnd = () => {
              clearTimeout(longPressTimer)
              e.currentTarget.removeEventListener('touchmove', handleTouchMove)
              e.currentTarget.removeEventListener('touchend', handleTouchEnd)
            }

            e.currentTarget.addEventListener('touchmove', handleTouchMove, { once: true })
            e.currentTarget.addEventListener('touchend', handleTouchEnd, { once: true })
          }}
        >
          <span style={styles.treeIcon}>
            {hasChildren ? (isExpanded ? '📂' : '📁') : '📁'}
          </span>
          <span style={styles.treeLabel}>
            {isRoot ? 'Top Level' : node.name}
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
      <style>{spinKeyframes}</style>
      {mode === 'overlay' && (
        <div style={styles.overlayBackdrop} onClick={onClose} />
      )}

      <div style={mode === 'overlay' ? (isMobile ? styles.overlayModalMobile : styles.overlayModal) : styles.mainWrapper}>
        <header style={isMobile ? styles.headerMobile : styles.header}>
          <div style={styles.headerLeft}>
            {isMobile && mobileView === 'tree' ? (
              <button style={styles.mobileBackBtn} onClick={() => setMobileView('drawings')}>
                ← Back
              </button>
            ) : (
              <>
                {mode === 'standalone' && !isMobile && (
                  <Link to="/" style={styles.logo}>ExcaliShare</Link>
                )}
                {!isMobile && (
                  <div style={styles.headerCenter}>
                    <div style={styles.searchContainer}>
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={styles.searchInput}
                      />
                      <button
                        onClick={() => setIsGlobalSearch(!isGlobalSearch)}
                        style={isGlobalSearch ? styles.globalSearchBtnActive : styles.globalSearchBtn}
                        title={isGlobalSearch ? 'Search in current folder' : 'Search across all folders'}
                      >
                        <span style={styles.globalSearchIcon}>🌐</span>
                        <span style={styles.globalSearchLabel}>Global</span>
                      </button>
                    </div>
                  </div>
                )}
                {isMobile && (
                  <button
                    style={{
                      ...styles.searchBtn,
                      ...(showSearch ? { backgroundColor: currentTheme === 'dark' ? '#1a2e3f' : '#e3f2fd', color: currentTheme === 'dark' ? '#64b5f6' : '#1976d2' } : {})
                    }}
                    onClick={() => setShowSearch(!showSearch)}
                    title="Search"
                  >
                    🔍
                  </button>
                )}
              </>
            )}
          </div>

          {isMobile && mobileView === 'drawings' && (
            <div style={{ flex: 1, display: 'flex', paddingLeft: '8px' }}>
              <button style={styles.mobileFolderBtn} onClick={openMobileTree}>
                <span style={{ filter: currentTheme === 'dark' ? 'brightness(1.3)' : 'none' }}>📁</span>
                <span style={{ flex: 1 }}>{selectedFolder === '_root' ? 'Top Level' : selectedFolder.split('/').pop()}</span>
                <span style={{ fontSize: '12px', marginLeft: '8px', color: currentTheme === 'dark' ? '#aaaaaa' : '#666' }}>▼</span>
              </button>
            </div>
          )}

          <div style={styles.headerRight}>
            <button
              style={styles.refreshIcon as React.CSSProperties}
              onClick={refreshDrawings}
              disabled={refreshing}
              title="Refresh drawings (r)"
            >
              <span style={refreshing ? { animation: 'spin 1s linear infinite' } : {}}>🔄</span>
            </button>
            {mode === 'standalone' ? (
              <Link to="/admin" style={styles.adminIcon} title="Admin">⚙️</Link>
            ) : (
              <button style={styles.closeBtn} onClick={onClose} title="Close">
                ✕
              </button>
            )}
          </div>
        </header>

        {isMobile && showSearch && (
          <div style={styles.mobileSearchContainer}>
            <input
              type="text"
              placeholder="Search by name or date..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={styles.mobileSearchInput}
            />
            <button
              onClick={() => setIsGlobalSearch(!isGlobalSearch)}
              style={isGlobalSearch ? styles.mobileGlobalSearchBtnActive : styles.mobileGlobalSearchBtn}
              title={isGlobalSearch ? 'Search in current folder' : 'Search across all folders'}
            >
              <span style={styles.globalSearchIcon}>🌐</span>
              <span style={styles.mobileGlobalSearchLabel}>Global</span>
            </button>
          </div>
        )}

        <main style={isMobile ? styles.mainMobile : styles.main}>
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
            <>
              {/* Mobile Tree View (fullscreen) */}
              {isMobile && mobileView === 'tree' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  <div style={styles.treeContainer}>
                    {tree && renderTree(tree)}
                  </div>
                </div>
              )}

              {/* Desktop Layout or Mobile Drawings View */}
              {(!isMobile || mobileView === 'drawings') && (
                <div style={isMobile ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : styles.layout}>
                  {!isMobile && (
                    <div
                      ref={sidebarRef}
                      style={{
                        ...styles.sidebar,
                        width: `${sidebarWidth}px`,
                        position: 'relative',
                        cursor: isResizing ? 'col-resize' : 'default',
                      }}
                    >
                      <div style={styles.treeContainer}>
                        {tree && renderTree(tree)}
                      </div>
                      {/* Resize handle */}
                      <div
                        onMouseDown={startResize}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: '8px',
                          cursor: 'col-resize',
                          zIndex: 10,
                        }}
                        title="Drag to resize"
                      />
                    </div>
                  )}

                  <div style={isMobile ? { flex: 1, overflowY: 'auto', padding: '0 4px' } : styles.content}>
                    {getFilteredDrawings().length === 0 ? (
                      <div style={styles.emptyFolder}>
                        {searchQuery ? (
                          <p>No drawings match "{searchQuery}"</p>
                        ) : (
                          <>
                            <p>This folder has no direct drawings.</p>
                            <p style={{fontSize: '13px', marginTop: '8px', color: currentTheme === 'dark' ? '#888' : '#666'}}>Select a subfolder to view its contents.</p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={isMobile ? styles.mobileGrid : styles.grid}>
                        {getFilteredDrawings().map((drawing, index) => (
                          <Link
                            key={drawing.id}
                            to={`/d/${drawing.id}`}
                            ref={(el) => {
                              if (el) {
                                drawingCardRefs.current.set(index, el)
                              }
                            }}
                            onClick={(e) => handleDrawingClick(e, drawing.id)}
                            style={{
                              ...styles.card,
                              ...(selectedDrawingIndex === index ? {
                                outline: currentTheme === 'dark' ? '2px solid #64b5f6' : '2px solid #1976d2',
                                margin: '2px'
                              } : {})
                            }}
                          >
                            <div style={{
                              ...styles.cardPreview,
                              ...(isMobile ? { height: '80px' } : {})
                            }}>
                              <span style={styles.cardIcon}>🎨</span>
                              {drawing.password_protected && <span style={{ position: 'absolute', top: '4px', right: '4px', fontSize: '14px' }} title="Password protected">🔒</span>}
                              {drawing.persistent_collab && <span style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '10px', padding: '1px 5px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)', color: '#16a34a', border: '1px solid rgba(34, 197, 94, 0.3)', fontFamily: 'system-ui, -apple-system, sans-serif' }} title="Collaborative drawing">🔄 Live</span>}
                            </div>
                            <div style={styles.cardContent}>
                              <h3 style={{
                                ...styles.cardTitle,
                                ...(isMobile ? { fontSize: '12px' } : {})
                              }}>{getFileName(drawing.source_path)}</h3>
                              <p style={{
                                ...styles.cardDate,
                                ...(isMobile ? { fontSize: '10px' } : {})
                              }}>{formatDate(drawing.created_at)}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Toast Notification */}
          {toast && (
            <div style={{
              ...styles.toast,
              backgroundColor: toast.type === 'error' ? (currentTheme === 'dark' ? '#3d2020' : '#ffebee') : (currentTheme === 'dark' ? '#1a3d1a' : '#e8f5e9'),
              borderColor: toast.type === 'error' ? '#ef5350' : '#4caf50',
            }}>
              <span style={{
                color: toast.type === 'error' ? (currentTheme === 'dark' ? '#ef5350' : '#d32f2f') : (currentTheme === 'dark' ? '#81c784' : '#2e7d32'),
              }}>
                {toast.message}
              </span>
            </div>
          )}

          {/* Tree Tooltip */}
          {treeTooltip && (
            <div
              onClick={() => setTreeTooltip(null)}
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
              }}
            >
              <div style={{
                position: 'absolute',
                left: treeTooltip.x,
                top: treeTooltip.y,
                transform: 'translate(-50%, -100%)',
                backgroundColor: currentTheme === 'dark' ? '#2a2a2a' : '#fff',
                border: `1px solid ${currentTheme === 'dark' ? '#444' : '#ddd'}`,
                borderRadius: '8px',
                padding: '12px 16px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                maxWidth: '300px',
                zIndex: 1001,
              }}>
                <div style={{
                  fontWeight: 600,
                  color: currentTheme === 'dark' ? '#fff' : '#333',
                  marginBottom: '4px',
                  wordBreak: 'break-all',
                }}>
                  {treeTooltip.name}
                </div>
                {treeTooltip.path !== '_root' && (
                  <div style={{
                    fontSize: '11px',
                    color: currentTheme === 'dark' ? '#888' : '#666',
                    wordBreak: 'break-all',
                  }}>
                    {treeTooltip.path}
                  </div>
                )}
                <div style={{
                  fontSize: '10px',
                  color: currentTheme === 'dark' ? '#666' : '#999',
                  marginTop: '8px',
                  textAlign: 'center',
                }}>
                  Tap anywhere to close
                </div>
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
      height: '100vh',
      backgroundColor: colors.bgApp,
      display: 'flex',
      flexDirection: 'column',
    },
    mainWrapper: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
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
      overflow: 'auto',
    },
    overlayModalMobile: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      borderRadius: 0,
      backgroundColor: colors.bgApp,
      boxShadow: 'none',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 10,
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
    headerMobile: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 16px',
      backgroundColor: colors.bgHeader,
      borderBottom: `1px solid ${colors.border}`,
      zIndex: 10,
    },
    mobileFolderBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: '8px',
      padding: '8px 12px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '15px',
      fontWeight: '500',
      color: colors.textMain,
      flex: 1,
    },
    mobileBackBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '8px 12px',
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: '15px',
      color: colors.textLink,
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      minWidth: '40px',
      gap: '8px',
    },
    headerCenter: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flex: 1,
      padding: '0 20px',
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      minWidth: '120px',
      justifyContent: 'flex-end',
      gap: '12px',
    },
    logo: {
      fontSize: '20px',
      fontWeight: 'bold',
      color: colors.textMain,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
    },
    refreshIcon: {
      fontSize: '16px',
      textDecoration: 'none',
      color: colors.textMuted,
      padding: '4px 8px',
      borderRadius: '4px',
      transition: 'background-color 0.2s, color 0.2s',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: '12px',
    },
    adminIcon: {
      fontSize: '18px',
      textDecoration: 'none',
      color: colors.textMuted,
      padding: '4px 8px',
      borderRadius: '4px',
      transition: 'background-color 0.2s, color 0.2s',
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
      minHeight: 0,
    },
    mainMobile: {
      flex: 1,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
    },
    layout: {
      display: 'flex',
      gap: '24px',
      alignItems: 'flex-start',
      flex: 1,
      overflow: 'hidden',
      minHeight: 0,
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
      minHeight: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
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
      position: 'relative' as const,
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

    // Mobile styles
    mobileTreeToggle: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
      cursor: 'pointer',
      marginBottom: '16px',
    },
    mobileTreeContainer: {
      display: 'block',
      marginBottom: '16px',
      backgroundColor: colors.bgPanel,
      borderRadius: '8px',
      padding: '12px',
      border: `1px solid ${colors.border}`,
    },
    mobileTreeToggleLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '15px',
      fontWeight: '500',
      color: colors.textMain,
    },
    mobileTreeToggleIcon: {
      fontSize: '14px',
      color: colors.textMuted,
      transition: 'transform 0.2s',
    },
    mobileContent: {
      display: 'none',
    },

    // Mobile-specific card and grid styles
    mobileGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
      gap: '12px',
      paddingBottom: '24px',
      paddingRight: '4px',
    },
    mobileCardPreview: {
      height: '80px',
      backgroundColor: colors.bgPreview,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderBottom: `1px solid ${colors.border}`,
    },
    mobileCardTitle: {
      fontSize: '12px',
      color: colors.textMain,
    },
    mobileCardDate: {
      fontSize: '10px',
      color: colors.textDim,
    },

    // Search styles
    searchInput: {
      padding: '8px 12px',
      borderRadius: '8px 0 0 8px',
      border: `1px solid ${colors.border}`,
      borderRight: 'none',
      backgroundColor: colors.bgPanel,
      color: colors.textMain,
      fontSize: '14px',
      width: '160px',
      outline: 'none',
      flexShrink: 0,
      height: '38px',
      boxSizing: 'border-box',
    },
    searchContainer: {
      display: 'flex',
      alignItems: 'center',
    },
    globalSearchBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '8px 12px',
      borderRadius: '0 8px 8px 0',
      border: `1px solid ${colors.border}`,
      borderLeft: 'none',
      backgroundColor: colors.bgPanel,
      color: colors.textMuted,
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      height: '38px',
      boxSizing: 'border-box',
    },
    globalSearchBtnActive: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '8px 12px',
      borderRadius: '0 8px 8px 0',
      border: `1px solid ${colors.textActive}`,
      borderLeft: 'none',
      backgroundColor: colors.bgActive,
      color: colors.textActive,
      height: '38px',
      boxSizing: 'border-box',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    },
    globalSearchIcon: {
      fontSize: '14px',
      lineHeight: 1,
    },
    globalSearchLabel: {
      letterSpacing: '0.3px',
    },
    searchBtn: {
      background: 'none',
      border: 'none',
      fontSize: '18px',
      cursor: 'pointer',
      color: colors.textMuted,
      padding: '4px 8px',
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    mobileSearchContainer: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '12px 16px',
      backgroundColor: colors.bgApp,
      borderBottom: `1px solid ${colors.border}`,
    },
    mobileSearchInput: {
      flex: 1,
      padding: '12px 16px',
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
      backgroundColor: colors.bgPanel,
      color: colors.textMain,
      fontSize: '16px',
      outline: 'none',
      boxSizing: 'border-box',
      height: '44px',
    },
    mobileGlobalSearchBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '12px 14px',
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
      backgroundColor: colors.bgPanel,
      color: colors.textMuted,
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
      height: '44px',
      boxSizing: 'border-box',
    },
    mobileGlobalSearchBtnActive: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '12px 14px',
      borderRadius: '8px',
      border: `1px solid ${colors.textActive}`,
      backgroundColor: colors.bgActive,
      color: colors.textActive,
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
      height: '44px',
      boxSizing: 'border-box',
    },
    mobileGlobalSearchLabel: {
      letterSpacing: '0.3px',
    },
    toast: {
      position: 'absolute',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 20px',
      borderRadius: '8px',
      border: '1px solid',
      fontSize: '14px',
      fontWeight: 500,
      boxShadow: `0 4px 12px ${colors.shadow}`,
      zIndex: 100,
      animation: 'toastFadeIn 0.3s ease-out',
    },
  };

  // Add keyframes for toast animation
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes toastFadeIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `;
  if (!document.getElementById('toast-styles')) {
    styleSheet.id = 'toast-styles';
    document.head.appendChild(styleSheet);
  }
}

export default DrawingsBrowser
