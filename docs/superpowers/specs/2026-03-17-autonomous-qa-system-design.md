# Autonomous QA System for Claude Sessions

## Problem

When Claude builds or modifies UI code via Zeus, there's no automated way for it to verify the result. The developer must manually check the browser, report issues, and ask Claude to fix them. This creates a slow feedback loop, especially when operating remotely via phone.

## Solution

Give Claude native browser testing tools via an MCP server so it can autonomously navigate to the dev server, inspect the page, capture console/network/errors, take screenshots, and fix issues — all without human intervention.

## Architecture

```
Claude CLI Session
  │
  │  --mcp-config '{"mcpServers":{"zeus-qa":{"command":"node","args":["mcp-qa-server.js"]}}}'
  │
  ▼
Zeus MCP QA Server (src/mcp/qa-server.ts → compiled to dist/)
  │                  (spawned by Claude CLI as child process)
  │
  ├──→ PinchTab HTTP API (localhost:9867)
  │      Navigation, Snapshot, Screenshot, Click, Type, Fill
  │
  └──→ CDP Client (via localhost:9222 discovery)
         Console logs, Network requests, JS errors, JS evaluation

Zeus QA Service (src/main/services/qa.ts)
  │  (runs inside Electron main process)
  │
  ├── Manages PinchTab binary lifecycle
  ├── Manages CDP client (captures events, forwards to frontend)
  └── WebSocket qa channel → Frontend QA Panel
```

### Component Responsibilities

**PinchTab (existing, port 9867):** Browser lifecycle, navigation, DOM interaction, accessibility tree, screenshots. Already integrated in Zeus. Launches Chrome with `CHROME_FLAGS=--remote-debugging-port=9222` env var to enable CDP access.

**CDP Client (new, inside QAService):** Lives in the Electron main process as part of `QAService`. Connects to Chrome's DevTools Protocol debug port via discovery URL (`GET http://127.0.0.1:9222/json/version` → `webSocketDebuggerUrl`). Passively captures console output, network activity, and JavaScript errors. Ring buffer of last 100 entries per category. Pushes events to frontend via the existing `qa` WebSocket channel.

**MCP QA Server (new, standalone script):** Thin bridge that speaks MCP protocol over stdio. Claude CLI spawns it as a child process via `--mcp-config`. Receives tool calls from Claude, translates them to PinchTab HTTP calls. For CDP data, queries PinchTab's `/tab/{tabId}/evaluate` to run JS, and reads buffered console/network/error data from a shared state file written by the CDP client in QAService. Returns structured results to Claude.

### Why CDP Client Lives in QAService, Not the MCP Server

The MCP server is spawned by Claude CLI as a child process — it has no direct connection to Zeus's WebSocket server. If CDP lived inside the MCP server, there would be no way to push live console/network events to the frontend QA panel. By keeping CDP in QAService (Electron main process), we get:
- Live event streaming to frontend via existing WebSocket `qa` channel
- MCP server reads buffered CDP data from a shared temp file (`/tmp/zeus-qa-cdp-state.json`)
- Clean separation: MCP server is stateless, QAService manages all state

## MCP Tool Definitions

### Browser Control (via PinchTab HTTP)

#### `qa_navigate`
Navigate to a URL and wait for page load.
- Input: `{ url: string }`
- Output: `{ title: string, url: string, loadTime: number }`

#### `qa_snapshot`
Capture the accessibility tree of the current page.
- Input: `{ filter?: "interactive" | "full" }`
- Output: `{ elements: Array<{ ref: string, role: string, name: string }>, raw: string }`

#### `qa_screenshot`
Take a JPEG screenshot of the current page.
- Input: `{}`
- Output: base64 image via MCP image content type

#### `qa_click`
Click an element identified by accessibility ref.
- Input: `{ ref: string }`
- Output: `{ success: boolean, message?: string }`

#### `qa_type`
Type text (keystroke by keystroke) at the focused element.
- Input: `{ text: string }`
- Output: `{ success: boolean }`

