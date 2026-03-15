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

## Phase 3: The Face (Single Web UI + Session Management)

**Goal:** Build the UI to manage sessions and run terminals, accessible from both the desktop Electron window and a phone browser.

### Step 3.1 — Shared Types + Session Registry
- Created `src/shared/types.ts` — shared interfaces (WsEnvelope, SessionRecord, StatusPayload)
- Added `SessionRecord` type with lifecycle tracking (active/exited/killed)
- Extended `WsEnvelope.channel` with `'status'` channel
- Extended `ControlPayload` with `list_sessions`, `session_list`, `session_updated`
- Added `StatusPayload` for power/service status communication
- `src/main/types.ts` now re-exports everything from shared
- Created `src/main/services/sessions.ts` — session registry (registerSession, markExited, markKilled, getAllSessions, getActiveSessions, clearCompleted)
- Updated both `tsconfig.node.json` and `tsconfig.web.json` to include `src/shared/**/*`

### Step 3.2 — WebSocket Server Rewrite
- Integrated `sirv` for static file serving — `http.createServer()` now serves built renderer files from `out/renderer/`
- Added graceful fallback when renderer dir doesn't exist (for tests)
- Added `broadcastEnvelope()` helper — sends to ALL connected clients
- Wired session registry into `websocket.ts`:
  - `start_session` → `registerSession()`, broadcasts `session_started` + `session_updated` to all clients
  - PTY `onExit` → `markExited()`, broadcasts exit + session update
  - `stop_session` → `markKilled()` before `destroySession()`, broadcasts update
  - `list_sessions` → responds with full session list
  - Client disconnect → marks owned sessions as killed, broadcasts updates
- Added `status` channel handler:
  - `get_status` → responds with `{ powerBlock, websocket, tunnel }`
  - `toggle_power` → toggles `powerSaveBlocker`, broadcasts new status to all clients
- Terminal output now broadcasts to ALL clients (not just session owner)

