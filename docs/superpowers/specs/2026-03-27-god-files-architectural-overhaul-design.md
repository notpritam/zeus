# Zeus Architectural Overhaul — God Files Split

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Atomic rewrite of the three god files (`websocket.ts`, `useZeusStore.ts`, `db.ts`) plus supporting infrastructure

## Problem

Three files carry the weight of the entire app:

| File | Lines | Responsibility |
|------|-------|---------------|
| `websocket.ts` | 3,954 | ALL message routing, session lifecycle, subagent management, QA sync, git, files, settings, MCP, tasks, permissions, android, perf monitoring |
| `useZeusStore.ts` | 3,399 | ALL frontend state + actions for every feature |
| `db.ts` | 1,572 | ALL tables, migrations, queries |

This makes the codebase hard to navigate, test, and extend. Adding any feature touches all three files. No domain isolation exists.

## Approach

Full architectural overhaul delivered as one atomic change. The Electron renderer is the only consumer of the WebSocket protocol, so both sides can be migrated in lockstep with no compatibility concerns.

## Design — 10 Components

---

### 1. Event Bus

Central pub/sub system. Services publish typed events; the WebSocket layer subscribes and forwards to clients. Replaces all `broadcastEnvelope()` calls scattered across websocket.ts.

**Location:** `src/main/bus/`

```
src/main/bus/
  event.ts        — BusEvent.define() + typed event registry
  bus.ts          — publish(), subscribe(), subscribeAll()
  events/
    claude.ts     — Claude.EntryAdded, Claude.SessionStarted, Claude.Done, Claude.ApprovalNeeded, etc.
    terminal.ts   — Terminal.Output, Terminal.Exited, etc.
    git.ts        — Git.StatusChanged, Git.CommitResult, etc.
    qa.ts         — QA.ScreenshotTaken, QA.SnapshotUpdated, etc.
    subagent.ts   — Subagent.Started, Subagent.Stopped, Subagent.Entry, etc.
    settings.ts   — Settings.Updated, Settings.ThemeChanged, etc.
    mcp.ts        — Mcp.ServerAdded, Mcp.HealthResult, etc.
    tasks.ts      — Task.Created, Task.Updated, Task.Diff, etc.
    permissions.ts— Permission.RulesChanged, Permission.AuditEntry, etc.
    android.ts    — Android.Screenshot, Android.DeviceList, etc.
    perf.ts       — Perf.MetricsUpdated
    system.ts     — System.StatusUpdate, System.Error
```

**Event definition pattern:**

```typescript
// bus/event.ts
export namespace BusEvent {
  const registry = new Map<string, Definition>();

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
  ) {
    const result = { type, properties };
    registry.set(type, result);
    return result;
  }
}

// bus/events/claude.ts
export const ClaudeEvents = {
  EntryAdded: BusEvent.define("claude.entry.added", z.object({
    sessionId: z.string(),
    entry: NormalizedEntrySchema,
  })),
  Done: BusEvent.define("claude.done", z.object({
    sessionId: z.string(),
  })),
  ApprovalNeeded: BusEvent.define("claude.approval.needed", z.object({
    sessionId: z.string(),
    approvalId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
  })),
  Error: BusEvent.define("claude.error", z.object({
    sessionId: z.string(),
    message: z.string(),
  })),
  SessionActivity: BusEvent.define("claude.activity", z.object({
    sessionId: z.string(),
    activity: SessionActivitySchema,
  })),
  QueueUpdated: BusEvent.define("claude.queue.updated", z.object({
    sessionId: z.string(),
    queue: z.array(z.object({ id: z.string(), content: z.string() })),
  })),
};
```

**Bus implementation:**

