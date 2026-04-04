# ExcaliShare — Reddit Post Drafts

## Post 1: r/ObsidianMD (Hauptpost)

### Titel-Optionen (wähle einen):
- `I built a self-hosted Excalidraw sharing plugin with real-time collaboration`
- `Share your Excalidraw drawings with anyone — self-hosted plugin with live collab [WIP]`
- `After months of building: self-hosted Excalidraw sharing + real-time collaboration from Obsidian`

### Body:

> Hey everyone!
>
> I've been working on **ExcaliShare** — a self-hosted solution for sharing Excalidraw drawings from Obsidian. The idea is simple: click a button in Obsidian, get a shareable link, and anyone can view your drawing in the browser.
>
> But it grew into something bigger than I expected.
>
> **What it does:**
>
> 📤 **One-click publish** — Publish any Excalidraw drawing from Obsidian's toolbar. Get a link, share it with anyone.
>
> <!-- GIF 1: Publish flow -->
>
> 🤝 **Real-time collaboration** — Start a collab session from Obsidian. Others join via the browser. You see their cursors, they see yours. Changes sync back to your vault.
>
> <!-- GIF 2: Collab with cursors -->
>
> 🔄 **Persistent collab** — Enable "always-on" collaboration for any drawing. Guests can edit even when you're offline. The server keeps everything in sync.
>
> 🖥️ **Web viewer** — View mode, edit mode, present mode (navigate drawings like slides), and a browse mode to search all shared drawings.
>
> <!-- GIF 3: Viewer modes -->
>
> 🔒 **Password protection** — Optionally protect drawings and collab sessions with passwords.
>
> 📱 **Mobile support** — Fully responsive, works on phones and tablets. Installable as a PWA.
>
> **Tech stack:**
> - Backend: Rust (Axum) — fast, low memory usage
> - Frontend: React + Excalidraw
> - Plugin: TypeScript, integrates directly into Excalidraw's toolbar
> - Deployment: NixOS module, systemd service (Docker coming soon)
>
> **Everything is self-hosted.** Your data stays on your server. No cloud accounts, no third-party services.
>
> It's still a work in progress — I'm cleaning things up for an open-source release on GitHub. Would love to hear your thoughts and what features you'd find most useful!
>
> Happy to answer any questions.

---

## Post 2: r/selfhosted

### Titel-Optionen:
- `I built a self-hosted Excalidraw sharing server with real-time collaboration`
- `Self-hosted alternative to Excalidraw+ with Obsidian integration and live collab`
- `ExcaliShare: publish and collaborate on Excalidraw drawings from your own server`

### Body:

> I've been building **ExcaliShare** — a self-hosted server for sharing and collaborating on Excalidraw drawings.
>
> **The problem:** I use Excalidraw in Obsidian for diagrams, architecture sketches, and brainstorming. But sharing them meant either screenshots (ugly) or Excalidraw+ ($7/user/month). I wanted something self-hosted where I control the data.
>
> **What I built:**
>
> - **Rust backend** (Axum) — serves drawings, handles WebSocket collaboration, stores everything as JSON files on disk. Low resource usage, no database needed.
> - **React frontend** — full Excalidraw viewer with view/edit/present modes, PWA support, offline caching
> - **Obsidian plugin** — one-click publish, auto-sync, live collaboration directly from Obsidian
>
> <!-- GIF: Quick demo -->
>
> **Key features:**
> - 📤 Publish drawings → get a shareable link
> - 🤝 Real-time collaboration via WebSocket (see cursors, follow mode)
> - 🔄 Persistent collab — guests can edit even when you're offline
> - 🔒 Password protection (Argon2id hashing)
> - 📱 Mobile-friendly PWA
> - 🛡️ Rate limiting, CORS, constant-time auth
> - NixOS module for declarative deployment
>
> **Resource usage:** The Rust backend uses ~10-20 MB RAM idle. Drawings are plain JSON files — no database, no Redis, no external dependencies.
>
> **What's next:**
> - Docker Compose setup (coming soon!)
> - Open-source release on GitHub
> - Obsidian community plugin submission
>
> Would love feedback from the self-hosted community. What would make this useful for you?

---

## Post 3: r/Excalidraw

### Titel:
- `Self-hosted Excalidraw sharing with real-time collaboration — built for Obsidian users`

### Body:

> I built a self-hosted server for sharing Excalidraw drawings with real-time collaboration support.
>
> **How it works:**
> 1. Draw in Obsidian (using the Excalidraw plugin)
> 2. Click "Publish" → drawing is uploaded to your server
> 3. Share the link → anyone can view it in a full Excalidraw viewer
> 4. Start a collab session → edit together in real-time
>
> <!-- GIF: End-to-end flow -->
>
> The viewer supports all Excalidraw features — view mode, edit mode, and even a "present mode" where you can navigate between drawings like slides.
>
> Collaboration uses WebSocket with version-based element merging, so there's no flickering or lost changes. You can even see each other's cursors and follow someone's viewport.
>
> Everything runs on your own server. Backend is Rust, frontend is React + Excalidraw library.
>
> Still WIP — working on getting it ready for open-source release. Curious what the Excalidraw community thinks!

---

## Post 4: r/rust

### Titel:
- `I built a real-time collaboration server in Rust/Axum with WebSocket, version-based merging, and Argon2id auth`
- `ExcaliShare: a self-hosted Excalidraw sharing server built with Axum + Tokio`

### Body:

> Sharing a side project I've been working on: **ExcaliShare** — a self-hosted server for sharing and collaborating on Excalidraw drawings.
>
> **Tech highlights (Rust side):**
>
> - **Axum 0.8** with WebSocket support for real-time collaboration
> - **In-memory session manager** with `tokio::sync::broadcast` channels for multi-user collab
> - **Version-based element merging** — each drawing element has a version number, server always keeps the highest version. Prevents deletion flickering when multiple users edit simultaneously.
> - **Argon2id password hashing** for optional drawing/session protection
> - **Constant-time API key comparison** via the `subtle` crate
> - **Rate limiting** with `tower_governor` (per-IP, separate limits for public/protected routes)
> - **File-based storage** — each drawing is a JSON file, no database needed
> - **Background task** for session cleanup with auto-save of expired sessions
> - **~10-20 MB RAM** idle, handles concurrent WebSocket connections efficiently
>
> The collab protocol handles: scene updates (element arrays), pointer tracking (cursor positions), follow mode (viewport syncing), and participant management (join/leave/color assignment).
>
> One interesting challenge was **element merging**: when two users edit different elements simultaneously, the server needs to merge both changes without losing either. I solved this with a version-based approach — each element has an incrementing version, and the server always keeps the element with the highest version for each ID.
>
> The project also has a React frontend and an Obsidian plugin, but the Rust backend is the core.
>
> Still cleaning up for open-source release. Happy to discuss the architecture or any Axum/WebSocket patterns!

---

## Post 5: Hacker News (Show HN)

### Titel:
`Show HN: ExcaliShare – Self-hosted Excalidraw sharing with real-time collaboration`

### Body:

> ExcaliShare is a self-hosted server for sharing Excalidraw drawings with real-time collaboration support. It integrates with Obsidian via a plugin.
>
> The workflow: draw in Obsidian → publish to your server → share a link → collaborate in real-time.
>
> Key features:
> - One-click publish from Obsidian
> - Real-time collaboration via WebSocket (cursors, follow mode, version-based merging)
> - Persistent collaboration (guests can edit when you're offline)
> - Password protection (Argon2id)
> - PWA with offline support
>
> Tech: Rust/Axum backend (~10 MB RAM), React frontend, TypeScript Obsidian plugin. No database — drawings stored as JSON files.
>
> Self-hosted alternative to Excalidraw+ ($7/user/month) for people who want to own their data.
>
> Working on open-source release. Feedback welcome!

---

## Post 6: r/NixOS

### Titel:
- `ExcaliShare: self-hosted Excalidraw sharing with a declarative NixOS module`

### Body:

> I built a self-hosted Excalidraw sharing server and wrote a NixOS module for it.
>
> ```nix
> services.excalishare = {
>   enable = true;
>   domain = "drawings.example.com";
>   apiKeyFile = "/etc/secrets/excalishare-api-key";
> };
> ```
>
> The module handles: systemd service, data directory, frontend serving, optional nginx reverse proxy with ACME SSL.
>
> The server is written in Rust (Axum), uses ~10 MB RAM, and stores drawings as JSON files. It supports real-time collaboration via WebSocket and integrates with Obsidian via a plugin.
>
> Still WIP but the NixOS module is already working well. Would love feedback from the NixOS community on the module design!

---

## Tipps für alle Posts

1. **GIFs sind entscheidend** — Posts mit GIFs/Videos bekommen 3-5x mehr Upvotes
2. **Antworte auf jeden Kommentar** — Engagement in den ersten 2 Stunden ist kritisch
3. **Sei ehrlich über den WIP-Status** — "Looking for feedback" kommt besser an als "Here's my finished product"
4. **Erwähne den Tech Stack** — Rust-Projekte bekommen auf Reddit generell mehr Aufmerksamkeit
5. **Poste nicht überall gleichzeitig** — Staffele über 1-2 Wochen
6. **Beste Zeiten:** Di-Do, 14:00-17:00 UTC (US-Morgen + EU-Nachmittag)