#### `qa_fill`
Fill a form field identified by ref with a value.
- Input: `{ ref: string, value: string }`
- Output: `{ success: boolean }`

#### `qa_press`
Press a keyboard key (Enter, Tab, Escape, etc.).
- Input: `{ key: string }`
- Output: `{ success: boolean }`

#### `qa_scroll`
Scroll the page or a specific element.
- Input: `{ direction: "up" | "down", amount?: number }`
- Output: `{ success: boolean }`

### Observability (via CDP, read from shared state file)

#### `qa_console_logs`
Get captured console output since last call (or last N entries).
- Input: `{ limit?: number, since_last_call?: boolean }`
- Output: `{ logs: Array<{ level: "log" | "warn" | "error" | "info", message: string, timestamp: number }> }`

#### `qa_network_requests`
Get captured network requests since last call.
- Input: `{ limit?: number, since_last_call?: boolean, failed_only?: boolean }`
- Output: `{ requests: Array<{ url: string, method: string, status: number, duration: number, type: string, failed: boolean, error?: string }> }`

#### `qa_js_errors`
Get captured JavaScript errors.
- Input: `{ limit?: number, since_last_call?: boolean }`
- Output: `{ errors: Array<{ message: string, stack: string, source: string, line: number, timestamp: number }> }`

#### `qa_evaluate`
Execute JavaScript in the page context and return the result. Note: this operates on the dev server page, not arbitrary sites. Equivalent to running JS in browser devtools.
- Input: `{ expression: string }`
- Output: `{ result: unknown, error?: string }`

#### `qa_wait`
Wait for a condition (navigation completes or network idle).
- Input: `{ condition: "navigation" | "network_idle", timeout?: number }`
- Output: `{ success: boolean, timedOut: boolean }`
- Note: `network_idle` = no new network requests for 500ms. Does not support element selectors — use `qa_snapshot` to check for elements instead.

### Compound Tool

#### `qa_run_test_flow`
Run a complete test check: navigate, wait for load, snapshot, screenshot, collect console/network/errors. Returns a combined report. This is the primary tool Claude should call after making changes.
- Input: `{ url: string, wait_for_network_idle?: boolean }`
- Output:
```json
{
  "title": "Login Page",
  "url": "http://localhost:5173/login",
  "loadTime": 450,
  "snapshot": {
    "elements": [
      { "ref": "e1", "role": "heading", "name": "Sign In" },
      { "ref": "e2", "role": "textbox", "name": "Email" },
      { "ref": "e3", "role": "textbox", "name": "Password" },
      { "ref": "e4", "role": "button", "name": "Submit" }
    ]
  },
  "screenshot": "data:image/jpeg;base64,...",
  "console": [
    { "level": "error", "message": "Failed to fetch /api/auth", "timestamp": 1710000000 }
  ],
  "network": [
    { "url": "/api/auth", "method": "POST", "status": 500, "duration": 120, "failed": true }
  ],
  "errors": [],
  "summary": "Page loaded. 1 console error. 1 failed network request (POST /api/auth -> 500)."
}
```

The `summary` field is a human-readable one-liner so Claude can quickly decide if action is needed.

## CDP Client Design

### Connection Discovery

Chrome's debug port at 9222 serves HTTP endpoints for WebSocket URL discovery:

1. `GET http://127.0.0.1:9222/json/version` → returns `{ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/..." }`
2. `GET http://127.0.0.1:9222/json/list` → returns array of open tabs, each with its own `webSocketDebuggerUrl`
3. Connect to the first tab's WebSocket URL for page-level CDP access

The CDP client handles this discovery automatically with retry/backoff (max 5 attempts, 1s intervals) since Chrome may not be ready immediately after PinchTab launches it.

### Captured Events

| CDP Domain | Event | What We Capture |
|------------|-------|-----------------|
| `Runtime` | `consoleAPICalled` | level, args (serialized), timestamp |
| `Runtime` | `exceptionThrown` | message, stack trace, source location |
| `Network` | `requestWillBeSent` | url, method, headers, timestamp |
| `Network` | `responseReceived` | status, headers, timing |
| `Network` | `loadingFailed` | error text, cancelled flag |