```typescript
// bus/bus.ts
export namespace Bus {
  type Subscription = (event: { type: string; properties: unknown }) => void;
  const subscriptions = new Map<string, Subscription[]>();

  export function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) {
    const payload = { type: def.type, properties };
    for (const key of [def.type, "*"]) {
      for (const sub of subscriptions.get(key) ?? []) {
        sub(payload);
      }
    }
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => void,
  ): () => void { /* ... */ }

  export function subscribeAll(callback: Subscription): () => void { /* ... */ }
}
```

**Integration point:** The WebSocket layer subscribes once in `server.ts`:

```typescript
Bus.subscribeAll((event) => {
  broadcastToClients(event);
});
```

Services never import WebSocket code. They only import `Bus` and their event definitions.

---

### 2. WebSocket Layer — Thin Router + Domain Handlers

`websocket.ts` (3,954 lines) splits into a thin server (~200 lines) plus domain handlers (~100-300 lines each).

**Location:** `src/main/server/`

```
src/main/server/
  server.ts           — HTTP server, static file serving, WS upgrade
  router.ts           — parse envelope, dispatch to handler by channel
  handlers/
    control.ts        — terminal session start/stop/list/delete/restore/archive
    terminal.ts       — terminal input/resize
    status.ts         — power, tunnel toggle, status queries, ping/pong
    claude.ts         — claude start/resume/send/approve/deny/interrupt/stop
    git.ts            — git watch/stage/unstage/commit/branch/push/pull/fetch
    files.ts          — file tree watch/list/read/save/search
    qa.ts             — PinchTab start/stop/navigate/snapshot/screenshot/actions
    subagent.ts       — subagent start/stop/send/delete/entries
    settings.ts       — settings get/update, themes, projects
    mcp.ts            — MCP server CRUD, profiles, health checks, import
    tasks.ts          — task create/continue/merge/PR/archive/discard/diff
    permissions.ts    — permission rules CRUD, templates, audit log
    android.ts        — android emulator start/stop, screenshot, logcat, view hierarchy
    perf.ts           — performance monitoring start/stop/interval
```

**Handler interface:**

```typescript
// router.ts
export interface HandlerContext {
  ws: WebSocket;
  envelope: WsEnvelope;
  broadcast: (envelope: WsEnvelope) => void;
  send: (envelope: WsEnvelope) => void;
}

export type ChannelHandler = (ctx: HandlerContext) => void;

const handlers: Record<string, ChannelHandler> = {
  control:     handleControl,
  terminal:    handleTerminal,
  status:      handleStatus,
  claude:      handleClaude,
  git:         handleGit,
  files:       handleFiles,
  qa:          handleQa,
  subagent:    handleSubagent,
  settings:    handleSettings,
  mcp:         handleMcp,
  tasks:       handleTasks,
  permissions: handlePermissions,
  android:     handleAndroid,
  perf:        handlePerf,
};

export function route(ws: WebSocket, raw: string): void {
  const envelope = WsEnvelopeSchema.parse(JSON.parse(raw));
  const handler = handlers[envelope.channel];
  if (!handler) {
    sendError(ws, envelope.sessionId, `Unknown channel: ${envelope.channel}`);
    return;
  }
  handler({
    ws,
    envelope,
    broadcast: broadcastEnvelope,
    send: (env) => sendEnvelope(ws, env),
  });
}
```

**Each handler validates its own payload with Zod** (see Section 8) and uses only domain services + Bus.publish(). No handler imports another handler.

---

### 3. Database Layer — Drizzle ORM + File Migrations

Replace raw `better-sqlite3` SQL strings with Drizzle ORM. Schema in `.sql.ts` files per domain, migrations as standalone SQL files.

**Location:** `src/main/db/`

