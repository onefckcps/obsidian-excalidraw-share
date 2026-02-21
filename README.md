# Excalidraw Share

A self-hosted solution for sharing Excalidraw drawings from your Obsidian vault.

## Overview

This project enables you to share Excalidraw drawings from Obsidian via a self-hosted server. When you share a drawing, it's uploaded to your server and becomes accessible via a public link.

### Architecture

```
┌─────────────────┐       POST /api/upload        ┌──────────────────────┐
│  Obsidian        │  ──────────────────────────▶  │  NixOS Server        │
│  (EA Script)     │                              │  notes.leyk.me       │
│                  │                              │                      │
│  Extracts JSON   │                              │  ┌─────────────────┐ │
│  from .excalidraw│                              │  │ Rust/Axum API   │ │
│  .md file        │                              │  └────────┬────────┘ │
└─────────────────┘                              │           │          │
                                                    │  ┌────────▼────────┐ │
┌─────────────────┐    Browser opens link          │  │ React Viewer   │ │
│  Recipient      │  ◀──────────────────────────   │  │ (viewMode=true)│ │
│  (Read-only)    │                                │  └─────────────────┘ │
└─────────────────┘                                └──────────────────────┘
```

## Project Structure

```
obsidian-excalidraw-share/
├── backend/          # Rust/Axum server
│   ├── src/
│   │   ├── main.rs   # Entry point
│   │   ├── routes.rs # API endpoints
│   │   ├── storage.rs# File storage abstraction
│   │   ├── auth.rs   # API key middleware
│   │   └── error.rs  # Error types
│   └── Cargo.toml
├── frontend/         # React/Vite viewer
│   ├── src/
│   │   ├── Viewer.tsx
│   │   └── ...
│   └── package.json
├── obsidian-script/  # ExcalidrawAutomate script
│   └── Share Drawing.md
└── nixos/           # NixOS deployment
    ├── default.nix  # Package definition
    └── module.nix   # Service module
```

---

## Quick Start (Automated)

### Using the Start Script

```bash
# Clone and enter the project
cd obsidian-excalidraw-share

# Run the start script (auto-builds if needed)
./start.sh
```

The script will:
1. Build the backend if not present
2. Build the frontend if not present
3. Create the data directory
4. Start the server

Configure via environment variables:
```bash
API_KEY="my-secret" BASE_URL="http://localhost:3030" ./start.sh
```

---

## Setup Guide

### Prerequisites

- **For local development:**
  - Rust toolchain (`rustup`, `cargo`)
  - Node.js 20+ and npm
  - Or use Nix: `nix develop`

- **For production (NixOS):**
  - NixOS machine with flake support
  - Domain configured (e.g., `notes.leyk.me`)
  - SSL certificates (handled by certbot)

---

### Step 1: Build the Frontend

The frontend is the viewer that displays shared drawings in read-only mode.

```bash
cd frontend

# Install dependencies
npm install

# Build for production
npm run build

# Output is in frontend/dist/
```

The built files will be in `frontend/dist/`. These are static files that will be served by the backend.

---

### Step 2: Build the Backend

The backend handles API requests (upload, download, delete) and serves the frontend.

```bash
cd backend

# Build the release binary
cargo build --release

# Output: target/release/excalidraw-share
```

---

### Step 3: Configure and Run (Local Development)

#### Environment Variables

The server can be configured via environment variables or CLI arguments:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | - | Secret key for upload/delete operations |
| `BASE_URL` | Yes | `http://localhost:3030` | Public URL (used for share links) |
| `DATA_DIR` | No | `./data/drawings` | Where to store drawing JSON files |
| `FRONTEND_DIR` | No | `./frontend/dist` | Path to built frontend |
| `MAX_UPLOAD_MB` | No | `50` | Maximum upload size in MB |
| `LISTEN_ADDR` | No | `127.0.0.1:3030` | Address to bind to |

#### Quick Test Run

```bash
cd backend

# Create data directory
mkdir -p data/drawings

# Run with environment variables
API_KEY="my-secret-key" \
BASE_URL="http://localhost:3030" \
DATA_DIR="./data/drawings" \
FRONTEND_DIR="../frontend/dist" \
./target/release/excalidraw-share
```

The server will start at `http://localhost:3030`. Visit `http://localhost:3030/` to see the landing page, or `http://localhost:3030/d/<id>` to view a drawing.

#### Testing the API

Once the server is running, you can test with curl:

