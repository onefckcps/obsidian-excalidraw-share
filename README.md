<p align="center">
  <img src="docs/assets/logo.png" alt="ExcaliShare Logo" width="120" />
</p>

<h1 align="center">ExcaliShare</h1>

<p align="center">
  <strong>Self-hosted Excalidraw sharing & real-time collaboration for Obsidian</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#installation">Installation</a> •
  <a href="#obsidian-plugin">Obsidian Plugin</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#api-reference">API</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <!-- TODO: Uncomment when published -->
  <!-- <a href="https://github.com/YOUR_USERNAME/excalishare/actions"><img src="https://img.shields.io/github/actions/workflow/status/YOUR_USERNAME/excalishare/ci.yml?style=flat-square" alt="CI"></a> -->
  <!-- <a href="https://github.com/YOUR_USERNAME/excalishare/releases"><img src="https://img.shields.io/github/v/release/YOUR_USERNAME/excalishare?style=flat-square" alt="Release"></a> -->
  <!-- <a href="https://github.com/YOUR_USERNAME/excalishare/blob/main/LICENSE"><img src="https://img.shields.io/github/license/YOUR_USERNAME/excalishare?style=flat-square" alt="License"></a> -->
  <img src="https://img.shields.io/badge/backend-Rust%20%2F%20Axum-orange?style=flat-square" alt="Backend: Rust/Axum">
  <img src="https://img.shields.io/badge/frontend-React%20%2F%20TypeScript-blue?style=flat-square" alt="Frontend: React/TypeScript">
  <img src="https://img.shields.io/badge/plugin-Obsidian-purple?style=flat-square" alt="Plugin: Obsidian">
</p>

---

## What is ExcaliShare?

ExcaliShare lets you **publish Excalidraw drawings from Obsidian** to your own server and **share them with anyone** via a simple link. No cloud accounts, no third-party services — just your drawings, your server, your data.

<!-- TODO: Replace with actual hero GIF/screenshot -->
<p align="center">
  <img src="docs/assets/hero-demo.gif" alt="ExcaliShare Demo — Publish from Obsidian, view in browser" width="800" />
  <br>
  <em>Publish from Obsidian → Share a link → View & collaborate in the browser</em>
</p>

---

## Features

### 📤 One-Click Publish

Publish any Excalidraw drawing from Obsidian with a single click. The plugin integrates directly into Excalidraw's toolbar — no context switching needed.

<!-- TODO: Replace with actual GIF -->
<p align="center">
  <img src="docs/assets/feature-publish.gif" alt="One-click publish from Obsidian" width="700" />
</p>

### 🤝 Real-Time Collaboration

Start a live collaboration session from Obsidian and invite anyone to edit together. See cursors, follow participants, and sync changes back to your vault.

<!-- TODO: Replace with actual GIF -->
<p align="center">
  <img src="docs/assets/feature-collab.gif" alt="Real-time collaboration with cursors" width="700" />
</p>

### 🔄 Persistent Collaboration

Enable always-on collaboration for any drawing. Guests can edit even when you're offline — the server is the source of truth. Changes auto-save and sync back to Obsidian.

<!-- TODO: Replace with actual GIF -->
<p align="center">
  <img src="docs/assets/feature-persistent-collab.gif" alt="Persistent collaboration mode" width="700" />
</p>

### 🖥️ Web Viewer with Multiple Modes

Drawings open in a full-featured web viewer with:
- **View Mode** — Clean, read-only presentation
- **Edit Mode** — Full Excalidraw editing (press `W` twice)
- **Present Mode** — Navigate between drawings like slides (press `P`)
- **Browse Mode** — Search and explore all shared drawings

<!-- TODO: Replace with actual GIF -->
<p align="center">
  <img src="docs/assets/feature-viewer-modes.gif" alt="Viewer modes: view, edit, present, browse" width="700" />
</p>

### 🔒 Password Protection

Optionally protect drawings and collaboration sessions with passwords. Uses Argon2id hashing — the same algorithm used by password managers.

### 📱 Mobile & Tablet Support

Fully responsive design with a 3-tier breakpoint system. Works on phones, tablets, and desktops. Installable as a PWA for offline access.

### 🏠 Fully Self-Hosted

Your data stays on your server. No telemetry, no tracking, no cloud dependencies. Deploy on NixOS, Docker, or any Linux server.

---

## Demo

<!-- TODO: Replace with actual screenshot or link to demo instance -->
<p align="center">
  <img src="docs/assets/demo-screenshot.png" alt="ExcaliShare web viewer" width="800" />