```
src/main/db/
  client.ts              — Drizzle client init, WAL mode, pragmas, close()
  transaction.ts         — AsyncLocalStorage-based transaction context
  schema/
    index.ts             — re-exports all tables
    claude-sessions.sql.ts
    claude-entries.sql.ts
    terminal-sessions.sql.ts
    subagent-sessions.sql.ts
    subagent-entries.sql.ts
    saved-projects.sql.ts
    mcp-servers.sql.ts
    mcp-profiles.sql.ts
    permission-rules.sql.ts
    audit-log.sql.ts
    tasks.sql.ts
  migrations/
    0001_init/migration.sql        — full current schema (version 13 equivalent)
    0002_placeholder/migration.sql — empty, for future additions
  queries/
    claude.ts            — insertSession, updateStatus, upsertEntry, getEntries, etc.
    terminal.ts          — insertSession, updateSession, getAll, etc.
    subagent.ts          — insert, update, getByParent, entries, etc.
    settings.ts          — projects CRUD
    mcp.ts               — servers CRUD, profiles
    permissions.ts       — rules CRUD, audit log
    tasks.ts             — task CRUD
```

**Client initialization:**

```typescript
// client.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function initDatabase(dbPath: string): void {
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -64000");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });

  // Apply migrations
  applyMigrations(db);
}

export function getClient() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function closeDatabase(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}
```

**Transaction context:**

```typescript
// transaction.ts
import { AsyncLocalStorage } from "async_hooks";
import { getClient } from "./client";

type TxOrDb = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0] | ReturnType<typeof drizzle>;

const txContext = new AsyncLocalStorage<{ tx: TxOrDb }>();

export function transaction<T>(callback: (tx: TxOrDb) => T): T {
  const existing = txContext.getStore();
  if (existing) return callback(existing.tx);  // nested — reuse
  return getClient().transaction((tx) =>
    txContext.run({ tx }, () => callback(tx))
  ) as T;
}

export function use<T>(callback: (db: TxOrDb) => T): T {
  const store = txContext.getStore();
  return callback(store?.tx ?? getClient());
}
```

**Schema example:**

```typescript
// schema/claude-sessions.sql.ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const claudeSessionsTable = sqliteTable("claude_sessions", {
  id: text("id").primaryKey(),
  claudeSessionId: text("claude_session_id"),
  status: text("status").notNull().default("running"),
  prompt: text("prompt").notNull(),
  name: text("name"),
  notificationSound: integer("notification_sound").default(1),
  workingDir: text("working_dir"),
  permissionMode: text("permission_mode"),
  model: text("model"),
  color: text("color"),
  icon: text("icon"),
  qaTargetUrl: text("qa_target_url"),
  deletedAt: integer("deleted_at"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
}, (table) => [
  index("idx_cs_started").on(table.startedAt),
]);
```

**Query example:**

```typescript
// queries/claude.ts
import { eq, and, isNull, desc } from "drizzle-orm";
import { claudeSessionsTable } from "../schema/claude-sessions.sql";
import { use } from "../transaction";

export function insertClaudeSession(session: typeof claudeSessionsTable.$inferInsert) {
  return use((db) => db.insert(claudeSessionsTable).values(session).run());
}

export function updateStatus(id: string, status: string, endedAt?: number) {
  return use((db) =>
    db.update(claudeSessionsTable)
      .set({ status, endedAt })
      .where(eq(claudeSessionsTable.id, id))
      .run()
  );
}

export function getAllSessions() {
  return use((db) =>
    db.select()
      .from(claudeSessionsTable)
      .where(isNull(claudeSessionsTable.deletedAt))
      .orderBy(desc(claudeSessionsTable.startedAt))
      .all()
  );
}
```

**Migration strategy:** Migration `0001_init` contains the full current schema (equivalent to version 13). Existing databases: since table shapes are unchanged (only the access layer changes), we write a migration marker file. No data migration needed. New databases get the full schema applied via Drizzle's migrator.

---

### 4. Zustand Store — Slices + Selectors

Split the 3,399-line monolith into domain slices.

**Location:** `src/renderer/src/stores/`

