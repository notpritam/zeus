# Claude Sessions

How Zeus spawns, manages, and streams Claude CLI processes.

**Files:**
- `src/main/services/claude-session.ts` — Session class, spawning, MCP config
- `src/main/services/claude-log-processor.ts` — Stream parsing, entry normalization
- `src/main/services/websocket.ts` — Wiring, broadcast, persistence

---

## Session Lifecycle

```
start_claude (WS)
    │
    ▼
ClaudeSession.start(prompt)
    │
    ├── Spawn: npx @anthropic-ai/claude-code@latest
    ├── Wire: stdout → log processor → entries
    ├── Set status: 'running'
    │
    ▼
  ┌──────────────────────────────────┐
  │         RUNNING LOOP             │
  │                                  │
  │  thinking → streaming → idle     │
  │       │          │               │
  │       ▼          ▼               │
  │  tool_running → streaming → idle │
  │       │                          │
  │       ▼                          │
  │  waiting_approval → (approved)   │
  │                  → (denied)      │
  │                                  │
  │  ◄── send_message (new turn) ──► │
  └──────────────────────────────────┘
    │
    ▼
Process exits → status: 'done' or 'error'
```

**Key point:** Claude process stays alive across multiple turns. `result` event = end of turn, `done` event = process exit.

---

## Claude CLI Spawning

**Command:**
```bash
npx -y @anthropic-ai/claude-code@latest \
  -p \
  --verbose \
  --output-format=stream-json \
  --input-format=stream-json \
  --include-partial-messages \
  --permission-prompt-tool=stdio \
  --permission-mode=bypassPermissions \
  --mcp-config '{"mcpServers":{...}}'
```

**Optional flags:**
- `--model claude-opus-4-1` (user-specified model)
- `--resume <sessionId>` (resume previous session)
- `--resume-session-at <messageId>` (start from specific message)
- `--append-system-prompt <text>` (QA/bridge context)

**Environment:**
```
NPM_CONFIG_LOGLEVEL=error
ZEUS_SESSION_ID=<sessionId>
ZEUS_QA_AGENT_ID=<qaAgentId>    # QA agents only
ZEUS_WS_URL=ws://127.0.0.1:8888
ZEUS_PINCHTAB_PORT=9867          # QA agents only
```

---

## MCP Server Configuration

Two mutually exclusive modes — a session gets one or the other:

### Regular Sessions → `zeus-bridge`

```json
{
  "mcpServers": {
    "zeus-bridge": {
      "command": "node",
      "args": ["out/main/mcp-zeus-bridge.mjs"]
    }
  }
}
```

Provides: session management, `zeus_qa_run`, `zeus_qa_start/log/end`, PinchTab control

### QA Agent Sessions → `zeus-qa`

```json
{
  "mcpServers": {
    "zeus-qa": {
      "command": "node",
      "args": ["out/main/mcp-qa-server.mjs"]
    }
  }
}
```

Provides: browser automation (navigate, click, type, screenshot, snapshot, finish)

---

## Entry Normalization Pipeline

Raw Claude stream-json → NormalizedEntry → broadcast + persist

```
Claude stdout (line-delimited JSON)
    │
    ▼
ClaudeSession.handleMessage(msg)
    │
    ▼
ClaudeLogProcessor.process(msg)
    ├── Discriminate on msg.type
    ├── Accumulate streaming text/thinking blocks
    ├── Extract tool metadata (toolName, actionType, status)
    ├── Detect file changes, images, MCP tool calls
    │
    ▼
NormalizedEntry {
    id: string,              // UUID, stable across streaming updates
    timestamp: string,       // ISO 8601
    entryType: {             // discriminated union
        type: 'assistant_message' | 'tool_use' | 'thinking' | ...
        toolName?, actionType?, status?, ...
    },
    content: string,         // display text
    metadata?: unknown       // tool output, file changes, images
}
    │
    ├──► broadcastEnvelope() → all WS clients (real-time)
    └──► upsertClaudeEntry() → SQLite (INSERT OR REPLACE)
```

---

## Entry Types

| Type | When | Content |
|------|------|---------|
| `user_message` | User sends prompt/follow-up | The user's text |
| `assistant_message` | Claude responds | Response text (streaming updates) |
| `tool_use` | Claude calls a tool | Tool name + args + output |
| `thinking` | Extended thinking | Claude's reasoning |
| `system_message` | System events | Task start/end notices |
| `error_message` | Errors | Error description |
| `token_usage` | Turn complete | Input/output token counts |

---

## Activity States

| State | Trigger | UI Shows |
|-------|---------|----------|
| `starting` | Session created / resume | Spinner |
| `thinking` | `content_block_start` (type=thinking) | "Thinking..." |
| `streaming` | `content_block_start` (type=text) | Text appearing |
| `tool_running` | `processToolUse()` | Tool name + spinner |
| `waiting_approval` | `approval_needed` event | Approval dialog |
| `idle` | `processResult()` | Ready for input |

**UI derivation:**
```typescript
isBusy = session.status === 'running' && activity.state !== 'idle'
```

---

## WebSocket Events (claude channel)

### Client → Server

| Type | Purpose |
|------|---------|
| `start_claude` | Spawn new Claude session |
| `resume_claude` | Resume by session ID |
| `send_message` | Follow-up message (text + optional images) |
| `approve_tool` | Approve pending tool use |
| `deny_tool` | Deny pending tool use |
| `interrupt` | SIGINT to process |
| `stop_claude` | Kill process |
| `list_claude_sessions` | Get session list |
| `get_claude_history` | Get entries for a session |

### Server → Client

| Type | Purpose |
|------|---------|
| `claude_started` | Session wired + process spawned |
| `entry` | NormalizedEntry (streamed) |
| `session_activity` | Activity state change |
| `approval_needed` | Tool needs user OK |
| `claude_session_id` | Real session ID extracted from stream |
| `turn_complete` | End of one Claude turn |
| `done` | Process exited cleanly |
| `error` | Fatal session error |

---

## Permission Modes

| Mode | Behavior |
|------|----------|
| `bypassPermissions` | Only `AskUserQuestion` needs approval (default) |
| `plan` | Approve everything except `ExitPlanMode` |
| `default` | Approve only non-read tools |

Approval flow:
```
Claude requests tool use → approval_needed event → UI shows dialog
    → User approves → approve_tool → tool runs
    → User denies  → deny_tool → Claude gets denial
```

---

## Multi-Session Support

- `ClaudeSessionManager` maps `sessionId → ClaudeSession`
- Multiple UI clients can view the same session
- On client disconnect: ownership cleared, process stays alive for reconnection
- On session done/error: cleanup git watcher, finalize pending tool entries
