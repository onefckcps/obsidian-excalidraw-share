# Technical Context: ExcaliShare

## Development Environment

### Nix Dev Shell
```bash
nix develop  # Provides Rust toolchain, Node.js, npm
```

### Build Commands
```bash
# Backend
cd backend && cargo build --release

# Frontend
cd frontend && npm install && npm run build

# Plugin
cd obsidian-plugin && npm install && npm run build

# Quick start (auto-builds + runs)
API_KEY="secret" BASE_URL="http://localhost:3030" ./start.sh
```

## Backend Dependencies (Cargo.toml)

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

## Frontend Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `@excalidraw/excalidraw` | ^0.17.6 | Drawing canvas component |
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | React DOM renderer |
| `react-router-dom` | ^6.26.0 | Client-side routing |
| `vite` | ^8.0.0 | Build tool |
| `vite-plugin-pwa` | ^1.2.0 | PWA/service worker support |
| `typescript` | ^5.5.4 | Type checking |

### Frontend `.npmrc`
```
legacy-peer-deps=true
```
Required because Excalidraw has peer dependency conflicts.

## Plugin Dependencies (package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `obsidian` | latest | Obsidian API |
| `@types/node` | ^16.11.6 | Node.js types |
| `esbuild` | 0.17.3 | Bundler |
| `typescript` | 4.7.4 | Type checking |
| `tslib` | 2.4.0 | TypeScript helpers |
| `builtin-modules` | 3.3.0 | Node built-in module list |

## Backend CLI Configuration

All config via CLI args with env var fallbacks:

| Arg | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `--listen-addr` | `LISTEN_ADDR` | `127.0.0.1:8184` | Listen address |
| `--data-dir` | `DATA_DIR` | `./data/drawings` | Drawing storage directory |
| `--api-key` | `API_KEY` | (required) | API key for protected routes |
| `--base-url` | `BASE_URL` | `http://localhost:8184` | Public base URL |
| `--max-upload-mb` | `MAX_UPLOAD_MB` | `50` | Max upload size in MB |
| `--frontend-dir` | `FRONTEND_DIR` | `./frontend/dist` | Frontend static files |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | Bearer | Upload/update drawing (supports `id` field for updates) |
| GET | `/api/view/{id}` | Public | Get drawing by ID |
| DELETE | `/api/drawings/{id}` | Bearer | Delete drawing |
| GET | `/api/drawings` | Bearer | List all drawings (includes `size_bytes`) |
| GET | `/api/public/drawings` | Public | List drawings (id, created_at, source_path only) |
| GET | `/api/health` | Public | Health check |
| POST | `/api/collab/start` | Bearer | Start collab session for a drawing |
| POST | `/api/collab/stop` | Bearer | End collab session (save or discard) |
| GET | `/api/collab/status/{drawing_id}` | Public | Check collab status (returns session_id if active) |
| GET | `/api/collab/sessions` | Bearer | List all active sessions (admin) |
| WS | `/ws/collab/{session_id}?name=...` | Public | WebSocket for real-time collaboration |

## WebSocket Protocol

### Client → Server Messages
```typescript
{ type: 'scene_update', elements: ExcalidrawElement[] }
{ type: 'pointer_update', x, y, button, tool?, scrollX?, scrollY?, zoom? }
{ type: 'set_name', name: string }
```

### Server → Client Messages
```typescript
{ type: 'snapshot', elements, appState, files, collaborators }
{ type: 'scene_update', elements, from: userId }
{ type: 'pointer_update', x, y, button, tool?, userId, name, colorIndex, scrollX?, scrollY?, zoom? }
{ type: 'user_joined', userId, name, collaborators }
{ type: 'user_left', userId, name, collaborators }
{ type: 'session_ended', saved: boolean }
{ type: 'error', message: string }
```

## Deployment

### NixOS (Declarative)
- Import `nixos/module.nix`
- Configure `services.excalishare` options
- API key loaded from file at runtime (not in systemd environment)
- Hardened systemd service (NoNewPrivileges, PrivateTmp, ProtectSystem, ProtectHome)
- Frontend copied via setup service

### Manual
- `excalishare.service` systemd unit file
- See `DEPLOYMENT.md` for full guide

## File Structure
```
obsidian-excalidraw-share/
├── backend/src/          # Rust source (main, routes, storage, auth, error, collab, ws)
├── frontend/src/         # React source (App, Viewer, Admin, Collab*, hooks, utils, types)
├── obsidian-plugin/      # Plugin source:
│   ├── main.ts           # Plugin class, commands, toolbar management, collab wiring
│   ├── settings.ts       # Settings interface + settings tab UI
│   ├── toolbar.ts        # Floating toolbar DOM management
│   ├── styles.ts         # CSS-in-JS styles, icons, colors
│   ├── pdfUtils.ts       # PDF-to-PNG conversion
│   ├── collabClient.ts   # WebSocket client with adaptive debouncing + pointer updates
│   ├── collabManager.ts  # Event-driven collab: onChange subscription, pointer tracking, follow mode, lerp viewport
│   └── collabTypes.ts    # Shared types for WS protocol + ExcalidrawAPI event subscriptions
├── nixos/module.nix      # NixOS service module
├── plans/                # Implementation plans (collab, security, UI, native-collab)
├── memory-bank/          # This documentation
├── AGENTS.md             # Agent guidelines
├── DEPLOYMENT.md         # Deployment guide
├── start.sh              # Quick start script
└── flake.nix             # Nix dev environment
```