```
src/renderer/src/stores/
  useZeusStore.ts          — compose all slices (~50 lines)
  types.ts                 — ZeusState aggregate type
  slices/
    connectionSlice.ts     — connected, connect(), WS message dispatch
    claudeSlice.ts         — sessions, entries, approvals, activity, queue
    terminalSlice.ts       — terminal sessions, session-terminal panels
    gitSlice.ts            — git status, branches, stage/commit/push
    fileSlice.ts           — file tree state, expand/collapse, read/save
    qaSlice.ts             — PinchTab state, screenshots, snapshots, console/network
    androidSlice.ts        — android devices, emulator, screenshots, logcat
    subagentSlice.ts       — subagent sessions, entries, selection
    settingsSlice.ts       — projects, defaults, themes, autoTunnel
    mcpSlice.ts            — MCP servers, profiles, health, import
    taskSlice.ts           — tasks CRUD, active task, diffs
    permissionSlice.ts     — rules, templates, audit log
    perfSlice.ts           — system metrics, monitoring toggle
    diffSlice.ts           — diff tabs, active tab, open/close/save
    viewSlice.ts           — viewMode, rightPanel, sidebar
```

**Slice pattern:**

```typescript
// slices/gitSlice.ts
import type { StateCreator } from "zustand";
import type { ZeusState } from "../types";

export interface GitSlice {
  gitStatus: Record<string, GitStatusData>;
  gitBranches: Record<string, GitBranchInfo[]>;
  gitErrors: Record<string, string>;
  gitWatcherConnected: Record<string, boolean>;
  gitNotARepo: Record<string, boolean>;
  gitPushing: Record<string, boolean>;
  gitPulling: Record<string, boolean>;

  startGitWatching: (sessionId: string, workingDir: string) => void;
  stopGitWatching: (sessionId: string) => void;
  refreshGitStatus: (sessionId: string) => void;
  stageFiles: (sessionId: string, files: string[]) => void;
  unstageFiles: (sessionId: string, files: string[]) => void;
  stageAll: (sessionId: string) => void;
  unstageAll: (sessionId: string) => void;
  discardFiles: (sessionId: string, files: string[]) => void;
  commitChanges: (sessionId: string, message: string) => void;
  initGitRepo: (sessionId: string, workingDir: string) => void;
  listBranches: (sessionId: string) => void;
  checkoutBranch: (sessionId: string, branch: string) => void;
  createBranch: (sessionId: string, branch: string, checkout?: boolean) => void;
  deleteBranch: (sessionId: string, branch: string, force?: boolean) => void;
  gitPush: (sessionId: string, force?: boolean) => void;
  gitPull: (sessionId: string) => void;
  gitFetch: (sessionId: string) => void;
}

export const createGitSlice: StateCreator<ZeusState, [], [], GitSlice> = (set, get) => ({
  gitStatus: {},
  gitBranches: {},
  gitErrors: {},
  gitWatcherConnected: {},
  gitNotARepo: {},
  gitPushing: {},
  gitPulling: {},

  startGitWatching: (sessionId, workingDir) => {
    get().send({ channel: "git", sessionId, payload: { type: "start_watching", workingDir } });
  },
  // ... all actions follow same pattern
});
```

**Root store composition:**

```typescript
// useZeusStore.ts
import { create } from "zustand";
import type { ZeusState } from "./types";
import { createConnectionSlice } from "./slices/connectionSlice";
import { createClaudeSlice } from "./slices/claudeSlice";
// ... all slice imports

export const useZeusStore = create<ZeusState>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createClaudeSlice(...a),
  ...createTerminalSlice(...a),
  ...createGitSlice(...a),
  ...createFileSlice(...a),
  ...createQaSlice(...a),
  ...createAndroidSlice(...a),
  ...createSubagentSlice(...a),
  ...createSettingsSlice(...a),
  ...createMcpSlice(...a),
  ...createTaskSlice(...a),
  ...createPermissionSlice(...a),
  ...createPerfSlice(...a),
  ...createDiffSlice(...a),
  ...createViewSlice(...a),
}));
```

**WS message dispatch:** `connectionSlice.ts` handles the WebSocket connection and routes incoming messages to `set()` calls that update the correct slice's state. This is the only slice that cross-references other slices' state keys.

