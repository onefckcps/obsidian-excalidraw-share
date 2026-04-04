import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Excalidraw, LiveCollaborationTrigger } from '@excalidraw/excalidraw'
import type { Theme, ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawData } from './types'
import { drawingCache } from './utils/cache'
import { useCollab } from './hooks/useCollab'
import { useBreakpoint } from './hooks/useBreakpoint'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import CollabStatus from './CollabStatus'
import CollabPopover from './CollabPopover'
import ScreenShareOverlay from './ScreenShareOverlay'
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
  const isOnline = useOnlineStatus()
  const [sceneData, setSceneData] = useState<ExcalidrawData | null>(null)
  const [currentDataId, setCurrentDataId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'network' | 'notfound' | 'server' | null>(null)
  const [loading, setLoading] = useState(true)
  /** True when showing a cached drawing because the server is unreachable */
  const [isCachedView, setIsCachedView] = useState(false)
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
  /** Tracks the number of active touch/pointer contacts on the Excalidraw canvas.
   * Incremented on touchstart, decremented on touchend/touchcancel.
   * When > 1, we suppress scene updates in handleExcalidrawChange to prevent
   * in-progress freedraw strokes from being broadcast during two-finger pan/pinch. */
  const activeTouchCountRef = useRef(0)
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [showScreenShareOverlay, setShowScreenShareOverlay] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  // Store the password used to successfully load a password-protected drawing,
  // so it can be reused for subsequent re-fetches (e.g. after session ends).
  const currentPasswordRef = useRef<string | undefined>(undefined)
  // Mobile collab popover style preference: bottom sheet (true) or dropdown (false)
  const [mobileCollabBottomSheet, setMobileCollabBottomSheet] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mobileCollabBottomSheet')
      if (saved === 'false') return false
    }
    return true // default: bottom sheet on mobile
  })

  const breakpoint = useBreakpoint()
  const isPhone = breakpoint === 'phone'
  // Excalidraw's mobile breakpoint — patched to 987px (was 730px).
  // At ≤987px Excalidraw renders MobileMenu with the bottom toolbar (.App-toolbar-content).
  // At >987px it renders the desktop toolbar (.App-toolbar-container).
  const isExcalidrawMobile = useMediaQuery('(max-width: 987px)')

  // Collaboration hook
  const collab = useCollab({ drawingId: id, excalidrawAPI })

  // Stable ref to screenShare so toolbar injection useEffect can use it
  // without adding object references to the dependency array (which would
  // cause the effect to re-run on every render and break button injection).
  const screenShareRef = useRef(collab.screenShare)
  screenShareRef.current = collab.screenShare
  // Derived primitive boolean for dependency array — triggers toolbar re-injection
  // when someone starts/stops sharing, without object reference churn.
  const hasActiveScreenSharer = !!collab.screenShare.activeSharer

  // Auto-show screen share overlay when a remote stream arrives
  useEffect(() => {
    if (collab.screenShare.remoteStream) {
      setShowScreenShareOverlay(true)
    }
  }, [collab.screenShare.remoteStream])

  // Auto-hide screen share overlay when the active sharer leaves
  useEffect(() => {
    if (!collab.screenShare.activeSharer) {
      setShowScreenShareOverlay(false)
    }
  }, [collab.screenShare.activeSharer])

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
    setIsCachedView(false)

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
          setIsCachedView(false)
          setLoading(false)
        }
      })
      .catch((err) => {
        // Ignoriere Abort-Errors, die wir selbst ausgelöst haben
        if (err.name === 'AbortError') return

        // Classify the error type
        const isNetworkError = err instanceof TypeError && err.message.includes('fetch')
        const isNotFound = err.message === 'Drawing not found'

        if (isNetworkError) {
          // Network error — try to serve from cache
          const cachedData = drawingCache.get(id)
          if (cachedData) {
            setSceneData(cachedData)
            setCurrentDataId(id)
            setTheme(cachedData.appState?.theme || 'light')
            setIsCachedView(true)
            setLoading(false)
            return
          }
          setErrorType('network')
        } else if (isNotFound) {
          setErrorType('notfound')
        } else {
          setErrorType('server')
        }

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

  const handleExcalidrawChange = useCallback((elements: readonly ExcalidrawElement[], appState: { theme?: Theme; userToFollow?: { socketId: string; username: string } | null; activeTool?: { type: string } }, files: BinaryFiles) => {
    setTheme(currentTheme => {
      // Nur updaten wenn sich das Theme wirklich geändert hat,
      // um endlose Re-Renders zu verhindern
      if (appState.theme && currentTheme !== appState.theme) {
        return appState.theme
      }
      return currentTheme
    })

    // Sync our follow state when Excalidraw's native follow mode is cleared
    // (e.g. user clicks the "X" on the native "Following" badge, or pans the canvas).
    // Guard against the loop: stopFollowing() calls updateScene({userToFollow:null}) which
    // triggers onChange again — suppressFollowSyncRef prevents re-entering stopFollowing.
    // Exception: laser pointer — Excalidraw clears userToFollow on every canvas click
    // (handleCanvasPointerDown → maybeUnfollowRemoteUser), but we want follow mode to
    // persist while the user is drawing with the laser pointer.
    const isLaserActive = appState.activeTool?.type === 'laser';
    if (collab.isJoined && collab.followingUserId && appState.userToFollow === null && !collab.suppressFollowSyncRef.current) {
      if (isLaserActive) {
        // Laser pointer cleared userToFollow — restore it so the "Following" badge stays visible.
        // The next onChange will have userToFollow set (not null), so no loop occurs.
        const api = excalidrawAPI as { updateScene?: (data: unknown) => void } | null;
        if (api?.updateScene) {
          const followedCollaborator = collab.collaborators.find(c => c.id === collab.followingUserId);
          api.updateScene({ appState: { userToFollow: { socketId: collab.followingUserId, username: followedCollaborator?.name || '' } } });
        }
      } else {
        collab.stopFollowing();
      }
    }

    // Send scene updates to collab session if joined.
    // Guard: suppress scene updates during multi-touch gestures (two-finger pan/pinch-zoom).
    // When the first finger touches down, Excalidraw may start a freedraw stroke and fire
    // onChange with the in-progress element — if a second finger then arrives (converting the
    // gesture to a pan), the partial stroke must NOT be broadcast to other clients.
    // activeTouchCountRef is updated by native touchstart/touchend listeners (see useEffect below).
    if (collab.isJoined && collab.isConnected) {
      if (activeTouchCountRef.current <= 1) {
        collab.sendSceneUpdate(elements as ExcalidrawElement[])
        // Send any new binary files (images) — CollabClient handles delta tracking
        if (files && Object.keys(files).length > 0) {
          collab.sendFilesUpdate(files)
        }
      }
    }
  }, [collab.isJoined, collab.isConnected, collab.followingUserId, collab.collaborators, collab.stopFollowing, collab.suppressFollowSyncRef, collab.sendSceneUpdate, collab.sendFilesUpdate, excalidrawAPI])

  const handlePointerUpdate = useCallback((payload: { pointer: { x: number; y: number; tool: string }; button: 'down' | 'up'; pointersMap: Map<number, Readonly<{ x: number; y: number }>> }) => {
    if (collab.isJoined && collab.isConnected) {
      // Suppress multi-touch gestures (two-finger pan/pinch-zoom).
      // Excalidraw fires onPointerUpdate for each touch point individually, so during a
      // two-finger pan the cursor would jump between both finger positions and — with the
      // laser/pen tool active — draw lines between them. Skip all pointer broadcasts
      // whenever more than one touch point is active.
      // Note: activeTouchCountRef (updated by native touchstart/touchend) is the primary guard
      // for scene updates in handleExcalidrawChange. pointersMap.size guards pointer broadcasts here.
      if (payload.pointersMap.size > 1) return;

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
      // (not on every pointer move, which would make follow mode unusable).
      // Exception: laser pointer — using the laser should not exit follow mode.
      if (collab.followingUserId && payload.button === 'down' && tool !== 'laser') {
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

      // Stop propagation to prevent Excalidraw's native goToCollaborator action
      // from also firing and double-toggling the follow state.
      // Without this, our capture-phase handler sets userToFollow, then Excalidraw's
      // native handler sees it's already set and toggles it OFF — cancelling the follow.
      e.stopPropagation();

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

  // Note: The visual follow indicator (is-followed CSS class on the Avatar) is now handled
  // natively by Excalidraw via appState.userToFollow, which is synced in startFollowing/stopFollowing.

  // ──────────────────────────────────────────────
  // Multi-touch tracking for scene update suppression
  // Track the number of active touch contacts on the Excalidraw canvas using native
  // touchstart/touchend events. When activeTouchCountRef > 1, handleExcalidrawChange
  // suppresses scene updates to prevent in-progress freedraw strokes (started by the
  // first finger before the second finger arrives) from being broadcast to other clients.
  //
  // Why native touch events instead of pointersMap from onPointerUpdate:
  // - touchstart fires synchronously before onChange, so the count is already > 1
  //   when the second finger arrives and onChange fires with the in-progress stroke.
  // - pointersMap only updates when onPointerUpdate fires, which may lag behind onChange.
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!collab.isJoined) return;

    const handleTouchStart = (e: TouchEvent) => {
      activeTouchCountRef.current = e.touches.length;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const wasMultiTouch = activeTouchCountRef.current > 1;
      activeTouchCountRef.current = e.touches.length;
      // When transitioning from multi-touch back to zero fingers, cancel any pending
      // debounced scene update that was accumulated during the gesture (e.g., the partial
      // freedraw stroke started by the first finger before the second finger arrived).
      // Only cancel if we were in multi-touch — single-finger strokes should still be sent.
      if (wasMultiTouch && e.touches.length === 0) {
        collab.cancelPendingSceneUpdate();
      }
    };
    const handleTouchCancel = (e: TouchEvent) => {
      const wasMultiTouch = activeTouchCountRef.current > 1;
      activeTouchCountRef.current = e.touches.length;
      if (wasMultiTouch && e.touches.length === 0) {
        collab.cancelPendingSceneUpdate();
      }
    };

    // Attach to document to catch all touch events regardless of target
    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchCancel, true);
      activeTouchCountRef.current = 0;
    };
  }, [collab.isJoined, collab.cancelPendingSceneUpdate]);

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

  // Inject ExcaliShare buttons into Excalidraw's native toolbar (all screen sizes)
  // ≤987px (isExcalidrawMobile): inject into bottom toolbar (.App-toolbar-content)
  // >987px (tablet/desktop): inject a new Island into the upper toolbar (.App-toolbar-container)
  useEffect(() => {
    const currentMode = mode as string
    const containerClass = 'excalishare-toolbar'
    let observer: MutationObserver | null = null
    const collabIsJoined = collab.isJoined
    const collabIsPersistent = collab.isPersistentCollab
    const collabReconnectState = collab.reconnectState
    const collabReconnectAttempt = collab.reconnectAttempt
    const collabMaxReconnectAttempts = collab.maxReconnectAttempts
    const currentIsCachedView = isCachedView
    const currentIsOnline = isOnline

    // Common button styles for phone (bottom toolbar)
    const getPhoneButtonStyle = (isActive: boolean, activeColor: string) => `
      background: ${isActive ? activeColor : (theme === 'dark' ? '#333' : '#fff')};
      border: 1px solid ${isActive ? activeColor : (theme === 'dark' ? '#555' : '#ccc')};
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 16px;
      color: ${theme === 'dark' ? '#fff' : '#000'};
      opacity: 1;
    `

    const getPhoneSmallButtonStyle = () => `
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

    // Desktop/Tablet button style (matches Excalidraw ToolIcon look)
    const getDesktopButtonStyle = (isActive: boolean, activeColor: string) => `
      width: 28px;
      height: 28px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
      border: none;
      background: ${isActive ? activeColor : 'transparent'};
      color: ${isActive ? '#fff' : 'inherit'};
      transition: background 0.15s ease;
      padding: 0;
      line-height: 1;
    `

    const injectButtons = () => {
      // Remove existing containers first
      document.querySelectorAll(`.${containerClass}`).forEach(el => el.remove())

      if (isExcalidrawMobile) {
        // ═══════════════════════════════════════════
        // EXCALIDRAW MOBILE (≤987px): inject into bottom toolbar
        // ═══════════════════════════════════════════
        const toolbar = document.querySelector('.App-toolbar-content')
        if (!toolbar) return
        if (toolbar.querySelector(`.${containerClass}`)) return

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

          const prevBtn = document.createElement('button')
          prevBtn.textContent = '◀'
          prevBtn.title = 'Previous (←)'
          prevBtn.style.cssText = getPhoneSmallButtonStyle()
          prevBtn.onclick = () => {
            if (drawingsList.length === 0) { loadDrawingsList(); return }
            const idx = drawingsList.findIndex(d => d.id === id)
            if (idx > 0) navigate(`/d/${drawingsList[idx - 1].id}`)
          }

          const counter = document.createElement('span')
          const idx = drawingsList.findIndex(d => d.id === id)
          counter.textContent = drawingsList.length > 0 ? `${idx + 1} / ${drawingsList.length}` : '...'
          counter.style.cssText = `
            color: ${theme === 'dark' ? '#e0e0e0' : '#333'};
            font-size: 16px;
            padding: 4px 8px;
            font-family: system-ui, -apple-system, sans-serif;
          `

          const nextBtn = document.createElement('button')
          nextBtn.textContent = '▶'
          nextBtn.title = 'Next (→)'
          nextBtn.style.cssText = getPhoneSmallButtonStyle()
          nextBtn.onclick = () => {
            if (drawingsList.length === 0) { loadDrawingsList(); return }
            const idx = drawingsList.findIndex(d => d.id === id)
            if (idx < drawingsList.length - 1) navigate(`/d/${drawingsList[idx + 1].id}`)
          }

          const exitBtn = document.createElement('button')
          exitBtn.textContent = '✕'
          exitBtn.title = 'Exit present mode'
          exitBtn.style.cssText = getPhoneSmallButtonStyle()
          exitBtn.onclick = () => setMode('view')

          container.append(prevBtn, counter, nextBtn, exitBtn)
          toolbar.appendChild(container)
          return
        }

        // NON-PRESENT MODE - inject normal buttons + collab button
        const container = document.createElement('div')
        container.className = containerClass
        container.style.cssText = `
          display: flex;
          gap: 8px;
          margin-left: 12px;
          padding: 4px 0;
          align-items: center;
        `

        const presentBtn = document.createElement('button')
        presentBtn.textContent = '▶️'
        presentBtn.title = 'Present mode (p/q)'
        presentBtn.style.cssText = getPhoneButtonStyle(false, '#2196F3')
        presentBtn.onclick = () => {
          setMode('present')
          if (drawingsList.length === 0 && !loadingDrawings) {
            setLoadingDrawings(true)
            fetch('/api/public/drawings')
              .then(res => res.json())
              .then(data => { setDrawingsList(data.drawings || []); setLoadingDrawings(false) })
              .catch(() => setLoadingDrawings(false))
          }
        }

        const editBtn = document.createElement('button')
        const isEdit = currentMode === 'edit'
        editBtn.textContent = isEdit ? '✏️' : '🔒'
        editBtn.title = isEdit ? 'Exit edit mode' : 'Edit mode (w)'
        editBtn.style.cssText = getPhoneButtonStyle(isEdit, '#ff9800')
        editBtn.onclick = () => { isEdit ? setMode('view') : setShowEditWarning(true) }

        const browseBtn = document.createElement('button')
        browseBtn.textContent = '📂'
        browseBtn.title = 'Browse all drawings (e)'
        browseBtn.style.cssText = getPhoneButtonStyle(false, '')
        browseBtn.onclick = () => setShowOverlay(true)

        container.append(presentBtn, editBtn, browseBtn)

        // Collab button — only when joined to a session (replaces renderTopRightUI on phone)
        if (collabIsJoined) {
          const collabBtn = document.createElement('button')
          collabBtn.textContent = '🤝'
          collabBtn.title = 'Collaboration'
          collabBtn.style.cssText = getPhoneButtonStyle(true, '#4CAF50')
          collabBtn.style.position = 'relative'
          // Green dot indicator
          const dot = document.createElement('span')
          dot.style.cssText = `
            position: absolute; top: -2px; right: -2px;
            width: 8px; height: 8px; border-radius: 50%;
            background: #4CAF50; border: 1px solid ${theme === 'dark' ? '#333' : '#fff'};
          `
          collabBtn.appendChild(dot)
          collabBtn.onclick = () => setShowCollabPopover((prev: boolean) => !prev)
          container.append(collabBtn)

          // Screen share button — only when joined to a session
          const screenShareBtn = document.createElement('button')
          const isScreenSharing = screenShareRef.current.isSharing
          const hasActiveSharer = !!screenShareRef.current.activeSharer
          screenShareBtn.textContent = '📺'
          screenShareBtn.title = isScreenSharing
            ? 'Stop sharing'
            : hasActiveSharer ? 'View screen share'
            : 'Share screen'
          screenShareBtn.style.cssText = getPhoneButtonStyle(
            isScreenSharing || hasActiveSharer,
            isScreenSharing ? '#f44336' : '#4CAF50'
          )
          screenShareBtn.onclick = () => {
            if (screenShareRef.current.isSharing) {
              screenShareRef.current.stopSharing()
            } else if (screenShareRef.current.activeSharer) {
              setShowScreenShareOverlay((prev: boolean) => !prev)
            } else {
              screenShareRef.current.startSharing()
            }
          }
          container.append(screenShareBtn)
        }

        toolbar.appendChild(container)
      } else {
        // ═══════════════════════════════════════════
        // UPPER TOOLBAR (>987px): inject new Island
        // Covers: tablet (988–1400px), desktop (>1400px)
        // ═══════════════════════════════════════════
        const toolbarContainer = document.querySelector('.App-toolbar-container')
        if (!toolbarContainer) return
        if (toolbarContainer.querySelector(`.${containerClass}`)) return

        const island = document.createElement('div')
        island.className = `Island ${containerClass}`
        island.style.cssText = `
          margin-left: 8px;
          align-self: center;
          height: fit-content;
          padding: 4px;
          display: flex;
          gap: 4px;
          align-items: center;
        `

        // PRESENT MODE on desktop/tablet
        if (currentMode === 'present') {
          const prevBtn = document.createElement('button')
          prevBtn.textContent = '◀'
          prevBtn.title = 'Previous (←)'
          prevBtn.style.cssText = getDesktopButtonStyle(false, '')
          prevBtn.onclick = () => navigateToPrevDrawing()

          const counter = document.createElement('span')
          const idx = drawingsList.findIndex(d => d.id === id)
          counter.textContent = drawingsList.length > 0 ? `${idx + 1}/${drawingsList.length}` : '...'
          counter.style.cssText = `
            font-size: 12px; padding: 0 4px;
            color: ${theme === 'dark' ? '#e0e0e0' : '#333'};
            font-family: system-ui, -apple-system, sans-serif;
          `

          const nextBtn = document.createElement('button')
          nextBtn.textContent = '▶'
          nextBtn.title = 'Next (→)'
          nextBtn.style.cssText = getDesktopButtonStyle(false, '')
          nextBtn.onclick = () => navigateToNextDrawing()

          const divider = document.createElement('div')
          divider.className = 'App-toolbar__divider'

          const exitBtn = document.createElement('button')
          exitBtn.textContent = '✕'
          exitBtn.title = 'Exit present mode'
          exitBtn.style.cssText = getDesktopButtonStyle(false, '')
          exitBtn.onclick = () => setMode('view')

          island.append(prevBtn, counter, nextBtn, divider, exitBtn)
          toolbarContainer.appendChild(island)
          return
        }

        // NON-PRESENT MODE
        const presentBtn = document.createElement('button')
        presentBtn.textContent = '▶️'
        presentBtn.title = 'Present mode (p/q)'
        presentBtn.style.cssText = getDesktopButtonStyle(currentMode === 'present', '#2196F3')
        presentBtn.classList.add('excalishare-btn')
        presentBtn.onclick = () => {
          setMode('present')
          if (drawingsList.length === 0 && !loadingDrawings) loadDrawingsList()
        }

        const editBtn = document.createElement('button')
        const isEdit = currentMode === 'edit'
        editBtn.textContent = isEdit ? '✏️' : '🔒'
        editBtn.title = isEdit ? 'Exit edit mode' : 'Edit mode (w)'
        editBtn.style.cssText = getDesktopButtonStyle(isEdit, '#ff9800')
        editBtn.classList.add('excalishare-btn')
        editBtn.onclick = () => { isEdit ? setMode('view') : setShowEditWarning(true) }

        const browseBtn = document.createElement('button')
        browseBtn.textContent = '📂'
        browseBtn.title = 'Browse all drawings (e)'
        browseBtn.style.cssText = getDesktopButtonStyle(false, '')
        browseBtn.classList.add('excalishare-btn')
        browseBtn.onclick = () => setShowOverlay(true)

        island.append(presentBtn, editBtn, browseBtn)

        // Screen share button — only when joined to a collab session
        if (collabIsJoined) {
          const isScreenSharing = screenShareRef.current.isSharing
          const hasActiveSharer = !!screenShareRef.current.activeSharer
          const screenShareBtn = document.createElement('button')
          screenShareBtn.textContent = '📺'
          screenShareBtn.title = isScreenSharing
            ? 'Stop sharing'
            : hasActiveSharer ? 'View screen share'
            : 'Share screen'
          screenShareBtn.style.cssText = getDesktopButtonStyle(
            isScreenSharing || hasActiveSharer,
            isScreenSharing ? '#f44336' : '#4CAF50'
          )
          screenShareBtn.classList.add('excalishare-btn')
          screenShareBtn.onclick = () => {
            if (screenShareRef.current.isSharing) {
              screenShareRef.current.stopSharing()
            } else if (screenShareRef.current.activeSharer) {
              setShowScreenShareOverlay((prev: boolean) => !prev)
            } else {
              screenShareRef.current.startSharing()
            }
          }
          island.appendChild(screenShareBtn)
        }

        // Offline / cached view badge — shown when server is unreachable
        if (currentIsCachedView || !currentIsOnline) {
          const dividerOffline = document.createElement('div')
          dividerOffline.className = 'App-toolbar__divider'
          island.appendChild(dividerOffline)

          const offlineBadge = document.createElement('div')
          const offlineText = !currentIsOnline ? 'Offline' : 'Cached · Server unreachable'
          const offlineTitle = !currentIsOnline
            ? 'You are offline. Showing cached drawing.'
            : 'Server is unreachable. Showing cached version.'
          offlineBadge.title = offlineTitle

          if (breakpoint === 'desktop') {
            offlineBadge.style.cssText = `
              display: flex; align-items: center; gap: 4px;
              padding: 2px 8px; border-radius: 10px;
              background: rgba(107, 114, 128, 0.1);
              border: 1px solid rgba(107, 114, 128, 0.3);
              font-size: 11px; color: #6b7280;
              font-family: system-ui, -apple-system, sans-serif;
              white-space: nowrap; pointer-events: none;
            `
            offlineBadge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#9ca3af;display:inline-block"></span> ${offlineText}`
          } else {
            // Tablet: compact gray dot
            offlineBadge.style.cssText = `
              width: 8px; height: 8px; border-radius: 50%;
              background: #9ca3af; flex-shrink: 0;
            `
          }
          island.appendChild(offlineBadge)
        }

        // Persistent collab badge — shows connection state when joined
        if (collabIsPersistent || (collabIsJoined && collabReconnectState !== 'idle')) {
          const divider = document.createElement('div')
          divider.className = 'App-toolbar__divider'
          island.appendChild(divider)

          // Determine badge color and text based on connection state
          let dotColor = '#22c55e'
          let dotAnimation = ''
          let badgeText = 'Collaborative'
          let badgeBg = 'rgba(34, 197, 94, 0.1)'
          let badgeBorder = 'rgba(34, 197, 94, 0.2)'
          let badgeColor = '#16a34a'
          let badgeTitle = 'Collaborative drawing'

          if (collabIsJoined && collabReconnectState === 'reconnecting') {
            dotColor = '#f59e0b'
            dotAnimation = 'excalishare-pulse 1s ease-in-out infinite'
            const maxStr = collabMaxReconnectAttempts >= 999 ? '∞' : String(collabMaxReconnectAttempts)
            badgeText = `Reconnecting ${collabReconnectAttempt}/${maxStr}`
            badgeBg = 'rgba(245, 158, 11, 0.1)'
            badgeBorder = 'rgba(245, 158, 11, 0.3)'
            badgeColor = '#b45309'
            badgeTitle = `Reconnecting to collab session (attempt ${collabReconnectAttempt})`
          } else if (collabIsJoined && collabReconnectState === 'failed') {
            dotColor = '#ef4444'
            badgeText = 'Disconnected'
            badgeBg = 'rgba(239, 68, 68, 0.1)'
            badgeBorder = 'rgba(239, 68, 68, 0.3)'
            badgeColor = '#b91c1c'
            badgeTitle = 'Disconnected from collab session'
          }

          if (breakpoint === 'desktop') {
            // Desktop: full text badge
            const badge = document.createElement('div')
            badge.style.cssText = `
              display: flex; align-items: center; gap: 4px;
              padding: 2px 8px; border-radius: 10px;
              background: ${badgeBg};
              border: 1px solid ${badgeBorder};
              font-size: 11px; color: ${badgeColor};
              font-family: system-ui, -apple-system, sans-serif;
              white-space: nowrap;
            `
            badge.title = badgeTitle
            const dotEl = document.createElement('span')
            dotEl.style.cssText = `width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0;`
            if (dotAnimation) dotEl.style.animation = dotAnimation
            badge.appendChild(dotEl)
            badge.appendChild(document.createTextNode(' ' + badgeText))

            // Add retry button when disconnected
            if (collabIsJoined && collabReconnectState === 'failed') {
              const retryBtn = document.createElement('button')
              retryBtn.textContent = '↻'
              retryBtn.title = 'Retry connection'
              retryBtn.style.cssText = `
                margin-left: 4px; padding: 0 4px; border: none; background: none;
                cursor: pointer; font-size: 13px; color: ${badgeColor};
                line-height: 1;
              `
              retryBtn.onclick = (e) => {
                e.stopPropagation()
                collab.manualReconnect()
              }
              badge.appendChild(retryBtn)
            }

            island.appendChild(badge)
          } else {
            // Tablet: compact colored dot with tooltip
            const dot = document.createElement('div')
            dot.title = badgeTitle
            dot.style.cssText = `
              width: 8px; height: 8px; border-radius: 50%;
              background: ${dotColor}; flex-shrink: 0;
            `
            if (dotAnimation) dot.style.animation = dotAnimation
            island.appendChild(dot)

            // Add retry button when disconnected (tablet)
            if (collabIsJoined && collabReconnectState === 'failed') {
              const retryBtn = document.createElement('button')
              retryBtn.textContent = '↻'
              retryBtn.title = 'Retry connection'
              retryBtn.style.cssText = `
                padding: 0 2px; border: none; background: none;
                cursor: pointer; font-size: 12px; color: #b91c1c;
                line-height: 1;
              `
              retryBtn.onclick = (e) => {
                e.stopPropagation()
                collab.manualReconnect()
              }
              island.appendChild(retryBtn)
            }
          }
        }

        // Collab button — for isPhone range (≤1140px) where renderTopRightUI is null
        if (isPhone && collabIsJoined) {
          const divider2 = document.createElement('div')
          divider2.className = 'App-toolbar__divider'
          island.appendChild(divider2)

          // Dot color reflects connection state
          const dotColor = collabReconnectState === 'reconnecting' ? '#f59e0b'
            : collabReconnectState === 'failed' ? '#ef4444'
            : '#4CAF50'
          const dotAnimation = collabReconnectState === 'reconnecting' ? 'excalishare-pulse 1s ease-in-out infinite' : ''

          const collabBtn = document.createElement('button')
          collabBtn.textContent = '🤝'
          collabBtn.title = collabReconnectState === 'reconnecting'
            ? `Reconnecting... (${collabReconnectAttempt}/${collabMaxReconnectAttempts >= 999 ? '∞' : collabMaxReconnectAttempts})`
            : collabReconnectState === 'failed' ? 'Disconnected — tap to retry'
            : 'Collaboration'
          collabBtn.style.cssText = getDesktopButtonStyle(true, '#4CAF50')
          collabBtn.classList.add('excalishare-btn')
          collabBtn.style.position = 'relative'
          const dot = document.createElement('span')
          dot.style.cssText = `
            position: absolute; top: -2px; right: -2px;
            width: 8px; height: 8px; border-radius: 50%;
            background: ${dotColor}; border: 1px solid ${theme === 'dark' ? '#1e1e1e' : '#fff'};
          `
          if (dotAnimation) dot.style.animation = dotAnimation
          collabBtn.appendChild(dot)
          collabBtn.onclick = () => {
            if (collabReconnectState === 'failed') {
              collab.manualReconnect()
            } else {
              setShowCollabPopover((prev: boolean) => !prev)
            }
          }
          island.appendChild(collabBtn)
        }

        toolbarContainer.appendChild(island)
      }
    }

    // Try immediate injection - use rAF for faster execution after paint
    const tryInject = () => {
      const target = isExcalidrawMobile
        ? document.querySelector('.App-toolbar-content')
        : document.querySelector('.App-toolbar-container')
      if (target) injectButtons()
    }

    // Track all timers for proper cleanup
    const rAfId = requestAnimationFrame(tryInject)
    const timers = [
      setTimeout(tryInject, 50),
      setTimeout(tryInject, 100),
      setTimeout(tryInject, 200),
      setTimeout(injectButtons, 300)
    ]

    // MutationObserver to detect when toolbar is added
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('App-toolbar-content') ||
                node.classList.contains('App-toolbar-container') ||
                node.querySelector?.('.App-toolbar-content') ||
                node.querySelector?.('.App-toolbar-container')) {
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
      document.querySelectorAll(`.${containerClass}`).forEach(el => el.remove())
    }
  // Note: collab.screenShare.startSharing, .stopSharing are intentionally
  // excluded from deps — they are accessed via screenShareRef.current inside the effect
  // to avoid object reference churn causing constant re-runs that break button injection.
  // collab.screenShare.isSharing and hasActiveScreenSharer are primitive booleans
  // so they're safe to include and ensure the button updates when sharing state changes.
  }, [breakpoint, isPhone, isExcalidrawMobile, mode, theme, showOverlay, id, loadDrawingsList, loading, sceneData, collab.isJoined, collab.isPersistentCollab, collab.reconnectState, collab.reconnectAttempt, collab.maxReconnectAttempts, collab.manualReconnect, isCachedView, isOnline, drawingsList, loadingDrawings, navigate, navigateToPrevDrawing, navigateToNextDrawing, collab.screenShare.isSharing, hasActiveScreenSharer])

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
    const isNetworkErr = errorType === 'network'
    const isNotFoundErr = errorType === 'notfound'
    const errorTitle = isNetworkErr ? '📡 Server Unreachable'
      : isNotFoundErr ? '🔍 Drawing Not Found'
      : '⚠️ Error'
    const errorMessage = isNetworkErr
      ? 'Could not connect to the server. Please check your connection and try again.'
      : isNotFoundErr
      ? 'This drawing does not exist or has been deleted.'
      : error

    return (
      <div style={styles.center}>
        <div style={styles.errorBox}>
          <h2 style={styles.errorTitle}>{errorTitle}</h2>
          <p style={styles.errorText}>{errorMessage}</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
            {isNetworkErr && (
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
                onClick={() => {
                  if (id) {
                    setError(null)
                    setErrorType(null)
                    setLoading(true)
                    fetchDrawing(id, currentPasswordRef.current)
                      .then((result) => {
                        if (result.data) {
                          drawingCache.set(id, result.data)
                          setSceneData(result.data)
                          setCurrentDataId(id)
                          setTheme(result.data.appState?.theme || 'light')
                          setLoading(false)
                        }
                      })
                      .catch((err) => {
                        setError(err.message)
                        setErrorType('network')
                        setLoading(false)
                      })
                  }
                }}
              >
                ↻ Retry
              </button>
            )}
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
          {!isPhone && (
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
          // On phone, collab button is injected into the bottom toolbar instead
          isPhone ? null : (
            collab.isJoined ? (
              <LiveCollaborationTrigger
                isCollaborating={true}
                onSelect={() => setShowCollabPopover(prev => !prev)}
              />
            ) : null
          )
        }
      />

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
        isPhone={isPhone}
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

      {/* Collab Popover — shown when clicking LiveCollaborationTrigger or phone collab button */}
      {collab.isJoined && showCollabPopover && (
        <CollabPopover
          theme={theme}
          isConnected={collab.isConnected}
          reconnectState={collab.reconnectState}
          reconnectAttempt={collab.reconnectAttempt}
          maxReconnectAttempts={collab.maxReconnectAttempts}
          onManualReconnect={collab.manualReconnect}
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
          isPhone={isPhone}
          useBottomSheet={mobileCollabBottomSheet}
          onToggleBottomSheet={(value) => {
            setMobileCollabBottomSheet(value)
            localStorage.setItem('mobileCollabBottomSheet', String(value))
          }}
          isSharing={collab.screenShare.isSharing}
          activeSharer={collab.screenShare.activeSharer}
          onStartSharing={collab.screenShare.startSharing}
          onStopSharing={collab.screenShare.stopSharing}
        />
      )}

      {/* Screen Share Overlay — shown when viewing a remote screen share */}
      {collab.screenShare.remoteStream && showScreenShareOverlay && (
        <ScreenShareOverlay
          theme={theme}
          stream={collab.screenShare.remoteStream}
          sharerName={collab.screenShare.activeSharer?.name || 'Unknown'}
          sharerUserId={collab.screenShare.activeSharer?.userId || ''}
          onClose={() => setShowScreenShareOverlay(false)}
        />
      )}

      {/* Floating buttons and presentation nav are now injected into the toolbar */}
      
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
