# Project Brief: ExcaliShare

## Overview
ExcaliShare is a **self-hosted Excalidraw drawing sharing server** with three main components:
1. **Backend** — Rust/Axum API server (default port 8184)
2. **Frontend** — React/Vite TypeScript viewer with PWA support
3. **Obsidian Plugin** — Obsidian plugin for publishing drawings with PDF embedding support

## Core Purpose
Allow users to publish Excalidraw drawings from Obsidian to a self-hosted server, view them in a web browser, and collaborate in real-time.

## Key Features
- **Publish/Sync** drawings from Obsidian to the server
- **View** drawings in a web-based Excalidraw viewer (with view, edit, present modes)
- **Browse** all shared drawings (tree view, search, overlay mode)
- **Live Collaboration** — real-time multi-user editing via WebSocket
- **PDF Embedding** — convert PDF pages to PNG for embedding in drawings
- **Admin Panel** — manage drawings and collab sessions
- **PWA Support** — installable web app with offline caching
- **NixOS Deployment** — declarative NixOS module for production deployment

## Technical Stack
- **Backend**: Rust, Axum 0.8, Tokio, Serde, tower-http, tower_governor (rate limiting)
- **Frontend**: React 18, TypeScript, Vite 8, Excalidraw 0.17.6, react-router-dom 6, vite-plugin-pwa
- **Plugin**: TypeScript, Obsidian API, esbuild
- **Infrastructure**: NixOS module, systemd service, Nix flake dev shell

## Version
- Backend: 1.0.1
- Frontend: 1.0.1
- Plugin manifest ID: `excalishare`