**Selectors** live alongside each slice:

```typescript
// slices/claudeSlice.ts (bottom of file)
export const selectActiveEntries = (s: ZeusState) =>
  s.activeClaudeId ? (s.claudeEntries[s.activeClaudeId] ?? []) : [];

export const selectActiveActivity = (s: ZeusState) =>
  s.activeClaudeId ? (s.sessionActivity[s.activeClaudeId] ?? { state: "idle" }) : { state: "idle" };

export const selectActiveQueue = (s: ZeusState) =>
  s.activeClaudeId ? (s.messageQueue[s.activeClaudeId] ?? []) : [];
```

Components use selectors:

```typescript
const entries = useZeusStore(selectActiveEntries);
const activity = useZeusStore(selectActiveActivity);
```

---

### 5. Structured Logging — Global + Session-Level

Replace all `console.log/error/warn` with a structured logger supporting levels, service tags, file output, timing, and per-session log files.

**Location:** `src/main/log/`

```
src/main/log/
  log.ts          — Log namespace
```

**API:**

```typescript
export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

  export interface Logger {
    debug(message: string, extra?: Record<string, unknown>): void;
    info(message: string, extra?: Record<string, unknown>): void;
    warn(message: string, extra?: Record<string, unknown>): void;
    error(message: string, extra?: Record<string, unknown>): void;
    time(label: string, extra?: Record<string, unknown>): { stop(): void };
  }

  // Global logger — writes to zeus.log
  export function create(opts: { service: string }): Logger;

  // Session-scoped logger — writes to sessions/<sessionId>.log AND zeus.log
  export function forSession(opts: { service: string; sessionId: string }): Logger;

  // Initialize logging (call before anything else)
  export function init(opts: { level: Level; logDir: string }): void;

  // Read a session's log file (for UI display)
  export function getSessionLog(sessionId: string): string;

  // Cleanup old logs
  export function pruneSessionLogs(maxAgeDays: number): void;
}
```

**File layout:**

```
~/.zeus/logs/
  zeus.log                     — global log (all services, all sessions)
  sessions/
    abc123-def456.log          — per Claude session
    term-789xyz.log            — per terminal session
```

**Output formats:**

```
Dev (stderr):
14:32:01 INFO  [tunnel] started url=https://xyz.ngrok.app
14:32:03 ERROR [claude:abc123] process error message="exited with code 1" pid=12345

File (JSON lines):
{"ts":"2026-03-27T14:32:01Z","level":"INFO","service":"tunnel","msg":"started","url":"https://xyz.ngrok.app"}
{"ts":"2026-03-27T14:32:03Z","level":"ERROR","service":"claude","sessionId":"abc123","msg":"process error","message":"exited with code 1","pid":12345}
```

**Timing helper:**

```typescript
const log = Log.forSession({ service: "claude", sessionId });
const timer = log.time("spawn");
await session.start(prompt);
timer.stop();
// → INFO [claude:abc123] spawn duration=1432ms
```

**Bus integration:** Bus gets a log subscriber that logs all events at DEBUG level for free observability. A new `System.SessionLogEntry` bus event enables streaming session logs to the UI if needed.

---

### 6. PTY Buffer + Cursor Replay

Ring buffer per terminal session enables reconnect without losing output.

**Changes to:** `src/main/services/terminal.ts` (existing file, enhanced)

**Session state additions:**

```typescript
interface PtySession {
  pty: IPty;
  buffer: string;
  bufferCursor: number;   // absolute position where buffer starts (after trim)
  cursor: number;         // absolute position of latest byte written
}

const BUFFER_LIMIT = 2 * 1024 * 1024;  // 2MB ring buffer
```

**Buffer management on PTY output:**

