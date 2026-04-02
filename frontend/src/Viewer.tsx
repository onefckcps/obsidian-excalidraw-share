import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Excalidraw, LiveCollaborationTrigger } from '@excalidraw/excalidraw'
import type { Theme, ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawData } from './types'
import { drawingCache } from './utils/cache'
import { useCollab } from './hooks/useCollab'
import { useMediaQuery } from './hooks/useMediaQuery'
import CollabStatus from './CollabStatus'
import CollabPopover from './CollabPopover'
import AboutModal from './AboutModal'
import PasswordDialog from './PasswordDialog'
import DrawingsBrowser from './DrawingsBrowser'

const spinKeyframes = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`

function Viewer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [sceneData, setSceneData] = useState<ExcalidrawData | null>(null)
  const [currentDataId, setCurrentDataId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOverlay, setShowOverlay] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [excalidrawAPI, setExcalidrawAPI] = useState<unknown>(null)
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
  const [drawingsList, setDrawingsList] = useState<{id: string, created_at: string, source_path: string | null}[]>([])
  const [loadingDrawings, setLoadingDrawings] = useState(false)
  const loadingDrawingsRef = useRef(false)
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  // Store the password used to successfully load a password-protected drawing,
  // so it can be reused for subsequent re-fetches (e.g. after session ends).
  const currentPasswordRef = useRef<string | undefined>(undefined)

  const isMobile = useMediaQuery('(max-width: 730px)')

  // Collaboration hook
  const collab = useCollab({ drawingId: id, excalidrawAPI })

  // Preload drawings list on mount
  useEffect(() => {
    setLoadingDrawings(true)
    fetch('/api/public/drawings')
      .then(res => res.json())
      .then(data => {
        const drawings = data.drawings || []
        setDrawingsList(drawings)
        setLoadingDrawings(false)
      })
      .catch(() => {
        setLoadingDrawings(false)
      })
  }, [])

  // Listen for about modal trigger from dropdown
  useEffect(() => {
    const handleShowAbout = () => setShowAbout(true)
    document.addEventListener('excalishare:show-about', handleShowAbout)
    return () => document.removeEventListener('excalishare:show-about', handleShowAbout)
  }, [])

  // Helper: fetch drawing with optional password key
  const fetchDrawing = useCallback(async (drawingId: string, key?: string, signal?: AbortSignal) => {
    const url = key
      ? `/api/view/${drawingId}?key=${encodeURIComponent(key)}`
      : `/api/view/${drawingId}`
    const res = await fetch(url, { signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      if (res.status === 403 && body.password_protected) {
        return { passwordRequired: true, error: body.error as string }
      }
      throw new Error(res.status === 404 ? 'Drawing not found' : 'Failed to load drawing')
    }
    return { data: await res.json() }
  }, [])

  useEffect(() => {
    if (!id) return

    // Reset password state on ID change
    setPasswordRequired(false)
    setPasswordError(null)
    // Clear stored password when navigating to a different drawing
    currentPasswordRef.current = undefined

    // Wenn sich die ID ändert, wollen wir vorherige noch laufende Fetches abbrechen
    const abortController = new AbortController()

    // Versuche zuerst, das Drawing aus dem Cache zu laden
    const cachedData = drawingCache.get(id)
    if (cachedData) {
      setSceneData(cachedData)
      setCurrentDataId(id)
      setTheme(cachedData.appState?.theme || 'light')
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)

    // Check for password in URL fragment (#key=...)
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const fragmentKey = hashParams.get('key')

    // Security: strip the password fragment from the URL to prevent leakage
    // via browser history, referrer headers, and shoulder surfing.
    if (fragmentKey) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }

    fetchDrawing(id, fragmentKey || undefined, abortController.signal)
      .then((result) => {
        if ('passwordRequired' in result && result.passwordRequired) {
          // If we had a fragment key and it was wrong, show error
          if (fragmentKey) {
            setPasswordError('Invalid password from link')
          }
          setPasswordRequired(true)
          setLoading(false)
          return
        }
        if (result.data) {
          // Store the fragment key as the current password for future re-fetches
          if (fragmentKey) {
            currentPasswordRef.current = fragmentKey
          }
          // Im Cache speichern für später
          drawingCache.set(id, result.data)
          setSceneData(result.data)
          setCurrentDataId(id)
          setTheme(result.data.appState?.theme || 'light')
          setPasswordRequired(false)
          setLoading(false)
        }
      })
      .catch((err) => {
        // Ignoriere Abort-Errors, die wir selbst ausgelöst haben
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })

    // Cleanup-Funktion: Bricht den Fetch ab, wenn die Komponente unmounted
    // oder sich die ID ändert (z.B. weil der User schnell auf "Next" geklickt hat)
    return () => {
      abortController.abort()
    }
  }, [id, fetchDrawing])

  // Handle password submission from PasswordDialog
  const handlePasswordSubmit = useCallback(async (password: string) => {
    if (!id) return
    setPasswordError(null)
    setLoading(true)
    try {
      const result = await fetchDrawing(id, password)
      if ('passwordRequired' in result && result.passwordRequired) {
        setPasswordError('Invalid password')
        setLoading(false)
        return
      }
      if (result.data) {
        // Store the password so subsequent re-fetches (e.g. after session ends) can reuse it
        currentPasswordRef.current = password
        drawingCache.set(id, result.data)
        setSceneData(result.data)
        setCurrentDataId(id)
        setTheme(result.data.appState?.theme || 'light')
        setPasswordRequired(false)
        setLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drawing')
      setLoading(false)
    }
  }, [id, fetchDrawing])

  const handleExcalidrawChange = useCallback((elements: readonly ExcalidrawElement[], appState: { theme?: Theme }) => {
    setTheme(currentTheme => {
      // Nur updaten wenn sich das Theme wirklich geändert hat,
      // um endlose Re-Renders zu verhindern
      if (appState.theme && currentTheme !== appState.theme) {
        return appState.theme
      }
      return currentTheme
    })

    // Send scene updates to collab session if joined
    if (collab.isJoined && collab.isConnected) {
      collab.sendSceneUpdate(elements as ExcalidrawElement[])
    }
  }, [collab.isJoined, collab.isConnected, collab.sendSceneUpdate])

  const handlePointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: string }; button: 'down' | 'up'; pointersMap: Map<number, Readonly<{ x: number; y: number }>> }) => {
    if (collab.isJoined && collab.isConnected) {
      // Include viewport data for follow mode
      const api = excalidrawAPI as { getAppState?: () => { scrollX: number; scrollY: number; zoom: { value: number } } } | null;
      let scrollX: number | undefined;
      let scrollY: number | undefined;
      let zoom: number | undefined;
      if (api?.getAppState) {
        const appState = api.getAppState();
        scrollX = appState.scrollX;
        scrollY = appState.scrollY;
        zoom = appState.zoom?.value;
      }
      const tool = (payload.pointer.tool === 'laser' ? 'laser' : 'pointer') as 'pointer' | 'laser';
      collab.sendPointerUpdate(payload.pointer.x, payload.pointer.y, payload.button, tool, scrollX, scrollY, zoom)

      // When pointer goes up (stroke/drag ends), flush any deferred remote scene updates
      if (payload.button === 'up') {
        collab.flushPendingSceneUpdates();
      }

      // Auto-exit follow mode only when user actively clicks/drags on canvas
      // (not on every pointer move, which would make follow mode unusable)
      if (collab.followingUserId && payload.button === 'down') {
        collab.stopFollowing();
      }
    }
  }, [collab.isJoined, collab.isConnected, collab.sendPointerUpdate, collab.flushPendingSceneUpdates, collab.followingUserId, collab.stopFollowing, excalidrawAPI])

  // ──────────────────────────────────────────────
  // Bug 2 Fix: Click-to-follow on Excalidraw's native user badges
  // Excalidraw renders collaborator avatars in a .UserList container with .Avatar elements.
  // We intercept clicks on these to toggle follow mode for the corresponding collaborator.
  //
  // Matching strategy: The avatars are rendered in the same order as the collaborator Map
  // entries (insertion order). We use getCollaboratorIds() from the hook which returns
  // the IDs in the same order as the collaborator Map passed to Excalidraw.
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!collab.isJoined || !excalidrawAPI) return;

    const container = document.querySelector('.excalidraw');
    if (!container) return;

    const handleAvatarClick = (e: Event) => {
      // Find the clicked .Avatar element
      const avatar = (e.target as HTMLElement).closest('.Avatar') as HTMLElement | null;
      if (!avatar) return;

      // Find the .UserList container to confirm this is a collaborator badge
      const userList = avatar.closest('.UserList');
      if (!userList) return;

      // Get all Avatar elements in the UserList
      const avatars = Array.from(userList.querySelectorAll('.Avatar'));
      const avatarIndex = avatars.indexOf(avatar as Element);
      if (avatarIndex < 0) return;

      // Get the collaborator IDs in the same order as the Excalidraw collaborator Map
      const orderedIds = collab.getCollaboratorIds();
      if (avatarIndex >= orderedIds.length) return;

      const clickedUserId = orderedIds[avatarIndex];

      // Find the collaborator info
      const collaborator = collab.collaborators.find(c => c.id === clickedUserId);
      if (!collaborator) return;

      // Don't follow yourself
      if (collaborator.name === collab.displayName) return;

      if (collab.followingUserId === clickedUserId) {
        collab.stopFollowing();
      } else {
        collab.startFollowing(clickedUserId);
      }
    };

    // Use capture phase to intercept before Excalidraw's own handler
    container.addEventListener('click', handleAvatarClick, true);
    return () => container.removeEventListener('click', handleAvatarClick, true);
  }, [collab.isJoined, collab.collaborators, collab.displayName, collab.followingUserId, collab.startFollowing, collab.stopFollowing, collab.getCollaboratorIds, excalidrawAPI]);

  // Visual follow indicator: highlight the followed user's badge with a CSS outline
  useEffect(() => {
    if (!collab.isJoined || !collab.followingUserId) return;

    // Find the followed user's avatar index using the collaborator Map order
    const orderedIds = collab.getCollaboratorIds();
    const followedIndex = orderedIds.indexOf(collab.followingUserId);
    if (followedIndex < 0) return;

    // Inject a style that highlights the followed user's badge
    const style = document.createElement('style');
    style.setAttribute('data-excalishare-follow', 'true');
    style.textContent = `
      .UserList .Avatar:nth-child(${followedIndex + 1}) {
        outline: 2px solid #4CAF50 !important;
        outline-offset: 2px;
        border-radius: 50%;
        box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [collab.isJoined, collab.followingUserId, collab.getCollaboratorIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      const currentMode = modeRef.current

      // These work even when overlay is open
      if (e.key === 'e' || e.key === 'E') {
        setShowOverlay(prev => !prev)
        return
      }

      // These only work when overlay is closed
      if (showOverlay) return

      // r - refresh current drawing
      if (e.key === 'r' || e.key === 'R') {
        if (!id || loading) return
        setLoading(true)
        const refreshUrl = currentPasswordRef.current
          ? `/api/view/${id}?key=${encodeURIComponent(currentPasswordRef.current)}`
          : `/api/view/${id}`
        fetch(refreshUrl)
          .then((res) => {
            if (!res.ok) throw new Error(res.status === 404 ? 'Drawing not found' : 'Failed to load drawing')
            return res.json()
          })
          .then((data) => {
            // Beim manuellen Refresh überschreiben wir explizit den Cache
            drawingCache.set(id, data)
            setSceneData(data)
            setCurrentDataId(id)
            setTheme(data.appState?.theme || 'light')
            setError(null)
            setLoading(false)
          })
          .catch((err) => {
            setError(err.message)
            setLoading(false)
          })
        return
      }

      // Don't allow these in edit mode (except w to exit edit mode)
      if (currentMode === 'edit') {
        if (e.key === 'w' || e.key === 'W') {
          setMode('view')
        }
        return
      }

      // w - toggle edit mode
      if (e.key === 'w' || e.key === 'W') {
        if (currentMode === 'present') {
          setShowEditWarning(true)
        } else if (currentMode === 'view') {
          setShowEditWarning(true)
        }
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'q' || e.key === 'Q') {
        const willBePresent = currentMode !== 'present'
        setMode(prev => prev === 'present' ? 'view' : 'present')
        if (willBePresent && drawingsList.length === 0 && !loadingDrawings) {
          setLoadingDrawings(true)
          fetch('/api/public/drawings')
            .then(res => res.json())
            .then(data => {
              const drawings = data.drawings || []
              setDrawingsList(drawings)
              setLoadingDrawings(false)
            })
            .catch(() => {
              setLoadingDrawings(false)
            })
        }
      } else if (e.key === 'ArrowLeft') {
        if (drawingsList.length === 0) {
          if (!loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => {
                const drawings = data.drawings || []
                setDrawingsList(drawings)
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
                setDrawingsList(drawings)
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
  }, [showOverlay, drawingsList, id, loadingDrawings, navigate, loading])

  const loadDrawingsList = useCallback(() => {
    if (loadingDrawingsRef.current) return
    loadingDrawingsRef.current = true
    setLoadingDrawings(true)
    fetch('/api/public/drawings')
      .then(res => res.json())
      .then(data => {
        const drawings = data.drawings || []
        setDrawingsList(drawings)
        loadingDrawingsRef.current = false
        setLoadingDrawings(false)
      })
      .catch(() => {
        loadingDrawingsRef.current = false
        setLoadingDrawings(false)
      })
  }, [])

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

  // Inject buttons into Excalidraw toolbar on mobile
  useEffect(() => {
    // Skip on desktop
    if (!isMobile) return

    const currentMode = mode as string
    const containerClass = 'excalishare-mobile-buttons'
    let observer: MutationObserver | null = null

    const injectButtons = () => {
      // Remove existing containers first
      document.querySelectorAll(`.${containerClass}`).forEach(el => el.remove())

      // Find the toolbar
      const toolbar = document.querySelector('.App-toolbar-content')
      if (!toolbar) return

      // Check if buttons already injected
      if (toolbar.querySelector(`.${containerClass}`)) return

      // Common button styles
      const getButtonStyle = (isActive: boolean, activeColor: string) => `
        background: ${isActive ? activeColor : (theme === 'dark' ? '#333' : '#fff')};
        border: 1px solid ${isActive ? activeColor : (theme === 'dark' ? '#555' : '#ccc')};
        border-radius: 4px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 16px;
        color: ${theme === 'dark' ? '#fff' : '#000'};
        opacity: 1;
      `

      const getSmallButtonStyle = () => `
        background: ${theme === 'dark' ? '#333' : '#fff'};
        border: 1px solid ${theme === 'dark' ? '#555' : '#ccc'};
        border-radius: 4px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 16px;
        color: ${theme === 'dark' ? '#fff' : '#000'};
        opacity: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
      `

      // PRESENT MODE - inject navigation and exit button
      if (currentMode === 'present') {
        const container = document.createElement('div')
        container.className = containerClass
        container.style.cssText = `
          display: flex;
          gap: 8px;
          margin-left: auto;
          margin-right: 8px;
          padding: 4px 0;
          align-items: center;
        `

        // Previous button
        const prevBtn = document.createElement('button')
        prevBtn.textContent = '◀'
        prevBtn.title = 'Previous (←)'
        prevBtn.style.cssText = getSmallButtonStyle()
        prevBtn.onclick = () => {
          if (drawingsList.length === 0) {
            loadDrawingsList()
            return
          }
          const currentIndex = drawingsList.findIndex(d => d.id === id)
          if (currentIndex > 0) {
            const prevId = drawingsList[currentIndex - 1].id
            navigate(`/d/${prevId}`)
          }
        }

        // Counter
        const counter = document.createElement('span')
        const currentIndex = drawingsList.findIndex(d => d.id === id)
        counter.textContent = drawingsList.length > 0 
          ? `${currentIndex + 1} / ${drawingsList.length}` 
          : '...'
        counter.style.cssText = `
          color: ${theme === 'dark' ? '#e0e0e0' : '#333'};
          font-size: 16px;
          padding: 4px 8px;
          font-family: system-ui, -apple-system, sans-serif;
        `

        // Next button
        const nextBtn = document.createElement('button')
        nextBtn.textContent = '▶'
        nextBtn.title = 'Next (→)'
        nextBtn.style.cssText = getSmallButtonStyle()
        nextBtn.onclick = () => {
          if (drawingsList.length === 0) {
            loadDrawingsList()
            return
          }
          const currentIndex = drawingsList.findIndex(d => d.id === id)
          if (currentIndex < drawingsList.length - 1) {
            const nextId = drawingsList[currentIndex + 1].id
            navigate(`/d/${nextId}`)
          }
        }

        // Exit present button
        const exitBtn = document.createElement('button')
        exitBtn.textContent = '✕'
        exitBtn.title = 'Exit present mode'
        exitBtn.style.cssText = getSmallButtonStyle()
        exitBtn.onclick = () => setMode('view')

        container.append(prevBtn, counter, nextBtn, exitBtn)
        toolbar.appendChild(container)
        return
      }

      // NON-PRESENT MODE - inject normal buttons
      const container = document.createElement('div')
      container.className = containerClass
      container.style.cssText = `
        display: flex;
        gap: 8px;
        margin-left: 12px;
        padding: 4px 0;
        align-items: center;
      `

      // Present button
      const presentBtn = document.createElement('button')
      presentBtn.textContent = '▶️'
      presentBtn.title = 'Present mode (p/q)'
      const isPresent = currentMode === 'present'
      presentBtn.style.cssText = getButtonStyle(isPresent, '#2196F3')
      presentBtn.onclick = () => {
        if (isPresent) {
          setMode('view')
        } else {
          setMode('present')
          // Only load drawings if not already loaded
          if (drawingsList.length === 0 && !loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => {
                const drawings = data.drawings || []
                setDrawingsList(drawings)
                setLoadingDrawings(false)
              })
              .catch(() => {
                setLoadingDrawings(false)
              })
          }
        }
      }

      // Edit button
      const editBtn = document.createElement('button')
      const isEdit = currentMode === 'edit'
      editBtn.textContent = isEdit ? '✏️' : '🔒'
      editBtn.title = isEdit ? 'Exit edit mode' : 'Edit mode (w)'
      editBtn.style.cssText = getButtonStyle(isEdit, '#ff9800')
      editBtn.onclick = () => {
        if (isEdit) {
          setMode('view')
        } else {
          setShowEditWarning(true)
        }
      }

      // Browse button
      const browseBtn = document.createElement('button')
      browseBtn.textContent = '📂'
      browseBtn.title = 'Browse all drawings (e)'
      browseBtn.style.cssText = getButtonStyle(false, '')
      browseBtn.onclick = () => setShowOverlay(true)

      container.append(presentBtn, editBtn, browseBtn)
      toolbar.appendChild(container)
    }

    // Try immediate injection first - use rAF for faster execution after paint
    const tryInject = () => {
      if (document.querySelector('.App-toolbar-content')) {
        injectButtons()
      }
    }
    
    // Track all timers for proper cleanup
    const rAfId = requestAnimationFrame(tryInject)
    const timers = [
      setTimeout(tryInject, 50),
      setTimeout(tryInject, 100),
      setTimeout(tryInject, 200),
      setTimeout(injectButtons, 300)
    ]

    // Set up MutationObserver to detect when toolbar is added
    // Observe document.body since .excalidraw may not exist yet
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('App-toolbar-content') || 
                node.querySelector?.('.App-toolbar-content')) {
              injectButtons()
            }
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    
    return () => {
      cancelAnimationFrame(rAfId)
      timers.forEach(clearTimeout)
      if (observer) observer.disconnect()
      document.querySelectorAll('.excalishare-mobile-buttons').forEach(el => el.remove())
    }
  }, [isMobile, mode, theme, showOverlay, id, loadDrawingsList, loading, sceneData])

  // Inject ExcaliShare links into Excalidraw help dropdown
  useEffect(() => {
    const injectExcaliShareDropdown = () => {
      const dropdown = document.querySelector('.dropdown-menu-container')
      if (!dropdown) return

      const excalidrawLinks = dropdown.querySelector('.dropdown-menu-group')
      if (!excalidrawLinks) return

      // Remove existing ExcaliShare section first to handle dropdown re-open
      dropdown.querySelector('.excalishare-dropdown')?.remove()
      dropdown.querySelectorAll('.excalishare-hr').forEach(el => el.remove())

      const excaliShareGroup = document.createElement('div')
      excaliShareGroup.className = 'dropdown-menu-group excalishare-dropdown'

      const title = document.createElement('p')
      title.className = 'dropdown-menu-group-title'
      title.textContent = 'ExcaliShare'
      excaliShareGroup.appendChild(title)

      const githubLink = document.createElement('a')
      githubLink.href = 'https://github.com/onefckcps/obsidian-excalishare'
      githubLink.target = '_blank'
      githubLink.rel = 'noopener noreferrer'
      githubLink.className = 'dropdown-menu-item dropdown-menu-item-base'
      githubLink.title = 'ExcaliShare on GitHub'
      githubLink.innerHTML = `
        <div class="dropdown-menu-item__icon">
          <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7.5 15.833c-3.583 1.167-3.583-2.083-5-2.5m10 4.167v-2.917c0-.833.083-1.166-.417-1.666 2.334-.25 4.584-1.167 4.584-5a3.833 3.833 0 0 0-1.084-2.667 3.5 3.5 0 0 0-.083-2.667s-.917-.25-2.917 1.084a10.25 10.25 0 0 0-5.166 0C5.417 2.333 4.5 2.583 4.5 2.583a3.5 3.5 0 0 0-.083 2.667 3.833 3.833 0 0 0-1.084 2.667c0 3.833 2.25 4.75 4.584 5-.5.5-.5 1-.417 1.666V17.5" stroke-width="1.25"></path>
          </svg>
        </div>
        <div class="dropdown-menu-item__text">GitHub</div>
      `

      const aboutLink = document.createElement('button')
      aboutLink.type = 'button'
      aboutLink.className = 'dropdown-menu-item dropdown-menu-item-base'
      aboutLink.title = 'About ExcaliShare'
      aboutLink.onclick = () => {
        document.dispatchEvent(new CustomEvent('excalishare:show-about'))
      }
      aboutLink.innerHTML = `
        <div class="dropdown-menu-item__icon">
          <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </div>
        <div class="dropdown-menu-item__text">About</div>
      `

      excaliShareGroup.appendChild(githubLink)
      excaliShareGroup.appendChild(aboutLink)

      const hr = document.createElement('div')
      hr.className = 'excalishare-hr'
      hr.style.height = '1px'
      hr.style.backgroundColor = 'var(--default-border-color)'
      hr.style.margin = '0.5rem 0px'

      // Insert before the last element (Dark/Light mode toggle)
      const lastElement = dropdown.lastElementChild
      if (lastElement) {
        dropdown.insertBefore(hr, lastElement)
        dropdown.insertBefore(excaliShareGroup, hr)
      } else {
        dropdown.appendChild(hr)
        dropdown.appendChild(excaliShareGroup)
      }
    }

    let dropdownObserver: MutationObserver | null = null

    const tryInjectDropdown = () => {
      injectExcaliShareDropdown()
    }

    // Reduced timeouts for faster injection
    const timers = [
      setTimeout(tryInjectDropdown, 50),
      setTimeout(tryInjectDropdown, 150),
      setTimeout(tryInjectDropdown, 300),
    ]

    dropdownObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList?.contains('dropdown-menu-container')) {
              injectExcaliShareDropdown()
            }
            // Also check if nodes contain the dropdown as child
            if (node.querySelector?.('.dropdown-menu-container')) {
              injectExcaliShareDropdown()
            }
          }
        }
        // Also observe attribute changes for the dropdown itself
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
            if (mutation.target.classList?.contains('dropdown-menu-container')) {
              injectExcaliShareDropdown()
            }
          }
        }
      }
    })

    dropdownObserver.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    })

    return () => {
      timers.forEach(clearTimeout)
      if (dropdownObserver) dropdownObserver.disconnect()
    }
  }, [])

  // Show password dialog before loading check (passwordRequired drawings never set currentDataId)
  if (passwordRequired && !loading) {
    return (
      <PasswordDialog
        theme={theme}
        error={passwordError}
        onSubmit={handlePasswordSubmit}
        onCancel={() => navigate('/')}
      />
    )
  }

  // Zeige Loader, wenn explizit loading==true ODER wenn die sceneData noch zu einem alten Drawing gehören
  if (loading || currentDataId !== id) {
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
          <h2 style={styles.errorTitle}>⚠️ Error</h2>
          <p style={styles.errorText}>{error}</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
            <button 
              style={{
                padding: '10px 16px',
                borderRadius: '4px',
                border: '1px solid',
                background: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: theme === 'dark' ? '#e0e0e0' : '#333',
                borderColor: theme === 'dark' ? '#555' : '#ccc',
              }}
              onClick={() => window.history.back()}
            >
              ← Go Back
            </button>
            <Link 
              to="/"
              style={{
                padding: '10px 16px',
                borderRadius: '4px',
                border: '1px solid',
                background: 'none',
                textDecoration: 'none',
                fontSize: '14px',
                color: theme === 'dark' ? '#e0e0e0' : '#333',
                borderColor: theme === 'dark' ? '#555' : '#ccc',
              }}
            >
              🏠 Home
            </Link>
          </div>
          {!isMobile && (
          <button 
            style={{...styles.link, background: 'none', border: 'none', cursor: 'pointer', display: 'block', margin: '16px auto 0'}} 
            onClick={() => setShowOverlay(true)}
          >
            📂 Browse drawings
          </button>
          )}
        </div>
        {showOverlay && (
          <DrawingsBrowser mode="overlay" theme={theme} onClose={() => setShowOverlay(false)} currentDrawingId={id} initialDrawings={drawingsList.length > 0 ? drawingsList as any : undefined} onRefresh={loadDrawingsList} />
        )}
      </div>
    )
  }

  if (!sceneData) return null

  return (
    <div style={styles.container}>
      <style>{spinKeyframes}</style>
      <Excalidraw
        key={id}
        excalidrawAPI={(api: unknown) => setExcalidrawAPI(api)}
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
        onPointerUpdate={collab.isJoined ? handlePointerUpdate : undefined}
        viewModeEnabled={collab.isJoined ? false : (mode === 'view' || mode === 'present')}
        zenModeEnabled={collab.isJoined ? false : mode !== 'edit'}
        isCollaborating={collab.isJoined}
        theme={theme}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: (mode === 'edit' || collab.isJoined) ? { saveFileToDisk: true } : false,
            saveAsImage: mode === 'edit' || collab.isJoined,
            toggleTheme: true,
          },
        }}
        renderTopRightUI={() =>
          collab.isJoined ? (
            <LiveCollaborationTrigger
              isCollaborating={true}
              onSelect={() => setShowCollabPopover(prev => !prev)}
            />
          ) : null
        }
      />

      {/* Persistent collab badge */}
      {collab.isPersistentCollab && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: 60,
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 12,
          background: theme === 'dark' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
          border: `1px solid ${theme === 'dark' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)'}`,
          fontSize: 12,
          color: theme === 'dark' ? '#4ade80' : '#16a34a',
          pointerEvents: 'none',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#22c55e',
            display: 'inline-block',
          }} />
          Collaborative
        </div>
      )}

      {/* Collaboration Status — pre-join banner + session ended only */}
      <CollabStatus
        theme={theme}
        isCollabActive={collab.isCollabActive}
        isJoined={collab.isJoined}
        participantCount={collab.participantCount}
        displayName={collab.displayName}
        sessionEnded={collab.sessionEnded}
        passwordRequired={collab.collabPasswordRequired}
        passwordError={collab.collabPasswordError}
        onJoin={collab.joinSession}
        isPersistentCollab={collab.isPersistentCollab}
        onDismissSessionEnded={() => {
          collab.dismissSessionEnded()
          // Reload the drawing to get the latest saved state.
          // Must include the password key if the drawing is password-protected.
          if (id) {
            setLoading(true)
            const reloadUrl = currentPasswordRef.current
              ? `/api/view/${id}?key=${encodeURIComponent(currentPasswordRef.current)}`
              : `/api/view/${id}`
            fetch(reloadUrl)
              .then(res => res.json())
              .then(data => {
                drawingCache.set(id, data)
                setSceneData(data)
                setCurrentDataId(id)
                setTheme(data.appState?.theme || 'light')
                setLoading(false)
              })
              .catch(() => setLoading(false))
          }
        }}
      />

      {/* Collab Popover — shown when clicking LiveCollaborationTrigger */}
      {collab.isJoined && showCollabPopover && (
        <CollabPopover
          theme={theme}
          isConnected={collab.isConnected}
          collaborators={collab.collaborators}
          displayName={collab.displayName}
          followingUserId={collab.followingUserId}
          onLeave={() => {
            collab.leaveSession()
            setShowCollabPopover(false)
          }}
          onStartFollowing={collab.startFollowing}
          onStopFollowing={collab.stopFollowing}
          onClose={() => setShowCollabPopover(false)}
        />
      )}
      
      {/* Floating Action Buttons - hidden on mobile, use Obsidian ribbon instead */}
      {!isMobile && (
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
              // Only load if not already loaded
              if (drawingsList.length === 0 && !loadingDrawings) {
                loadDrawingsList()
              }
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
      )}

      {/* Presentation Mode Navigation - Bottom Center - Desktop only */}
      {mode === 'present' && !isMobile && (
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
        <DrawingsBrowser mode="overlay" theme={theme} onClose={() => setShowOverlay(false)} currentDrawingId={id} initialDrawings={drawingsList.length > 0 ? drawingsList as any : undefined} onRefresh={loadDrawingsList} />
      )}

      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} theme={theme} />
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
