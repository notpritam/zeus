# Zeus Architecture Documentation

How Zeus works under the hood. Each doc covers a core subsystem.

## Documents

| Doc | What It Covers |
|-----|----------------|
| [websocket-server.md](websocket-server.md) | WebSocket server, envelope routing, channels, auth, broadcast |
| [claude-sessions.md](claude-sessions.md) | Claude CLI spawning, session lifecycle, MCP config, entry normalization |
| [terminal-sessions.md](terminal-sessions.md) | PTY spawning, I/O, resize, cleanup |
| [qa-agent-flow.md](qa-agent-flow.md) | QA sub-agent lifecycle, deferred response pattern, PinchTab integration |
| [data-persistence.md](data-persistence.md) | SQLite schema, entry storage, pagination, validation |
| [claude-session-events.md](claude-session-events.md) | Complete WebSocket event reference for claude channel |

## System Diagram

```
                    +---------------------------+
                    |      Mobile / Web UI      |
                    |      (React + Vite)       |
                    +-------------+-------------+
                                  |
                          WebSocket (ws://)
                          + Ngrok tunnel
                                  |
+-----------------------------+---+---+-----------------------------+
|                             |       |                             |
|              Zeus Host (Electron Main Process)                    |
|                                                                   |
|  +-----------+  +-----------+  +-----------+  +-----------+      |
|  | Terminal  |  |  Claude   |  |    Git    |  |    QA     |      |
|  | Manager   |  |  Session  |  |  Watcher  |  |  Service  |      |
|  | (node-pty)|  |  Manager  |  | (chokidar)|  | (PinchTab)|      |
|  +-----------+  +-----------+  +-----------+  +-----------+      |
|       |              |              |               |             |
|       |         +----+----+         |          +----+----+       |
|       |         | Claude  |         |          | Headless|       |
|       |         | CLI     |         |          | Chrome  |       |
|       |         | (npx)   |         |          |         |       |
|       |         +---------+         |          +---------+       |
|                                                                   |
|  +-----------------------------------------------------------+   |
|  |                    SQLite (better-sqlite3)                 |   |
|  |  claude_sessions | claude_entries | terminal_sessions | qa |   |
|  +-----------------------------------------------------------+   |
+-------------------------------------------------------------------+
```

## Key Concepts

- **Envelope Routing** — Every WebSocket message has a `channel` field that routes to the right handler
- **Deferred Response** — `zeus_qa_run` blocks the calling agent while a sub-agent runs, using `responseId` matching
- **Entry Normalization** — Raw Claude stream-json is parsed into `NormalizedEntry` structs before storage/broadcast
- **MCP Switching** — Regular sessions get `zeus-bridge` MCP; QA agents get `qa-server` MCP
- **File-Based IPC** — QA agents write results to `/tmp/zeus-qa-finish-{id}.json` for the host to read