```typescript
pty.onData((chunk) => {
  session.cursor += chunk.length;
  session.buffer += chunk;

  if (session.buffer.length > BUFFER_LIMIT) {
    const excess = session.buffer.length - BUFFER_LIMIT;
    session.buffer = session.buffer.slice(excess);
    session.bufferCursor += excess;
  }

  Bus.publish(TerminalEvents.Output, { sessionId, data: chunk });
});
```

**New `attach` message type:**

```typescript
// Client sends on connect/reconnect:
{ channel: "terminal", sessionId, payload: { type: "attach", cursor: 154832 } }

// Server replays missed data:
function handleAttach(ctx: HandlerContext, cursor: number) {
  const session = getSession(ctx.envelope.sessionId);
  const from = Math.max(cursor, session.bufferCursor);
  const offset = from - session.bufferCursor;
  const missed = session.buffer.slice(offset);

  ctx.send({
    channel: "terminal",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "replay", data: missed, cursor: session.cursor },
  });
}
```

**Client side** (`useTerminal.ts`): tracks `localCursor`, sends it on reconnect, writes replayed data to xterm.

---

### 7. WebSocket Reconnection + Heartbeat (Client)

Robust client-side connection handling for remote/tunnel use case.

**Location:** `src/renderer/src/lib/ws.ts` (rewrite)

```typescript
class ZeusWs {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 30_000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingBuffer: string[] = [];
  private missedPongs = 0;

  connect(): void { /* ... */ }

  private scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  private onOpen() {
    this.reconnectDelay = 1000;   // reset backoff
    this.flushBuffer();            // send queued messages
    this.startHeartbeat();         // ping every 30s
    this.missedPongs = 0;
  }

  private startHeartbeat() {
    this.pingInterval = setInterval(() => {
      this.missedPongs++;
      if (this.missedPongs >= 2) {
        this.ws?.close();          // force reconnect
        return;
      }
      this.rawSend({ channel: "status", sessionId: "", payload: { type: "ping" }, auth: "" });
    }, 30_000);
  }

  private onPong() {
    this.missedPongs = 0;
  }

  send(envelope: WsEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    } else {
      this.pendingBuffer.push(JSON.stringify(envelope));
    }
  }
}
```

Server `status` handler responds to `ping` with `pong`.

---

### 8. Typed WS Protocol with Zod

Full discriminated unions for every channel, validated at both ends.

**Location:** `src/shared/protocol/`

```
src/shared/protocol/
  envelope.ts       — WsEnvelope schema
  channels/
    claude.ts       — ClaudeIncoming / ClaudeOutgoing unions
    terminal.ts     — TerminalIncoming / TerminalOutgoing
    git.ts          — GitIncoming / GitOutgoing
    control.ts      — ControlIncoming / ControlOutgoing
    status.ts       — StatusIncoming / StatusOutgoing
    files.ts        — FilesIncoming / FilesOutgoing
    qa.ts           — QaIncoming / QaOutgoing
    subagent.ts     — SubagentIncoming / SubagentOutgoing
    settings.ts     — SettingsIncoming / SettingsOutgoing
    mcp.ts          — McpIncoming / McpOutgoing
    tasks.ts        — TasksIncoming / TasksOutgoing
    permissions.ts  — PermissionsIncoming / PermissionsOutgoing
    android.ts      — AndroidIncoming / AndroidOutgoing
    perf.ts         — PerfIncoming / PerfOutgoing
```

**Envelope schema:**

```typescript
// shared/protocol/envelope.ts
export const ChannelName = z.enum([
  "control", "terminal", "claude", "git", "files", "qa",
  "status", "settings", "subagent", "mcp", "permissions",
  "tasks", "android", "perf",
]);

export const WsEnvelopeSchema = z.object({
  channel: ChannelName,
  sessionId: z.string(),
  payload: z.unknown(),  // validated per-channel in handler
  auth: z.string(),
});
```

**Per-channel schema example:**