### Step 3.3 — Electron → Server Loading + IPC Removal
- `index.ts` now loads from `http://127.0.0.1:3000` in production (was `loadFile`)
- Dev mode still uses `ELECTRON_RENDERER_URL` (Vite HMR)
- Removed `registerIpcHandlers()` call
- `before-quit` now marks all active sessions as killed before destroying
- Deleted `src/main/ipc/handlers.ts` — all communication via WebSocket
- Stripped `src/preload/index.ts` — empty (kept for Electron's preload requirement)
- Updated window size to 1024x640 for terminal-centric layout

### Step 3.4 — Dependencies
- Installed `sirv` — static file serving (3KB, zero-dep)
- Installed `xterm` — terminal emulator
- Installed `@xterm/addon-fit` — auto-resize terminal
- Installed `@xterm/addon-web-links` — clickable URLs in terminal

### Step 3.5 — WebSocket Client Library (`src/renderer/src/lib/ws.ts`)
- Singleton `ZeusWebSocket` class for the renderer
- `connect()` / `disconnect()` / `send(envelope)` / `on(channel, handler)`
- Auto-reconnect with exponential backoff (1s → 2s → 4s → max 10s)
- URL: `ws://${location.host}` (same-origin) with dev override for Vite on :5173
- Dispatches `_connected` / `_disconnected` synthetic events on status channel

### Step 3.6 — Zustand Store Rewrite (`useZeusStore.ts`)
- Replaced all `window.zeus.*` IPC calls with WebSocket communication
- New state: `connected`, `powerBlock`, `websocket`, `tunnel`, `sessions`, `activeSessionId`
- `connect()` → subscribes to `status` + `control` channels, auto-requests initial state
- `session_started` → auto-selects new session
- `session_list` → replaces sessions array
- `session_updated` → upserts matching session record
- Actions: `togglePower`, `fetchSessions`, `startSession`, `stopSession`, `selectSession`

### Step 3.7 — useTerminal Hook (`src/renderer/src/hooks/useTerminal.ts`)
- xterm.js ↔ WebSocket bridge
- Creates `Terminal` + `FitAddon` + `WebLinksAddon`
- Themed to match Zeus design tokens (dark background, green cursor/accent)
- `terminal.onData()` → sends input envelope to server
- Subscribes to terminal channel, filters by sessionId for output/exit
- `ResizeObserver` → `fitAddon.fit()` → sends resize envelope
- Full cleanup on sessionId change or unmount

### Step 3.8 — New Components + App Layout
- **`Header.tsx`** — "Zeus" brand + connection status dot (green/red) + mobile hamburger toggle
- **`SessionCard.tsx`** — compact card: truncated ID (8 chars), shell, status badge (green=active, gray=exited, red=killed), relative time, stop button
- **`SessionSidebar.tsx`** — "New Session" button + session list (active on top, completed below) + service status footer (Power Lock, WebSocket)
- **`TerminalView.tsx`** — xterm.js container using `useTerminal` hook, empty state when no session selected
- **`App.tsx`** rewritten — grid layout with sidebar (280px) + terminal area
  - Desktop (`md:` breakpoint): sidebar always visible
  - Mobile: header with hamburger → slide-over sidebar panel with backdrop

### Step 3.9 — Type + CSS Updates
- Removed `ZeusAPI` / `window.zeus` from `zeus.d.ts`
- Added xterm.js CSS import and theme overrides in `styles.css`
- Removed `-webkit-app-region: drag` from body (drag region only on specific elements)

### Step 3.10 — Tests
- New `sessions.test.ts` — register, markExited, markKilled, getAllSessions, getActiveSessions, clearCompleted (8 tests)
- New `SessionCard.test.tsx` — renders truncated ID, status badge, stop button, fires callbacks (5 tests)
- New `SessionSidebar.test.tsx` — empty state, new session button, renders cards, status rows (5 tests)
- New `TerminalView.test.tsx` — empty state, mounts container on session select (2 tests)
- Rewrote `setup.ts` — removed `window.zeus` mock, added xterm/WebSocket mocks, ResizeObserver polyfill
- Rewrote `useZeusStore.test.ts` — WS-based store (connect, togglePower, startSession, stopSession, selectSession) (7 tests)
- Rewrote `App.test.tsx` — new layout (header, sidebar, terminal area, service status) (6 tests)
- Updated `websocket.test.ts` — works with sirv graceful fallback (5 tests)
- Total: 55 tests across 12 suites, all passing

### Step 3.11 — Verification
- `npm run build` → `out/renderer/` has `index.html` + assets ✓
- `npm run lint` → 0 errors ✓
- `npm run format:check` → all files formatted ✓
- `npm test` → 55 tests passing ✓

**Phase 3 status: COMPLETE**

---

## Claude Code Session Management (SDK Integration)

**Goal:** Spawn Claude CLI as a piped subprocess, manage the stream-json protocol, and emit normalized entries over WebSocket for remote UI rendering. Based on vibe-kanban's session handling patterns.

### Step C.1 — Type Definitions (`src/main/services/claude-types.ts`)
- Full TypeScript type system mirroring Claude Code's stream-json protocol
- **Inbound types (App → Claude stdin):** `SDKControlRequest` (initialize, set_permission_mode, interrupt), `ControlResponseMessage` (allow/deny), `UserMessage`
- **Outbound types (Claude stdout → App):** `ClaudeJson` union type — `system`, `assistant`, `user`, `tool_use`, `tool_result`, `stream_event`, `result`, `control_request`, `rate_limit_event`
- **Sub-types:** `StreamEvent` (content_block_start/delta/stop, message_start/delta/stop), `ContentBlockDelta` (text_delta, thinking_delta, signature_delta)
- **Permission system:** `PermissionMode`, `PermissionResult` (allow/deny), `PermissionUpdate` (setMode, addRules)
- **UI types:** `NormalizedEntry` (id, entryType, content), `NormalizedEntryType` (user_message, assistant_message, tool_use, thinking, system_message, error_message, token_usage), `ActionType` (file_read, file_edit, command_run, search, web_fetch, task_create, plan_presentation), `ToolStatus`, `FileChange`
- **Helper factories:** `makeControlRequest()`, `makeControlResponse()`, `makeUserMessage()` — using `crypto.randomUUID()` (no external uuid package)

### Step C.2 — Protocol Peer (`src/main/services/claude-protocol.ts`)
- Bidirectional JSON communication over stdin/stdout
- Reads stdout line-by-line via `readline.createInterface()`
- Parses each line as `ClaudeJson`, emits `message`, `control_request`, `result` events
- Filters stderr noise (npm warnings, fast mode warnings)
- Outbound methods: `initialize(hooks)`, `setPermissionMode(mode)`, `sendUserMessage(content)`, `sendPermissionResponse(requestId, result)`, `sendHookResponse(requestId, output)`, `interrupt()`
- Strongly-typed EventEmitter with `ProtocolPeerEvents` interface

### Step C.3 — Log Processor (`src/main/services/claude-log-processor.ts`)
- Converts raw `ClaudeJson` → `NormalizedEntry[]` for UI rendering
- Handles all message types: assistant (text + thinking), user, tool_use, stream_event, result
- **Stream accumulation:** Tracks `streamingText` and `streamingThinking` across `content_block_start` → `content_block_delta` → `content_block_stop` lifecycle
- **Tool mapping:** Maps tool names to `ActionType` — Read → file_read, Edit/Write → file_edit, Bash → command_run, Grep/Glob → search, WebFetch → web_fetch, Task/Agent → task_create, ExitPlanMode → plan_presentation, mcp__* → other
- **Tool tracking:** Stores tool_use id → entry metadata for later tool_result matching
- Generates human-readable content strings (e.g., "Reading src/App.tsx", "$ npm install")
- Skips replayed user messages (`isReplay: true`)

### Step C.4 — Session Manager (`src/main/services/claude-session.ts`)
- **`ClaudeSession`** — one instance per conversation:
  - Spawns `npx @anthropic-ai/claude-code@latest` with `-p --output-format=stream-json --input-format=stream-json --include-partial-messages --permission-prompt-tool=stdio --permission-mode=bypassPermissions`
  - Protocol initialization sequence: `initialize(hooks)` → `setPermissionMode(mode)` → `sendUserMessage(prompt)`
  - **Hook configuration:** Plan mode auto-approves everything except ExitPlanMode/AskUserQuestion; bypass mode only intercepts AskUserQuestion; default mode approves reads
  - **Session ID tracking:** Extracted from first message with `session_id` field
  - **Message UUID tracking:** User messages commit immediately; assistant messages pend until `result` confirms (for safe resume points)
  - **Control request handling:** `can_use_tool` → emits `approval_needed` for UI; `hook_callback` → auto-approves `AUTO_APPROVE_CALLBACK_ID`, handles `STOP_GIT_CHECK_CALLBACK_ID`
  - **Special tools:** ExitPlanMode auto-approved with `updatedPermissions` to switch to bypass; AskUserQuestion always routed to user
  - Events: `entry`, `raw`, `approval_needed`, `session_id`, `done`, `error`
  - Methods: `start(prompt)`, `sendMessage(content)`, `approveTool(approvalId)`, `denyTool(approvalId, reason)`, `interrupt()`, `kill()`
- **`ClaudeSessionManager`** — manages multiple concurrent sessions:
  - `createSession(prompt, options)`, `resumeSession(sessionId, prompt, options)`
  - Resume via `--resume <sessionId>` flag, fork via `--resume-session-at <messageId>`
  - `getSession(id)`, `getAllSessions()`, `killSession(id)`, `killAll()`

### Step C.5 — WebSocket Integration
- Added `'claude'` channel to `WsEnvelope.channel` union in shared types
- Added Claude payload types: `ClaudeStartPayload`, `ClaudeResumePayload`, `ClaudeSendMessagePayload`, `ClaudeApproveToolPayload`, `ClaudeDenyToolPayload`, `ClaudeInterruptPayload`, `ClaudeStopPayload`
- Wired `handleClaude()` into `websocket.ts` message router:
  - `start_claude` → `claudeManager.createSession()`, wires session events to WS broadcast
  - `resume_claude` → `claudeManager.resumeSession()`
  - `send_message` → `session.sendMessage(content)`
  - `approve_tool` / `deny_tool` → `session.approveTool/denyTool(approvalId)`
  - `interrupt` → `session.interrupt()`
  - `stop_claude` → `claudeManager.killSession()`
- Claude events broadcast to all WS clients: `entry` (normalized), `approval_needed`, `claude_session_id`, `done`, `error`
- Client disconnect → kills owned Claude sessions
- Server shutdown → `claudeManager.killAll()`

### Step C.6 — Verification
- `npx tsc --noEmit` — clean compile, no errors
- `npm test` — all 55 existing tests pass (no regressions)

---