### Buffer Management

Each category (console, network, errors) maintains a ring buffer of 100 entries. The CDP client writes the current buffer state to `/tmp/zeus-qa-cdp-state.json` on every event (debounced to 200ms). The MCP server reads this file when Claude calls `qa_console_logs`, `qa_network_requests`, or `qa_js_errors`. A `readPointer` per category in the MCP server tracks `since_last_call` semantics.

### Lifecycle

1. CDP client created inside `QAService` when a browser instance is launched
2. Discovers Chrome debug WebSocket URL via HTTP discovery endpoint (with retry)
3. Enables `Runtime` and `Network` domains
4. Passively collects events into ring buffers
5. Writes buffer state to temp file for MCP server consumption
6. Pushes events to frontend via WebSocket `qa` channel
7. Disconnects when instance stops or QA service stops
8. Temp file cleaned up on disconnect

## MCP QA Server Design

### Process Model

The MCP server is a standalone Node.js script that Claude CLI spawns as a child process via `--mcp-config`. It communicates with Claude over stdio (MCP JSON-RPC protocol) and with PinchTab over HTTP. For CDP data, it reads the shared state file.

```
src/mcp/qa-server.ts (compiled to dist/mcp/qa-server.js)
  │
  ├── Stdin listener (MCP JSON-RPC from Claude CLI)
  ├── PinchTab HTTP client (fetch to localhost:9867)
  ├── CDP state reader (reads /tmp/zeus-qa-cdp-state.json)
  └── Stdout writer (MCP JSON-RPC responses to Claude CLI)
```

### MCP Protocol Handshake

Uses `@modelcontextprotocol/sdk` npm package for correct protocol implementation.

**1. Client sends `initialize`:**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05", "capabilities": {} } }
```

**2. Server responds:**
```json
{ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "2024-11-05", "serverInfo": { "name": "zeus-qa", "version": "1.0.0" }, "capabilities": { "tools": {} } } }
```

**3. Client sends `initialized` notification:**
```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