```typescript
// shared/protocol/channels/claude.ts
export const ClaudeIncoming = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    prompt: z.string(),
    workingDir: z.string(),
    sessionName: z.string().optional(),
    permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
    model: z.string().optional(),
    // ... all fields
  }),
  z.object({ type: z.literal("send_message"), content: z.string(), files: z.array(z.string()).optional() }),
  z.object({ type: z.literal("approve_tool"), approvalId: z.string(), updatedInput: z.unknown().optional() }),
  z.object({ type: z.literal("deny_tool"), approvalId: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("resume"), prompt: z.string().optional() }),
  z.object({ type: z.literal("queue_message"), content: z.string() }),
  z.object({ type: z.literal("edit_queued_message"), msgId: z.string(), content: z.string() }),
  z.object({ type: z.literal("remove_queued_message"), msgId: z.string() }),
  // ...
]);

export const ClaudeOutgoing = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entry"), entry: NormalizedEntrySchema }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("session_activity"), activity: SessionActivitySchema }),
  z.object({ type: z.literal("approval_needed"), approvalId: z.string(), toolName: z.string(), toolInput: z.unknown() }),
  z.object({ type: z.literal("queue_updated"), queue: z.array(z.object({ id: z.string(), content: z.string() })) }),
  // ...
]);
```

Handlers validate: `const payload = ClaudeIncoming.parse(ctx.envelope.payload);`
Client-side dispatch validates: `const payload = ClaudeOutgoing.parse(event.payload);`

The existing types in `src/shared/types.ts` remain but are now backed by Zod schemas. The discriminated union types (`SettingsPayload`, `GitPayload`, etc.) are replaced by the protocol schemas. Runtime types are inferred from Zod: `type ClaudeIncoming = z.infer<typeof ClaudeIncoming>`.

---

### 9. Service Lifecycle Manager

Ordered startup and shutdown with dependency resolution.

**Location:** `src/main/lifecycle.ts`

```typescript
interface Service {
  name: string;
  deps?: string[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const services: Service[] = [
  { name: "log",        deps: [],                start: initLog,            stop: async () => {} },
  { name: "db",         deps: ["log"],           start: initDatabase,       stop: closeDatabase },
  { name: "settings",   deps: ["db"],            start: initSettings,       stop: async () => {} },
  { name: "themes",     deps: ["db"],            start: loadAllThemes,      stop: async () => {} },
  { name: "bus",        deps: ["log"],           start: initBus,            stop: stopBus },
  { name: "claude-cli", deps: ["log"],           start: resolveClaudeBinary, stop: async () => {} },
  { name: "server",     deps: ["db", "bus"],     start: startServer,        stop: stopServer },
  { name: "tunnel",     deps: ["server"],        start: maybeStartTunnel,   stop: stopTunnel },
  { name: "recovery",   deps: ["db"],            start: recoverStaleState,  stop: async () => {} },
];

export async function bootAll(): Promise<void> {
  // Topological sort by deps, start in dependency order
  const sorted = topologicalSort(services);
  for (const service of sorted) {
    log.info("starting service", { name: service.name });
    await service.start();
  }
}

export async function shutdownAll(): Promise<void> {
  // Reverse order
  const sorted = topologicalSort(services).reverse();
  for (const service of sorted) {
    try {
      await service.stop();
    } catch (err) {
      log.error("service stop failed", { name: service.name, error: String(err) });
    }
  }
}
```

**`index.ts` simplifies to:**

```typescript
app.whenReady().then(async () => {
  await bootAll();
  createWindow();
});

app.on("before-quit", async () => {
  await shutdownAll();
});
```

---

### 10. Claude CLI Resolution + Stale WS Cleanup

**Claude CLI — resolve once at startup:**

**Location:** `src/main/services/claude-cli.ts`

