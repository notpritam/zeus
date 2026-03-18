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

### NormalizedEntry (Claude Session Log)

Every item in the Claude session log is a `NormalizedEntry`. Persisted to SQLite (`claude_entries` table) with `entryType` and `metadata` JSON-stringified.

```typescript
interface NormalizedEntry {
  id: string;                    // UUID, stable across streaming updates
  timestamp?: string;            // ISO 8601
  entryType: NormalizedEntryType; // discriminated union (see shared/types.ts)
  content: string;               // display text or tool content description
  metadata?: unknown;            // tool output, etc. — shape varies by entryType
}
```

**MCP Tool Entries:** Tool calls to MCP servers (`mcp__<server>__<method>`) are stored with `actionType: { action: 'mcp_tool', server, method, input }`. The `input` field contains the full JSON parameters sent to the MCP tool. The result is stored in `metadata.output`.

## Next Immediate Action

> **Focus:** Complete Phase 1 — get `main.js` with a BrowserWindow and `powerSaveBlocker` running. Then move to Phase 2 (Terminal Engine).

## Coding Conventions

* Always use `async/await` for PTY spawns and IPC calls.
* TypeScript everywhere — all source lives in `src/`, compiles to `dist/`.
* Use ES module style imports (`import`/`export`) in TS source.
* Keep the Electron main process lean — delegate heavy work to utility modules under `src/main/services/`.
* All WebSocket messages must conform to the envelope schema above.
* Never store secrets in code — use environment variables or Electron's `safeStorage`.

## Type System & Runtime Validation

### Canonical Type Location

All entry types live in **`src/shared/types.ts`** — this is the single source of truth:

* `NormalizedEntry` — the universal shape for every item stored in the Claude session log
* `NormalizedEntryType` — discriminated union: `user_message | assistant_message | tool_use | thinking | system_message | error_message | loading | token_usage`
* `ActionType` — discriminated union for tool actions: `file_read | file_edit | command_run | search | web_fetch | task_create | plan_presentation | mcp_tool | other`
* `ToolStatus` — `'created' | 'success' | 'failed' | 'timed_out' | { status: 'denied'; reason?: string } | { status: 'pending_approval'; approvalId: string }`
* `FileChange` — `write | edit | delete` for file edit tracking

**`src/main/services/claude-types.ts`** re-exports these types (plus Claude protocol types). Never duplicate type definitions — always re-export from `shared/types.ts`.

### Runtime Validators (`src/shared/validators.ts`)

Runtime validation is enforced at DB boundaries to catch malformed data before it persists or reaches the renderer:

* **`validateNormalizedEntry(v)`** — Deep validates an entry and all nested types. Returns `{ valid: boolean, errors: ValidationError[] }`.
* **`validateActionType(v)`** — Validates action type discriminant and required fields per variant.
* **`validateToolStatus(v)`** — Validates both string and object status variants.
* **`validateNormalizedEntryType(v)`** — Validates the entry type discriminant and nested fields.
* **`assertNormalizedEntry(v)`** — Throws with detailed path info on invalid data (use in development).
* **`safeParseNormalizedEntry(v)`** — Returns typed entry or `null` with console warning (use at read boundaries).

**Where validation runs:**
* `upsertClaudeEntry()` — validates before writing to SQLite. Invalid entries are logged and skipped.
* `getClaudeEntries()` — validates after reading from SQLite. Corrupt rows are filtered out with a warning.

### Adding New Entry Types or Action Types

1. Add the variant to the discriminated union in `src/shared/types.ts`.
2. Add the matching validation case in `src/shared/validators.ts`.
3. Add test cases in `src/shared/__tests__/validators.test.ts`.
4. Run `npm run validate` to confirm all 67+ tests pass.
5. Update the renderer's `EntryItem`/`ToolCard` switch to handle the new variant.

### Verification Commands

```bash
npm run validate     # Run validator tests (67 tests)
npm run typecheck    # Type-check main + renderer (tsc --noEmit)
npm run test         # Run all tests
npm run build        # Full production build
```

## QA Testing

After implementing any UI feature or fix, use the `zeus_qa_run` MCP tool (via zeus-bridge) to spawn a server-side QA agent. The agent runs independently with full browser automation and results appear in the Zeus QA panel.

Usage: Call `zeus_qa_run` with a `task` describing what to test. The `target_url` auto-detects from the dev server (via `ZEUS_QA_DEFAULT_URL` env var, set from `ELECTRON_RENDERER_URL` at startup).

### Screenshot Handling

Screenshots are displayed as actual images in the Zeus QA panel, not just text summaries.

- The QA agent calls `qa_screenshot` (via `qa-server.ts` MCP).
- `websocket.ts` detects the screenshot tool result and re-fetches the image from PinchTab.
- The base64 data URL is attached as `imageData` on the `tool_result` log entry.
- `QAPanel.tsx` renders the image inline in both full and compressed agent log views.

**Type:** `QaAgentLogEntry` `tool_result` kind has an optional `imageData?: string` field (base64 data URL).

**Important:** Base64 image data is NOT persisted to SQLite — it's only broadcast via WebSocket for live rendering.

## Development Log

**`DEVLOG.md`** — Running log of every step taken during development. Append to this file after completing each step so the developer can review progress at any time. Most recent entries go at the bottom.
