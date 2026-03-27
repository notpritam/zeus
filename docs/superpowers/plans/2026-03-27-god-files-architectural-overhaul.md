# God Files Architectural Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split three monolithic files (websocket.ts 3954 LOC, useZeusStore.ts 3399 LOC, db.ts 1572 LOC) into domain-based modules with an event bus, Drizzle ORM, Zustand slices, structured logging, typed protocol, and supporting infrastructure.

**Architecture:** Internal event bus decouples services from transport. WebSocket server becomes a thin router dispatching to domain handlers. Database moves to Drizzle ORM with typed schema. Frontend store splits into composable Zustand slices. All WS payloads validated with Zod at boundaries.

**Tech Stack:** Electron + electron-vite, better-sqlite3 + drizzle-orm, Zustand slices, Zod, node-pty, ws

**Spec:** `docs/superpowers/specs/2026-03-27-god-files-architectural-overhaul-design.md`

---

## File Structure

### New files to create:

```
# Infrastructure
src/main/log/log.ts                              — Structured logger (global + session-scoped)
src/main/bus/event.ts                             — BusEvent.define() typed event registry
src/main/bus/bus.ts                               — Bus.publish(), subscribe(), subscribeAll()
src/main/bus/events/claude.ts                     — Claude domain events
src/main/bus/events/terminal.ts                   — Terminal domain events
src/main/bus/events/git.ts                        — Git domain events
src/main/bus/events/qa.ts                         — QA/PinchTab domain events
src/main/bus/events/subagent.ts                   — Subagent domain events
src/main/bus/events/settings.ts                   — Settings/theme domain events
src/main/bus/events/mcp.ts                        — MCP server domain events
src/main/bus/events/tasks.ts                      — Task domain events
src/main/bus/events/permissions.ts                — Permission domain events
src/main/bus/events/android.ts                    — Android QA domain events
src/main/bus/events/files.ts                      — Files domain events
src/main/bus/events/perf.ts                       — Performance monitoring events
src/main/bus/events/system.ts                     — System-level events (status, error, ping/pong)
src/main/lifecycle.ts                             — Service lifecycle manager (boot/shutdown ordering)
src/main/services/claude-cli.ts                   — Claude CLI binary resolution

# Database (Drizzle)
src/main/db/client.ts                             — Drizzle client init, pragmas, close
src/main/db/transaction.ts                        — AsyncLocalStorage transaction context
src/main/db/schema/index.ts                       — Re-export all table schemas
src/main/db/schema/claude-sessions.sql.ts         — claude_sessions table
src/main/db/schema/claude-entries.sql.ts          — claude_entries table
src/main/db/schema/terminal-sessions.sql.ts       — terminal_sessions table
src/main/db/schema/subagent-sessions.sql.ts       — subagent_sessions table
src/main/db/schema/subagent-entries.sql.ts        — subagent_entries table
src/main/db/schema/saved-projects.sql.ts          — saved_projects table
src/main/db/schema/mcp-servers.sql.ts             — mcp_servers + mcp_profiles + session_mcps tables
src/main/db/schema/permission-rules.sql.ts        — permission_rules + audit_log tables
src/main/db/schema/tasks.sql.ts                   — tasks table
src/main/db/migrations/0001_init/migration.sql    — Full current schema
src/main/db/queries/claude.ts                     — Claude session + entry queries
src/main/db/queries/terminal.ts                   — Terminal session queries
src/main/db/queries/subagent.ts                   — Subagent session + entry queries
src/main/db/queries/settings.ts                   — Saved projects queries
src/main/db/queries/mcp.ts                        — MCP server/profile queries
src/main/db/queries/permissions.ts                — Permission rules + audit queries
src/main/db/queries/tasks.ts                      — Task queries

# Server (WebSocket handlers)
src/main/server/server.ts                         — HTTP server, WS upgrade, static serving
src/main/server/router.ts                         — Envelope parse + channel dispatch
src/main/server/handlers/control.ts               — Terminal session lifecycle
src/main/server/handlers/terminal.ts              — Terminal I/O (input/resize/attach)
src/main/server/handlers/status.ts                — Power, tunnel, ping/pong
src/main/server/handlers/claude.ts                — Claude session management
src/main/server/handlers/git.ts                   — Git watcher + operations
src/main/server/handlers/files.ts                 — File tree + read/save
src/main/server/handlers/qa.ts                    — PinchTab/QA browser
src/main/server/handlers/subagent.ts              — Subagent lifecycle
src/main/server/handlers/settings.ts              — Settings + themes
src/main/server/handlers/mcp.ts                   — MCP server management
src/main/server/handlers/tasks.ts                 — Task management
src/main/server/handlers/permissions.ts           — Permission rules + audit
src/main/server/handlers/android.ts               — Android QA
src/main/server/handlers/perf.ts                  — Performance monitoring

# Typed Protocol (shared)
src/shared/protocol/envelope.ts                   — WsEnvelope Zod schema
src/shared/protocol/channels/control.ts           — Control channel schemas
src/shared/protocol/channels/terminal.ts          — Terminal channel schemas
src/shared/protocol/channels/status.ts            — Status channel schemas
src/shared/protocol/channels/claude.ts            — Claude channel schemas
src/shared/protocol/channels/git.ts               — Git channel schemas
src/shared/protocol/channels/files.ts             — Files channel schemas
src/shared/protocol/channels/qa.ts                — QA channel schemas
src/shared/protocol/channels/subagent.ts          — Subagent channel schemas
src/shared/protocol/channels/settings.ts          — Settings channel schemas
src/shared/protocol/channels/mcp.ts               — MCP channel schemas
src/shared/protocol/channels/tasks.ts             — Tasks channel schemas
src/shared/protocol/channels/permissions.ts       — Permissions channel schemas
src/shared/protocol/channels/android.ts           — Android channel schemas
src/shared/protocol/channels/perf.ts              — Perf channel schemas

# Zustand Slices (renderer)
src/renderer/src/stores/types.ts                  — ZeusState aggregate type
src/renderer/src/stores/slices/connectionSlice.ts — WS connection + message dispatch
src/renderer/src/stores/slices/claudeSlice.ts     — Claude sessions, entries, approvals, queue
src/renderer/src/stores/slices/terminalSlice.ts   — Terminal sessions, session terminal panels
src/renderer/src/stores/slices/gitSlice.ts        — Git status, branches, operations
src/renderer/src/stores/slices/fileSlice.ts       — File tree, read/save
src/renderer/src/stores/slices/qaSlice.ts         — PinchTab state
src/renderer/src/stores/slices/androidSlice.ts    — Android QA state
src/renderer/src/stores/slices/subagentSlice.ts   — Subagent sessions + entries
src/renderer/src/stores/slices/settingsSlice.ts   — Projects, defaults, themes
src/renderer/src/stores/slices/mcpSlice.ts        — MCP servers, profiles
src/renderer/src/stores/slices/taskSlice.ts       — Tasks state
src/renderer/src/stores/slices/permissionSlice.ts — Permission rules, audit
src/renderer/src/stores/slices/perfSlice.ts       — Performance metrics
src/renderer/src/stores/slices/diffSlice.ts       — Diff tabs
src/renderer/src/stores/slices/viewSlice.ts       — View mode, panels, sidebar

# WebSocket client (rewrite)
src/renderer/src/lib/ws.ts                        — Rewrite with reconnection + heartbeat + buffer
```

### Files to delete after migration:

```
src/main/services/websocket.ts    — replaced by src/main/server/ + src/main/bus/
src/main/services/db.ts           — replaced by src/main/db/
```

### Files to modify:

