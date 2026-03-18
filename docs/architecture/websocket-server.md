# WebSocket Server

The central nervous system. All data between the UI and Zeus host flows through a single multiplexed WebSocket.

**File:** `src/main/services/websocket.ts`

---

## Initialization

- **Port:** Configurable via `ZEUS_WS_PORT` env var (default `8888`)
- **Server:** Node.js `http.createServer()` + `WebSocketServer` from `ws` package
- **Static files:** Serves built renderer via `sirv` middleware on the same HTTP server
- **Startup:** Called from `src/main/index.ts` → `startWebSocketServer(wsPort)`

---

## Envelope Format

Every message (client→server and server→client) uses this shape:

```typescript
interface WsEnvelope {
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf';
  sessionId: string;
  payload: unknown;   // shape varies by channel + payload.type
  auth: string;       // token for remote clients
}
```

The `channel` field is the primary router. The `payload.type` field discriminates within a channel.

---

## Channels

| Channel | Handler | Purpose |
|---------|---------|---------|
| `control` | `handleControl()` | Terminal lifecycle: start, stop, list, delete, archive sessions |
| `terminal` | `handleTerminal()` | Terminal I/O: keyboard input, PTY resize |
| `status` | `handleStatus()` | System: power save toggle, tunnel start/stop |
| `claude` | `handleClaude()` | Claude sessions: start, resume, message, approval, interrupt, stop |
| `git` | `handleGit()` | Git ops: status, commit, push, checkout, branch (via GitWatcherManager) |
| `files` | `handleFiles()` | File tree: read, write, tree traversal (via FileTreeServiceManager) |
| `qa` | `handleQA()` | QA agents: spawn, log, stop, PinchTab control |
| `settings` | `handleSettings()` | App config: themes, project settings, defaults |
| `perf` | `handlePerf()` | System monitor: CPU, memory, process metrics |

---

## Authentication

**Hybrid local/remote model:**

```
Local client (127.0.0.1)     → Auto-authenticated
Remote client (via Ngrok)    → Must provide ?token=<auth_token> query param
```

- Token validated via `validateToken(token)`
- Failed auth → `ws.close(4401, 'Unauthorized')`
- Authenticated clients tracked in `WeakSet<WebSocket>`

---

## Broadcast Pattern

```typescript
function broadcastEnvelope(envelope: WsEnvelope): void {
  for (const client of wss.clients) {
    sendEnvelope(client, envelope);
  }
}
```

- **All-to-all:** Every connected client gets broadcasted messages
- **Selective:** Some responses go only to the requesting client via `sendEnvelope(ws, ...)`
- **Used for:** Terminal output, Claude entries, git status, QA results, perf metrics

---

## Connection Lifecycle

```
Client connects
    │
    ├── Local? → auto-auth
    ├── Remote? → validate token
    │       ├── valid → add to authenticatedClients
    │       └── invalid → ws.close(4401)
    │
    ▼
Register handlers: on('message'), on('close')
    │
    ▼
Messages routed by channel → handler
    │
    ▼
Client disconnects
    ├── Terminal sessions: killed + cleaned up
    ├── Claude sessions: ownership cleared, process stays alive
    └── Git/File watchers: stay active for other clients
```

---

## Global State

| State | Purpose |
|-------|---------|
| `clientSessions: Map<WS, Set<string>>` | Terminal sessions per client |
| `clientClaudeSessions: Map<WS, Set<string>>` | Claude sessions per client |
| `authenticatedClients: WeakSet<WS>` | Authenticated remote clients |
| `claudeManager: ClaudeSessionManager` | Singleton session manager |
| `gitManager: GitWatcherManager` | Singleton git watcher |
| `qaService: QAService` | Singleton PinchTab server |
| `qaAgentSessions: Map<string, QaAgentRecord>` | Active QA agent processes |
