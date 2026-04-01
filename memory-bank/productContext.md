# Product Context: ExcaliShare

## Why This Project Exists
ExcaliShare fills the gap between Obsidian's local-only Excalidraw drawings and the need to share them publicly or collaboratively. It provides a self-hosted alternative to Excalidraw's cloud service, giving users full control over their data.

## User Workflow
1. **Author** creates Excalidraw drawings in Obsidian
2. **Publish** via the plugin (ribbon icon, command palette, context menu, or floating toolbar)
3. **Share** the generated URL with others
4. **View** in any browser — no login required
5. **Collaborate** in real-time via live collab sessions started from Obsidian
6. **Pull** changes back to Obsidian after collaboration

## Key User Personas
- **Drawing Author** — Uses Obsidian + Excalidraw plugin, publishes drawings
- **Viewer** — Accesses shared drawings via URL, can browse all drawings
- **Collaborator** — Joins live sessions to edit drawings together in real-time
- **Admin** — Manages drawings and collab sessions via the admin panel

## Frontend Viewer Modes
- **View Mode** (default) — Read-only, zen mode enabled, no editing tools
- **Edit Mode** (press `w` twice) — Full Excalidraw editing, local only (not saved to server)
- **Present Mode** (press `p`/`q`) — Slideshow-like navigation between drawings with arrow keys
- **Collab Mode** — When joined to a live session, full editing with real-time sync

## Obsidian Plugin Features
- **Floating Toolbar** — Injected directly into the Excalidraw canvas view, shows publish/sync/collab status
- **Auto-Sync** — Optionally auto-sync published drawings on save (debounced)
- **Context Menu** — Right-click on `.excalidraw` files for all actions
- **Command Palette** — All actions available as commands
- **Pull from Server** — Sync collab changes back to the vault
- **PDF Embedding** — Converts PDF pages (with optional crop rects) to PNG for sharing

## Admin Panel (`/admin`)
- API key authentication (stored in sessionStorage)
- List all drawings with size, date, source path
- Delete drawings
- View and end active collab sessions
- Auto-refreshes collab sessions every 10 seconds