```
src/main/index.ts                 — Use lifecycle.ts bootAll/shutdownAll
src/main/services/claude-session.ts — Use getClaudeBinary(), Bus.publish() for events
src/main/services/terminal.ts     — Add PTY buffer/cursor, use Bus.publish()
src/main/services/sessions.ts     — Minor: may need import updates
src/main/services/git.ts          — Use Bus.publish() instead of callbacks
src/main/services/file-tree.ts    — Use Bus.publish() instead of callbacks
src/main/services/qa.ts           — No WS imports, return values only
src/main/services/android-qa.ts   — No WS imports, return values only
src/main/services/system-monitor.ts — Use Bus.publish() for metrics
src/main/services/settings.ts     — Import from new db/queries/settings.ts
src/main/services/tunnel.ts       — Minor: import updates
src/main/services/power.ts        — Minor: import updates
src/main/types.ts                 — Remove payload types (moved to protocol/)
src/shared/types.ts               — Remove payload union types (moved to protocol/)
src/renderer/src/stores/useZeusStore.ts — Rewrite as slice composer (~50 lines)
src/renderer/src/App.tsx           — Import selectors from slices
src/renderer/src/components/ClaudeView.tsx — Import selectors
src/renderer/src/components/*.tsx  — Update store imports where using derived state
electron.vite.config.ts           — No changes needed (entry points unchanged)
package.json                      — Add drizzle-orm, drizzle-kit dependencies
```

---

## Task Dependency Order

Tasks must be executed in this order because of build dependencies:

```
Task 1 (deps) → Task 2 (log) → Task 3 (bus) → Task 4 (protocol) → Task 5 (db)
  → Task 6 (lifecycle) → Task 7 (claude-cli) → Task 8 (server+handlers)
  → Task 9 (terminal buffer) → Task 10 (ws client) → Task 11 (store slices)
  → Task 12 (update components) → Task 13 (cleanup) → Task 14 (verify)
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Drizzle ORM and Zod**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm install drizzle-orm zod
npm install -D drizzle-kit
```

- [ ] **Step 2: Verify install**

```bash
npm ls drizzle-orm zod drizzle-kit
```

Expected: all three listed without errors.

- [ ] **Step 3: Verify existing build still works**

```bash
npm run typecheck
```

Expected: PASS (no regressions from adding deps)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add drizzle-orm, zod, drizzle-kit dependencies"
```

---

### Task 2: Structured Logging

**Files:**
- Create: `src/main/log/log.ts`

- [ ] **Step 1: Create the Log namespace**

```typescript
// src/main/log/log.ts
import path from "path";
import fs from "fs";

