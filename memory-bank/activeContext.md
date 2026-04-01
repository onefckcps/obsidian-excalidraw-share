# Active Context: ExcaliShare

## Current State (April 2026)
The project is feature-complete with the live collaboration system fully implemented and refined through multiple iterations. All three components (backend, frontend, plugin) are working together.

## Recently Completed Features

### 1. Live Collaboration System (Major Feature)
The entire real-time collaboration feature was designed and implemented across all three components:

#### Backend (`collab.rs`, `ws.rs`, `routes.rs`)
- **SessionManager** — In-memory session management with `Arc<RwLock<HashMap>>` for concurrent access
- **Version-based element merging** — `merge_elements()` resolves conflicts by comparing element versions; highest version wins, preventing deletion flickering
- **Broadcast channel** — `tokio::broadcast` with 256-message buffer for fan-out to all WebSocket clients
- **Participant management** — Join/leave with color index assignment, max 20 participants per session
- **Session lifecycle** — Create (auth required) → Join (WebSocket) → Update → End (save/discard)
- **Background cleanup** — Every 60 seconds, expired sessions are auto-saved to storage
- **WebSocket handler** — Bidirectional message routing with `tokio::select!` for concurrent send/receive tasks
- **Message filtering** — Scene updates and pointer updates are not echoed back to the sender
- **5 MB message size limit** on WebSocket to prevent memory abuse

#### Frontend (`useCollab.ts`, `collabClient.ts`, `CollabStatus.tsx`, `CollabPopover.tsx`)
- **`useCollab` hook** — Complete state management for collaboration (569 lines)
  - Status polling every 10 seconds when not joined
  - Auto-disconnect when navigating to a different drawing
  - Persistent collaborator map for Excalidraw (preserves pointer state across updates)
  - Drawing interruption deferral (queues remote updates during active drawing)
  - Safety flush interval (300ms) for deferred updates
  - Follow mode with viewport syncing
- **`CollabClient`** — WebSocket wrapper with:
  - Exponential backoff reconnect (1s, 2s, 4s, 8s, 16s)
  - Scene update debouncing (100ms)
  - Pointer update throttling (50ms)
  - Event emitter pattern
- **`CollabStatus`** — Pre-join UI: live session banner with participant count, join dialog with name input, session-ended notification
- **`CollabPopover`** — In-session UI: participant list with color dots, follow/unfollow toggle, leave button, following banner
- **Viewer integration** — `LiveCollaborationTrigger` from Excalidraw, `isCollaborating` prop, `onPointerUpdate` handler, click-to-follow on native user badges, CSS outline on followed user's avatar

#### Obsidian Plugin (`main.ts`)
- **Start/Stop Collab** commands and context menu items
- **CollabStopModal** — Save/Discard/Cancel dialog when stopping a session
- **Health check polling** — Every 30 seconds to detect if session ended externally
- **Status bar indicator** — "🔴 Live Collab" when session is active
- **Auto-open browser** — Optionally opens the web viewer when starting a collab session
- **Pull from server** — Syncs collab changes back to the vault (via Excalidraw API or manual JSON replacement)

### 2. Collaboration Bug Fixes (Iterative Refinement)
Multiple rounds of bug fixes documented in `plans/collab-bugfixes.md`:
- **Cursor visibility** — Fixed by using persistent `collaboratorMapRef` and syncing full Collaborator objects to Excalidraw
- **Deletion flickering** — Fixed with version-based merging on both server and client
- **Drawing interruption** — Fixed by deferring remote scene updates while user is actively drawing/resizing/editing
- **Follow mode** — Implemented viewport syncing via pointer_update messages with scrollX/scrollY/zoom
- **Click-to-follow on avatars** — Intercepts clicks on Excalidraw's native `.Avatar` elements using DOM index matching
- **Auto-exit follow** — Only on pointer down (not move), so follow mode remains usable

### 3. Security Fixes
Documented in `plans/security-fixes.md`:
- **Constant-time API key comparison** — `subtle::ConstantTimeEq` to prevent timing attacks
- **Rate limiting** — `tower_governor` with per-IP limits (120/s public, 30/s protected)
- **CORS restriction** — Only `BASE_URL` origin and `app://obsidian.md` allowed
- **Unguessable session IDs** — Full 128-bit UUIDs (not truncated)
- **WebSocket message size limit** — 5 MB max
- **Session capacity limit** — 20 participants max
- **Timeout clamping** — 5 min to 24 hours
- **API key file loading** — NixOS module loads API key from file at runtime, not in environment
- **PWA cache scope** — Only public API routes cached by service worker

### 4. Plugin UI Upgrade
Documented in `plans/plugin-ui-upgrade.md`:
- **Modular file structure** — Split monolithic `main.ts` into `settings.ts`, `toolbar.ts`, `styles.ts`
- **Floating toolbar** — Injected into Excalidraw canvas with status dot, expandable panel
- **Auto-sync on save** — Debounced file modify listener
- **Toolbar retry injection** — Handles mobile/tablet where DOM may not be ready immediately
- **CSS-in-JS with Obsidian variables** — Automatic theme compatibility

### 5. Frontend Enhancements
- **DrawingsBrowser** — Tree view with folder structure, search, overlay mode (54K+ lines)
- **LRU Drawing Cache** — 50 MB client-side cache for faster navigation
- **Mobile toolbar injection** — Present/Edit/Browse buttons injected into Excalidraw toolbar on mobile
- **ExcaliShare dropdown** — GitHub + About links injected into Excalidraw's help menu
- **Keyboard shortcuts** — `e` (browse), `w` (edit), `p`/`q` (present), `r` (refresh), arrows (navigate)

## Active Decisions
- Collab sessions are **in-memory only** — no persistence across server restarts (by design)
- Frontend uses **Excalidraw 0.17.6** — specific version pinned for API compatibility
- Plugin uses `requestUrl` from Obsidian API (not `fetch`) for cross-platform compatibility
- Drawing IDs stored in Obsidian frontmatter (`excalishare-id`)

## Known Limitations
- No automated tests (manual testing only)
- Collab sessions lost on server restart (in-memory)
- No user authentication for viewers (anyone with the URL can view)
- WebSocket has no auth — relies on unguessable session IDs
- Plugin can only manage one collab session at a time