**4. Client requests tool list:**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```
```json
{ "jsonrpc": "2.0", "id": 2, "result": { "tools": [{ "name": "qa_navigate", "description": "Navigate browser to URL", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] } }, ...] } }
```

**5. Client calls a tool:**
```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "qa_navigate", "arguments": { "url": "http://localhost:5173" } } }
```
```json
{ "jsonrpc": "2.0", "id": 3, "result": { "content": [{ "type": "text", "text": "{\"title\":\"My App\",\"url\":\"http://localhost:5173\",\"loadTime\":320}" }] } }
```

**For screenshots (image content):**
```json
{ "jsonrpc": "2.0", "id": 4, "result": { "content": [{ "type": "image", "data": "base64...", "mimeType": "image/jpeg" }] } }
```

**For errors:**
```json
{ "jsonrpc": "2.0", "id": 5, "result": { "content": [{ "type": "text", "text": "Error: PinchTab not running" }], "isError": true } }
```

### Lazy PinchTab Connection

The MCP server does not fail on startup if PinchTab is not running. Instead, each tool call checks PinchTab health first. If PinchTab is not available, the tool returns an error result and Claude can proceed with non-QA work.

## Claude Session Integration

### Changes to SessionOptions

```typescript
interface SessionOptions {
  // ... existing fields ...
  enableQA?: boolean;        // Enable QA tools for this session
  qaTargetUrl?: string;      // Default URL to test (e.g., http://localhost:5173)
}
```

### Changes to ClaudeStartPayload

```typescript
interface ClaudeStartPayload {
  // ... existing fields ...
  enableQA?: boolean;
  qaTargetUrl?: string;
}
```

### Changes to websocket.ts handleClaude()

Map new fields from `ClaudeStartPayload` to `SessionOptions`:
```typescript
const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
  workingDir,
  permissionMode: opts.permissionMode ?? 'bypassPermissions',
  model: opts.model,
  enableQA: opts.enableQA,        // NEW
  qaTargetUrl: opts.qaTargetUrl,  // NEW
});
```

### Changes to ClaudeSession.buildArgs()

When `enableQA` is true:

```typescript
if (this.options.enableQA) {
  const mcpServerPath = path.resolve(__dirname, '../../dist/mcp/qa-server.js');
  const mcpConfig = JSON.stringify({
    mcpServers: {
      'zeus-qa': {
        command: 'node',
        args: [mcpServerPath],
      },
    },
  });
  args.push('--mcp-config', mcpConfig);
}
```

Claude CLI spawns the MCP server as a child process. Zeus does not manage this process directly — Claude handles the lifecycle.

### System Prompt Injection

When `enableQA` is true, use `--append-system-prompt` flag:

```typescript
if (this.options.enableQA) {
  const qaPrompt = [
    'You have access to QA browser testing tools via the zeus-qa MCP server.',
    `After making UI changes, call qa_run_test_flow with url "${this.options.qaTargetUrl || 'http://localhost:5173'}".`,
    'Check the summary for errors. If issues found, fix them and re-test.',
    'Do not claim work is complete until qa_run_test_flow returns a clean report.',
  ].join(' ');
  args.push('--append-system-prompt', qaPrompt);
}
```

This appends to the default system prompt rather than replacing it, preserving Claude's default behavior.

### QA Service Auto-Start

When a Claude session starts with `enableQA: true`, the WebSocket handler:
1. Starts PinchTab service if not already running (via existing `QAService.start()`)
2. Launches a browser instance with `CHROME_FLAGS=--remote-debugging-port=9222`
3. Starts CDP client inside QAService to begin capturing events
4. Then proceeds with Claude session creation (which adds `--mcp-config`)

## Frontend Enhancements

### QAPanel Updates

Add three new sub-tabs alongside existing Snapshot/Screenshot/Text:

- **Console** — Live stream of console.log entries, color-coded by level (red for errors, yellow for warnings)
- **Network** — Table of requests: method, URL (truncated), status badge, duration
- **Errors** — List of JS errors with expandable stack traces

### New QaPayload Types

```typescript
// Add to QaPayload union in shared/types.ts:
| { type: 'cdp_console'; logs: Array<{ level: string; message: string; timestamp: number }> }
| { type: 'cdp_network'; requests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean }> }
| { type: 'cdp_error'; errors: Array<{ message: string; stack: string; timestamp: number }> }
```

### State Additions (useZeusStore)

```typescript
qaConsoleLogs: Array<{ level: string; message: string; timestamp: number }>;
qaNetworkRequests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean }>;
qaJsErrors: Array<{ message: string; stack: string; timestamp: number }>;
```

Updated via `qa` channel subscription when `cdp_console`, `cdp_network`, `cdp_error` payloads arrive.

### QA Tab Error Badge

When `qaJsErrors.length > 0`, show a red dot on the Eye icon in the RightPanel activity bar.

### New Claude Session Modal Update

Add a toggle: "Enable QA Testing" (checkbox) and "Dev Server URL" (text input, default `http://localhost:5173`).

## Auto-Test Flow

```
1. User starts Claude session with enableQA=true, qaTargetUrl="http://localhost:5173"
2. Zeus WebSocket handler:
   a. Starts PinchTab if not running
   b. Launches Chrome instance (with --remote-debugging-port=9222 via CHROME_FLAGS)
   c. Connects CDP client to Chrome
   d. Creates Claude session with --mcp-config pointing to zeus-qa MCP server
   e. Adds --append-system-prompt with QA instructions
3. Claude CLI starts, discovers zeus-qa MCP tools
4. Claude works on the task (writes code, edits files)
5. After UI changes, Claude calls qa_run_test_flow("http://localhost:5173")
6. MCP server:
   a. POST /nav → PinchTab (navigate to URL)
   b. Wait for page load
   c. POST /snapshot → PinchTab (accessibility tree)
   d. GET /screenshot → PinchTab (visual capture)
   e. Read /tmp/zeus-qa-cdp-state.json (console + network + errors)
   f. Generate summary
7. Returns combined report to Claude
8. Claude analyzes:
   - Console errors? → Fix the code, re-test
   - Network failures? → Check API endpoints, fix, re-test
   - Snapshot missing elements? → Fix component, re-test
   - Clean report → Continue with next task or report success
9. Repeat from step 4 for each change
```

