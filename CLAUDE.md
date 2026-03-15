# Zeus Project Definition

## Core Intent

Build a remote orchestration tool that turns a local laptop into a headless, AI-powered development server accessible via mobile/web. The goal is to delegate high-level tasks to Claude CLI and monitor/manage the entire OS and Git state remotely.

## Architecture Principles (The "Brutal" Way)

* **Host-First:** The Electron app on the laptop is the source of truth for all sessions, file watching, and process management.
* **PTY, Not Shell:** Use `node-pty` to handle terminal sessions. Do not rely on simple shell execution; we need full ANSI support and interactivity.
* **Multiplexed WebSockets:** All data (Terminal, Git, Control, QA) flows through a single WebSocket connection using a JSON envelope.
* **Stateless Client:** The mobile UI (React/Vite) should be "dumb." It fetches state from the Host and renders it.
* **Security:** Hardcoded token authentication for all incoming tunnel connections.

## Technical Stack

* **Desktop App:** Electron (Main process manages power, processes, and network).
* **Terminal Engine:** `node-pty` + `xterm.js`.
* **File Watching:** `chokidar` + `git status --porcelain`.
* **Tunneling:** `@ngrok/ngrok` (integrated into the Electron startup).
* **QA Layer:** PinchTab (via HTTP API) to control a headless Chrome instance.
* **Database:** `better-sqlite3` for persistent session history.

## Development Roadmap (Brutal, Isolated Layers)

Build strictly in order. Test each phase before moving on.

### Phase 1: The Bare Metal (Electron & Power)

Goal: Desktop app that refuses to let the laptop sleep.

* [x] `npm init -y` — project initialized.
* [x] `npm install -D electron` — Electron installed.
* [ ] Write `main.js` — spawn a basic BrowserWindow.
* [ ] Import `powerSaveBlocker` and activate on startup.
* **Success check:** App runs, laptop stays awake for 30+ minutes.

### Phase 2: The Brains (Local WebSockets & `node-pty`)

Goal: Spawn a terminal and stream it locally (no public internet yet).

* [ ] `npm install express ws node-pty`
* [ ] Setup Express + WebSocket server on `localhost:3000` inside Electron main process.
* [ ] WebSocket listener for `start_session` event.
* [ ] `start_session` triggers `pty.spawn('bash', ...)` (or `zsh`).
* [ ] Pipe PTY output into `ws.send()`.
* **Success check:** Local WebSocket server spawns hidden terminal sessions.

### Phase 3: The Face (Frontend Client & `xterm.js`)

Goal: Build the UI (test locally, eventually used on phone).

* [ ] Create React/Vite project (or plain HTML to start fast).
* [ ] `npm install xterm xterm-addon-fit`
* [ ] Connect frontend WebSocket client to `ws://localhost:3000`.
* [ ] Feed incoming WebSocket messages into `xterm.write()`.
* [ ] Capture keyboard inputs in `xterm.js`, send back to server.
* **Success check:** Open browser, type `ls`, see laptop's files, run interactive commands.

### Phase 4: The Bridge (Ngrok & Security)

Goal: Make local connection accessible from phone securely.

* [ ] `npm install @ngrok/ngrok`
* [ ] Update `main.js` to auto-start Ngrok tunnel → port 3000 on boot.
* [ ] Implement hardcoded password/token middleware on WebSocket connection.
* [ ] Pass generated Ngrok URL to Electron UI for display.
* **Success check:** Open phone browser → Ngrok URL → enter password → run `ls` on laptop from LTE.

### Phase 5: The Hands (Git Watcher)

Goal: Make the UI aware of what Claude is doing to files.

* [ ] `npm install chokidar`
* [ ] `chokidar.watch(dir)` spawns alongside `node-pty` session.
* [ ] On file change, run `git status --porcelain` via `child_process.exec`.
* [ ] Push parsed Git status over WebSocket to frontend.
* **Success check:** Touch a file in terminal → frontend side-panel instantly shows unstaged file.

### Future: The Eyes (QA Controller)

* [ ] Integrate PinchTab binary.
* [ ] Create a "QA Preview" tab in the remote UI.
* [ ] Allow Claude to query the accessibility tree of the local dev server.

## Data Schemas

### WebSocket Message Envelope

```json
{
  "channel": "terminal" | "git" | "control" | "qa",
  "sessionId": "string",
  "payload": "any",
  "auth": "token_string"
}
```

### Git Status Payload

```json
{
  "branch": "main",
  "changes": [
    { "file": "src/App.js", "status": "M" },
    { "file": "index.html", "status": "??" }
  ]
}
```

## Next Immediate Action

> **Focus:** Complete Phase 1 — get `main.js` with a BrowserWindow and `powerSaveBlocker` running. Then move to Phase 2 (Terminal Engine).

## Coding Conventions

* Always use `async/await` for PTY spawns and IPC calls.
* Use ES modules (`import`/`export`) throughout.
* Keep the Electron main process lean — delegate heavy work to utility modules under `host/main/`.
* All WebSocket messages must conform to the envelope schema above.
* Never store secrets in code — use environment variables or Electron's `safeStorage`.
