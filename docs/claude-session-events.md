# Claude Session — Event Reference

Complete map of all WebSocket events for the `claude` channel.

## Server → Client Events

| Payload Type | Trigger | Fields | Store Handler |
|---|---|---|---|
| `claude_started` | Session wired + process spawned | `{ type }` | **MISSING** |
| `entry` | Log processor emits NormalizedEntry | `{ type, entry }` | handled |
| `session_activity` | Activity state change | `{ type, activity: SessionActivity }` | handled |
| `approval_needed` | Tool needs user OK | `{ type, approvalId, requestId, toolName, toolInput, toolUseId }` | handled |
| `claude_session_id` | Real session ID extracted | `{ type, claudeSessionId }` | handled |
| `turn_complete` | End of one Claude turn | `{ type, result }` | **MISSING** |
| `done` | Process exited cleanly | `{ type }` | handled |
| `error` | Fatal session error | `{ type, message }` | handled |
| `claude_session_list` | Client requested list | `{ type, sessions }` | handled |
| `claude_history` | Client requested history | `{ type, entries }` | handled |
| `claude_session_deleted` | Client deleted session | `{ type, deletedId }` | handled |
| `claude_session_archived` | Client archived session | `{ type, archivedId }` | handled |

## Client → Server Events

| Payload Type | Purpose |
|---|---|
| `start_claude` | Spawn a new Claude CLI process |
| `resume_claude` | Resume an existing session by ID |
| `send_message` | Send follow-up message to active session |
| `approve_tool` | Approve a pending tool use |
| `deny_tool` | Deny a pending tool use |
| `interrupt` | Send SIGINT to the process |
| `stop_claude` | Kill the process |
| `list_claude_sessions` | Request session list |
| `get_claude_history` | Request entries for a session |

## Activity State Machine

```
starting ──► thinking ──► streaming ──► idle
                │              │
                ▼              ▼
          tool_running ──► streaming ──► idle
                │
                ▼
        waiting_approval ──► (approved) ──► tool_running
                         ──► (denied)  ──► streaming
```

| State | Set By | Means |
|---|---|---|
| `starting` | Constructor / resume | Process spawned, not yet producing output |
| `thinking` | `content_block_start` (type=thinking) | Extended thinking active |
| `streaming` | `content_block_start` (type=text) / tool result | Writing response text |
| `tool_running` | `processToolUse()` | A tool is executing |
| `waiting_approval` | `approval_needed` event | Blocked on user approval |
| `idle` | `processResult()` | Turn finished, waiting for next input |

## UI State Derivation

```
isBusy = session.status === 'running' && activity.state !== 'idle'
```

- **Stop button**: visible when `isBusy`
- **Send vs Queue**: `isBusy` → Queue, else → Send
- **Activity bar**: visible when `isBusy`, shows state-specific icon + label
- **Resume button**: visible when `session.status === 'done' | 'error'`

## Known Gaps (fixed)

1. `claude_started` — now sets activity to `starting` so UI shows spinner immediately
2. `turn_complete` — now updates token usage entry in the chat
