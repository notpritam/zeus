# Zeus QA Agent Flow

How a main Claude agent triggers a QA sub-agent, and how results flow back.

---

## Architecture Overview

```
+------------------+       +------------------+       +------------------+
|  Main Claude     |       |   Zeus Host      |       |  QA Claude       |
|  Agent           |       |   (Electron)     |       |  Agent           |
|                  |       |                  |       |                  |
|  zeus-bridge MCP |<----->|  WebSocket Server|<----->|  qa-server MCP   |
|  (tools)         |  WS   |  (orchestrator)  | PTY   |  (browser tools) |
+------------------+       +------------------+       +------------------+
                                    |
                                    v
                           +------------------+
                           |   PinchTab       |
                           |   (Headless      |
                           |    Chrome)        |
                           +------------------+
```

**Three layers:**
1. **zeus-bridge MCP** — The tool interface for the main Claude agent
2. **Zeus Host** — Electron app's WebSocket server; the orchestrator
3. **qa-server MCP** — The tool interface for the spawned QA agent, with PinchTab browser automation

---

## Full Sequence Diagram

```
Main Claude          zeus-bridge           Zeus Host              ClaudeSession           QA Agent Claude        qa-server MCP         PinchTab
    |                    |                    |                       |                       |                      |                    |
    |  zeus_qa_run()     |                    |                       |                       |                      |                    |
    |------------------->|                    |                       |                       |                      |                    |
    |                    |  WS: start_qa_agent|                       |                       |                      |                    |
    |                    |------------------->|                       |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |   [BLOCKED]        |  1. Ensure PinchTab   |                       |                      |                    |
    |                    |   waiting for      |     is running        |                       |                      |                    |
    |                    |   responseId       |---------------------->|                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  2. Resolve target URL|                       |                      |                    |
    |                    |                    |     (auto-detect)     |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  3. Create QA record  |                       |                      |                    |
    |                    |                    |     (qaAgentId)       |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  4. Spawn Claude      |                       |                      |                    |
    |                    |                    |------ session ------->|                       |                      |                    |
    |                    |                    |  (enableQA: true,     |   npx claude-code     |                      |                    |
    |                    |                    |   qaAgentId env var)  |---------------------->|                      |                    |
    |                    |                    |                       |   --mcp-config        |                      |                    |
    |                    |                    |                       |   (qa-server)         |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  5. wireQAAgent()     |                       |                      |                    |
    |                    |                    |     (event handlers)  |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  6. Broadcast to UI:  |                       |                      |                    |
    |                    |                    |     qa_agent_started  |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |                       |   << QA agent runs >>  |                      |                    |
    |                    |                    |                       |                       |  qa_navigate(url)    |                    |
    |                    |                    |                       |                       |--------------------->|                    |
    |                    |                    |                       |                       |                      |  HTTP: /navigate   |
    |                    |                    |                       |                       |                      |------------------->|
    |                    |                    |                       |                       |                      |   page loaded      |
    |                    |                    |                       |                       |                      |<-------------------|
    |                    |                    |                       |                       |  result              |                    |
    |                    |                    |                       |                       |<---------------------|                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  7. Stream entries     |                       |  qa_screenshot()     |                    |
    |                    |                    |<--- (entry event) ----|                       |--------------------->|                    |
    |                    |                    |                       |                       |                      |  HTTP: /screenshot |
    |                    |                    |  broadcast:           |                       |                      |------------------->|
    |                    |                    |  qa_agent_entry       |                       |                      |  base64 image      |
    |                    |                    |  (to all UI clients)  |                       |                      |<-------------------|
    |                    |                    |                       |                       |  image data          |                    |
    |                    |                    |                       |                       |<---------------------|                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |                       |                       |  qa_snapshot()       |                    |
    |                    |                    |                       |                       |--------------------->|                    |
    |                    |                    |                       |                       |  accessibility tree  |                    |
    |                    |                    |                       |                       |<---------------------|                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |                       |                       |  qa_finish(summary,  |                    |
    |                    |                    |                       |                       |    status)           |                    |
    |                    |                    |                       |                       |--------------------->|                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |                       |                       |  writes finish file: |                    |
    |                    |                    |                       |                       |  /tmp/zeus-qa-finish-{id}.json           |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  8. Claude exits /    |                       |                      |                    |
    |                    |                    |     result event      |                       |                      |                    |
    |                    |                    |<--- (done event) -----|                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |                    |  9. Read finish file  |                       |                      |                    |
    |                    |                    |     get summary+status|                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |                    |  WS: start_qa_agent|                       |                       |                      |                    |
    |                    |      _response     |                       |                       |                      |                    |
    |                    |<-------------------|                       |                       |                      |                    |
    |  { qaAgentId,      |                    |                       |                       |                      |                    |
    |    status, summary}|                    |                       |                       |                      |                    |
    |<-------------------|                    |                       |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
    |  10. Main agent    |                    |  broadcast:           |                       |                      |                    |
    |      uses result   |                    |  qa_agent_stopped     |                       |                      |                    |
    |                    |                    |                       |                       |                      |                    |
```

