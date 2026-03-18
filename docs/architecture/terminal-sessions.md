# Terminal Sessions

How Zeus manages PTY-based terminal sessions with full ANSI support.

**Files:**
- `src/main/services/terminal.ts` — PTY spawning, I/O, resize, cleanup
- `src/main/services/websocket.ts` — WebSocket wiring, broadcast

---

## Lifecycle

```
start_session (control channel)
    │
    ▼
pty.spawn(shell, [], { cols, rows, cwd, env })
    │
    ├── Store in sessions Map<sessionId, IPty>
    ├── Persist to SQLite (terminal_sessions table)
    ├── Wire onData → broadcast terminal output
    ├── Wire onExit → mark exited, emit exit code
    │
    ▼
  ┌──────────────────────────────┐
  │        ACTIVE SESSION        │
  │                              │
  │  input (terminal channel)    │
  │    → term.write(data)        │
  │                              │
  │  resize (terminal channel)   │
  │    → term.resize(cols, rows) │
  └──────────────────────────────┘
    │
    ▼
Exit (process ends or stop_session)
    ├── term.kill()
    ├── Remove from sessions Map
    ├── Update DB status: 'exited' or 'killed'
    └── Broadcast exit event
```

---

## Shell Detection

```typescript
const shell = process.env.SHELL || '/bin/zsh'
```

Uses the user's default shell. Falls back to `/bin/zsh` on macOS.

---

## I/O Flow

```
User types in xterm.js
    │
    ▼
WS: { channel: 'terminal', payload: { type: 'input', data: '...' } }
    │
    ▼
term.write(data)  →  PTY process  →  term.onData(output)
                                          │
                                          ▼
                                  broadcastEnvelope({
                                    channel: 'terminal',
                                    payload: { type: 'output', data: output }
                                  })
                                          │
                                          ▼
                                  All connected clients render via xterm.write()
```

**Key:** Terminal output is broadcast to ALL clients, enabling multi-device terminal sharing.

---

## WebSocket Events

### Client → Server

| Channel | Type | Purpose |
|---------|------|---------|
| `control` | `start_session` | Create new terminal |
| `control` | `stop_session` | Kill terminal process |
| `control` | `list_sessions` | Get all terminals |
| `control` | `delete_terminal_session` | Delete from DB |
| `control` | `archive_terminal_session` | Archive in DB |
| `terminal` | `input` | Keyboard data |
| `terminal` | `resize` | PTY dimension change |

### Server → Client

| Channel | Type | Purpose |
|---------|------|---------|
| `terminal` | `output` | PTY output data (ANSI) |
| `control` | `session_list` | List of all sessions |
| `control` | `session_exited` | Terminal process ended |

---

## Cleanup

- **Client disconnect:** All terminal sessions owned by that client are killed
- **App shutdown:** `destroyAllSessions()` kills all PTY processes
- **PID tracking:** `getSessionPids()` returns active PIDs for system monitor
