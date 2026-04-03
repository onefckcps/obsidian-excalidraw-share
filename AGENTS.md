# AGENTS.md - Agent Guidelines for obsidian-excalidraw-share

## Project Overview

ExcaliShare is a **self-hosted Excalidraw drawing sharing server** with three main components:
- **backend/** - Rust/Axum API server (port 8184 by default)
- **frontend/** - React/Vite TypeScript viewer with PWA support
- **obsidian-plugin/** - Obsidian plugin for publishing drawings (with PDF embedding support)

Additional infrastructure:
- **nixos/** - NixOS module for declarative deployment
- **DEPLOYMENT.md** - Deployment guide (NixOS declarative or manual)
- **excalishare.service** - Systemd service file for manual deployment

### Core Purpose
Allow users to publish Excalidraw drawings from Obsidian to a self-hosted server, view them in a web browser, and collaborate in real-time.

### Key Features
- **Publish/Sync** drawings from Obsidian to the server
- **View** drawings in a web-based Excalidraw viewer (with view, edit, present modes)
- **Browse** all shared drawings (tree view, search, overlay mode)
- **Live Collaboration** — real-time multi-user editing via WebSocket
- **Persistent Collaboration** — always-on collab mode per drawing; guests can edit without admin being online, server is source of truth, auto-saves to disk
- **Password Protection** — optional Argon2id-hashed passwords for drawings and collab sessions
- **PDF Embedding** — convert PDF pages to PNG for embedding in drawings
- **Admin Panel** — manage drawings and collab sessions
- **PWA Support** — installable web app with offline caching
- **NixOS Deployment** — declarative NixOS module for production deployment

### Technical Stack
- **Backend**: Rust, Axum 0.8, Tokio, Serde, tower-http, tower_governor (rate limiting)
- **Frontend**: React 18, TypeScript, Vite 8, Excalidraw 0.17.6, react-router-dom 6, vite-plugin-pwa
- **Plugin**: TypeScript, Obsidian API, esbuild
- **Infrastructure**: NixOS module, systemd service, Nix flake dev shell

### Version
- Backend: 1.0.1
- Frontend: 1.0.1
- Plugin manifest ID: `excalishare`

---

## Product Context

### Why This Project Exists
ExcaliShare fills the gap between Obsidian's local-only Excalidraw drawings and the need to share them publicly or collaboratively. It provides a self-hosted alternative to Excalidraw's cloud service, giving users full control over their data.

### User Workflow
1. **Author** creates Excalidraw drawings in Obsidian
2. **Publish** via the plugin (ribbon icon, command palette, context menu, or floating toolbar)
3. **Share** the generated URL with others
4. **View** in any browser — no login required
5. **Collaborate** in real-time via live collab sessions started from Obsidian
6. **Pull** changes back to Obsidian after collaboration

### Key User Personas
- **Drawing Author** — Uses Obsidian + Excalidraw plugin, publishes drawings
- **Viewer** — Accesses shared drawings via URL, can browse all drawings
- **Collaborator** — Joins live sessions to edit drawings together in real-time
- **Admin** — Manages drawings and collab sessions via the admin panel

### Frontend Viewer Modes
- **View Mode** (default) — Read-only, zen mode enabled, no editing tools
- **Edit Mode** (press `w` twice) — Full Excalidraw editing, local only (not saved to server)
- **Present Mode** (press `p`/`q`) — Slideshow-like navigation between drawings with arrow keys
- **Collab Mode** — When joined to a live session, full editing with real-time sync

### Obsidian Plugin Features
- **Toolbar** — Two modes: **Auto** (injected into Excalidraw's native toolbar as Island element, popover on click) or **Floating** (absolute-positioned overlay at configurable corner). Auto is default, with floating as fallback.
- **Auto-Sync** — Optionally auto-sync published drawings on save (debounced)
- **Context Menu** — Right-click on `.excalidraw` files for all actions
- **Command Palette** — All actions available as commands
- **Pull from Server** — Sync collab changes back to the vault
- **PDF Embedding** — Converts PDF pages (with optional crop rects) to PNG for sharing

### Admin Panel (`/admin`)
- API key authentication (stored in sessionStorage)
- List all drawings with size, date, source path
- Delete drawings
- View and end active collab sessions
- Auto-refreshes collab sessions every 10 seconds

---

## Build Commands

### Development Environment (Nix)
```bash
nix develop                           # Enter development shell
```

### Backend (Rust)
```bash
cd backend
cargo build                           # Debug build
cargo build --release                 # Release build
cargo run                            # Run in development (port 8184)
cargo check                          # Type check only
cargo clippy                         # Lint
cargo test                           # Run tests
```

### Frontend (React/TypeScript)
```bash
cd frontend
npm install                          # Install dependencies
npm run dev                          # Development server (port 5173)
npm run build                        # Production build (runs tsc + vite)
npm run preview                      # Preview production build
```

### Obsidian Plugin (TypeScript)
```bash
cd obsidian-plugin
npm install                          # Install dependencies
npm run build                        # Compile TypeScript to JS
npm run dev                          # Watch mode
# Output: obsidian-plugin/main.js -> copy to Vault/.obsidian/plugins/excalidraw-share/
```

### Quick Start
```bash
./start.sh                          # Auto-builds and starts server
API_KEY="secret" BASE_URL="http://localhost:3030" ./start.sh
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | Bearer | Upload/update drawing (supports `id`, `password` fields) |
| GET | `/api/view/{id}?key=...` | Public | Get drawing by ID (requires `key` param if password-protected; Bearer token bypasses password) |
| DELETE | `/api/drawings/{id}` | Bearer | Delete drawing |
| GET | `/api/drawings` | Bearer | List all drawings (includes `size_bytes`, `password_protected`) |
| GET | `/api/public/drawings` | Public | List drawings (id, created_at, source_path, password_protected) |
| GET | `/api/health` | Public | Health check |
| POST | `/api/collab/start` | Bearer | Start collab session (supports `password` field) |
| POST | `/api/collab/stop` | Bearer | End collab session (save or discard) |
| GET | `/api/collab/status/{drawing_id}` | Public | Check collab status (returns session_id, password_required, persistent) |
| POST | `/api/collab/verify-password` | Public | Verify collab session password before WS connection |
| GET | `/api/collab/sessions` | Bearer | List all active sessions (admin, includes password_required, persistent) |
| POST | `/api/persistent-collab/enable` | Bearer | Enable persistent collab for a drawing (supports `password` field) |
| POST | `/api/persistent-collab/disable` | Bearer | Disable persistent collab for a drawing |
| POST | `/api/persistent-collab/activate/{drawing_id}` | Public | Activate (create on demand) persistent collab session for a drawing |
| WS | `/ws/collab/{session_id}?name=...&password=...&api_key=...` | Public | WebSocket for real-time collaboration (password verified before upgrade; `api_key` bypasses session password) |

### Upload Request Format
```json
{
  "type": "excalidraw",
  "elements": [...],
  "appState": {...},
  "files": {...},
  "source_path": "optional/vault/path.excalidraw",
  "id": "optional-existing-id-for-updates"
}
```

### WebSocket Protocol

**Client → Server Messages**
```typescript
{ type: 'scene_update', elements: ExcalidrawElement[] }
{ type: 'pointer_update', x, y, button, tool?, scrollX?, scrollY?, zoom? }
{ type: 'set_name', name: string }
```

**Server → Client Messages**
```typescript
{ type: 'snapshot', elements, appState, files, collaborators }
{ type: 'scene_update', elements, from: userId }
{ type: 'pointer_update', x, y, button, tool?, userId, name, colorIndex, scrollX?, scrollY?, zoom? }
{ type: 'user_joined', userId, name, collaborators }
{ type: 'user_left', userId, name, collaborators }
{ type: 'session_ended', saved: boolean }
{ type: 'error', message: string }
```

---

## System Architecture

### Architecture Overview

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

### Backend Architecture (Rust/Axum)

**Module Structure**
- `main.rs` — Entry point, CLI config (clap), route registration, CORS, rate limiting, background cleanup task
- `routes.rs` — All HTTP handlers (upload, get, delete, list, collab start/stop/status/sessions, password verification)
- `storage.rs` — `DrawingStorage` trait + `FileSystemStorage` implementation
- `auth.rs` — Bearer token middleware with constant-time comparison (`subtle` crate)
- `error.rs` — `AppError` enum with `IntoResponse` impl (includes PasswordRequired, InvalidPassword)
- `password.rs` — Argon2id password hashing and verification utilities
- `collab.rs` — `SessionManager`, `CollabSession`, message types, version-based element merging
- `ws.rs` — WebSocket upgrade handler, bidirectional message routing, password verification before upgrade, API key bypass for admin

**Route Organization**
- **Public routes** (no auth): `/api/health`, `/api/public/drawings`, `/api/view/{id}`, `/api/collab/status/{drawing_id}`, `/api/collab/verify-password`, `/api/persistent-collab/activate/{drawing_id}`
- **Protected routes** (Bearer token): `/api/upload`, `/api/drawings/{id}` (DELETE), `/api/drawings` (GET), `/api/collab/start`, `/api/collab/stop`, `/api/collab/sessions`, `/api/persistent-collab/enable`, `/api/persistent-collab/disable`
- **WebSocket**: `/ws/collab/{session_id}` (no auth, but session must exist — security via unguessable UUID + optional password; `api_key` query param bypasses session password)

**Rate Limiting**
- Public: 120 req/sec per IP (burst)
- Protected: 30 req/sec per IP (burst)
- Implemented via `tower_governor`

**Storage Pattern**
- Each drawing is `<id>.json` in `DATA_DIR`
- Source path stored as `_source_path` field inside the JSON
- ID sanitization: alphanumeric, `-`, `_` only (path traversal protection)
- IDs: 16-char truncated UUID for new drawings, or client-provided (1-64 chars)

**CORS Configuration**
- Allowed origins: configured `BASE_URL` + `app://obsidian.md`
- Allowed methods: GET, POST, DELETE, OPTIONS
- Allowed headers: Authorization, Content-Type

### Frontend Architecture (React/Vite)

**Component Structure**
- `App.tsx` — Router: `/` and `/d/:id` → Viewer, `/admin` → AdminPage
- `Viewer.tsx` — Main drawing viewer (1000+ lines), handles all modes, keyboard shortcuts, mobile toolbar injection
- `DrawingsBrowser.tsx` — Browse/search drawings with tree view, overlay mode
- `AdminPage.tsx` — Admin panel with drawing management and collab session management
- `CollabStatus.tsx` — Pre-join banner and session-ended notification overlay
- `CollabPopover.tsx` — In-session popover showing participants, follow mode controls
- `PasswordDialog.tsx` — Reusable password input dialog for protected drawings and collab sessions
- `AboutModal.tsx` — About dialog

**Hooks**
- `useCollab.ts` — Complete collaboration state management (569 lines), handles WebSocket lifecycle, scene merging, pointer updates, follow mode, drawing interruption deferral

**Utilities**
- `cache.ts` — LRU `DrawingCache` class (50 MB limit, singleton `drawingCache`)
- `collabClient.ts` — `CollabClient` WebSocket wrapper with reconnect, debounce, throttle

**Shared Types (`types/index.ts`)**
- `ExcalidrawData`, `PublicDrawing`
- `CollaboratorInfo`, `CollabStatusResponse`, `CollabSessionInfo`
- `ClientMessage` (union: scene_update, pointer_update, set_name)
- `ServerMessage` (union: snapshot, scene_update, pointer_update, user_joined, user_left, session_ended, error)

**PWA Configuration**
- Service worker with NetworkFirst caching for public API routes
- Excludes authenticated endpoints from caching
- 5 MB max file size for cache

### Obsidian Plugin Architecture

**File Structure (Modular)**
- `main.ts` — Plugin class, commands, context menu, toolbar management, API methods, collab wiring
- `settings.ts` — `ExcaliShareSettings` interface, `ExcaliShareSettingTab`, defaults
- `toolbar.ts` — `ExcaliShareToolbar` class (floating toolbar DOM management)
- `styles.ts` — CSS-in-JS styles, icons, colors, position helpers, global style injection
- `pdfUtils.ts` — PDF-to-PNG conversion utilities
- `collabClient.ts` — WebSocket client for native collab (adapted from frontend)
- `collabManager.ts` — Session lifecycle, polling-based change detection, deferred updates, cursor display
- `collabTypes.ts` — Shared types for WebSocket protocol (ClientMessage, ServerMessage, ExcalidrawAPI)
- `excalidrawScripts.ts` — Embedded Excalidraw scripts (ZoomAdaptiveStroke, RightClickEraser, ExcalidrawScriptManager)

**Native Collab Architecture**
The plugin can participate in collab sessions directly within Obsidian (no browser needed):
- **CollabClient** — WebSocket wrapper with reconnect, delta tracking, adaptive debounce (mirrors frontend's `collabClient.ts`)
- **CollabManager** — Orchestrates the full collab lifecycle:
  - Connects via WebSocket to `/ws/collab/{session_id}`
  - **Event-driven change detection** — Uses `excalidrawAPI.onChange()` subscription for instant, zero-waste detection. Falls back to 2s polling for older Excalidraw versions.
  - **Pointer tracking** — DOM `pointermove` listener on Excalidraw canvas with screen→scene coordinate conversion. Exponential backoff retry (500ms → 1s → 2s → 4s) for canvas discovery. Canvas search uses 5 selectors: `.excalidraw__canvas.interactive`, `.excalidraw__canvas`, `.excalidraw canvas`, `canvas.interactive`, `canvas`. Also searches iframes.
  - **Viewport broadcast fallback** — Periodic 500ms broadcast of scrollX/scrollY/zoom ensures follow mode works even if DOM pointer tracking fails
  - **Laser pointer support** — Reads `appState.activeTool.type` to detect laser vs pointer tool
  - **Follow mode** — Lerp-based viewport interpolation via `requestAnimationFrame` (same algorithm as frontend)
  - **Deferred remote updates** — Queues incoming updates while user is drawing, flushes via 300ms interval + onPointerUp
  - **Cached API reference** — Stores `getExcalidrawAPI()` result, validates with quick `getSceneElements()` call, avoids expensive `ea.setView('active')` on every cycle
  - **Collaborator cursors** — Receives pointer updates, builds Excalidraw collaborator Map, pushes via `updateScene({ collaborators })`
  - **Version-based echo suppression** — `remoteAppliedVersions` map + double-`requestAnimationFrame` cooldown
- **No backend changes needed** — Uses the same WebSocket endpoint and protocol as the frontend

**Plugin Settings**
```typescript
interface ExcaliShareSettings {
  apiKey: string;
  baseUrl: string;
  pdfScale: number;                    // 0.5 - 5.0
  collabTimeoutSecs: number;           // default 7200 (2h)
  collabAutoOpenBrowser: boolean;      // auto-open browser on collab start
  collabJoinFromObsidian: boolean;     // auto-join collab from Obsidian (default: true)
  collabDisplayName: string;           // display name for collab (default: 'Host')
  collabPollIntervalMs: number;        // change detection interval (default: 250)
  showFloatingToolbar: boolean;        // toggle toolbar visibility
  toolbarPosition: ToolbarPosition;    // 'auto' (native toolbar injection, default), top-right, top-left, bottom-right, bottom-left
  autoSyncOnSave: boolean;             // auto-sync on file modify
  autoSyncDelaySecs: number;           // debounce delay (1-30s)
  toolbarCollapsedByDefault: boolean;  // start collapsed
  mobilePopoverBottomSheet: boolean;   // use bottom-sheet style on mobile (default: true); false = dropdown like desktop
  persistentCollabAutoSync: boolean;   // auto-pull server changes on open (default: true)
  enableZoomAdaptiveStroke: boolean;   // zoom-adaptive stroke width (default: true)
  zoomAdaptiveBaseStrokeWidth: number; // base stroke width at 100% zoom (default: 0.6)
  zoomAdaptivePollIntervalMs: number;  // zoom poll interval in ms, fallback only (default: 200)
  disableSmoothing: boolean;           // disable smoothing/streamline (default: true)
  enableRightClickEraser: boolean;     // right-click eraser in freedraw (default: true)
}
```

**Toolbar States**
- `unpublished` — Drawing not yet published
- `published` — Drawing published, can sync/copy link/start collab
- `syncing` — Currently syncing
- `collabActive` — Live collab session active
- `error` — Error state

**Published ID Tracking**
- Stored in Obsidian frontmatter as `excalishare-id`
- Read via `app.metadataCache.getFileCache(file).frontmatter['excalishare-id']`
- Written via `app.fileManager.processFrontMatter()`
- Persistent collab tracked via `excalishare-persistent-collab: true` and `excalishare-last-sync-version: N` in frontmatter

### Key Design Decisions

1. **In-memory collab sessions** — No database needed, sessions are ephemeral with configurable timeout
2. **Version-based element merging** — Server merges elements by ID + version to prevent deletion flickering
3. **Drawing interruption deferral** — Remote scene updates are queued while user is actively drawing (dragging/resizing/editing), flushed on pointer up or via 300ms safety interval
4. **Follow mode** — Viewport syncing via pointer_update messages carrying scrollX/scrollY/zoom
5. **Unguessable session IDs** — Full 128-bit UUIDs for session security (optional password + API key bypass on WebSocket)
6. **Constant-time auth** — `subtle::ConstantTimeEq` for API key comparison
7. **Expired session auto-save** — Background task saves expired sessions to storage before cleanup
8. **Event-driven native collab** — Obsidian plugin uses `excalidrawAPI.onChange()` imperative subscription for instant, zero-waste change detection. Falls back to 2s polling for older Excalidraw versions. Host cursor is broadcast via DOM `pointermove` listener with screen→scene coordinate conversion. Laser pointer detected via `appState.activeTool.type`. Follow mode uses lerp-based viewport interpolation (same algorithm as frontend). Adaptive debouncing: 16ms idle / 50ms batch / 80ms during drawing. Version-based echo suppression via `remoteAppliedVersions` map + double-`requestAnimationFrame` cooldown.
9. **Cached Excalidraw API** — Plugin caches the `getExcalidrawAPI()` reference and validates it cheaply, avoiding expensive `ea.setView('active')` calls on every cycle
10. **Persistent Collaboration** — Always-on collab mode per drawing. Server is source of truth with debounced auto-save (2s). Sessions are created on demand when visitors arrive and cleaned up after 30 min idle (no participants). Element-level merge with version-based conflict resolution for offline admin sync. Frontmatter tracks `excalishare-persistent-collab` and `excalishare-last-sync-version`.
11. **Server State Reconciliation** — Plugin reconciles local frontmatter with server state on every file open (with 30s TTL cache). Handles: persistent collab enabled/disabled externally, drawing deleted from server, collab session recovery after Obsidian restart. Background reconciliation every 60s for long-running sessions. Server is always the source of truth.

---

## Technical Dependencies

### Backend Dependencies (Cargo.toml)

| Crate | Version | Purpose |
|-------|---------|---------|
| `axum` | 0.8 | Web framework (with `macros` + `ws` features) |
| `tokio` | 1 (full) | Async runtime |
| `serde` / `serde_json` | 1 | Serialization |
| `uuid` | 1 (v4) | ID generation |
| `tower-http` | 0.6 | CORS, static files, compression, tracing, body limits |
| `tower` | 0.5 | Middleware tower |
| `tower_governor` | 0.6 | Rate limiting per IP |
| `tracing` / `tracing-subscriber` | 0.1/0.3 | Structured logging |
| `clap` | 4 | CLI args with env var fallbacks |
| `chrono` | 0.4 | DateTime handling |
| `thiserror` | 2 | Error derive macro |
| `anyhow` | 1 | Application-level errors |
| `futures` | 0.3 | Stream/Sink for WebSocket |
| `subtle` | 2 | Constant-time comparison for auth |
| `argon2` | 0.5 | Argon2id password hashing |
| `rand` | 0.8 | Salt generation for password hashing |

### Frontend Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `@excalidraw/excalidraw` | ^0.17.6 | Drawing canvas component |
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | React DOM renderer |
| `react-router-dom` | ^6.26.0 | Client-side routing |
| `vite` | ^8.0.0 | Build tool |
| `vite-plugin-pwa` | ^1.2.0 | PWA/service worker support |
| `typescript` | ^5.5.4 | Type checking |

Frontend `.npmrc`: `legacy-peer-deps=true` (required for Excalidraw peer dependency conflicts)

### Plugin Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `obsidian` | latest | Obsidian API |
| `@types/node` | ^16.11.6 | Node.js types |
| `esbuild` | 0.17.3 | Bundler |
| `typescript` | 4.7.4 | Type checking |
| `tslib` | 2.4.0 | TypeScript helpers |
| `builtin-modules` | 3.3.0 | Node built-in module list |

### Backend CLI Configuration

| Arg | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `--listen-addr` | `LISTEN_ADDR` | `127.0.0.1:8184` | Listen address |
| `--data-dir` | `DATA_DIR` | `./data/drawings` | Drawing storage directory |
| `--api-key` | `API_KEY` | (required) | API key for protected routes |
| `--base-url` | `BASE_URL` | `http://localhost:8184` | Public base URL |
| `--max-upload-mb` | `MAX_UPLOAD_MB` | `50` | Max upload size in MB |
| `--frontend-dir` | `FRONTEND_DIR` | `./frontend/dist` | Frontend static files |

---

## Code Style Guidelines

### TypeScript General

**Imports**
- Use absolute imports for project modules: `import Viewer from './Viewer'`
- Use namespace imports for external libs: `import { Excalidraw } from '@excalidraw/excalidraw'`
- Group: external libs → internal modules → types
- Use explicit type imports: `import type { AppState } from '...'`

**Naming Conventions**
- Files: PascalCase for components (`Viewer.tsx`), camelCase for utilities (`pdfUtils.ts`)
- Components: PascalCase; Hooks: camelCase with `use` prefix
- Interfaces: PascalCase, descriptive names (`ExcalidrawData`)
- Constants: SCREAMING_SNAKE_CASE for config values

**Types**
- Always declare types for props, state, and function parameters
- Prefer interfaces over type aliases for object shapes
- Use `unknown` instead of `any` when type is truly unknown
- Shared types live in `frontend/src/types/index.ts`

**Formatting**
- 2 spaces indentation, single quotes for strings, semicolons required

### React Patterns

**Component Structure**
```typescript
import { useState, useEffect } from 'react'
import type { SomeType } from './types'

interface ComponentProps { id: string }

function Component({ id }: ComponentProps) {
  const [state, setState] = useState<Type>(initial)
  useEffect(() => { ... }, [deps])
  const handleClick = useCallback(() => { ... }, [deps])
  return ( ... )
}
export default Component
```

**Styling**
- Use inline styles with typed `styles` object at component end
- `const styles: Record<string, React.CSSProperties> = { ... }`

**Mobile Responsiveness**
- Use `useBreakpoint()` hook from `frontend/src/hooks/useBreakpoint.ts` for 3-tier responsive detection in `Viewer.tsx`
- Use `useMediaQuery()` hook directly in other components (e.g. `DrawingsBrowser.tsx`)
- **3-tier breakpoint system** (Viewer.tsx):
  - `phone` ≤ 1140px — toolbar injection mode; `renderTopRightUI` returns null; collab button in toolbar
  - `tablet` 1141–1400px — compact toolbar Island; green dot for "Collaborative"
  - `desktop` > 1400px — full toolbar Island; "Collaborative" text badge
- **Excalidraw's mobile breakpoint** is patched to 987px (was 730px hardcoded in library) via `frontend/patch-excalidraw.sh` — at ≤987px Excalidraw shows the bottom toolbar (`.App-toolbar-content`); at >987px it shows the top toolbar (`.App-toolbar-container`)
- `isExcalidrawMobile` (987px check) determines which DOM element to inject buttons into
- `isPhone` (1140px check) determines UI behavior (collab button placement, renderTopRightUI)

**Caching**
- Drawing data is cached client-side via an LRU cache (`frontend/src/utils/cache.ts`)
- `DrawingCache` class with 50 MB memory limit, singleton exported as `drawingCache`
- API responses also cached via PWA service worker (NetworkFirst strategy)

### Rust (Backend)

**CLI Configuration (clap)**
- All config via CLI args with env var fallbacks using `clap::Parser`
- Key env vars: `LISTEN_ADDR`, `DATA_DIR`, `API_KEY`, `BASE_URL`, `MAX_UPLOAD_MB`, `FRONTEND_DIR`

**Error Handling**
- Use `thiserror` for custom error types with `#[derive(Error, Debug)]`
- Use `anyhow` for application-level errors (in `main.rs`)
- Implement `axum::response::IntoResponse` for error types
- Log errors with `tracing::error!` before converting to user response

```rust
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Drawing not found")]
    NotFound,
    #[error("Unauthorized: invalid or missing API key")]
    Unauthorized,
    #[error("Invalid input: {0}")]
    BadRequest(String),
    #[error("Payload too large")]
    PayloadTooLarge,
    #[error("Storage error: {0}")]
    Storage(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Password required")]
    PasswordRequired,
    #[error("Invalid password")]
    InvalidPassword,
}
```

**Auth Middleware**
- Bearer token auth via `Authorization: Bearer <key>` header
- Middleware in `auth.rs` using `axum::middleware::from_fn_with_state`
- Applied only to protected routes (upload, delete, list-all)

**Storage**
- `DrawingStorage` trait in `storage.rs` for abstraction (filesystem, S3, SQLite, etc.)
- `FileSystemStorage` implementation: each drawing is `<id>.json` in `DATA_DIR`
- Path traversal protection via ID sanitization (alphanumeric, `-`, `_` only)
- Source path stored as `_source_path` field inside the JSON file
- Password hash stored as `_password_hash` field inside the JSON file (Argon2id, never exposed to clients)

**Logging & Naming**
- Use `tracing::info!` for operations, `tracing::error!` for errors
- Include context: `tracing::info!(id = %id, "Drawing uploaded")`
- Modules/Functions: snake_case; Types/Structs: PascalCase

### Obsidian Plugin

**Structure**
- Single class extending `Plugin`, use `onload()` for initialization
- Use `addCommand()`, `addSettingTab()`, `addRibbonIcon()` in `onload`
- Store settings in `this.settings` with `loadSettings()`/`saveSettings()`

**Features**
- Publish/update Excalidraw drawings to the share server
- PDF page embedding support (converts PDF pages to PNG via `loadPdfJs()`)
- Crop rect support for PDF page regions
- Context menu integration for `.excalidraw` files
- Settings tab for server URL and API key configuration

**Best Practices**
- Always handle errors and show `Notice` to user
- Use async/await for all vault operations
- Use `console.log` with plugin prefix for debugging

---

## Testing

No automated tests configured. Test manually:
```bash
# Backend
cd backend && cargo run &
curl -X POST http://localhost:8184/api/upload \
  -H "Authorization: Bearer key" \
  -H "Content-Type: application/json" \
  -d '{"type":"excalidraw","elements":[]}'

# Frontend
cd frontend && npm run dev
```

---

## Common Tasks

**Adding a new API endpoint:**
1. Add handler in `backend/src/routes.rs`
2. Add route in `backend/src/main.rs` (public or protected router)
3. If needed, add error variant in `backend/src/error.rs`

**Adding a new frontend page:**
1. Create component in `frontend/src/`
2. Add route in `frontend/src/App.tsx`

**Adding shared types:**
1. Add interface in `frontend/src/types/index.ts`

**Building for production:**
```bash
cd frontend && npm run build
cd backend && cargo build --release
```

**Deploying on NixOS:**
1. See `DEPLOYMENT.md` for full guide
2. Import `nixos/module.nix` in your NixOS config
3. Configure `services.excalishare` options

---

## Project Structure

```
obsidian-excalidraw-share/
├── backend/
│   ├── src/
│   │   ├── main.rs         # Entry point, CLI config, route registration
│   │   ├── routes.rs       # API handlers (upload, get, delete, list, collab)
│   │   ├── storage.rs      # DrawingStorage trait + FileSystemStorage impl
│   │   ├── auth.rs         # API key middleware (Bearer token)
│   │   ├── error.rs        # AppError enum with IntoResponse impl
│   │   ├── collab.rs       # SessionManager, in-memory collab session state
│   │   └── ws.rs           # WebSocket handler for real-time collaboration
│   └── Cargo.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Main router (/, /d/:id, /admin)
│   │   ├── Viewer.tsx           # Drawing viewer (Excalidraw, theme, edit/present modes)
│   │   ├── DrawingsBrowser.tsx  # Browse/search drawings (tree view, overlay mode)
│   │   ├── AdminPage.tsx        # Admin panel (API key auth, delete drawings)
│   │   ├── AboutModal.tsx       # About dialog (light/dark theme)
│   │   ├── CollabStatus.tsx     # Live collab session UI (join, status, participants)
│   │   ├── CollabPopover.tsx    # In-session popover (participants, follow controls)
│   │   ├── main.tsx             # React entry point
│   │   ├── index.css            # Global styles
│   │   ├── types/
│   │   │   └── index.ts         # Shared types (ExcalidrawData, PublicDrawing, Collab types)
│   │   ├── hooks/
│   │   │   └── useCollab.ts     # React hook for collaboration state management
│   │   └── utils/
│   │       ├── cache.ts         # LRU DrawingCache (50 MB limit)
│   │       └── collabClient.ts  # WebSocket client for real-time collab
│   ├── public/                  # PWA icons and favicon
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts           # Vite + React + PWA plugin config
│   ├── tsconfig.json
│   └── tsconfig.node.json
├── obsidian-plugin/
│   ├── main.ts             # Plugin entry point (publish, PDF support, live collab)
│   ├── main.js             # Compiled output
│   ├── settings.ts         # Settings interface + settings tab UI
│   ├── toolbar.ts          # Floating toolbar DOM management
│   ├── styles.ts           # CSS-in-JS styles, icons, colors
│   ├── pdfUtils.ts         # PDF-to-PNG conversion utilities
│   ├── collabClient.ts     # WebSocket client (adaptive debounce, delta tracking)
│   ├── collabManager.ts    # Event-driven collab: onChange, pointer tracking, follow mode
│   ├── collabTypes.ts      # Shared types for WS protocol + ExcalidrawAPI subscriptions
│   ├── excalidrawScripts.ts # Embedded Excalidraw scripts (ZoomAdaptiveStroke, RightClickEraser)
│   ├── manifest.json       # Plugin manifest (id: excalishare)
│   ├── package.json
│   └── tsconfig.json
├── nixos/
│   └── module.nix          # NixOS service module (systemd, optional nginx)
├── plans/                  # Implementation plans (collab, security, UI, native-collab)
├── memory-bank/            # Project memory/context documentation
├── flake.nix               # Nix flake for dev environment
├── start.sh                # Quick start script (builds + runs)
├── excalishare.service     # Systemd service file (manual deployment)
├── DEPLOYMENT.md           # Deployment guide (NixOS + manual)
├── AGENTS.md               # This file
└── README.md               # Project documentation
```

---

## Current State & Progress (April 2026)

The project is feature-complete with the live collaboration system fully implemented and refined through multiple iterations. All three components (backend, frontend, plugin) are working together.

### Completed Features ✅

**Core Functionality**
- [x] Backend API server (Rust/Axum) with upload, view, delete, list endpoints
- [x] Frontend viewer (React/Vite) with Excalidraw integration
- [x] Obsidian plugin for publishing drawings
- [x] PDF page embedding with crop rect support
- [x] Source path tracking (`_source_path` in JSON, frontmatter `excalishare-id`)
- [x] Drawing update support (re-upload with same ID)
- [x] Public drawings list endpoint (`/api/public/drawings`)

**Frontend Viewer**
- [x] View mode (read-only, zen mode)
- [x] Edit mode (local editing, press `w` twice)
- [x] Present mode (slideshow navigation with arrows)
- [x] DrawingsBrowser with tree view, search, overlay mode
- [x] LRU drawing cache (50 MB limit)
- [x] Unified toolbar injection (present/edit/browse buttons) — all screen sizes via native Excalidraw toolbar
- [x] ExcaliShare links in Excalidraw help dropdown
- [x] About modal
- [x] Keyboard shortcuts (e, w, p/q, r, arrows, Escape)
- [x] PWA support with service worker caching

**Live Collaboration**
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
- [x] Plugin: CollabManager (session lifecycle, change detection, cursor display, follow mode)
- [x] Plugin: Event-driven change detection via `excalidrawAPI.onChange()` (instant, zero-waste)
- [x] Plugin: Fallback polling at 2s for older Excalidraw versions
- [x] Plugin: Adaptive debouncing (16ms idle / 50ms batch / 80ms drawing)
- [x] Plugin: Version-based echo suppression (remoteAppliedVersions + double-rAF)
- [x] Plugin: Host cursor broadcasting via DOM pointermove (50ms throttled)
- [x] Plugin: Laser pointer detection (reads appState.activeTool.type)
- [x] Plugin: Follow mode with lerp-based viewport interpolation (same as frontend)
- [x] Plugin: Drawing state tracking via onPointerDown/onPointerUp subscriptions
- [x] Plugin: Deferred remote updates during active drawing (prevents stutter)
- [x] Plugin: Cached Excalidraw API reference (avoids expensive setView calls)
- [x] Plugin: Collaborator cursor display in Obsidian Excalidraw view
- [x] Plugin: Auto-sync disabled during active collab session
- [x] Plugin: Toolbar shows participant count and native connection status

**Persistent Collaboration**
- [x] Backend: Persistent collab flag per drawing (`_persistent_collab` in JSON, sidecar metadata)
- [x] Backend: `save_persistent()` with atomic writes and version tracking
- [x] Backend: Persistent sessions with idle-based cleanup (30 min no participants)
- [x] Backend: On-demand session creation via `/api/persistent-collab/activate/{id}`
- [x] Backend: Enable/disable endpoints with password support
- [x] Backend: Auto-save background task (2s debounce) for dirty persistent sessions
- [x] Backend: Server startup scan for persistent collab drawings
- [x] Frontend: Auto-activation of persistent sessions in `useCollab` hook
- [x] Frontend: Auto-join with stored name for persistent collab (no banner)
- [x] Frontend: Visual "Collaborative" badge in Viewer
- [x] Frontend: "🔄 Live" badge in DrawingsBrowser
- [x] Frontend: "Persistent" badge in AdminPage session list
- [x] Plugin: Enable/disable persistent collab via toolbar, commands, context menu
- [x] Plugin: Element-level merge with version-based conflict resolution
- [x] Plugin: Auto-sync on file open (once per file, elements only)
- [x] Plugin: Frontmatter tracking (`excalishare-persistent-collab`, `excalishare-last-sync-version`)
- [x] Plugin: Auto-join persistent sessions from Obsidian
- [x] Plugin: Settings toggle for `persistentCollabAutoSync`

**Server State Reconciliation**
- [x] Plugin: `reconcileServerState()` — queries server on every file open, reconciles frontmatter with server state
- [x] Plugin: TTL cache (30s) and dedup guard to avoid redundant server calls on tab switching
- [x] Plugin: Background reconciliation every 60s for long-running sessions
- [x] Plugin: Collab session recovery after Obsidian restart (restores `activeCollabSessionId`)
- [x] Plugin: Drawing deletion detection (clears frontmatter when server returns 404)
- [x] Plugin: Persistent collab drift detection (server enabled/disabled externally → update local)
- [x] Frontend: DrawingsBrowser auto-refresh every 30s for persistent collab badge accuracy

**Security**
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

**Plugin UI**
- [x] Modular file structure (settings.ts, toolbar.ts, styles.ts)
- [x] Auto mode: toolbar injected into Excalidraw's native toolbar as Island element (default)
- [x] Floating mode: absolute-positioned overlay at configurable corner (fallback/alternative)
- [x] Popover panel on click (auto mode) or expandable panel (floating mode)
- [x] Mobile bottom-sheet popover with backdrop (auto mode on mobile)
- [x] MutationObserver-based injection with fallback to floating if native toolbar not found
- [x] Auto-sync on save (debounced)
- [x] Toolbar position configuration (auto + 4 floating positions)
- [x] Toolbar retry injection for mobile
- [x] CSS-in-JS with Obsidian theme variables
- [x] Context menu integration
- [x] Ribbon icons (publish, browse)

**Embedded Excalidraw Scripts**
- [x] Zoom-Adaptive Stroke Width — auto-adjusts stroke width inversely with zoom; event-driven via `onChange` with polling fallback
- [x] Disable Smoothing/Streamline — separate toggle from zoom-adaptive, disables smoothing for precise pen input
- [x] Right-Click Eraser in Freedraw — hold right mouse button or S Pen side button to temporarily switch to eraser; caches tool type via `onChange`
- [x] Per-leaf script instances (supports split views with independent scripts)
- [x] ExcalidrawScriptManager with activate/deactivate lifecycle per leaf, stores api/container refs for hot-reload
- [x] Settings hot-reload — toggling scripts on/off in settings takes effect immediately without leaf switch
- [x] Settings toggles for each script + configurable base stroke width and poll interval
- [x] Exponential backoff retry for API acquisition (500ms → 1s → 2s → 4s)

**Admin Panel**
- [x] API key authentication
- [x] Drawing list with size, date, source path
- [x] Delete drawings
- [x] Active collab sessions display
- [x] End collab sessions
- [x] Auto-refresh (10s interval)

**Infrastructure**
- [x] NixOS module (`nixos/module.nix`)
- [x] Systemd service with security hardening
- [x] Nix flake dev environment
- [x] Quick start script (`start.sh`)
- [x] DEPLOYMENT.md guide

### Recent Bug Fixes

**Host Cursor/Laser/Follow Bug Fix (April 2026)**
Fixed a fatal bug where the Obsidian plugin host's cursor, laser pointer, and follow mode were invisible to browser users during native live collaboration. Root causes:
- Pointer tracking skipped in polling fallback — `startPointerTracking()` was only called inside `startEventDrivenDetection()`, never when using polling fallback
- Canvas element not found — `findExcalidrawCanvas()` used too few selectors, missing `.excalidraw__canvas.interactive` used by newer Excalidraw versions
- Insufficient retry logic — Only a single 1-second retry for canvas discovery
- No fallback for follow mode — If pointer tracking failed, no viewport data was ever sent

Fixes applied:
- [x] Expanded canvas discovery with 5 selectors + iframe search + diagnostic logging
- [x] Moved `startPointerTracking()` to `startChangeDetection()` (always runs)
- [x] Exponential backoff retry (500ms → 1s → 2s → 4s) for canvas discovery
- [x] Viewport broadcast fallback (500ms interval) ensures follow mode works even without DOM pointer tracking
- [x] Improved `getCanvasContainer` in `main.ts` to search `.excalidraw-wrapper`, `[class*="excalidraw"]`, and all workspace leaves of type `'excalidraw'`

**Persistent Collab & Follow Mode Fixes (April 2026)**
Multiple fixes for persistent collaboration and follow mode:

1. **"Collaborative" badge hidden behind floating buttons** — Badge was at `zIndex: 5` overlapping with floating buttons at `zIndex: 100`. Moved badge inside the floating buttons flex container; hidden on mobile.

2. **Persistent collab requires tab close/reopen** — After enabling persistent collab, `syncPersistentCollabOnOpen()` was never called (only triggered on leaf change). Added call after `enablePersistentCollab()` succeeds.

3. **Follow function missing for persistent collab** — `activeCollabSessionId` and `activeCollabDrawingId` were never set when auto-joining persistent sessions via `syncPersistentCollabOnOpen()`. Toolbar condition checked these to render collaborator list with follow buttons. Added assignments before `joinCollabFromObsidian()`.

4. **Zoom/scroll not detected in follow mode** — Excalidraw's `onPointerUpdate` only fires on mouse movement, not scroll/zoom. Added periodic viewport broadcast (500ms) in both frontend (`useCollab.ts`) and plugin (`collabManager.ts`) that detects viewport changes and sends pointer_update with last known cursor position. Skips during active dragging to avoid stale cursor positions causing jitter.

Fixes applied:
- [x] Moved "Collaborative" badge inside floating buttons container in `Viewer.tsx`
- [x] Call `syncPersistentCollabOnOpen()` after `enablePersistentCollab()` in `main.ts`
- [x] Set `activeCollabSessionId`/`activeCollabDrawingId` in `syncPersistentCollabOnOpen()` before joining
- [x] Added periodic viewport broadcast in `useCollab.ts` with change detection and drag-skip
- [x] Fixed plugin viewport broadcast in `collabManager.ts` to always run (not skip when DOM tracking active)
- [x] Track last known cursor position in both frontend and plugin for viewport broadcast reuse

**Persistent Collab Auto-Join After Unpublish/Republish Bug Fix (April 2026)**
Fixed a bug where enabling persistent collab after unpublishing and republishing a drawing would not auto-join the new session. Root cause:

- `unpublishDrawing()` cleared frontmatter and in-memory tracking but did **not** destroy the active `collabManager` WebSocket connection from the previous persistent collab session.
- When the user republished and enabled persistent collab on the new drawing, `autoJoinPersistentCollab()` checked `this.collabManager?.isJoined` — which was still `true` from the old session — and returned early without joining.

Fix applied:
- [x] Added `collabManager` cleanup in `unpublishDrawing()` in `main.ts`: if the active `collabManager` is joined to the drawing being unpublished, `cleanupCollabState()` is called to destroy the WebSocket connection and clear all session tracking state.

**Mobile Multi-Touch Pan Bug Fix (April 2026)**
Fixed a bug where two-finger pan gestures on mobile during a live collab session caused the cursor to jump wildly between both finger positions. With the laser pointer or pen tool active, lines were drawn between the two touch positions.

Root cause:
- `handlePointerUpdate` in `Viewer.tsx` received `pointersMap` (containing all active touch points) but never checked its size. Excalidraw fires `onPointerUpdate` for each touch point individually, so both finger positions were broadcast to collaborators.
- `attachPointerListener` in `collabManager.ts` (plugin) used raw DOM `pointermove` events with no multi-touch guard — secondary touch points fired their own events and were broadcast.

Fixes applied:
- [x] Added `if (payload.pointersMap.size > 1) return;` guard in `handlePointerUpdate` in `Viewer.tsx` — skips all pointer broadcasts during multi-touch gestures
- [x] Added active pointer counter (`pointerdown`/`pointerup`/`pointercancel` listeners) in `attachPointerListener` in `collabManager.ts` — skips `pointermove` broadcast when `activePointerCount > 1`
- [x] Added `isPrimary` check in `attachPointerListener` as second layer — skips non-primary touch points

**Mobile & Tablet Responsive Redesign (April 2026)**
Completely overhauled the responsive layout system in the frontend viewer to fix toolbar overlap and collab session toolbar shift issues.

Root causes:
- `LiveCollaborationTrigger` via `renderTopRightUI` caused toolbar shift on narrow screens
- Floating buttons overlay (`position: absolute`) overlapped Excalidraw's native toolbar on tablets
- Single binary `isMobile` breakpoint (730px) — no tablet tier

Fixes applied:
- [x] Created `useBreakpoint()` hook with 3-tier system: `phone` (≤1140px) / `tablet` (1141–1400px) / `desktop` (>1400px)
- [x] Added `isExcalidrawMobile` (730px) check to determine DOM injection target (bottom vs top toolbar)
- [x] `renderTopRightUI` returns `null` on phone (≤1140px) — eliminates toolbar shift
- [x] Collab button (🤝) injected into toolbar alongside Present/Edit/Browse on phone
- [x] Removed floating buttons overlay entirely — buttons now injected as native Excalidraw Island
- [x] `CollabPopover` renders as bottom sheet on phone, dropdown on tablet/desktop
- [x] `CollabStatus` join banner repositioned below toolbar on phone

### Active Decisions
- Ephemeral collab sessions are **in-memory only** — no persistence across server restarts (by design)
- Persistent collab sessions are **auto-recreated from disk** on first visitor after server restart
- Frontend uses **Excalidraw 0.17.6** — specific version pinned for API compatibility
- Plugin uses `requestUrl` from Obsidian API (not `fetch`) for cross-platform compatibility
- Drawing IDs stored in Obsidian frontmatter (`excalishare-id`)

### Known Limitations / Potential Improvements
- No automated tests (all manual testing)
- Collab sessions are in-memory only (lost on server restart)
- Large drawings may cause performance issues in collab (no delta updates, full scene sync)
- No user authentication for viewers (anyone with the URL can view)
- WebSocket has no auth — relies on unguessable session IDs
- Plugin can only manage one collab session at a time
- `DrawingsBrowser.tsx` is very large (54K+ chars) — could benefit from splitting
- `Viewer.tsx` is very large (42K+ chars) — could benefit from splitting
- No conflict resolution UI (server always picks highest version)
- No undo/redo sync across collaborators
- Persistent collab auto-save writes full drawing JSON every 2s (no delta-only saves yet)
