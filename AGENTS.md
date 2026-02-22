# AGENTS.md - Agent Guidelines for obsidian-excalidraw-share

## Project Overview

This is a self-hosted Excalidraw drawing sharing server with three components:
- **backend/** - Rust/Axum API server
- **frontend/** - React/Vite TypeScript viewer  
- **obsidian-plugin/** - Obsidian plugin for publishing drawings

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
npm run dev                          # Development server
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
- Use `useMediaQuery('(max-width: 730px)')` hook for mobile detection
- Mobile breakpoint is 730px (not 640px)

### Rust (Backend)

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
    #[error("Storage error: {0}")]
    Storage(#[from] std::io::Error),
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Storage(e) => {
                tracing::error!("Storage error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };
        (status, Json(ErrorResponse { error: message })).into_response()
    }
}
```

**Logging & Naming**
- Use `tracing::info!` for operations, `tracing::error!` for errors
- Include context: `tracing::info!(id = %id, "Drawing uploaded")`
- Modules/Functions: snake_case; Types/Structs: PascalCase

### Obsidian Plugin

**Structure**
- Single class extending `Plugin`, use `onload()` for initialization
- Use `addCommand()`, `addSettingTab()`, `addRibbonIcon()` in `onload`
- Store settings in `this.settings` with `loadSettings()`/`saveSettings()`

**Best Practices**
- Always handle errors and show `Notice` to user
- Use async/await for all vault operations
- Use `console.log` with plugin prefix for debugging

## Testing

No automated tests configured. Test manually:
```bash
# Backend
cd backend && cargo run &
curl -X POST http://localhost:8184/api/upload -H "Authorization: Bearer key" -d '{...}'

# Frontend
cd frontend && npm run dev
```

## Common Tasks

**Adding a new API endpoint:**
1. Add handler in `backend/src/routes.rs`
2. Add route in `backend/src/main.rs`

**Adding a new frontend page:**
1. Create component in `frontend/src/`
2. Add route in `frontend/src/App.tsx`

**Building for production:**
```bash
cd frontend && npm run build
cd backend && cargo build --release
```

## Project Structure

```
obsidian-excalidraw-share/
├── backend/
│   ├── src/
│   │   ├── main.rs         # Entry point, route registration
│   │   ├── routes.rs       # API handlers
│   │   ├── storage.rs      # File storage logic
│   │   └── error.rs       # Error types
│   └── Cargo.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main router
│   │   ├── Viewer.tsx      # Drawing viewer with Excalidraw
│   │   ├── DrawingsBrowser.tsx  # Browse/search drawings
│   │   └── ...
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── obsidian-plugin/
│   ├── main.ts             # Plugin entry point
│   ├── manifest.json       # Plugin manifest
│   └── package.json
├── flake.nix               # Nix flake for dev environment
└── start.sh               # Quick start script
```
