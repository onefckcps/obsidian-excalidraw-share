# Progress: ExcaliShare

## Completed Features ✅

### Core Functionality
- [x] Backend API server (Rust/Axum) with upload, view, delete, list endpoints
- [x] Frontend viewer (React/Vite) with Excalidraw integration
- [x] Obsidian plugin for publishing drawings
- [x] PDF page embedding with crop rect support
- [x] Source path tracking (`_source_path` in JSON, frontmatter `excalishare-id`)
- [x] Drawing update support (re-upload with same ID)
- [x] Public drawings list endpoint (`/api/public/drawings`)

### Frontend Viewer
- [x] View mode (read-only, zen mode)
- [x] Edit mode (local editing, press `w` twice)
- [x] Present mode (slideshow navigation with arrows)
- [x] DrawingsBrowser with tree view, search, overlay mode
- [x] LRU drawing cache (50 MB limit)
- [x] Mobile toolbar injection (present/edit/browse buttons)
- [x] ExcaliShare links in Excalidraw help dropdown
- [x] About modal
- [x] Keyboard shortcuts (e, w, p/q, r, arrows, Escape)
- [x] PWA support with service worker caching

### Live Collaboration
- [x] Backend: SessionManager with in-memory sessions
- [x] Backend: WebSocket handler with broadcast channel
- [x] Backend: Version-based element merging (prevents deletion flickering)
- [x] Backend: Background session cleanup with auto-save
- [x] Backend: Participant management (join/leave/color assignment)
- [x] Frontend: `useCollab` hook (complete state management)
- [x] Frontend: `CollabClient` WebSocket wrapper (reconnect, debounce, throttle)
- [x] Frontend: CollabStatus (pre-join banner, session-ended notification)
- [x] Frontend: CollabPopover (participant list, follow controls)
- [x] Frontend: LiveCollaborationTrigger integration
- [x] Frontend: Real-time cursor/pointer display
- [x] Frontend: Drawing interruption deferral (queue during active drawing)
- [x] Frontend: Follow mode (viewport syncing via pointer updates)
- [x] Frontend: Click-to-follow on Excalidraw user badges
- [x] Frontend: Visual follow indicator (CSS outline on followed avatar)
- [x] Frontend: Auto-disconnect on drawing navigation
- [x] Plugin: Start/Stop collab commands
- [x] Plugin: CollabStopModal (save/discard/cancel)
- [x] Plugin: Health check polling (30s interval)
- [x] Plugin: Status bar indicator with participant count
- [x] Plugin: Auto-open browser on collab start
- [x] Plugin: Pull from server (sync changes back to vault)
- [x] Plugin: Native collab participation (WebSocket from Obsidian)
- [x] Plugin: CollabClient WebSocket wrapper (adapted from frontend)
- [x] Plugin: CollabManager (session lifecycle, change detection, cursor display)
- [x] Plugin: Polling-based change detection (250ms interval, version comparison)
- [x] Plugin: Deferred remote updates during active drawing (prevents stutter)
- [x] Plugin: Cached Excalidraw API reference (avoids expensive setView calls)
- [x] Plugin: Collaborator cursor display in Obsidian Excalidraw view
- [x] Plugin: Auto-sync disabled during active collab session
- [x] Plugin: Toolbar shows participant count and native connection status

### Security
- [x] Constant-time API key comparison (`subtle` crate)
- [x] Rate limiting (tower_governor, per-IP)
- [x] CORS restriction (BASE_URL + Obsidian origin only)
- [x] Unguessable session IDs (full 128-bit UUID)
- [x] WebSocket message size limit (5 MB)
- [x] Session capacity limit (20 participants)
- [x] Timeout clamping (5 min – 24 hours)
- [x] API key file loading in NixOS module
- [x] PWA cache scope limited to public routes
- [x] Path traversal protection (ID sanitization)

### Plugin UI
- [x] Modular file structure (settings.ts, toolbar.ts, styles.ts)
- [x] Floating toolbar with status dot
- [x] Expandable toolbar panel with all actions
- [x] Auto-sync on save (debounced)
- [x] Toolbar position configuration (4 positions)
- [x] Toolbar retry injection for mobile
- [x] CSS-in-JS with Obsidian theme variables
- [x] Context menu integration
- [x] Ribbon icons (publish, browse)

### Admin Panel
- [x] API key authentication
- [x] Drawing list with size, date, source path
- [x] Delete drawings
- [x] Active collab sessions display
- [x] End collab sessions
- [x] Auto-refresh (10s interval)

### Infrastructure
- [x] NixOS module (`nixos/module.nix`)
- [x] Systemd service with security hardening
- [x] Nix flake dev environment
- [x] Quick start script (`start.sh`)
- [x] DEPLOYMENT.md guide

## What's Working Well
- Real-time collaboration with cursor visibility and follow mode
- Version-based merging prevents most sync conflicts
- Drawing interruption deferral provides smooth editing experience during collab
- Floating toolbar in Obsidian provides quick access to all actions
- PWA caching makes the viewer fast for repeat visits
- Native collab from Obsidian — host can participate without opening a browser
- Deferred remote updates prevent stutter during active drawing in Obsidian

## Known Issues / Potential Improvements
- No automated tests (all manual testing)
- Collab sessions are in-memory only (lost on server restart)
- Large drawings may cause performance issues in collab (no delta updates, full scene sync)
- No user authentication for viewers
- DrawingsBrowser.tsx is very large (54K+ chars) — could benefit from splitting
- Viewer.tsx is very large (42K+ chars) — could benefit from splitting
- No conflict resolution UI (server always picks highest version)
- No undo/redo sync across collaborators
- Obsidian host cannot broadcast cursor position (no `onPointerUpdate` hook available in Excalidraw Obsidian plugin)
- Polling-based change detection adds ~250ms latency for outgoing changes from Obsidian (vs. instant in browser)