---

## Phase-by-Phase Breakdown

### Phase 1: Main Agent Calls `zeus_qa_run`

**File:** `src/main/mcp/zeus-bridge.ts`

The main Claude agent (running a regular session) calls `zeus_qa_run` via the zeus-bridge MCP server.

```
Input:
  - task: string          — what to test
  - target_url?: string   — URL to test (auto-detected if omitted)
  - name?: string         — display name for QA session
  - parent_session_id?: string
  - working_dir?: string
```

zeus-bridge sends a WebSocket message to the Zeus host and **blocks** (up to 10 minutes) waiting for the response:

```typescript
sendAndWait('qa', {
  type: 'start_qa_agent',
  task, name, workingDir, targetUrl,
  parentSessionId, parentSessionType: 'claude'
}, 600_000);
```

The `sendAndWait` pattern:
1. Generates a unique `responseId`
2. Sends the message with `responseId` attached
3. Registers a Promise that resolves when a message with matching `responseId` arrives
4. Returns the resolved payload to the caller

---

### Phase 2: Zeus Host Receives `start_qa_agent`

**File:** `src/main/services/websocket.ts` — `handleQA()`

The WebSocket server processes the request in order:

#### 2a. Ensure PinchTab is Running
- Auto-starts the QA service if not already running
- Launches a headless Chrome instance if none exists
- Wires CDP event listeners (console, network, JS errors)

#### 2b. Resolve Target URL
Priority order:
1. Explicit URL from payload
2. Parent session's cached URL
3. Live detection via `detectDevServerUrlDetailed(workingDir)`
4. Env default (`ZEUS_QA_DEFAULT_URL`)

#### 2c. Create QA Agent Record
```typescript
qaAgentId = `qa-agent-${counter}-${timestamp}`

QaAgentRecord = {
  qaAgentId, parentSessionId, parentSessionType,
  session: ClaudeSession,
  task, targetUrl, startedAt,
  pendingResponseId,    // links to zeus-bridge's waiting Promise
  pendingResponseWs,    // which WebSocket to reply on
  collectedTextEntries  // fallback summary if qa_finish not called
}
```

#### 2d. Spawn QA Claude Session
```typescript
new ClaudeSession({
  enableQA: true,
  qaAgentId,          // set as ZEUS_QA_AGENT_ID env var
  parentSessionId     // set as zeusSessionId
})
```

This launches `npx @anthropic-ai/claude-code` with:
- `--mcp-config` pointing to **qa-server** (NOT zeus-bridge)
- System prompt describing available QA/browser tools
- Env vars: `ZEUS_SESSION_ID`, `ZEUS_QA_AGENT_ID`, `ZEUS_PINCHTAB_PORT`

#### 2e. Wire Event Handlers
`wireQAAgent(record)` sets up listeners on the ClaudeSession for:
- `entry` — stream each entry to UI
- `result` — Claude's turn ended
- `done` — process exited
- `error` — crash/failure

#### 2f. Broadcast to UI
```typescript
broadcast({ channel: 'qa', payload: { type: 'qa_agent_started', ... } })
```

The Zeus UI's QA panel shows the agent as running.

---

### Phase 3: QA Agent Runs

**File:** `src/main/mcp/qa-server.ts`

The QA agent is a full Claude instance with its own MCP server (`qa-server`) providing browser automation tools:

| Tool | Purpose |
|------|---------|
| `qa_navigate` | Navigate to a URL |
| `qa_screenshot` | Capture page screenshot |
| `qa_snapshot` | Get accessibility tree |
| `qa_click` | Click an element |
| `qa_type` / `qa_fill` | Type text into inputs |
| `qa_press` | Press keyboard keys |
| `qa_hover` | Hover over element |
| `qa_scroll` | Scroll the page |
| `qa_wait_for_element` | Wait for selector |
| `qa_assert_element` | Assert element exists |
| `qa_text` | Get text content |
| `qa_console_logs` | Get console output |
| `qa_network_requests` | Get network activity |
| `qa_js_errors` | Get JavaScript errors |
| `qa_finish` | **Signal completion with summary** |

All tools call PinchTab's HTTP API at `http://127.0.0.1:{PINCHTAB_PORT}`.

---

### Phase 4: Entry Streaming (Real-time)

**File:** `src/main/services/websocket.ts` — `wireQAAgent()`

As the QA agent works, every entry is streamed to the UI in real-time:

```
QA Agent stdout  →  ClaudeSession (parse)  →  wireQAAgent handler  →  broadcast to UI
                                                      |
                                                      v
                                               insertQaAgentEntry() → SQLite DB
```

