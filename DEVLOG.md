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

### Step 1.10 — React + Vite Migration (electron-vite)
- Replaced raw `tsc` build with `electron-vite` — handles main, preload, and renderer builds
- Installed: `vite`, `electron-vite`, `@vitejs/plugin-react`, `react`, `react-dom`, type defs
- Created `electron.vite.config.ts` with three build targets (main, preload, renderer)
- Split `tsconfig.json` into references: `tsconfig.node.json` (main/preload) + `tsconfig.web.json` (renderer with JSX)
- Moved renderer to React: `index.html` → `src/main.tsx` → `<App />`
- `App.tsx` renders status dashboard with `StatusRow` component
- Main process now checks `process.env.ELECTRON_RENDERER_URL` for dev mode, falls back to built files
- Build output: `out/` (was `dist/`)
- Scripts: `npm run dev` (HMR), `npm run build`, `npm run start` (build + preview)

### Step 1.11 — Code Rules
- Created `CODERULES.md` — project structure, TS rules, main/renderer/preload conventions, security, workflow

### Step 1.12 — Path Alias
- Added `@/` alias → `src/renderer/src/` in both `tsconfig.web.json` and `electron.vite.config.ts`
- Updated all renderer imports to use `@/` instead of relative paths
- Added rule to CODERULES.md

### Step 1.13 — Mode Toggle (Pause/Resume Zeus)
- Installed `framer-motion` for subtle animations
- Created `ModeToggle` component — spring-animated toggle switch (running/paused)
- Added `zeus:toggle-power` IPC channel: toggles `powerSaveBlocker` on/off
- Updated preload to expose `window.zeus.togglePower()`
- Created `types/zeus.d.ts` — typed global `window.zeus` API
- Updated `StatusRow` — badge animates (fade + scale) on state change
- Updated `App.tsx` — fetches initial status on mount, toggle controls power blocker
- Full stack verified: click toggle → IPC → main process stops/starts power blocker → UI updates

### Step 1.14 — Frameless Window
- Set `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: { x: 12, y: 12 }` on macOS
- Added `-webkit-app-region: drag` on body so the whole window is draggable
- Toggle button has `no-drag` so it stays clickable
- Added top padding to clear the traffic lights