</p>

<!-- TODO: Uncomment when demo instance is available -->
<!-- 🌐 **Try it live:** [demo.excalishare.example.com](https://demo.excalishare.example.com) -->

---

## Architecture

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

| Component | Tech Stack | Description |
|---|---|---|
| **Backend** | Rust, Axum 0.8, Tokio | API server, WebSocket collab, file storage |
| **Frontend** | React 18, TypeScript, Vite, Excalidraw | Web viewer with PWA support |
| **Plugin** | TypeScript, Obsidian API | Publish, sync, and collaborate from Obsidian |

---

## Quick Start

The fastest way to get ExcaliShare running locally:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/excalishare.git
cd excalishare

# Run the start script (auto-builds everything)
API_KEY="my-secret-key" ./start.sh
```

The server starts at `http://localhost:8184`. Configure the Obsidian plugin to point to this URL.

### Using Nix

```bash
# Enter the development shell (includes Rust, Node.js, and all tools)
nix develop

# Then run the start script
API_KEY="my-secret-key" ./start.sh
```

---

## Installation

### Prerequisites

- **Rust** toolchain (1.75+) — [rustup.rs](https://rustup.rs)
- **Node.js** 20+ and npm
- Or just **Nix** — `nix develop` provides everything

### Build from Source

```bash
# 1. Build the frontend
cd frontend
npm install
npm run build

# 2. Build the backend
cd ../backend
cargo build --release

# 3. Run the server
API_KEY="your-secret-key" \
BASE_URL="http://localhost:8184" \
./target/release/excalishare
```

### Configuration

All settings can be configured via environment variables or CLI arguments:

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | *(required)* | Secret key for admin operations |
| `BASE_URL` | `http://localhost:8184` | Public URL for share links |
| `LISTEN_ADDR` | `127.0.0.1:8184` | Address to bind to |
| `DATA_DIR` | `./data/drawings` | Drawing storage directory |
| `FRONTEND_DIR` | `./frontend/dist` | Path to built frontend |
| `MAX_UPLOAD_MB` | `50` | Maximum upload size in MB |

---

## Obsidian Plugin

### Installation

<!-- TODO: Update when published to community plugins -->
**Manual installation** (until published to community plugins):

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/YOUR_USERNAME/excalishare/releases)
2. Create a folder: `YourVault/.obsidian/plugins/excalishare/`
3. Copy both files into that folder
4. Enable the plugin in Obsidian Settings → Community Plugins

### Setup

1. Open **Settings → ExcaliShare**
2. Enter your server URL (e.g., `https://drawings.example.com`)
3. Enter your API key
4. Done! The ExcaliShare toolbar appears on every Excalidraw drawing

### Plugin Features

<!-- TODO: Replace with actual screenshot -->
<p align="center">
  <img src="docs/assets/plugin-toolbar.png" alt="ExcaliShare toolbar in Obsidian" width="500" />
</p>

| Feature | Description |
|---|---|
| **Publish** | Upload drawing to server, get a shareable link |
| **Sync** | Update an already-published drawing |
| **Auto-Sync** | Automatically sync on save (configurable) |
| **Live Collab** | Start a real-time collaboration session |
| **Persistent Collab** | Enable always-on collaboration mode |
| **Pull from Server** | Sync collaboration changes back to your vault |
| **Copy Link** | Copy the share URL to clipboard |
| **PDF Embedding** | Convert PDF pages to images for sharing |

### Toolbar Modes

The plugin toolbar integrates in two ways:

- **Auto Mode** *(default)* — Injected directly into Excalidraw's native toolbar
- **Floating Mode** — Positioned as an overlay at a configurable corner

---

## Deployment

### Docker (Recommended)

<!-- TODO: Add Docker support and uncomment -->
<!--
```bash
docker compose up -d
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for full Docker configuration.
-->

### NixOS (Declarative)

```nix
imports = [ ./path/to/excalishare/nixos/module.nix ];

services.excalishare = {
  enable = true;
  domain = "drawings.example.com";
  apiKeyFile = "/etc/secrets/excalishare-api-key";
  package = ./backend/target/release/excalishare;
  frontendSource = ./frontend/dist;
};
```

### Manual (Systemd)

```bash
# Copy binary and frontend
sudo cp backend/target/release/excalishare /usr/local/bin/
sudo cp -r frontend/dist /var/lib/excalishare/frontend

# Install and start the service
sudo cp excalishare.service /etc/systemd/system/
sudo systemctl enable --now excalishare
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions including reverse proxy setup, SSL, and security hardening.

---

## API Reference

### Public Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/view/{id}` | Get drawing by ID |
| `GET` | `/api/public/drawings` | List all drawings (id, date, path) |
| `GET` | `/api/collab/status/{id}` | Check collab session status |
| `POST` | `/api/persistent-collab/activate/{id}` | Join persistent collab session |
| `WS` | `/ws/collab/{session_id}` | WebSocket for real-time collaboration |

### Protected Endpoints (Bearer Token)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload/update a drawing |
| `DELETE` | `/api/drawings/{id}` | Delete a drawing |
| `GET` | `/api/drawings` | List all drawings (admin) |
| `POST` | `/api/collab/start` | Start collab session |
| `POST` | `/api/collab/stop` | End collab session |
| `POST` | `/api/persistent-collab/enable` | Enable persistent collab |
| `POST` | `/api/persistent-collab/disable` | Disable persistent collab |

### Example: Upload a Drawing

```bash
curl -X POST https://drawings.example.com/api/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "excalidraw",
    "elements": [...],
    "appState": {"viewBackgroundColor": "#ffffff"},
    "files": {}
  }'

# Response: {"id": "a1b2c3d4", "url": "https://drawings.example.com/d/a1b2c3d4"}
```

---

## Security

- **API Key Authentication** — All admin operations require a Bearer token
- **Constant-Time Comparison** — API keys compared using `subtle::ConstantTimeEq`
- **Argon2id Password Hashing** — For drawing and collab session passwords
- **Rate Limiting** — Per-IP rate limiting via `tower_governor`
- **CORS Restriction** — Only configured origins allowed
- **Path Traversal Protection** — Drawing IDs sanitized (alphanumeric + `-_` only)
- **WebSocket Limits** — 5 MB message size, 20 participants per session

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

---

## Project Structure

```
excalishare/
├── backend/                 # Rust/Axum API server
│   ├── src/
│   │   ├── main.rs          # Entry point, CLI config, routes
│   │   ├── routes.rs        # HTTP handlers
│   │   ├── storage.rs       # File storage abstraction
│   │   ├── collab.rs        # Collaboration session manager
│   │   ├── ws.rs            # WebSocket handler
│   │   ├── auth.rs          # API key middleware
│   │   ├── password.rs      # Argon2id utilities
│   │   └── error.rs         # Error types
│   └── Cargo.toml
├── frontend/                # React/Vite web viewer
│   ├── src/
│   │   ├── Viewer.tsx       # Main drawing viewer
│   │   ├── DrawingsBrowser.tsx  # Browse/search drawings
│   │   ├── AdminPage.tsx    # Admin panel
│   │   ├── hooks/useCollab.ts   # Collaboration hook
│   │   └── utils/collabClient.ts # WebSocket client
│   └── package.json
├── obsidian-plugin/         # Obsidian plugin
│   ├── main.ts              # Plugin entry point
│   ├── collabManager.ts     # Native collab from Obsidian
│   ├── toolbar.ts           # Toolbar UI
│   ├── settings.ts          # Plugin settings
│   └── manifest.json
├── nixos/module.nix         # NixOS deployment module
├── DEPLOYMENT.md            # Deployment guide
└── start.sh                 # Quick start script
```

---

## Roadmap

- [ ] Docker Compose setup for easy deployment
- [ ] Automated tests (backend + frontend)
- [ ] GitHub Actions CI/CD pipeline
- [ ] One-click deploy (Railway, Fly.io)
- [ ] S3/cloud storage backend
- [ ] Drawing export (PNG, SVG, PDF)
- [ ] Embeddable viewer (`<iframe>` support)
- [ ] Drawing versioning / history

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

```bash
# Development setup
nix develop          # Enter dev shell
cd backend && cargo run   # Start backend (port 8184)
cd frontend && npm run dev  # Start frontend dev server (port 5173)
cd obsidian-plugin && npm run dev  # Watch mode for plugin
```

---

## Support

If you find ExcaliShare useful, consider supporting its development:

<!-- TODO: Uncomment and update links when accounts are set up -->
<!-- 
<p align="center">
  <a href="https://github.com/sponsors/YOUR_USERNAME"><img src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=for-the-badge&logo=github-sponsors" alt="GitHub Sponsors"></a>
  <a href="https://buymeacoffee.com/YOUR_USERNAME"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
</p>
-->

---

## License

[MIT](LICENSE) — Use it however you want. Attribution appreciated but not required.

---

<p align="center">
  Made with ❤️ for the Obsidian & Excalidraw community
</p>
