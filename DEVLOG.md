# Zeus Development Log

Running log of every step taken. Most recent at the bottom.

---

## Phase 1: The Bare Metal (Electron & Power)

**Goal:** Desktop app that refuses to let the laptop sleep.

### Step 1.1 — Project Init
- `npm init -y` created `package.json`
- `npm install -D electron` added Electron v41

### Step 1.2 — Folder Structure
Created the standard Electron layout:
```
src/
├── main/           # Electron main process
│   ├── index.ts    # Entry point
│   ├── services/   # Business logic modules
│   └── ipc/        # IPC channel handlers
├── preload/        # contextBridge scripts
└── renderer/       # Status window (HTML/CSS/JS)
```
**Why this structure:** Keeps `index.ts` lean (~40 lines). Each concern (power, websocket, terminal, tunnel) gets its own file under `services/`. Renderer is intentionally dumb — the real UI comes in Phase 3 as a separate React app.

### Step 1.3 — Main Process (`src/main/index.ts`)
- Creates a 480x360 non-resizable BrowserWindow
- Loads `renderer/index.html` as the status dashboard
- Calls `startPowerBlock()` on app ready
- Calls `registerIpcHandlers()` for renderer ↔ main communication
- Standard macOS `activate` / `window-all-closed` handlers

### Step 1.4 — Power Service (`src/main/services/power.ts`)
- `startPowerBlock()` — calls `powerSaveBlocker.start('prevent-display-sleep')`
- `stopPowerBlock()` — safely stops if running
- `isPowerBlocked()` — returns current state
- Logs blocker ID to console on start

### Step 1.5 — IPC Handlers (`src/main/ipc/handlers.ts`)
- Registers `zeus:status` channel via `ipcMain.handle()`
- Returns `{ powerBlock, websocket, tunnel }` status object
- Renderer can call `window.zeus.getStatus()` to fetch

### Step 1.6 — Preload (`src/preload/index.ts`)
- Uses `contextBridge.exposeInMainWorld()` to expose `zeus` API
- Keeps `contextIsolation: true`, `nodeIntegration: false` (secure defaults)

### Step 1.7 — Status Window (`src/renderer/`)
- `index.html` — dark status dashboard showing Power Lock / WebSocket / Tunnel status
- `styles.css` — minimal dark theme, monospace font, draggable window region
- `app.js` — placeholder, just logs renderer loaded

### Step 1.8 — TypeScript Migration
- Installed `typescript`, `@types/node`, `ts-node`
- Created `tsconfig.json` (target ES2022, commonjs, strict mode)
- Converted all `.js` source files to `.ts` with proper types
- Build: `tsc` compiles `src/` → `dist/`, then copies `renderer/` assets
- Entry point: `dist/main/index.js`

### Step 1.9 — Verification
- `npm run start` → builds TS, launches Electron
- Console: `[Zeus] Power blocker started (id: 0)`
- Window renders status dashboard with Power Lock showing ACTIVE
- No errors, clean exit on close

**Phase 1 status: COMPLETE**

---

## Phase 2: The Brains (Local WebSockets & `node-pty`)

*Not started yet.*

---
