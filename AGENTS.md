# AGENTS.md - Agent Guidelines for obsidian-excalidraw-share

## Project Overview

This is a self-hosted Excalidraw drawing sharing server with three components:
- **backend/** - Rust/Axum API server (port 8184 by default)
- **frontend/** - React/Vite TypeScript viewer with PWA support
- **obsidian-plugin/** - Obsidian plugin for publishing drawings (with PDF embedding support)

Additional infrastructure:
- **nixos/** - NixOS module for declarative deployment
- **DEPLOYMENT.md** - Deployment guide (NixOS declarative or manual)
- **excalishare.service** - Systemd service file for manual deployment

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

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | API Key | Upload/update a drawing (supports `id` field for updates) |
| GET | `/api/view/{id}` | Public | Get a single drawing by ID |
| DELETE | `/api/drawings/{id}` | API Key | Delete a drawing |
| GET | `/api/drawings` | API Key | List all drawings (includes `size_bytes`) |
| GET | `/api/public/drawings` | Public | List drawings (id, created_at, source_path only) |
| GET | `/api/health` | Public | Health check |
| POST | `/api/collab/start` | API Key | Start a live collab session for a drawing |
| POST | `/api/collab/stop` | API Key | End a collab session (save or discard) |
| GET | `/api/collab/status/{drawing_id}` | Public | Check if drawing has active collab session |
| GET | `/api/collab/sessions` | API Key | List all active collab sessions (admin) |
| WS | `/ws/collab/{session_id}` | Public | WebSocket connection for real-time collaboration |

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
- Use `useMediaQuery('(max-width: 730px)')` hook for mobile detection (defined locally in components)
- Mobile breakpoint is 730px (not 640px)

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
│   ├── pdfUtils.ts         # PDF-to-PNG conversion utilities
│   ├── pdfUtils.js         # Compiled output
│   ├── manifest.json       # Plugin manifest (id: excalishare)
│   ├── package.json
│   └── tsconfig.json
├── nixos/
│   └── module.nix          # NixOS service module (systemd, optional nginx)
├── flake.nix               # Nix flake for dev environment
├── start.sh                # Quick start script (builds + runs)
├── excalishare.service     # Systemd service file (manual deployment)
├── DEPLOYMENT.md           # Deployment guide (NixOS + manual)
├── AGENTS.md               # This file
└── README.md               # Project documentation
```
