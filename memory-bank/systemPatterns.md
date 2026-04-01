# System Patterns: ExcaliShare

## Architecture Overview

```
┌─────────────────┐     HTTP/WS      ┌──────────────────┐     HTTP      ┌─────────────────┐
│  Obsidian Plugin │ ──────────────→  │  Rust/Axum       │ ←──────────  │  React Frontend  │
│  (TypeScript)    │  API + Collab    │  Backend         │  API + WS    │  (Vite + PWA)    │
└─────────────────┘                   │  Port 8184       │              └─────────────────┘
                                      │                  │
                                      │  ┌────────────┐  │
                                      │  │ FileSystem  │  │
                                      │  │ Storage     │  │
                                      │  │ (JSON files)│  │
                                      │  └────────────┘  │
                                      │                  │
                                      │  ┌────────────┐  │
                                      │  │ Session     │  │
                                      │  │ Manager     │  │
                                      │  │ (in-memory) │  │
                                      │  └────────────┘  │
                                      └──────────────────┘
```

## Backend Architecture (Rust/Axum)

### Module Structure
- `main.rs` — Entry point, CLI config (clap), route registration, CORS, rate limiting, background cleanup task
- `routes.rs` — All HTTP handlers (upload, get, delete, list, collab start/stop/status/sessions)
- `storage.rs` — `DrawingStorage` trait + `FileSystemStorage` implementation
- `auth.rs` — Bearer token middleware with constant-time comparison (`subtle` crate)
- `error.rs` — `AppError` enum with `IntoResponse` impl
- `collab.rs` — `SessionManager`, `CollabSession`, message types, version-based element merging
- `ws.rs` — WebSocket upgrade handler, bidirectional message routing

### Route Organization
- **Public routes** (no auth): `/api/health`, `/api/public/drawings`, `/api/view/{id}`, `/api/collab/status/{drawing_id}`
- **Protected routes** (Bearer token): `/api/upload`, `/api/drawings/{id}` (DELETE), `/api/drawings` (GET), `/api/collab/start`, `/api/collab/stop`, `/api/collab/sessions`
- **WebSocket**: `/ws/collab/{session_id}` (no auth, but session must exist — security via unguessable UUID)

### Rate Limiting
- Public: 120 req/sec per IP (burst)
- Protected: 30 req/sec per IP (burst)
- Implemented via `tower_governor`

### Storage Pattern
- Each drawing is `<id>.json` in `DATA_DIR`
- Source path stored as `_source_path` field inside the JSON
- ID sanitization: alphanumeric, `-`, `_` only (path traversal protection)
- IDs: 16-char truncated UUID for new drawings, or client-provided (1-64 chars)

### CORS Configuration
- Allowed origins: configured `BASE_URL` + `app://obsidian.md`
- Allowed methods: GET, POST, DELETE, OPTIONS
- Allowed headers: Authorization, Content-Type

## Frontend Architecture (React/Vite)

### Component Structure
- `App.tsx` — Router: `/` and `/d/:id` → Viewer, `/admin` → AdminPage
- `Viewer.tsx` — Main drawing viewer (1000+ lines), handles all modes, keyboard shortcuts, mobile toolbar injection
- `DrawingsBrowser.tsx` — Browse/search drawings with tree view, overlay mode
- `AdminPage.tsx` — Admin panel with drawing management and collab session management
- `CollabStatus.tsx` — Pre-join banner and session-ended notification overlay
- `CollabPopover.tsx` — In-session popover showing participants, follow mode controls
- `AboutModal.tsx` — About dialog

### Hooks
- `useCollab.ts` — Complete collaboration state management (569 lines), handles WebSocket lifecycle, scene merging, pointer updates, follow mode, drawing interruption deferral

### Utilities
- `cache.ts` — LRU `DrawingCache` class (50 MB limit, singleton `drawingCache`)
- `collabClient.ts` — `CollabClient` WebSocket wrapper with reconnect, debounce, throttle

### Shared Types (`types/index.ts`)
- `ExcalidrawData`, `PublicDrawing`
- `CollaboratorInfo`, `CollabStatusResponse`, `CollabSessionInfo`
- `ClientMessage` (union: scene_update, pointer_update, set_name)
- `ServerMessage` (union: snapshot, scene_update, pointer_update, user_joined, user_left, session_ended, error)

### Styling Pattern
- Inline styles with typed `styles` object at component end
- `const styles: Record<string, React.CSSProperties> = { ... }`
- Mobile breakpoint: 730px via `useMediaQuery`

### PWA Configuration
- Service worker with NetworkFirst caching for public API routes
- Excludes authenticated endpoints from caching
- 5 MB max file size for cache

## Obsidian Plugin Architecture

### File Structure (Modular)
- `main.ts` — Plugin class, commands, context menu, toolbar management, API methods
- `settings.ts` — `ExcaliShareSettings` interface, `ExcaliShareSettingTab`, defaults
- `toolbar.ts` — `ExcaliShareToolbar` class (floating toolbar DOM management)
- `styles.ts` — CSS-in-JS styles, icons, colors, position helpers, global style injection
- `pdfUtils.ts` — PDF-to-PNG conversion utilities

### Plugin Settings
```typescript
interface ExcaliShareSettings {
  apiKey: string;
  baseUrl: string;
  pdfScale: number;                    // 0.5 - 5.0
  collabTimeoutSecs: number;           // default 7200 (2h)
  collabAutoOpenBrowser: boolean;      // auto-open browser on collab start
  showFloatingToolbar: boolean;        // toggle floating toolbar
  toolbarPosition: ToolbarPosition;    // top-right, top-left, bottom-right, bottom-left
  autoSyncOnSave: boolean;             // auto-sync on file modify
  autoSyncDelaySecs: number;           // debounce delay (1-30s)
  toolbarCollapsedByDefault: boolean;  // start collapsed
}
```

### Toolbar States
- `unpublished` — Drawing not yet published
- `published` — Drawing published, can sync/copy link/start collab
- `syncing` — Currently syncing
- `collabActive` — Live collab session active
- `error` — Error state

### Published ID Tracking
- Stored in Obsidian frontmatter as `excalishare-id`
- Read via `app.metadataCache.getFileCache(file).frontmatter['excalishare-id']`
- Written via `app.fileManager.processFrontMatter()`

## Key Design Decisions

1. **In-memory collab sessions** — No database needed, sessions are ephemeral with configurable timeout
2. **Version-based element merging** — Server merges elements by ID + version to prevent deletion flickering
3. **Drawing interruption deferral** — Remote scene updates are queued while user is actively drawing (dragging/resizing/editing), flushed on pointer up or via 300ms safety interval
4. **Follow mode** — Viewport syncing via pointer_update messages carrying scrollX/scrollY/zoom
5. **Unguessable session IDs** — Full 128-bit UUIDs for session security (no auth on WebSocket)
6. **Constant-time auth** — `subtle::ConstantTimeEq` for API key comparison
7. **Expired session auto-save** — Background task saves expired sessions to storage before cleanup