### Step 1.15 — Test Setup (Vitest)
- Installed `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- Created `vitest.config.ts` with jsdom environment and `@/` alias
- Created test setup file mocking `window.zeus` API
- Tests written:
  - `StatusRow.test.tsx` — renders label/status, applies active/inactive classes (3 tests)
  - `ModeToggle.test.tsx` — shows RUNNING/PAUSED, fires onToggle callback (3 tests)
  - `App.test.tsx` — renders after loading, shows all status rows (3 tests)
- Scripts: `npm test` (single run), `npm run test:watch` (watch mode)
- All 9 tests pass

### Step 1.16 — Tailwind CSS v4
- Installed `tailwindcss` + `@tailwindcss/vite`
- Added Tailwind plugin to renderer in `electron.vite.config.ts`
- Replaced all custom CSS with Tailwind utility classes
- Defined Zeus color tokens via `@theme` in `styles.css` (zeus-bg, zeus-card, zeus-green, etc.)
- Updated tests to assert on Tailwind class names instead of old CSS classes
- Build + all 9 tests pass

### Step 1.17 — Theme System
- Replaced ad-hoc `zeus-*` color tokens with semantic token system in `@theme`
- Token categories: backgrounds (`bg`, `bg-card`, `bg-surface`, `bg-elevated`), text (`text-primary` through `text-ghost`), borders, accent (green), danger (red), warning (amber), info (blue)
- Added radius tokens (`radius-sm/md/lg`) and font tokens (`font-sans`, `font-mono`)
- All components updated to use semantic tokens (e.g., `bg-zeus-card` → `bg-bg-card`, `text-zeus-green` → `text-accent`)

### Step 1.18 — Zustand State Management
- Installed `zustand` for global state management
- Created `useZeusStore` in `src/renderer/src/stores/` — holds `powerBlock`, `websocket`, `tunnel`, `loading`
- Store actions: `init()` fetches status from main process, `togglePower()` toggles power blocker
- Refactored `App.tsx` — removed `useState`/`useEffect` state, uses store directly
- Added `useZeusStore.test.ts` — tests init, togglePower, and initial state (3 tests)
- Total: 12 tests across 4 suites, all passing

### Step 1.19 — Linting & Formatting
- Fixed `max-w-[280px]` → `max-w-70` (use canonical Tailwind classes, not arbitrary values)
- Set up ESLint (`eslint.config.mjs`) — `@eslint/js` + `typescript-eslint` + `eslint-plugin-react`
- Set up Prettier (`.prettierrc`) with `prettier-plugin-tailwindcss` — auto-sorts Tailwind classes
- Scripts: `npm run lint`, `npm run format`, `npm run format:check`
- All checks pass: format, lint, tests, build

**Phase 1 status: COMPLETE**

---

## Phase 2: The Brains (Local WebSockets & `node-pty`)

**Goal:** Spawn terminal sessions via `node-pty` and stream them over WebSocket.

### Step 2.1 — Install Dependencies
- `npm install ws node-pty` — production deps (externalized by `externalizeDepsPlugin()`)
- `npm install -D @types/ws` — WebSocket type definitions
- `npx @electron/rebuild` — rebuilt native `node-pty` for Electron's Node version
- Added `"postinstall": "electron-rebuild"` script for future installs

### Step 2.2 — Shared Types (`src/main/types.ts`)
- Defined `WsEnvelope` — `{ channel, sessionId, payload, auth }` per CLAUDE.md spec
- Terminal payloads: `input`, `output`, `resize`, `exit`
- Control payloads: `start_session`, `stop_session`, `session_started`, `error`

### Step 2.3 — Terminal Service (`src/main/services/terminal.ts`)
- Follows same pattern as `power.ts` (module-level state, exported functions)
- `sessions` Map tracks active PTY instances by UUID
- `createSession(options, onOutput, onExit)` — spawns PTY with `node-pty`
  - Shell from `$SHELL` (defaults to `/bin/zsh`), default 80x24
  - Returns `{ sessionId, shell }`
- `writeToSession`, `resizeSession`, `destroySession` — PTY lifecycle
- `destroyAllSessions` — cleanup for shutdown
- `getSessionCount`, `hasSession` — query helpers
- Service is WebSocket-agnostic — takes callbacks, keeps it testable

### Step 2.4 — WebSocket Service (`src/main/services/websocket.ts`)
- Uses `http.createServer()` + `ws.WebSocketServer` (no Express)
- Binds to `127.0.0.1:3000` (local only for Phase 2)
- Routes messages by `envelope.channel`:
  - `control` → handles `start_session` / `stop_session`
  - `terminal` → handles `input` / `resize`
  - `git`, `qa` → stubbed with error response
- Tracks client→sessions via `Map<WebSocket, Set<string>>`
- On client disconnect, destroys all owned sessions (no orphaned PTYs)
- `startWebSocketServer()` / `stopWebSocketServer()` — async lifecycle

### Step 2.5 — Main Process Wiring (`src/main/index.ts`)
- `startWebSocketServer()` called after `startPowerBlock()` in `app.whenReady()`
- Made ready callback `async`
- `before-quit` handler: `destroyAllSessions()` + `stopWebSocketServer()`

### Step 2.6 — IPC & Preload Updates
- `handlers.ts`: replaced hardcoded `websocket: false` → `isWebSocketRunning()`
- Added `zeus:toggle-websocket` IPC handler (start/stop WS server)
- `preload/index.ts`: exposed `toggleWebSocket` to renderer
- `zeus.d.ts`: added `toggleWebSocket: () => Promise<boolean>`

### Step 2.7 — UI Wiring
- `useZeusStore.ts`: added `toggleWebSocket` action (same pattern as `togglePower`)
- `App.tsx`: WebSocket StatusRow now shows live state (`ACTIVE`/`OFFLINE`)

### Step 2.8 — Tests
- Updated `setup.ts` — guarded `window.zeus` mock for Node env compatibility
- `useZeusStore.test.ts` — added `toggleWebSocket` action test
- `App.test.tsx` — added test verifying WebSocket status reflects store state
- New `terminal.test.ts` — PTY spawn, write, resize, destroy lifecycle (8 tests)
- New `websocket.test.ts` — server start/stop, client connect, start_session flow, error handling (4 tests)
- Total: 33 tests across 8 suites, all passing

**Phase 2 status: COMPLETE**

---