export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

  export interface Logger {
    debug(message: string, extra?: Record<string, unknown>): void;
    info(message: string, extra?: Record<string, unknown>): void;
    warn(message: string, extra?: Record<string, unknown>): void;
    error(message: string, extra?: Record<string, unknown>): void;
    time(label: string, extra?: Record<string, unknown>): { stop(): void };
  }

  const levelPriority: Record<Level, number> = {
    DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3,
  };

  let currentLevel: Level = "INFO";
  let logDir = "";
  let globalStream: fs.WriteStream | null = null;
  const sessionStreams = new Map<string, fs.WriteStream>();

  export function init(opts: { level: Level; logDir: string }): void {
    currentLevel = opts.level;
    logDir = opts.logDir;
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(path.join(logDir, "sessions"), { recursive: true });
    globalStream = fs.createWriteStream(path.join(logDir, "zeus.log"), { flags: "a" });
  }

  export function close(): void {
    globalStream?.close();
    globalStream = null;
    for (const stream of sessionStreams.values()) {
      stream.close();
    }
    sessionStreams.clear();
  }

  function shouldLog(level: Level): boolean {
    return levelPriority[level] >= levelPriority[currentLevel];
  }

  function formatDev(ts: string, level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): string {
    const tag = sessionId ? `${service}:${sessionId.slice(0, 8)}` : service;
    const extraStr = extra ? " " + Object.entries(extra).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
    return `${ts.slice(11, 19)} ${level.padEnd(5)} [${tag}] ${message}${extraStr}`;
  }

  function formatJson(ts: string, level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): string {
    const obj: Record<string, unknown> = { ts, level, service, msg: message };
    if (sessionId) obj.sessionId = sessionId;
    if (extra) Object.assign(obj, extra);
    return JSON.stringify(obj);
  }

  function write(level: Level, service: string, sessionId: string | undefined, message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const ts = new Date().toISOString();
    const dev = formatDev(ts, level, service, sessionId, message, extra);
    const json = formatJson(ts, level, service, sessionId, message, extra);

    // Dev output to stderr
    process.stderr.write(dev + "\n");

    // JSON to global log file
    globalStream?.write(json + "\n");

    // JSON to session log file (if session-scoped)
    if (sessionId) {
      let stream = sessionStreams.get(sessionId);
      if (!stream) {
        const filePath = path.join(logDir, "sessions", `${sessionId}.log`);
        stream = fs.createWriteStream(filePath, { flags: "a" });
        sessionStreams.set(sessionId, stream);
      }
      stream.write(json + "\n");
    }
  }

  function makeLogger(service: string, sessionId?: string): Logger {
    return {
      debug: (msg, extra) => write("DEBUG", service, sessionId, msg, extra),
      info: (msg, extra) => write("INFO", service, sessionId, msg, extra),
      warn: (msg, extra) => write("WARN", service, sessionId, msg, extra),
      error: (msg, extra) => write("ERROR", service, sessionId, msg, extra),
      time(label, extra) {
        const start = Date.now();
        return {
          stop: () => {
            const duration = Date.now() - start;
            write("INFO", service, sessionId, label, { ...extra, duration: `${duration}ms` });
          },
        };
      },
    };
  }

  export function create(opts: { service: string }): Logger {
    return makeLogger(opts.service);
  }

  export function forSession(opts: { service: string; sessionId: string }): Logger {
    return makeLogger(opts.service, opts.sessionId);
  }

  export function getSessionLog(sessionId: string): string {
    const filePath = path.join(logDir, "sessions", `${sessionId}.log`);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  export function pruneSessionLogs(maxAgeDays: number): void {
    const sessionsDir = path.join(logDir, "sessions");
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    try {
      for (const file of fs.readdirSync(sessionsDir)) {
        const filePath = path.join(sessionsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/log/log.ts
git commit -m "feat: add structured logging with global + session-level support"
```

---

### Task 3: Event Bus

**Files:**
- Create: `src/main/bus/event.ts`
- Create: `src/main/bus/bus.ts`
- Create: `src/main/bus/events/claude.ts`
- Create: `src/main/bus/events/terminal.ts`
- Create: `src/main/bus/events/git.ts`
- Create: `src/main/bus/events/qa.ts`
- Create: `src/main/bus/events/subagent.ts`
- Create: `src/main/bus/events/settings.ts`
- Create: `src/main/bus/events/mcp.ts`
- Create: `src/main/bus/events/tasks.ts`
- Create: `src/main/bus/events/permissions.ts`
- Create: `src/main/bus/events/android.ts`
- Create: `src/main/bus/events/files.ts`
- Create: `src/main/bus/events/perf.ts`
- Create: `src/main/bus/events/system.ts`

- [ ] **Step 1: Create BusEvent registry**

```typescript
// src/main/bus/event.ts
import type { ZodType } from "zod";

export namespace BusEvent {
  export interface Definition<Type extends string = string, Props extends ZodType = ZodType> {
    type: Type;
    properties: Props;
  }

  const registry = new Map<string, Definition>();

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
  ): { type: Type; properties: Properties } {
    const result = { type, properties };
    registry.set(type, result);
    return result;
  }

  export function all(): Map<string, Definition> {
    return new Map(registry);
  }
}
```

- [ ] **Step 2: Create Bus pub/sub**

```typescript
// src/main/bus/bus.ts
import type { BusEvent } from "./event";
import type z from "zod";
import { Log } from "../log/log";

export namespace Bus {
  const log = Log.create({ service: "bus" });

  type Subscription = (event: { type: string; properties: unknown }) => void | Promise<void>;
  const subscriptions = new Map<string, Subscription[]>();

  export function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ): void {
    const payload = { type: def.type, properties };
    for (const key of [def.type, "*"]) {
      const subs = subscriptions.get(key);
      if (!subs) continue;
      for (const sub of [...subs]) {
        try {
          sub(payload);
        } catch (err) {
          log.error("subscriber error", { type: def.type, error: String(err) });
        }
      }
    }
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => void,
  ): () => void {
    return raw(def.type, callback);
  }

  export function subscribeAll(callback: Subscription): () => void {
    return raw("*", callback);
  }

  function raw(type: string, callback: Subscription): () => void {
    let subs = subscriptions.get(type);
    if (!subs) {
      subs = [];
      subscriptions.set(type, subs);
    }
    subs.push(callback);

    return () => {
      const list = subscriptions.get(type);
      if (!list) return;
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  export function reset(): void {
    subscriptions.clear();
  }
}
```

- [ ] **Step 3: Create all domain event definition files**

Create each file in `src/main/bus/events/`. Every event definition imports `z` from `zod` and `BusEvent` from `../event`. Each exports a namespace with event definitions.

The events must cover every `broadcastEnvelope()` call currently in `websocket.ts`. Here are the key events per domain — create all 14 files with these definitions:

**`src/main/bus/events/claude.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const ClaudeEvents = {
  EntryAdded: BusEvent.define("claude.entry.added", z.object({
    sessionId: z.string(),
    entry: z.unknown(), // NormalizedEntry — validated elsewhere
  })),
  SessionStarted: BusEvent.define("claude.session.started", z.object({
    sessionId: z.string(),
    info: z.unknown(),
  })),
  SessionActivity: BusEvent.define("claude.session.activity", z.object({
    sessionId: z.string(),
    activity: z.unknown(),
  })),
  ApprovalNeeded: BusEvent.define("claude.approval.needed", z.object({
    sessionId: z.string(),
    approvalId: z.string(),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
    toolUseId: z.string().optional(),
  })),
  ApprovalResolved: BusEvent.define("claude.approval.resolved", z.object({
    sessionId: z.string(),
    approvalId: z.string(),
  })),
  ClaudeSessionId: BusEvent.define("claude.session.claude_id", z.object({
    sessionId: z.string(),
    claudeSessionId: z.string(),
  })),
  TurnComplete: BusEvent.define("claude.turn.complete", z.object({
    sessionId: z.string(),
    result: z.unknown(),
  })),
  Done: BusEvent.define("claude.done", z.object({
    sessionId: z.string(),
  })),
  Error: BusEvent.define("claude.error", z.object({
    sessionId: z.string(),
    message: z.string(),
  })),
  QueueUpdated: BusEvent.define("claude.queue.updated", z.object({
    sessionId: z.string(),
    queue: z.array(z.object({ id: z.string(), content: z.string() })),
  })),
  QueueDrained: BusEvent.define("claude.queue.drained", z.object({
    sessionId: z.string(),
    msgId: z.string(),
  })),
  SessionList: BusEvent.define("claude.session.list", z.object({
    sessions: z.unknown(),
  })),
  SessionUpdated: BusEvent.define("claude.session.updated", z.object({
    sessionId: z.string(),
    info: z.unknown(),
  })),
  SessionDeleted: BusEvent.define("claude.session.deleted", z.object({
    deletedId: z.string(),
  })),
  SessionRestored: BusEvent.define("claude.session.restored", z.object({
    sessionId: z.string(),
  })),
  SessionArchived: BusEvent.define("claude.session.archived", z.object({
    archivedId: z.string(),
  })),
  PermissionAutoResolved: BusEvent.define("claude.permission.auto_resolved", z.object({
    sessionId: z.string(),
    toolName: z.string(),
    pattern: z.string(),
    action: z.string(),
  })),
  EntriesPaginated: BusEvent.define("claude.entries.paginated", z.object({
    sessionId: z.string(),
    entries: z.unknown(),
    oldestSeq: z.number().nullable(),
    totalCount: z.number(),
    hasMore: z.boolean(),
  })),
  HistoryCleared: BusEvent.define("claude.history.cleared", z.object({
    sessionId: z.string(),
  })),
  DeletedSessionsList: BusEvent.define("claude.deleted_sessions.list", z.object({
    sessions: z.unknown(),
  })),
};
```

**`src/main/bus/events/terminal.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const TerminalEvents = {
  Output: BusEvent.define("terminal.output", z.object({
    sessionId: z.string(),
    data: z.string(),
  })),
  Exit: BusEvent.define("terminal.exit", z.object({
    sessionId: z.string(),
    code: z.number().nullable(),
  })),
  Replay: BusEvent.define("terminal.replay", z.object({
    sessionId: z.string(),
    data: z.string(),
    cursor: z.number(),
  })),
};
```

**`src/main/bus/events/git.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const GitEvents = {
  Connected: BusEvent.define("git.connected", z.object({ sessionId: z.string() })),
  Disconnected: BusEvent.define("git.disconnected", z.object({ sessionId: z.string() })),
  Status: BusEvent.define("git.status", z.object({ sessionId: z.string(), data: z.unknown() })),
  Error: BusEvent.define("git.error", z.object({ sessionId: z.string(), message: z.string() })),
  NotARepo: BusEvent.define("git.not_a_repo", z.object({ sessionId: z.string() })),
  FileContentsResult: BusEvent.define("git.file_contents_result", z.object({
    sessionId: z.string(), file: z.string(), staged: z.boolean(),
    original: z.string(), modified: z.string(), language: z.string(),
  })),
  FileContentsError: BusEvent.define("git.file_contents_error", z.object({
    sessionId: z.string(), file: z.string(), error: z.string(),
  })),
  CommitResult: BusEvent.define("git.commit_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(), commitHash: z.string().optional(),
  })),
  SaveFileResult: BusEvent.define("git.save_file_result", z.object({
    sessionId: z.string(), file: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  BranchesResult: BusEvent.define("git.branches_result", z.object({ sessionId: z.string(), branches: z.unknown() })),
  CheckoutResult: BusEvent.define("git.checkout_result", z.object({
    sessionId: z.string(), success: z.boolean(), branch: z.string().optional(), error: z.string().optional(),
  })),
  CreateBranchResult: BusEvent.define("git.create_branch_result", z.object({
    sessionId: z.string(), success: z.boolean(), branch: z.string().optional(), error: z.string().optional(),
  })),
  DeleteBranchResult: BusEvent.define("git.delete_branch_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  PushResult: BusEvent.define("git.push_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  PullResult: BusEvent.define("git.pull_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  FetchResult: BusEvent.define("git.fetch_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  InitResult: BusEvent.define("git.init_result", z.object({
    sessionId: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
};
```

**`src/main/bus/events/system.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const SystemEvents = {
  StatusUpdate: BusEvent.define("system.status_update", z.object({
    powerBlock: z.boolean(),
    websocket: z.boolean(),
    tunnel: z.string().nullable(),
  })),
  Error: BusEvent.define("system.error", z.object({
    sessionId: z.string(),
    message: z.string(),
  })),
  Pong: BusEvent.define("system.pong", z.object({})),
  SessionUpdated: BusEvent.define("system.session_updated", z.object({
    sessionId: z.string(),
    session: z.unknown(),
  })),
  SessionStarted: BusEvent.define("system.session_started", z.object({
    sessionId: z.string(),
    shell: z.string(),
    correlationId: z.string().optional(),
  })),
  SessionList: BusEvent.define("system.session_list", z.object({
    sessions: z.unknown(),
  })),
  TerminalSessionDeleted: BusEvent.define("system.terminal_session.deleted", z.object({
    deletedId: z.string(),
  })),
  TerminalSessionRestored: BusEvent.define("system.terminal_session.restored", z.object({
    sessionId: z.string(),
  })),
  TerminalSessionArchived: BusEvent.define("system.terminal_session.archived", z.object({
    archivedId: z.string(),
  })),
};
```

**`src/main/bus/events/qa.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const QaEvents = {
  Started: BusEvent.define("qa.started", z.object({})),
  Stopped: BusEvent.define("qa.stopped", z.object({})),
  InstanceList: BusEvent.define("qa.instance_list", z.object({ instances: z.unknown() })),
  SnapshotResult: BusEvent.define("qa.snapshot_result", z.object({ nodes: z.unknown(), raw: z.string().nullable() })),
  ScreenshotResult: BusEvent.define("qa.screenshot_result", z.object({ dataUrl: z.string() })),
  TextResult: BusEvent.define("qa.text_result", z.object({ text: z.string() })),
  NavigateResult: BusEvent.define("qa.navigate_result", z.object({ url: z.string(), title: z.string() })),
  ActionResult: BusEvent.define("qa.action_result", z.object({ success: z.boolean(), message: z.string().optional() })),
  TabsList: BusEvent.define("qa.tabs_list", z.object({ tabs: z.unknown() })),
  Error: BusEvent.define("qa.error", z.object({ message: z.string() })),
  ConsoleLogs: BusEvent.define("qa.console_logs", z.object({ logs: z.unknown() })),
  NetworkRequests: BusEvent.define("qa.network_requests", z.object({ requests: z.unknown() })),
  JsErrors: BusEvent.define("qa.js_errors", z.object({ errors: z.unknown() })),
  UrlDetectionResult: BusEvent.define("qa.url_detection_result", z.object({
    sessionId: z.string(), qaTargetUrl: z.string().nullable(), source: z.string(),
    detail: z.string(), framework: z.string().optional(), verification: z.string().optional(),
  })),
};
```

**`src/main/bus/events/subagent.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const SubagentEvents = {
  Started: BusEvent.define("subagent.started", z.object({ parentSessionId: z.string(), info: z.unknown() })),
  Stopped: BusEvent.define("subagent.stopped", z.object({ parentSessionId: z.string(), subagentId: z.string() })),
  Entry: BusEvent.define("subagent.entry", z.object({ parentSessionId: z.string(), subagentId: z.string(), entry: z.unknown() })),
  Activity: BusEvent.define("subagent.activity", z.object({ parentSessionId: z.string(), subagentId: z.string(), activity: z.unknown() })),
  List: BusEvent.define("subagent.list", z.object({ parentSessionId: z.string(), agents: z.unknown() })),
  EntriesList: BusEvent.define("subagent.entries_list", z.object({ subagentId: z.string(), entries: z.unknown() })),
  Deleted: BusEvent.define("subagent.deleted", z.object({ parentSessionId: z.string(), subagentId: z.string() })),
  Cleared: BusEvent.define("subagent.cleared", z.object({ subagentId: z.string() })),
  QaFlowsList: BusEvent.define("subagent.qa_flows_list", z.object({ flows: z.unknown() })),
  MarkdownFilesList: BusEvent.define("subagent.markdown_files_list", z.object({ sessionId: z.string(), files: z.unknown() })),
};
```

**`src/main/bus/events/settings.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const SettingsEvents = {
  Updated: BusEvent.define("settings.updated", z.object({ settings: z.unknown() })),
  Error: BusEvent.define("settings.error", z.object({ message: z.string() })),
  ThemeColors: BusEvent.define("settings.theme_colors", z.object({ theme: z.unknown() })),
};
```

**`src/main/bus/events/mcp.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const McpEvents = {
  ServerList: BusEvent.define("mcp.server_list", z.object({ servers: z.unknown() })),
  ServerAdded: BusEvent.define("mcp.server_added", z.object({ server: z.unknown() })),
  ServerUpdated: BusEvent.define("mcp.server_updated", z.object({ server: z.unknown() })),
  ServerRemoved: BusEvent.define("mcp.server_removed", z.object({ id: z.string() })),
  HealthResult: BusEvent.define("mcp.health_result", z.object({ results: z.unknown() })),
  ProfileList: BusEvent.define("mcp.profile_list", z.object({ profiles: z.unknown() })),
  ProfileAdded: BusEvent.define("mcp.profile_added", z.object({ profile: z.unknown() })),
  ProfileUpdated: BusEvent.define("mcp.profile_updated", z.object({ profile: z.unknown() })),
  ProfileRemoved: BusEvent.define("mcp.profile_removed", z.object({ id: z.string() })),
  SessionMcpList: BusEvent.define("mcp.session_mcp_list", z.object({ sessionId: z.string(), mcps: z.unknown() })),
  ImportResult: BusEvent.define("mcp.import_result", z.object({ imported: z.array(z.string()), skipped: z.array(z.string()) })),
  Error: BusEvent.define("mcp.error", z.object({ message: z.string() })),
};
```

**`src/main/bus/events/tasks.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const TaskEvents = {
  List: BusEvent.define("task.list", z.object({ tasks: z.unknown() })),
  Created: BusEvent.define("task.created", z.object({ task: z.unknown() })),
  Updated: BusEvent.define("task.updated", z.object({ task: z.unknown() })),
  Deleted: BusEvent.define("task.deleted", z.object({ taskId: z.string() })),
  DiffResult: BusEvent.define("task.diff_result", z.object({ taskId: z.string(), diff: z.string() })),
  Error: BusEvent.define("task.error", z.object({ message: z.string() })),
};
```

**`src/main/bus/events/permissions.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const PermissionEvents = {
  RulesUpdated: BusEvent.define("permission.rules_updated", z.object({ projectId: z.string(), rules: z.unknown() })),
  TemplateList: BusEvent.define("permission.template_list", z.object({ templates: z.unknown() })),
  AuditLog: BusEvent.define("permission.audit_log", z.object({
    sessionId: z.string(), entries: z.unknown(), total: z.number(),
  })),
  Error: BusEvent.define("permission.error", z.object({ message: z.string() })),
};
```

**`src/main/bus/events/android.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const AndroidEvents = {
  Started: BusEvent.define("android.started", z.object({})),
  Stopped: BusEvent.define("android.stopped", z.object({})),
  DeviceList: BusEvent.define("android.device_list", z.object({ devices: z.unknown(), avds: z.unknown() })),
  Screenshot: BusEvent.define("android.screenshot", z.object({ dataUrl: z.string() })),
  ViewHierarchy: BusEvent.define("android.view_hierarchy", z.object({ nodes: z.unknown() })),
  Logcat: BusEvent.define("android.logcat", z.object({ entries: z.unknown() })),
  Error: BusEvent.define("android.error", z.object({ message: z.string() })),
  AppInstalled: BusEvent.define("android.app_installed", z.object({ success: z.boolean() })),
  AppLaunched: BusEvent.define("android.app_launched", z.object({ success: z.boolean() })),
};
```

**`src/main/bus/events/perf.ts`:**
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const PerfEvents = {
  MetricsUpdated: BusEvent.define("perf.metrics_updated", z.object({ metrics: z.unknown() })),
  MonitoringStarted: BusEvent.define("perf.monitoring_started", z.object({})),
  MonitoringStopped: BusEvent.define("perf.monitoring_stopped", z.object({})),
};
```

**`src/main/bus/events/files.ts`** (create this too):
```typescript
import z from "zod";
import { BusEvent } from "../event";

export const FilesEvents = {
  Connected: BusEvent.define("files.connected", z.object({ sessionId: z.string() })),
  DirectoryListing: BusEvent.define("files.directory_listing", z.object({
    sessionId: z.string(), dirPath: z.string(), entries: z.unknown(),
  })),
  ReadFileResult: BusEvent.define("files.read_file_result", z.object({
    sessionId: z.string(), filePath: z.string(), content: z.string(), language: z.string(),
  })),
  ReadFileError: BusEvent.define("files.read_file_error", z.object({
    sessionId: z.string(), filePath: z.string(), error: z.string(),
  })),
  SaveFileResult: BusEvent.define("files.save_file_result", z.object({
    sessionId: z.string(), filePath: z.string(), success: z.boolean(), error: z.string().optional(),
  })),
  FilesChanged: BusEvent.define("files.changed", z.object({
    sessionId: z.string(), directories: z.array(z.string()),
  })),
  SearchResult: BusEvent.define("files.search_result", z.object({
    sessionId: z.string(), query: z.string(), results: z.unknown(),
  })),
  ScanResult: BusEvent.define("files.scan_result", z.object({
    sessionId: z.string(), ext: z.string(), results: z.unknown(),
  })),
  Error: BusEvent.define("files.error", z.object({ sessionId: z.string(), message: z.string() })),
};
```

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/bus/
git commit -m "feat: add typed event bus with domain event definitions"
```

---

### Task 4: Typed WS Protocol Schemas

**Files:**
- Create: `src/shared/protocol/envelope.ts`
- Create: `src/shared/protocol/channels/*.ts` (14 files)

This task creates Zod schemas for all WebSocket payloads. These are derived from the existing TypeScript types in `src/shared/types.ts` and `src/main/types.ts`.

- [ ] **Step 1: Create envelope schema**

```typescript
// src/shared/protocol/envelope.ts
import z from "zod";

export const ChannelName = z.enum([
  "control", "terminal", "claude", "git", "files", "qa",
  "status", "settings", "subagent", "mcp", "permissions",
  "tasks", "android", "perf",
]);
export type ChannelName = z.infer<typeof ChannelName>;

export const WsEnvelopeSchema = z.object({
  channel: ChannelName,
  sessionId: z.string(),
  payload: z.unknown(),
  auth: z.string(),
});
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;
```

- [ ] **Step 2: Create channel schemas for each domain**

Create each file in `src/shared/protocol/channels/`. Each file exports `Incoming` (client→server) and `Outgoing` (server→client) discriminated unions. Extract the exact payload shapes from the current `handleXxx` functions in `websocket.ts` and the existing types in `src/shared/types.ts` and `src/main/types.ts`.

Key approach: read each `handleXxx` function in `websocket.ts`, identify every `payload.type` case, and create a Zod schema variant for it. Do the same for every `broadcastEnvelope`/`sendEnvelope` call to build the Outgoing schemas.

This is mechanical extraction — the shapes already exist in code, they just need Zod wrappers. Start with the simpler channels (status, perf, terminal) then do the complex ones (claude, subagent, git).

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS (shared/ is included in both tsconfigs)

- [ ] **Step 4: Commit**

```bash
git add src/shared/protocol/
git commit -m "feat: add Zod protocol schemas for all WS channels"
```

---

### Task 5: Database Layer — Drizzle ORM

**Files:**
- Create: `src/main/db/client.ts`
- Create: `src/main/db/transaction.ts`
- Create: `src/main/db/schema/*.sql.ts` (9 files)
- Create: `src/main/db/schema/index.ts`
- Create: `src/main/db/migrations/0001_init/migration.sql`
- Create: `src/main/db/queries/*.ts` (7 files)

- [ ] **Step 1: Create Drizzle client**

```typescript
// src/main/db/client.ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { Log } from "../log/log";
import path from "path";

const log = Log.create({ service: "db" });

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function initDatabase(dbPath: string): void {
  log.info("opening database", { path: dbPath });

  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -64000");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });

  // Apply migrations
  const migrationsFolder = path.join(__dirname, "migrations");
  try {
    migrate(db, { migrationsFolder });
    log.info("migrations applied");
  } catch (err) {
    log.error("migration failed", { error: String(err) });
    throw err;
  }
}

export function getClient(): BetterSQLite3Database<typeof schema> {
  if (!db) throw new Error("[Zeus DB] Database not initialized");
  return db;
}

export function getRawSqlite(): Database.Database {
  if (!sqlite) throw new Error("[Zeus DB] Database not initialized");
  return sqlite;
}

export function closeDatabase(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
  log.info("database closed");
}
```

- [ ] **Step 2: Create transaction context**

```typescript
// src/main/db/transaction.ts
import { AsyncLocalStorage } from "async_hooks";
import { getClient } from "./client";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

type TxOrDb = BetterSQLite3Database<any>;

const txContext = new AsyncLocalStorage<{ tx: TxOrDb }>();

export function transaction<T>(callback: (tx: TxOrDb) => T): T {
  const existing = txContext.getStore();
  if (existing) return callback(existing.tx);

  return getClient().transaction((tx) =>
    txContext.run({ tx: tx as unknown as TxOrDb }, () => callback(tx as unknown as TxOrDb))
  ) as T;
}

export function use<T>(callback: (db: TxOrDb) => T): T {
  const store = txContext.getStore();
  return callback((store?.tx ?? getClient()) as TxOrDb);
}
```

- [ ] **Step 3: Create all schema files**

Create `src/main/db/schema/*.sql.ts` — one per table group. Extract table definitions from the current `runMigrations()` in `db.ts`. The column names and types must match the existing schema exactly (no data migration).

Then create `src/main/db/schema/index.ts` that re-exports all tables.

- [ ] **Step 4: Create migration 0001_init**

Generate `src/main/db/migrations/0001_init/migration.sql` containing the full current schema (the combined result of all 13 migration steps in the current `db.ts`). This is the starting point — existing databases with data already have these tables, so Drizzle's migration tracking marks it as applied.

- [ ] **Step 5: Create query modules**

Create `src/main/db/queries/*.ts` — one per domain. Port every exported function from the current `db.ts` to use Drizzle's query builder instead of raw SQL. Each query function uses the `use()` helper from `transaction.ts` so it automatically participates in active transactions.

Maintain the same function names and signatures so that callers (handlers, services) can switch imports without logic changes.

- [ ] **Step 6: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: PASS

- [ ] **Step 7: Run existing validator tests**

```bash
npm run validate
```

Expected: PASS (validators don't touch DB directly)

- [ ] **Step 8: Commit**

```bash
git add src/main/db/
git commit -m "feat: add Drizzle ORM database layer with typed schemas and queries"
```

---

### Task 6: Service Lifecycle Manager

**Files:**
- Create: `src/main/lifecycle.ts`

- [ ] **Step 1: Create lifecycle manager**

```typescript
// src/main/lifecycle.ts
import { Log } from "./log/log";
import path from "path";
import { app } from "electron";

const log = Log.create({ service: "lifecycle" });

interface Service {
  name: string;
  deps: string[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const services: Service[] = [];

export function registerService(service: Service): void {
  services.push(service);
}

function topologicalSort(items: Service[]): Service[] {
  const sorted: Service[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byName = new Map(items.map((s) => [s.name, s]));

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);
    visiting.add(name);
    const service = byName.get(name);
    if (!service) throw new Error(`Unknown service: ${name}`);
    for (const dep of service.deps) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(service);
  }

  for (const item of items) {
    visit(item.name);
  }
  return sorted;
}

export async function bootAll(): Promise<void> {
  const sorted = topologicalSort(services);
  for (const service of sorted) {
    const timer = log.time(`boot ${service.name}`);
    try {
      await service.start();
      timer.stop();
    } catch (err) {
      log.error("service boot failed", { name: service.name, error: String(err) });
      throw err;
    }
  }
}

export async function shutdownAll(): Promise<void> {
  const sorted = topologicalSort(services).reverse();
  for (const service of sorted) {
    try {
      await service.stop();
      log.info("service stopped", { name: service.name });
    } catch (err) {
      log.error("service stop failed", { name: service.name, error: String(err) });
    }
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

- [ ] **Step 3: Commit**

```bash
git add src/main/lifecycle.ts
git commit -m "feat: add service lifecycle manager with dependency ordering"
```

---

### Task 7: Claude CLI Resolution

**Files:**
- Create: `src/main/services/claude-cli.ts`

- [ ] **Step 1: Create CLI resolver**

```typescript
// src/main/services/claude-cli.ts
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { Log } from "../log/log";

const log = Log.create({ service: "claude-cli" });

let resolvedPath: string | null = null;

export async function resolveClaudeBinary(): Promise<void> {
  // 1. Try `which claude`
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && existsSync(result)) {
      resolvedPath = result;
      log.info("resolved via which", { path: resolvedPath });
      return;
    }
  } catch { /* not found */ }

  // 2. Try common global paths
  const candidates = [
    path.join(process.env.HOME ?? "", ".npm/bin/claude"),
    "/usr/local/bin/claude",
    path.join(process.env.HOME ?? "", ".local/bin/claude"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      resolvedPath = candidate;
      log.info("resolved via path scan", { path: resolvedPath });
      return;
    }
  }

  // 3. Fallback — will use npx
  log.warn("claude binary not found, will use npx fallback");
  resolvedPath = null;
}

export function getClaudeBinary(): { command: string; prefixArgs: string[] } {
  if (resolvedPath) {
    return { command: resolvedPath, prefixArgs: [] };
  }
  return { command: "npx", prefixArgs: ["-y", "@anthropic-ai/claude-code@latest"] };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/claude-cli.ts
git commit -m "feat: add Claude CLI binary resolver (avoid npx on every session)"
```

---

### Task 8: WebSocket Server + Domain Handlers

This is the largest task. It replaces `websocket.ts` (3954 lines) with a thin server + router + 14 handler files.

**Files:**
- Create: `src/main/server/server.ts`
- Create: `src/main/server/router.ts`
- Create: `src/main/server/handlers/control.ts`
- Create: `src/main/server/handlers/terminal.ts`
- Create: `src/main/server/handlers/status.ts`
- Create: `src/main/server/handlers/claude.ts`
- Create: `src/main/server/handlers/git.ts`
- Create: `src/main/server/handlers/files.ts`
- Create: `src/main/server/handlers/qa.ts`
- Create: `src/main/server/handlers/subagent.ts`
- Create: `src/main/server/handlers/settings.ts`
- Create: `src/main/server/handlers/mcp.ts`
- Create: `src/main/server/handlers/tasks.ts`
- Create: `src/main/server/handlers/permissions.ts`
- Create: `src/main/server/handlers/android.ts`
- Create: `src/main/server/handlers/perf.ts`
- Delete (after migration): `src/main/services/websocket.ts`

- [ ] **Step 1: Create server.ts**

Port the HTTP server setup, static serving, WS upgrade, and auth from the current `startWebSocketServer()` (line 3799) and `stopWebSocketServer()` (line 3866). Add `clientState` tracking for stale WS cleanup. Wire `Bus.subscribeAll()` to forward events to all connected clients.

Key responsibilities:
- `startWebSocketServer(port)` — create HTTP server, serve static files (prod mode), create WSS, wire `ws.on('message')` to `router.route()`, wire `ws.on('close')` to cleanup
- `stopWebSocketServer()` — close all connections, close server
- `broadcastEnvelope()` / `sendEnvelope()` — kept as module exports for handlers that need targeted sends
- `notifyTunnelStatus()` / `isWebSocketRunning()` / `getServerPort()` — kept as exports
- Bus subscriber that maps bus events to WS envelopes and broadcasts

- [ ] **Step 2: Create router.ts**

```typescript
// src/main/server/router.ts
import { WebSocket } from "ws";
import { WsEnvelopeSchema } from "../../shared/protocol/envelope";
import type { WsEnvelope } from "../../shared/protocol/envelope";
import { Log } from "../log/log";
import { handleControl } from "./handlers/control";
import { handleTerminal } from "./handlers/terminal";
import { handleStatus } from "./handlers/status";
import { handleClaude } from "./handlers/claude";
import { handleGit } from "./handlers/git";
import { handleFiles } from "./handlers/files";
import { handleQa } from "./handlers/qa";
import { handleSubagent } from "./handlers/subagent";
import { handleSettings } from "./handlers/settings";
import { handleMcp } from "./handlers/mcp";
import { handleTasks } from "./handlers/tasks";
import { handlePermissions } from "./handlers/permissions";
import { handleAndroid } from "./handlers/android";
import { handlePerf } from "./handlers/perf";

const log = Log.create({ service: "router" });

export interface HandlerContext {
  ws: WebSocket;
  envelope: WsEnvelope;
  broadcast: (envelope: WsEnvelope) => void;
  send: (envelope: WsEnvelope) => void;
}

export type ChannelHandler = (ctx: HandlerContext) => void | Promise<void>;

const handlers: Record<string, ChannelHandler> = {
  control: handleControl,
  terminal: handleTerminal,
  status: handleStatus,
  claude: handleClaude,
  git: handleGit,
  files: handleFiles,
  qa: handleQa,
  subagent: handleSubagent,
  settings: handleSettings,
  mcp: handleMcp,
  tasks: handleTasks,
  permissions: handlePermissions,
  android: handleAndroid,
  perf: handlePerf,
};

export function route(
  ws: WebSocket,
  raw: string,
  broadcast: (env: WsEnvelope) => void,
  send: (env: WsEnvelope) => void,
): void {
  let envelope: WsEnvelope;
  try {
    envelope = WsEnvelopeSchema.parse(JSON.parse(raw));
  } catch (err) {
    log.warn("invalid envelope", { error: String(err), raw: raw.slice(0, 200) });
    return;
  }

  const handler = handlers[envelope.channel];
  if (!handler) {
    log.warn("unknown channel", { channel: envelope.channel });
    send({
      channel: "control",
      sessionId: envelope.sessionId,
      payload: { type: "error", message: `Unknown channel: ${envelope.channel}` },
      auth: "",
    });
    return;
  }

  try {
    const result = handler({ ws, envelope, broadcast, send });
    if (result instanceof Promise) {
      result.catch((err) => {
        log.error("handler error", { channel: envelope.channel, error: String(err) });
      });
    }
  } catch (err) {
    log.error("handler error", { channel: envelope.channel, error: String(err) });
  }
}
```

- [ ] **Step 3: Create each handler file**

Port the logic from each `handleXxx` function in `websocket.ts` into its own file. Each handler:
- Validates payload with the Zod schema from `src/shared/protocol/channels/`
- Calls domain services (existing files like `claude-session.ts`, `git.ts`, etc.)
- Calls DB queries from `src/main/db/queries/`
- Publishes events via `Bus.publish()` instead of `broadcastEnvelope()`
- Uses `ctx.send()` for responses targeted to the requesting client only

**Handler-to-source mapping** (where to extract from in current `websocket.ts`):

| Handler file | Source lines in websocket.ts | Key functions to port |
|---|---|---|
| `control.ts` | 287-404 | `handleControl` — session start/stop/list/delete/restore/archive |
| `terminal.ts` | 406-426 | `handleTerminal` — input, resize. Add attach/replay (new). |
| `status.ts` | 428-532 | `handleStatus` — get_status, toggle_power, toggle_tunnel, stop_tunnel |
| `claude.ts` | 534-1630 | `wireClaudeSession`, `adoptClaudeSession`, `handleClaude` — all claude ops |
| `git.ts` | 1631-1990 | `handleGit` — all git operations |
| `files.ts` | 1991-2158 | `handleFiles` — file tree operations |
| `qa.ts` | 2159-2297 | `handleQA` — PinchTab operations |
| `android.ts` | 2298-2404 | `sendAndroidResponse`, `handleAndroid` |
| `subagent.ts` | 2405-3087 | `handleSubagent` + `wireSubagent` + `readQaFinishFile` |
| `settings.ts` | 3088-3221 | `handleSettings` |
| `perf.ts` | 3222-3243 | `handlePerf` |
| `mcp.ts` | 3244-3346 | `handleMcp` |
| `tasks.ts` | 3347-3619 | `handleTask` |
| `permissions.ts` | 3620-3694 | `handlePermissions` |

Module-level state from `websocket.ts` must be moved to the appropriate handler or to a shared state module:
- `claudeManager` → `handlers/claude.ts`
- `gitManager` → `handlers/git.ts`
- `fileTreeManager` → `handlers/files.ts`
- `qaService` → `handlers/qa.ts`
- `androidQAService` → `handlers/android.ts`
- `subagentSessions`, `externalSubagentParentMap`, `subagentIdCounter` → `handlers/subagent.ts`
- `systemMonitor` → `handlers/perf.ts`
- `flowRunner` → `handlers/subagent.ts`
- `clientSessions`, `clientClaudeSessions` → `server.ts`
- `authenticatedClients` → `server.ts`

Helper functions move with their domain:
- `requestAttention` → `server.ts` (shared utility)
- `broadcastSessionUpdated` → `handlers/control.ts`
- `wireClaudeSession` → `handlers/claude.ts`
- `wireSubagent` → `handlers/subagent.ts`
- `readQaFinishFile` → `handlers/subagent.ts`
- `stopSubagentsByParent` → `handlers/subagent.ts`

- [ ] **Step 4: Update index.ts to use new server**

Change imports from `./services/websocket` to `./server/server`. Wire lifecycle manager.

- [ ] **Step 5: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/main/server/ src/main/index.ts
git commit -m "feat: split websocket.ts into thin server + 14 domain handlers"
```

---

### Task 9: PTY Buffer + Cursor Replay

**Files:**
- Modify: `src/main/services/terminal.ts`
- Modify: `src/main/server/handlers/terminal.ts` (add `attach` handler)

- [ ] **Step 1: Add buffer tracking to terminal sessions**

In `src/main/services/terminal.ts`, add `buffer`, `bufferCursor`, and `cursor` fields to the session map. Update the PTY `onData` callback to maintain the ring buffer (2MB limit). Export `getSessionBuffer(sessionId)` for the handler to use on attach.

- [ ] **Step 2: Add attach/replay to terminal handler**

In `src/main/server/handlers/terminal.ts`, add handling for `payload.type === "attach"`. Read the client's cursor from the payload, compute the missed data from the buffer, and send a `replay` response.

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/terminal.ts src/main/server/handlers/terminal.ts
git commit -m "feat: add PTY ring buffer with cursor-based replay on reconnect"
```

---

### Task 10: WebSocket Client Rewrite

**Files:**
- Rewrite: `src/renderer/src/lib/ws.ts`

- [ ] **Step 1: Rewrite ws.ts with reconnection + heartbeat + send buffer**

Replace the current WebSocket client with the `ZeusWs` class that supports:
- Exponential backoff reconnection (1s → 2s → 4s → max 30s)
- Ping every 30s, force reconnect on 2 missed pongs
- Send buffer during disconnection — messages queued and flushed on reconnect
- Same external API: `on(channel, callback)`, `send(envelope)`, `connect()`

Maintain backward compatibility with how `connectionSlice.ts` (next task) will consume it.

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.web.json
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/ws.ts
git commit -m "feat: rewrite WS client with exponential backoff, heartbeat, send buffer"
```

---

### Task 11: Zustand Store — Split into Slices

This is the second largest task. Split `useZeusStore.ts` (3399 lines) into 15 slice files + a ~50 line composer.

**Files:**
- Create: `src/renderer/src/stores/types.ts`
- Create: `src/renderer/src/stores/slices/connectionSlice.ts`
- Create: `src/renderer/src/stores/slices/claudeSlice.ts`
- Create: `src/renderer/src/stores/slices/terminalSlice.ts`
- Create: `src/renderer/src/stores/slices/gitSlice.ts`
- Create: `src/renderer/src/stores/slices/fileSlice.ts`
- Create: `src/renderer/src/stores/slices/qaSlice.ts`
- Create: `src/renderer/src/stores/slices/androidSlice.ts`
- Create: `src/renderer/src/stores/slices/subagentSlice.ts`
- Create: `src/renderer/src/stores/slices/settingsSlice.ts`
- Create: `src/renderer/src/stores/slices/mcpSlice.ts`
- Create: `src/renderer/src/stores/slices/taskSlice.ts`
- Create: `src/renderer/src/stores/slices/permissionSlice.ts`
- Create: `src/renderer/src/stores/slices/perfSlice.ts`
- Create: `src/renderer/src/stores/slices/diffSlice.ts`
- Create: `src/renderer/src/stores/slices/viewSlice.ts`
- Rewrite: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Create types.ts aggregate**

```typescript
// src/renderer/src/stores/types.ts
import type { ConnectionSlice } from "./slices/connectionSlice";
import type { ClaudeSlice } from "./slices/claudeSlice";
import type { TerminalSlice } from "./slices/terminalSlice";
import type { GitSlice } from "./slices/gitSlice";
import type { FileSlice } from "./slices/fileSlice";
import type { QaSlice } from "./slices/qaSlice";
import type { AndroidSlice } from "./slices/androidSlice";
import type { SubagentSlice } from "./slices/subagentSlice";
import type { SettingsSlice } from "./slices/settingsSlice";
import type { McpSlice } from "./slices/mcpSlice";
import type { TaskSlice } from "./slices/taskSlice";
import type { PermissionSlice } from "./slices/permissionSlice";
import type { PerfSlice } from "./slices/perfSlice";
import type { DiffSlice } from "./slices/diffSlice";
import type { ViewSlice } from "./slices/viewSlice";

export type ZeusState = ConnectionSlice & ClaudeSlice & TerminalSlice
  & GitSlice & FileSlice & QaSlice & AndroidSlice & SubagentSlice
  & SettingsSlice & McpSlice & TaskSlice & PermissionSlice
  & PerfSlice & DiffSlice & ViewSlice;
```

- [ ] **Step 2: Create each slice**

Port state + actions from `useZeusStore.ts` into domain slices. Map from current code:

| Slice | State fields (current lines) | Actions (current lines) |
|---|---|---|
| `connectionSlice` | `connected` (L402) | `connect` (L497-1711) — the big WS dispatch |
| `claudeSlice` | L409-418 | L1779-2250 |
| `terminalSlice` | L403-404, L189-200 | L1748-1777, L2819-3024 |
| `gitSlice` | L420-426 | L2254-2326, L2487-2570 |
| `fileSlice` | L431-433 | L2572-2659 |
| `qaSlice` | L435-450 | L2662-2715 |
| `androidSlice` | L452-456, L147-154 | L3025-3071 |
| `subagentSlice` | L464-468 | L2717-2802 |
| `settingsSlice` | L482-493, L496 | L3104-3158 |
| `mcpSlice` | L458-462 | L3160-3216 |
| `taskSlice` | L473-475 | L3218-3275 |
| `permissionSlice` | L478-480 | L3276-3311 |
| `perfSlice` | L470-471 | L3073-3102 |
| `diffSlice` | L274-276, L427-429 | L2326-2485 |
| `viewSlice` | L495, L186-187, L201 | L2245-2253, L2805-2817 |

Each slice follows the `StateCreator<ZeusState, [], [], SliceType>` pattern shown in the design spec.

The `connectionSlice` is special — its `connect()` function sets up WS subscriptions that dispatch incoming messages to `set()` calls targeting other slices' state. Port the entire message dispatch logic from the current `connect()` (lines 497-1711) into this slice, updating it to validate incoming payloads with the Zod schemas from `src/shared/protocol/channels/`.

Add selectors at the bottom of each slice file for commonly derived state (e.g., `selectActiveEntries`, `selectActiveActivity`, `selectActiveQueue` in `claudeSlice`).

- [ ] **Step 3: Rewrite useZeusStore.ts as composer**

```typescript
// src/renderer/src/stores/useZeusStore.ts
import { create } from "zustand";
import type { ZeusState } from "./types";
import { createConnectionSlice } from "./slices/connectionSlice";
import { createClaudeSlice } from "./slices/claudeSlice";
import { createTerminalSlice } from "./slices/terminalSlice";
import { createGitSlice } from "./slices/gitSlice";
import { createFileSlice } from "./slices/fileSlice";
import { createQaSlice } from "./slices/qaSlice";
import { createAndroidSlice } from "./slices/androidSlice";
import { createSubagentSlice } from "./slices/subagentSlice";
import { createSettingsSlice } from "./slices/settingsSlice";
import { createMcpSlice } from "./slices/mcpSlice";
import { createTaskSlice } from "./slices/taskSlice";
import { createPermissionSlice } from "./slices/permissionSlice";
import { createPerfSlice } from "./slices/perfSlice";
import { createDiffSlice } from "./slices/diffSlice";
import { createViewSlice } from "./slices/viewSlice";

export type { ZeusState } from "./types";

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

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit -p tsconfig.web.json
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/
git commit -m "feat: split Zustand store into 15 domain slices with selectors"
```

---

### Task 12: Update Component Imports

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ClaudeView.tsx`
- Modify: other components that use inline derived state from the store

- [ ] **Step 1: Update App.tsx to use selectors**

Replace inline filtering like:
```typescript
const activeEntries = activeClaudeId ? (claudeEntries[activeClaudeId] ?? []) : [];
```
With:
```typescript
import { selectActiveEntries } from "@/stores/slices/claudeSlice";
const entries = useZeusStore(selectActiveEntries);
```

- [ ] **Step 2: Update other components**

Grep for components that destructure large amounts of state from `useZeusStore()` and update them to use targeted selectors where beneficial. The store API is unchanged (same action names), so most components only need import path changes if they were importing types that moved.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/
git commit -m "refactor: update components to use store selectors from slices"
```

---

### Task 13: Cleanup + Wire Lifecycle

**Files:**
- Modify: `src/main/index.ts` — use `bootAll()` / `shutdownAll()`
- Delete: `src/main/services/websocket.ts`
- Delete: `src/main/services/db.ts`
- Modify: `src/main/services/claude-session.ts` — use `getClaudeBinary()`
- Modify: any remaining imports pointing to old files

- [ ] **Step 1: Register all services in lifecycle**

In `src/main/index.ts`, register services with the lifecycle manager and replace the ad-hoc startup sequence with `bootAll()`:

```typescript
import { registerService, bootAll, shutdownAll } from "./lifecycle";
import { Log } from "./log/log";
import { initDatabase, closeDatabase } from "./db/client";
import { Bus } from "./bus/bus";
import { startWebSocketServer, stopWebSocketServer } from "./server/server";
import { resolveClaudeBinary } from "./services/claude-cli";
// ... etc

registerService({ name: "log", deps: [], start: async () => Log.init({ level: "INFO", logDir: "..." }), stop: async () => Log.close() });
registerService({ name: "db", deps: ["log"], start: async () => initDatabase(dbPath), stop: async () => closeDatabase() });
// ... all other services

app.whenReady().then(async () => {
  await bootAll();
  createWindow();
});

app.on("before-quit", async () => {
  await shutdownAll();
});
```

- [ ] **Step 2: Update claude-session.ts**

Replace `spawn('npx', ['-y', '@anthropic-ai/claude-code@latest', ...args], ...)` with:

```typescript
import { getClaudeBinary } from "./claude-cli";

const { command, prefixArgs } = getClaudeBinary();
this.child = spawn(command, [...prefixArgs, ...args], { ... });
```

- [ ] **Step 3: Delete old god files**

```bash
git rm src/main/services/websocket.ts src/main/services/db.ts
```

- [ ] **Step 4: Fix any remaining imports**

Search for any file still importing from the deleted paths and update to new locations:

```bash
grep -r "from.*services/websocket" src/ --include="*.ts" --include="*.tsx"
grep -r "from.*services/db" src/ --include="*.ts" --include="*.tsx"
```

Update all found imports.

- [ ] **Step 5: Verify full typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: wire lifecycle manager, delete old god files, update all imports"
```

---

### Task 14: Full Verification

- [ ] **Step 1: Run type checker**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 2: Run validator tests**

```bash
npm run validate
```

Expected: PASS (67+ tests)

- [ ] **Step 3: Run full test suite**

```bash
npm run test
```

Expected: PASS (some tests may need import updates — fix any failures)

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: PASS

- [ ] **Step 5: Manual smoke test**

Start dev server and verify:
```bash
npm run dev
```

Test checklist:
- [ ] App launches, renderer loads
- [ ] Create a Claude session, send a message, see entries stream
- [ ] Approve/deny a tool use
- [ ] Git panel shows status for the session's working dir
- [ ] File explorer lists files
- [ ] Terminal session works (create, type, see output)
- [ ] Settings panel loads, theme switching works
- [ ] Session sidebar shows all sessions with activity indicators

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test: fix remaining test imports after architectural overhaul"
```

- [ ] **Step 7: Summary commit (if needed)**

If all tests pass and smoke test is clean:
```bash
git log --oneline -15
```

Verify the commit history shows a clean progression of the overhaul.

---

## Summary

| Task | Description | Estimated files |
|------|-------------|----------------|
| 1 | Install dependencies | 1 |
| 2 | Structured logging | 1 |
| 3 | Event bus + domain events | 16 |
| 4 | Typed WS protocol schemas | 15 |
| 5 | Drizzle ORM database layer | ~20 |
| 6 | Service lifecycle manager | 1 |
| 7 | Claude CLI resolver | 1 |
| 8 | WS server + 14 handlers | 16 |
| 9 | PTY buffer + replay | 2 |
| 10 | WS client rewrite | 1 |
| 11 | Zustand slices | 17 |
| 12 | Update component imports | ~5 |
| 13 | Cleanup + wire lifecycle | ~5 |
| 14 | Full verification | 0 |
| **Total** | | **~100 files** |