```typescript
let claudeBinaryPath: string | null = null;

export async function resolveClaudeBinary(): Promise<void> {
  // 1. Try `which claude` (global install)
  // 2. Try npx --resolve @anthropic-ai/claude-code
  // 3. Try common paths (/usr/local/bin/claude, ~/.npm/bin/claude)
  // 4. Fallback: keep using npx
  // Cache in claudeBinaryPath
}

export function getClaudeBinary(): { command: string; args: string[] } {
  if (claudeBinaryPath) {
    return { command: claudeBinaryPath, args: [] };
  }
  return { command: "npx", args: ["-y", "@anthropic-ai/claude-code@latest"] };
}
```

`ClaudeSession.start()` uses `getClaudeBinary()` instead of hardcoded `npx`.

**Stale WS cleanup:**

**Location:** `src/main/server/server.ts`

```typescript
interface ClientState {
  terminalSessions: Set<string>;
  claudeSessions: Set<string>;
  pendingSubagentResponses: Map<string, string>;
}

const clientState = new WeakMap<WebSocket, ClientState>();

function initClientState(ws: WebSocket): ClientState {
  const state: ClientState = {
    terminalSessions: new Set(),
    claudeSessions: new Set(),
    pendingSubagentResponses: new Map(),
  };
  clientState.set(ws, state);
  return state;
}

ws.on("close", () => {
  const state = clientState.get(ws);
  if (!state) return;
  for (const [subagentId] of state.pendingSubagentResponses) {
    clearPendingSubagentResponse(subagentId);
  }
  // No need to delete from WeakMap — GC handles it
});
```

Handlers register their state via `clientState`:

```typescript
// handlers/subagent.ts
function startSubagent(ctx: HandlerContext, payload: SubagentStartPayload) {
  const state = clientState.get(ctx.ws);
  state?.pendingSubagentResponses.set(subagentId, responseId);
  // ...
}
```

---

## File Structure Summary

### New directories:

```
src/main/
  bus/
    event.ts
    bus.ts
    events/  (12 event definition files)
  server/
    server.ts
    router.ts
    handlers/  (14 handler files)
  db/
    client.ts
    transaction.ts
    schema/  (11 schema files)
    migrations/  (SQL files)
    queries/  (7 query files)
  log/
    log.ts
  lifecycle.ts
  services/
    claude-cli.ts  (new)
    ... (existing services remain, but stop importing websocket.ts)

src/renderer/src/stores/
  useZeusStore.ts  (rewritten, ~50 lines)
  types.ts
  slices/  (15 slice files)

src/shared/
  protocol/
    envelope.ts
    channels/  (14 channel schema files)
  types.ts  (remains, but payload types replaced by protocol schemas)
```

### Deleted files:

```
src/main/services/websocket.ts  — replaced by server/ + bus/
src/main/services/db.ts         — replaced by db/
```

### Unchanged files:

All component files (`ClaudeView.tsx`, `SessionSidebar.tsx`, etc.) keep their structure. They just import selectors from slices instead of inlining derived state. Service files (`claude-session.ts`, `git.ts`, `terminal.ts`, `power.ts`, `tunnel.ts`, etc.) keep their structure but switch from `broadcastEnvelope()` to `Bus.publish()` and from raw SQL to Drizzle queries.

---

## Migration Strategy

1. **Database:** No data migration. Table shapes are identical. Migration `0001_init` contains the full current schema. Existing DBs skip it via migration marker.
2. **WebSocket protocol:** Envelope shape `{ channel, sessionId, payload, auth }` is unchanged. Payload structures are unchanged. Zod schemas codify what already exists — no protocol break.
3. **Store:** State shape is identical (same keys, same types). Slices just split the code, not the data.
4. **Tests:** Existing tests update imports but logic stays the same. New tests added for bus, lifecycle, and transaction context.

## Verification

After implementation, the following must pass:

```bash
npm run typecheck     # tsc --noEmit for main + renderer
npm run test          # all existing tests pass
npm run validate      # validator tests (67+) pass
npm run build         # full production build succeeds
```

Manual verification: start dev server, create a Claude session, send a message, approve a tool, check git panel, open terminal — all features work identically to before.