```bash
# Upload a drawing (requires API key)
curl -X POST http://localhost:3030/api/upload \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "excalidraw",
    "version": 2,
    "elements": [
      {"type": "rectangle", "x": 100, "y": 100, "width": 200, "height": 150, "strokeColor": "#000000", "backgroundColor": "#ff0000"},
      {"type": "text", "x": 150, "y": 180, "text": "Hello World!", "fontSize": 24, "strokeColor": "#000000"}
    ],
    "appState": {"viewBackgroundColor": "#ffffff", "theme": "light"}
  }'

# Response: {"id":"abc123","url":"http://localhost:3030/d/abc123"}

# Download a drawing (public, no auth needed)
curl http://localhost:3030/api/drawings/abc123

# View in browser
# http://localhost:3030/d/abc123

# List all drawings (requires API key)
curl http://localhost:3030/api/drawings \
  -H "Authorization: Bearer my-secret-key"

# Delete a drawing (requires API key)
curl -X DELETE http://localhost:3030/api/drawings/abc123 \
  -H "Authorization: Bearer my-secret-key"
```

```bash
# Upload a drawing (requires API key)
curl -X POST http://localhost:3030/api/upload \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"type":"excalidraw","version":2,"elements":[]}'

# Response: {"id":"abc123","url":"http://localhost:3030/d/abc123"}

# Download a drawing (public, no auth needed)
curl http://localhost:3030/api/drawings/abc123

# List all drawings (requires API key)
curl http://localhost:3030/api/drawings \
  -H "Authorization: Bearer my-secret-key"
```

---

### Step 4: Configure Obsidian

#### 4.1 Install the Script

1. Open Obsidian
2. Navigate to your vault's Excalidraw scripts folder:
   - Default: `Vault/Excalidraw/Scripts/Downloaded/`
3. Copy `obsidian-script/Share Drawing.md` from this repo into that folder
4. If Excalidraw doesn't recognize it, restart Obsidian

#### 4.2 Configure the Script

Open the copied `Share Drawing.md` in Obsidian and edit the configuration at the top:

```javascript
const CONFIG = {
  // Your self-hosted server URL (without trailing slash)
  apiUrl: "https://notes.leyk.me",
  
  // API key - WARNING: For better security, consider reading from a vault file
  apiKey: "my-secret-key",
};
```

**Security Note:** The API key is stored in plaintext in the script. For better security, you can:

```javascript
// Option 1: Read from a separate file in your vault
const apiKeyFile = app.vault.getAbstractFileByPath(".excalidraw-share-key");
const apiKey = apiKeyFile ? (await app.vault.read(apiKeyFile)).trim() : null;

// Option 2: Use Obsidian's Secrets plugin
```

#### 4.3 Using the Script

1. Open any Excalidraw drawing in Obsidian
2. Open the Command Palette (`Ctrl/Cmd + Shift + P`)
3. Search for "Share Drawing" and select it
4. The script will:
   - Extract the drawing data
   - Upload it to your server
   - Copy the share link to your clipboard
5. Share the link with anyone!

You can also add a button to the Excalidraw toolbar by editing the script's configuration section.

---

## NixOS Deployment (Recommended)

This is the recommended way to deploy in production on NixOS. The module handles:
- Building the backend
- Creating a dedicated user
- Setting up the data directory
- Configuring the systemd service
- Nginx reverse proxy with VPN access control
- SSL certificates via ACME

### Step 1: Create API Key

```bash
# Create the API key file
sudo mkdir -p /etc/secrets
sudo openssl rand -base64 32 | sudo tee /etc/secrets/excalidraw-share-api-key
sudo chmod 600 /etc/secrets/excalidraw-share-api-key
```

### Step 2: Build Frontend

The frontend needs to be built first:

```bash
cd /path/to/obsidian-excalidraw-share/frontend
npm install
npm run build
```

### Step 3: Add to NixOS Configuration

Add to your `configuration.nix`:

```nix
imports = [ /path/to/obsidian-excalidraw-share/nixos/module.nix ];

services.excalidraw-share = {
  enable = true;
  domain = "notes.leyk.me";
  apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
  
  # Path to built frontend (REQUIRED)
  frontendSource = /path/to/obsidian-excalidraw-share/frontend/dist;
  
  # Access control (default: vpnOnly)
  # Options: vpnOnly | vpnAndSelf | public
  vpnAccess = "vpnOnly";
};
```

### Step 4: Rebuild

```bash
sudo nixos-rebuild switch
```

### VPN Access Options