## File Structure

```
src/mcp/
  └── qa-server.ts          # NEW — MCP stdio server (standalone, spawned by Claude CLI)

src/main/services/
  ├── cdp-client.ts          # NEW — Chrome DevTools Protocol client
  ├── qa.ts                  # MODIFY — Launch Chrome with CHROME_FLAGS, manage CDP lifecycle
  ├── claude-session.ts      # MODIFY — Add --mcp-config and --append-system-prompt flags
  └── websocket.ts           # MODIFY — Map enableQA/qaTargetUrl, auto-start QA on session create

src/shared/types.ts           # MODIFY — Add enableQA to payloads, CDP event types to QaPayload

src/renderer/src/
  ├── stores/useZeusStore.ts  # MODIFY — Add console/network/error state
  ├── components/QAPanel.tsx   # MODIFY — Add Console/Network/Error tabs
  └── components/NewClaudeSessionModal.tsx  # MODIFY — Add QA toggle
```

## Implementation Order

1. **CDP Client** (`src/main/services/cdp-client.ts`) — Connect to Chrome debug port via discovery, capture events, write to temp file
2. **QAService updates** (`src/main/services/qa.ts`) — Launch Chrome with `CHROME_FLAGS`, start CDP client on instance launch
3. **MCP QA Server** (`src/mcp/qa-server.ts`) — Stdio bridge using `@modelcontextprotocol/sdk`, expose all tools
4. **Claude Session Integration** (`src/main/services/claude-session.ts`) — `--mcp-config` flag, `--append-system-prompt`, `SessionOptions` update
5. **WebSocket + Types** — Map `enableQA`/`qaTargetUrl`, forward CDP events to frontend
6. **Frontend** — Console/Network/Error tabs in QA panel, error badge, session modal toggle

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "latest",
  "ws": "^8.x"  // already installed — reuse for CDP WebSocket
}
```

## Testing Strategy

1. **Unit tests for CDP client** — Mock WebSocket, verify event parsing, ring buffer, temp file writing
2. **Unit tests for MCP server** — Mock PinchTab HTTP, verify JSON-RPC protocol, tool responses
3. **Integration test** — Start PinchTab + CDP, navigate to test page, verify snapshot + console capture
4. **E2E test** — Start Claude session with `enableQA`, verify it discovers and calls QA tools

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| PinchTab doesn't pass `CHROME_FLAGS` to Chrome | Verify with PinchTab docs; fallback: launch Chrome directly alongside PinchTab |
| Chrome debug port not accessible | CDP client uses lazy-connect with retry (5 attempts, 1s backoff); QA degrades to PinchTab-only mode |
| Token explosion from verbose console/network | Ring buffers (100 entries), `since_last_call` filtering, summary field in `qa_run_test_flow` |
| MCP server crash | Claude gets error response, continues without QA; can retry on next tool call |
| Port conflicts (9222, 9867) | Configurable via env vars `ZEUS_CDP_PORT`, `ZEUS_PINCHTAB_PORT`; health check before connecting |
| PinchTab binary not installed | MCP server returns graceful error; Claude told "QA tools unavailable" |
| `qa_evaluate` runs arbitrary JS | Low risk since it targets the user's own dev server. Documented as equivalent to browser devtools |
| Shared temp file race condition | Debounced writes (200ms), atomic file write (write to `.tmp` then rename) |
| Multiple Chrome tabs confuse CDP | CDP client connects to the first tab from `/json/list`; PinchTab manages tab focus |