**Special handling for screenshots:**
- When a `qa_screenshot` tool result is detected, Zeus re-fetches the image from PinchTab
- The base64 data URL is attached as `imageData` on the entry
- The UI renders it inline (NOT persisted to DB — live broadcast only)

**Entry accumulation:**
- `assistant_message` and `thinking` entries are buffered
- Flushed when a new block type starts or a tool call arrives
- Prevents fragmented streaming to the UI

---

### Phase 5: QA Agent Finishes

The QA agent calls `qa_finish(summary, status)` when done:

```typescript
// qa-server writes a temp file
{
  summary: "PASS — All UI elements render correctly...",
  status: "pass",
  timestamp: 1773848507918
}
// Written to: /tmp/zeus-qa-finish-{qaAgentId}.json
```

Then the Claude process exits.

---

### Phase 6: Zeus Host Collects Results

**File:** `src/main/services/websocket.ts`

When the QA agent's Claude process emits `result` or `done`:

1. **Flush** any pending text/thinking entries
2. **Read** the qa_finish file from `/tmp/zeus-qa-finish-{qaAgentId}.json`
3. **Send deferred response** back to zeus-bridge:

```typescript
ws.send(JSON.stringify({
  channel: 'qa',
  payload: {
    type: 'start_qa_agent_response',
    responseId: record.pendingResponseId,  // matches zeus-bridge's waiting Promise
    success: true,
    qaAgentId,
    status,   // 'pass' | 'fail' | 'done' | 'error' | 'warning'
    summary   // from qa_finish file
  }
}))
```

4. **Broadcast** `qa_agent_stopped` to UI
5. **Update** DB status

---

### Phase 7: Main Agent Receives Result

**File:** `src/main/mcp/zeus-bridge.ts`

zeus-bridge's `sendAndWait()` Promise resolves with the response. The main Claude agent receives:

```json
{
  "qaAgentId": "qa-agent-1-1773848507918",
  "status": "pass",
  "summary": "PASS — Zeus UI renders correctly. All components present..."
}
```

The main agent can now use this result to inform the user or make decisions.

---

## Deferred Response Pattern

The key innovation is the **deferred response** pattern that allows the main agent to block while the QA sub-agent runs:

```
zeus-bridge                       Zeus Host
    |                                |
    |  sendAndWait(responseId: X)    |
    |------------------------------->|
    |                                |
    |  [Promise pending...]          |  ... spawns QA agent ...
    |                                |  ... QA agent runs ...
    |                                |  ... QA agent finishes ...
    |                                |
    |  response(responseId: X)       |
    |<-------------------------------|
    |                                |
    |  Promise resolves!             |
    |                                |
```

The `responseId` is stored on the QA agent record so the response can be sent even if it takes minutes.

---

## Data Flow: WebSocket Messages

| Message Type | Direction | Purpose |
|---|---|---|
| `start_qa_agent` | zeus-bridge → Host | Request to spawn QA agent |
| `start_qa_agent_response` | Host → zeus-bridge | QA result (deferred) |
| `qa_agent_started` | Host → UI | Agent appeared in QA panel |
| `qa_agent_entry` | Host → UI | Real-time log entry |
| `qa_agent_stopped` | Host → UI | Agent finished |

---

## File-Based IPC: qa_finish

The QA agent and Zeus host communicate the final result via a temp file:

```
QA Agent (qa-server)                    Zeus Host (websocket.ts)
    |                                        |
    |  qa_finish("summary", "pass")          |
    |  → writes /tmp/zeus-qa-finish-{id}.json|
    |                                        |
    |  [process exits]                       |
    |                                        |  reads /tmp/zeus-qa-finish-{id}.json
    |                                        |  extracts summary + status
    |                                        |  sends deferred response
```

This is necessary because the QA agent's Claude process and the host are separate processes — the temp file bridges them.

---

## Key Source Files

| File | Role |
|------|------|
| `src/main/mcp/zeus-bridge.ts` | MCP server for main Claude agent; exposes `zeus_qa_run` |
| `src/main/mcp/qa-server.ts` | MCP server for QA agent; PinchTab browser automation tools |
| `src/main/services/websocket.ts` | Orchestrator — handles lifecycle, streaming, deferred response |
| `src/main/services/claude-session.ts` | Spawns Claude subprocesses with correct MCP config |
| `src/shared/types.ts` | Shared type definitions |

---

## Summary

```
Main Agent                    Zeus Host                     QA Agent
    |                            |                             |
    |  "test the UI please"      |                             |
    |  zeus_qa_run(task) ------->|                             |
    |  [blocked]                 |  spawn claude --mcp qa ---->|
    |                            |                             |  navigate(url)
    |                            |  <-- stream entries --------|  screenshot()
    |                            |  broadcast to UI            |  snapshot()
    |                            |                             |  qa_finish(summary)
    |                            |  <-- process exits ---------|
    |                            |  read finish file           |
    |  <-- { status, summary } --|                             |
    |  uses result               |  broadcast: stopped         |
```