| Option | Description |
|--------|-------------|
| `vpnOnly` | Only VPN clients (100.64.0.0/10) + localhost |
| `vpnAndSelf` | Like vpnOnly + your external IP |
| `public` | Anyone can access (not recommended!) |

---

### Manual Deployment (Alternative)

If you prefer manual control:

services.excalidraw-share = {
  enable = true;
  domain = "notes.leyk.me";
  apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
  dataDir = "/var/lib/excalidraw-share";
  frontendDir = "/var/lib/excalidraw-share/frontend";
};
```

Then rebuild:
```bash
sudo nixos-rebuild switch
```

The module will:
- Build the Rust backend
- Build the React frontend
- Create a systemd service
- Set up Nginx with SSL (via certbot)
- Configure the firewall

#### Option B: Manual Build

```bash
# Build everything
cd /path/to/obsidian-excalidraw-share

# Build frontend
cd frontend && npm install && npm run build

# Build backend
cd ../backend && cargo build --release

# Copy to server
sudo cp target/release/excalidraw-share /usr/local/bin/
sudo cp -r ../frontend/dist /var/lib/excalidraw-share/frontend

# Create data directory
sudo mkdir -p /var/lib/excalidraw-share/drawings
```

##### Install Systemd Service

```bash
# Copy the service file
sudo cp excalidraw-share.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable excalidraw-share
sudo systemctl start excalidraw-share
```

Edit the service file to set your environment variables (`API_KEY`, `BASE_URL`, etc.) before starting.

### Step 3: Verify Deployment

```bash
# Check service status
systemctl status excalidraw-share

# Check health endpoint
curl https://notes.leyk.me/api/health

# Check frontend
curl https://notes.leyk.me/
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | Bearer token | Upload new drawing |
| GET | `/api/drawings/:id` | Public | Get drawing by ID |
| DELETE | `/api/drawings/:id` | Bearer token | Delete drawing |
| GET | `/api/drawings` | Bearer token | List all drawings |
| GET | `/api/health` | Public | Health check |

### Upload Request

```bash
curl -X POST https://notes.leyk.me/api/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @drawing.json
```

### Response

```json
{
  "id": "abc12345",
  "url": "https://notes.leyk.me/d/abc12345"
}
```

---

## Troubleshooting

### Server Won't Start

```bash
# Check logs
journalctl -u excalidraw-share -f

# Common issues:
# - Port already in use: Check if another service is using the port
# - Missing data directory: mkdir -p /var/lib/excalidraw-share
# - Wrong permissions: chown -R excalidraw-share:excalidraw-share /var/lib/excalidraw-share
```

### Upload Fails

```bash
# Verify API key is correct
curl -X POST https://notes.leyk.me/api/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"excalidraw","elements":[]}'

# Check server logs for errors
journalctl -u excalidraw-share | tail -50
```

### Drawing Not Loading

- Ensure the drawing ID exists: `curl https://notes.leyk.me/api/drawings/<id>`
- Check browser console for JavaScript errors
- Verify the frontend is being served correctly

### Images Not Showing

Excalidraw drawings with embedded images store them as base64 in the JSON. If images are missing:
- Check that the upload size limit isn't cutting off large files
- Verify the JSON includes the `files` field

### SSL Certificate Issues

```bash
# For NixOS certbot issues
sudo systemctl restart certbot
sudo systemctl reload nginx
```

---

## Security Considerations

- **API Key**: Keep the API key secret. It controls upload/delete operations.
- **SSL/TLS**: Always use HTTPS in production (the NixOS module uses certbot).
- **Rate Limiting**: Consider adding rate limiting for the upload endpoint.
- **File Size**: Default max upload is 50MB (for base64-encoded images in drawings).
- **User Isolation**: Currently, all drawings share the same API key. For multi-user scenarios, consider adding per-user authentication.

---

## Development

### Using Nix Flakes

```bash
# Enter development shell (includes Rust, Node.js, etc.)
nix develop

# Or use the existing flake
cd /path/to/repo
nix develop

# Then build
cd backend && cargo build
cd ../frontend && npm install && npm run build
```

### Adding Custom Fonts

The Excalidraw viewer uses self-hosted fonts. The NixOS module automatically copies the required font files. For manual deployment:

```bash
# Copy fonts from node_modules
cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts /var/lib/excalidraw-share/frontend/assets/

# Set asset path in frontend (already configured in main.tsx)
window.EXCALIDRAW_ASSET_PATH = '/assets/'
```

---

## License

MIT
