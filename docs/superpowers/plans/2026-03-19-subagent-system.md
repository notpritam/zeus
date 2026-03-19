# Subagent System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the QA-specific agent infrastructure into a generalized subagent system that supports multiple agent types (QA Tester, Plan Reviewer), with a registry pattern and dynamic UI.

**Architecture:** Full rename of all `qa_agent_*` / `QaAgent*` identifiers to `subagent_*` / `Subagent*` across types, DB, WebSocket, store, and UI. A `SubagentTypeDefinition` registry declares each type's inputs, prompt, MCP servers, and CLI. The `QAPanel` becomes `SubagentPanel` with a type selector, dynamic input forms, and type-aware agent view. QA-domain infrastructure (PinchTab, qa-server MCP, flow-runner) stays unchanged.

**Tech Stack:** TypeScript, Electron, SQLite (better-sqlite3), WebSocket, React/Zustand, Claude CLI

**Spec:** `docs/superpowers/specs/2026-03-19-subagent-system-design.md`

**Branch:** `feat/subagent-system`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Rename types, split `QaPayload`, add `SubagentPayload`, update `WsEnvelope` channel |
| `src/main/services/db.ts` | Modify | DB migration (v10), rename all DB functions/types/SQL |
| `src/main/services/subagent-registry.ts` | Create | Type definitions registry + prompt builders |
| `src/main/services/claude-session.ts` | Modify | Rename `qaAgentId`→`subagentId`, generic MCP attachment |
| `src/main/services/websocket.ts` | Modify | Rename handlers, split `'qa'`/`'subagent'` channels, use registry |
| `src/main/mcp/zeus-bridge.ts` | Modify | Internal WS messages use new names, external tools unchanged |
| `src/renderer/src/stores/useZeusStore.ts` | Modify | Rename state/actions, update WS listeners |
| `src/renderer/src/components/SubagentPanel.tsx` | Create (rename) | Rename from QAPanel, add type selector + dynamic forms |
| `src/renderer/src/components/RightPanel.tsx` | Modify | Tab rename `qa`→`subagents`, icon, tooltip |
| `src/renderer/src/components/SessionInfoPanel.tsx` | Modify | `qaAgentCount`→`subagentCount` |
| `src/renderer/src/components/SessionSidebar.tsx` | Modify | `qaAgentCount`→`subagentCount` |

---

## Task 0: Create Branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/subagent-system
```

- [ ] **Step 2: Commit spec document**

```bash
git add docs/superpowers/specs/2026-03-19-subagent-system-design.md
git commit -m "docs: add subagent system design spec"
```

---

## Task 1: Shared Types Rename (`src/shared/types.ts`)

**Files:**
- Modify: `src/shared/types.ts`

This is the foundation — all other files depend on these types.

- [ ] **Step 1: Add `'subagent'` to the `WsEnvelope.channel` union**

Find the `WsEnvelope` interface (around line 168) and add `'subagent'` to the channel union:

```typescript
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent'
```

- [ ] **Step 2: Add `SubagentType` and `SubagentCli` types**

Add before the existing `QaAgentStatus`:

```typescript
// ─── Subagent Types ───

export type SubagentType = 'qa' | 'plan_reviewer';
export type SubagentCli = 'claude';
```

- [ ] **Step 3: Rename `QaAgentStatus` → `SubagentStatus`**

```typescript
// OLD: export type QaAgentStatus = 'running' | 'stopped' | 'error';
export type SubagentStatus = 'running' | 'stopped' | 'error';
```

- [ ] **Step 4: Rename `QaAgentSessionInfo` → `SubagentSessionInfo`**

Replace the interface, adding `subagentId`, `subagentType`, `cli` fields:

```typescript
export interface SubagentSessionInfo {
  subagentId: string;
  subagentType: SubagentType;
  cli: SubagentCli;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;
  status: SubagentStatus;
  startedAt: number;
}
```

- [ ] **Step 5: Rename `ClaudeSessionInfo.qaAgentCount` → `subagentCount`**

In the `ClaudeSessionInfo` interface (around line 409), rename:

```typescript
// OLD: qaAgentCount?: number;
subagentCount?: number;
```

- [ ] **Step 6: Split `QaPayload` into `QaBrowserPayload` + `SubagentPayload`**

Extract all browser/PinchTab messages into `QaBrowserPayload` (keep `qa_error` for browser errors). Create `SubagentPayload` with all renamed agent lifecycle messages. The existing `QaPayload` becomes `QaBrowserPayload`.

`SubagentPayload` contains all the renamed messages:

```typescript
export type SubagentPayload =
  // Client → Server
  | { type: 'start_subagent'; subagentType: SubagentType; cli: SubagentCli; inputs: Record<string, string>; workingDir: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; responseId?: string }
  | { type: 'stop_subagent'; subagentId: string }
  | { type: 'subagent_message'; subagentId: string; text: string }
  | { type: 'list_subagents'; parentSessionId: string }
  | { type: 'get_subagent_entries'; subagentId: string }
  | { type: 'delete_subagent'; subagentId: string; parentSessionId: string }
  | { type: 'clear_subagent_entries'; subagentId: string }
  // Server → Client
  | { type: 'subagent_started'; subagentId: string; subagentType: SubagentType; cli: SubagentCli; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; task: string; targetUrl?: string }
  | { type: 'subagent_stopped'; subagentId: string; parentSessionId: string }
  | { type: 'subagent_deleted'; subagentId: string; parentSessionId: string }
  | { type: 'subagent_entry'; subagentId: string; parentSessionId: string; entry: NormalizedEntry }
  | { type: 'subagent_list'; parentSessionId: string; agents: SubagentSessionInfo[] }
  | { type: 'subagent_entries'; subagentId: string; entries: NormalizedEntry[] }
  | { type: 'subagent_error'; message: string }
  // External subagent registration
  | { type: 'register_external_subagent'; subagentType: SubagentType; task: string; targetUrl?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; responseId?: string }
  | { type: 'register_external_subagent_response'; subagentId: string; responseId?: string }
  | { type: 'external_subagent_entry'; subagentId: string; entry: unknown }
  | { type: 'external_subagent_done'; subagentId: string; status?: string }
  | { type: 'start_subagent_response'; responseId?: string; subagentId: string; status: string; summary: string };
```

Remove the agent lifecycle messages from `QaPayload` (now `QaBrowserPayload`), keeping only browser/PinchTab messages + `qa_error` + `list_qa_flows` + `qa_flows_list`.

**Note:** The external subagent messages (`register_external_subagent`, `external_subagent_entry`, `external_subagent_done`, `start_subagent_response`) are **new typed additions** — they existed in `websocket.ts` as untyped messages but were never part of the old `QaPayload` type. Adding them to `SubagentPayload` is an improvement.

- [ ] **Step 7: Verify TypeScript compiles (expect errors in downstream files)**

```bash
npx tsc --noEmit 2>&1 | head -50
```

Expected: errors in `db.ts`, `websocket.ts`, `useZeusStore.ts`, etc. referencing old type names. This confirms the type rename is working.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor: rename QaAgent types to Subagent in shared types"
```

---

## Task 2: Database Migration & Function Renames (`src/main/services/db.ts`)

**Files:**
- Modify: `src/main/services/db.ts`

- [ ] **Step 1: Bump `SCHEMA_VERSION` from 9 to 10**

```typescript
const SCHEMA_VERSION = 10;
```

- [ ] **Step 2: Add migration 10 — create new tables, copy data, drop old**

After the `if (currentVersion < 9)` block, add:

```typescript
if (currentVersion < 10) {
  // Rename qa_agent_sessions → subagent_sessions
  database.exec(`
    CREATE TABLE IF NOT EXISTS subagent_sessions (
      id                  TEXT PRIMARY KEY,
      parent_session_id   TEXT NOT NULL,
      parent_session_type TEXT NOT NULL DEFAULT 'claude',
      name                TEXT,
      task                TEXT NOT NULL,
      target_url          TEXT,
      status              TEXT NOT NULL DEFAULT 'running',
      started_at          INTEGER NOT NULL,
      ended_at            INTEGER,
      claude_session_id   TEXT,
      last_message_id     TEXT,
      working_dir         TEXT,
      subagent_type       TEXT NOT NULL DEFAULT 'qa',
      cli                 TEXT NOT NULL DEFAULT 'claude'
    );
    CREATE TABLE IF NOT EXISTS subagent_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      subagent_id   TEXT NOT NULL,
      kind          TEXT NOT NULL,
      data          TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      seq           INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Copy data if old tables exist
  const hasOldTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='qa_agent_sessions'"
  ).get();
  if (hasOldTable) {
    database.exec(`
      INSERT OR IGNORE INTO subagent_sessions
        (id, parent_session_id, parent_session_type, name, task, target_url,
         status, started_at, ended_at, claude_session_id, last_message_id,
         working_dir, subagent_type, cli)
      SELECT
        id, parent_session_id, parent_session_type, name, task, target_url,
        status, started_at, ended_at, claude_session_id, last_message_id,
        working_dir, 'qa', 'claude'
      FROM qa_agent_sessions;

      INSERT OR IGNORE INTO subagent_entries (id, subagent_id, kind, data, timestamp, seq)
      SELECT id, qa_agent_id, kind, data, timestamp, seq
      FROM qa_agent_entries;

      DROP TABLE IF EXISTS qa_agent_entries;
      DROP TABLE IF EXISTS qa_agent_sessions;
    `);
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_subagent_parent ON subagent_sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_subagent_started ON subagent_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_subagent_type ON subagent_sessions(subagent_type);
    CREATE INDEX IF NOT EXISTS idx_subagent_entries_agent ON subagent_entries(subagent_id, seq);
  `);
}
```

- [ ] **Step 3: Leave migrations 3, 4, 7 untouched**

Do NOT modify migrations 3, 4, or 7. They reference `qa_agent_sessions` which is correct for their original purpose. For fresh installs, migrations 3/4/7 will create and alter `qa_agent_sessions`, then migration 10 will copy data to `subagent_sessions` and drop the old tables. The `hasOldTable` check in migration 10 handles both cases safely:
- **Existing DB** (version >= 3): old tables exist → copy + drop
- **Fresh install** (version 0): migrations 3/4/7 create old tables → migration 10 copies + drops

- [ ] **Step 4: Rename type interfaces**

Rename `QaAgentSessionRow` → `SubagentSessionRow` (add `subagentType` and `cli` fields), `QaAgentSessionDbRow` → `SubagentSessionDbRow` (add `subagent_type` and `cli` fields), `QaAgentEntryRow` → `SubagentEntryRow` (rename `qaAgentId` → `subagentId`), `QaAgentEntryDbRow` → `SubagentEntryDbRow` (rename `qa_agent_id` → `subagent_id`).

- [ ] **Step 5: Rename all DB functions**

Rename every function, updating table names and column names in SQL:

| Old | New |
|-----|-----|
| `insertQaAgentSession` | `insertSubagentSession` |
| `updateQaAgentSessionStatus` | `updateSubagentSessionStatus` |
| `updateQaAgentResumeData` | `updateSubagentResumeData` |
| `getQaAgentSession` | `getSubagentSession` |
| `getQaAgentSessionsByParent` | `getSubagentSessionsByParent` |
| `getAllQaAgentSessions` | `getAllSubagentSessions` |
| `deleteQaAgentSession` | `deleteSubagentSession` |
| `clearQaAgentEntries` | `clearSubagentEntries` |
| `deleteQaAgentsByParent` | `deleteSubagentsByParent` |
| `countQaAgentsByParent` | `countSubagentsByParent` |
| `insertQaAgentEntry` | `insertSubagentEntry` |
| `getQaAgentEntries` | `getSubagentEntries` |
| `markStaleQaAgentsErrored` | `markStaleSubagentsErrored` |

Update all SQL strings inside these functions: `qa_agent_sessions` → `subagent_sessions`, `qa_agent_entries` → `subagent_entries`, `qa_agent_id` → `subagent_id`.

Key changes beyond rename:
- `SubagentSessionRow` adds `subagentType: SubagentType` and `cli: SubagentCli` fields
- `SubagentSessionDbRow` adds `subagent_type: string` and `cli: string` fields
- `SubagentEntryRow` renames `qaAgentId` → `subagentId`
- `SubagentEntryDbRow` renames `qa_agent_id` → `subagent_id`
- `insertSubagentSession` INSERT SQL adds two new columns:

```sql
INSERT OR IGNORE INTO subagent_sessions
  (id, parent_session_id, parent_session_type, name, task, target_url,
   status, started_at, ended_at, claude_session_id, last_message_id,
   working_dir, subagent_type, cli)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

- All `getSubagentSession*` row mappers add `subagentType: r.subagent_type` and `cli: r.cli` to the output

- [ ] **Step 6: Update `pruneOldSessions`**

Lines 177-180: change `qa_agent_entries` → `subagent_entries`, `qa_agent_sessions` → `subagent_sessions`.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/db.ts
git commit -m "refactor: rename qa_agent DB tables to subagent, add migration 10"
```

---

## Task 3: Subagent Registry (`src/main/services/subagent-registry.ts`)

**Files:**
- Create: `src/main/services/subagent-registry.ts`

- [ ] **Step 1: Create the registry file with types and API**

```typescript
import type { PermissionMode } from '../../shared/types';
import type { SubagentType, SubagentCli } from '../../shared/types';

export interface SubagentInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'file';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | (() => string);
}

export interface SubagentMcpConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SubagentContext {
  workingDir: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  targetUrl?: string;
  fileContent?: string;
  resolvedFlow?: unknown; // ResolvedFlow from flow-runner (QA-specific)
}

export interface SubagentTypeDefinition {
  type: SubagentType;
  name: string;
  icon: string;
  description: string;
  inputFields: SubagentInputField[];
  buildPrompt: (inputs: Record<string, string>, context: SubagentContext) => string;
  permissionMode: PermissionMode;
  mcpServers: SubagentMcpConfig[];
  cli: SubagentCli;
}

const registry = new Map<SubagentType, SubagentTypeDefinition>();

export function registerSubagentType(def: SubagentTypeDefinition): void {
  registry.set(def.type, def);
}

export function getSubagentType(type: SubagentType): SubagentTypeDefinition | undefined {
  return registry.get(type);
}

export function listSubagentTypes(): SubagentTypeDefinition[] {
  return Array.from(registry.values());
}
```

- [ ] **Step 2: Register QA Tester type**

Move `buildQAAgentSystemPrompt()` from `websocket.ts` into this file (or import it). Register the QA type:

```typescript
import { app } from 'electron';
import path from 'node:path';

registerSubagentType({
  type: 'qa',
  name: 'QA Tester',
  icon: 'Eye',
  description: 'Browser-based QA testing with PinchTab automation',
  inputFields: [
    { key: 'task', label: 'Task', type: 'textarea', required: true, placeholder: 'What to test...' },
    { key: 'targetUrl', label: 'Target URL', type: 'text', required: false, placeholder: 'Auto-detected from dev server' },
  ],
  buildPrompt: (inputs, context) => {
    const targetUrl = inputs.targetUrl || context.targetUrl || 'http://localhost:5173';
    return `${buildQAAgentSystemPrompt(targetUrl)}\n\n---\n\nTask: ${inputs.task}`;
  },
  permissionMode: 'bypassPermissions',
  mcpServers: [{
    name: 'zeus-qa',
    command: 'node',
    args: [path.resolve(app.getAppPath(), 'out/main/mcp-qa-server.mjs')],
  }],
  cli: 'claude',
});
```

- [ ] **Step 3: Register Plan Reviewer type**

```typescript
// File reading happens in the websocket handler (Task 5), not here.
// The buildPrompt receives fileContent via SubagentContext.

registerSubagentType({
  type: 'plan_reviewer',
  name: 'Plan Reviewer',
  icon: 'FileSearch',
  description: 'Review implementation plans for completeness and feasibility',
  inputFields: [
    { key: 'task', label: 'Review Instructions', type: 'textarea', required: true, placeholder: 'Review this plan for...' },
    { key: 'filePath', label: 'Plan File', type: 'file', required: true, placeholder: 'docs/superpowers/plans/...' },
  ],
  buildPrompt: (inputs, context) => {
    const fileContent = context.fileContent ?? '';
    return [
      'You are a Plan Reviewer agent. Your job is to review implementation plans for completeness, feasibility, and correctness.',
      '',
      'Review the following implementation plan and provide:',
      '1. **Completeness** — Are all necessary steps included? Any gaps?',
      '2. **Ordering** — Are steps in the right order? Are dependencies respected?',
      '3. **Feasibility** — Are any steps technically infeasible or overly complex?',
      '4. **Risks** — What could go wrong? Missing error handling? Edge cases?',
      '5. **Improvements** — Concrete suggestions to strengthen the plan.',
      '',
      '---',
      '',
      `Plan file: ${inputs.filePath}`,
      '',
      fileContent,
      '',
      '---',
      '',
      `Additional instructions: ${inputs.task}`,
    ].join('\n');
  },
  permissionMode: 'plan',
  mcpServers: [],
  cli: 'claude',
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/subagent-registry.ts
git commit -m "feat: add subagent type registry with QA and Plan Reviewer definitions"
```

---

## Task 4: Claude Session Rename (`src/main/services/claude-session.ts`)

**Files:**
- Modify: `src/main/services/claude-session.ts`

- [ ] **Step 1: Rename `qaAgentId` → `subagentId` in `SessionOptions`**

```typescript
// OLD: qaAgentId?: string;
subagentId?: string;
```

Also add `mcpServers` option for generic MCP attachment:

```typescript
mcpServers?: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>;
```

- [ ] **Step 2: Replace hardcoded QA MCP block with generic loop**

Replace lines 229-262 (the `isQAAgent` block including the QA prompt injection):

```typescript
const isSubagent = !!this.options.subagentId;

if (isSubagent && this.options.mcpServers) {
  for (const mcp of this.options.mcpServers) {
    const env: Record<string, string> = {
      ...(mcp.env ?? {}),
      ZEUS_QA_AGENT_ID: this.options.subagentId!,
      ZEUS_WS_URL: process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:8888',
    };
    mcpServers[mcp.name] = {
      command: mcp.command,
      args: mcp.args,
      env,
    };
  }
}
```

Keep the `else` branch that attaches `zeus-bridge` for regular sessions unchanged.

- [ ] **Step 3: Update the QA-specific system prompt injection**

The `qaPrompt` lines (244-249) that inject QA testing instructions should only run for QA subagents. Add a condition — check if any MCP server is named `zeus-qa`:

```typescript
if (isSubagent && this.options.mcpServers?.some(m => m.name === 'zeus-qa')) {
  const targetUrl = this.options.qaTargetUrl || process.env.ZEUS_QA_DEFAULT_URL || 'http://localhost:5173';
  // existing qaPrompt logic
}
```

- [ ] **Step 4: Update comment referencing `qa_agent_stopped`**

Find the comment (around line 197) and update to `subagent_stopped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "refactor: rename qaAgentId to subagentId, generic MCP attachment"
```

---

## Task 5: WebSocket Handler Refactor (`src/main/services/websocket.ts`)

**Files:**
- Modify: `src/main/services/websocket.ts`

This is the largest task — the file is ~3100 lines. Work methodically.

- [ ] **Step 1: Update imports**

Update all imports from `db.ts` to use the new function names. Update type imports from `shared/types.ts`. Import the subagent registry:

```typescript
import { getSubagentType, listSubagentTypes, type SubagentContext } from './subagent-registry';
```

- [ ] **Step 2: Rename in-memory data structures**

```typescript
// OLD
interface QaAgentRecord { ... }
const qaAgentSessions = new Map<string, QaAgentRecord>();
let qaAgentIdCounter = 0;

// NEW
interface SubagentRecord {
  subagentId: string;
  subagentType: SubagentType;
  cli: SubagentCli;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;
  workingDir: string;
  session: ClaudeSession | null;
  startedAt: number;
  pendingResponseId?: string;
  pendingResponseWs?: WebSocket;
  collectedTextEntries: string[];
  claudeSessionId?: string;
  lastMessageId?: string;
}
const subagentSessions = new Map<string, SubagentRecord>();
let subagentIdCounter = 0;
```

Also rename `externalQaParentMap` → `externalSubagentParentMap`.

Rename `stopQaAgentsByParent()` → `stopSubagentsByParent()` — this function is called at ~4 locations in `websocket.ts` (session cleanup, disconnect handling). Update its body to reference `subagentSessions` instead of `qaAgentSessions`.

- [ ] **Step 3: Rename `wireQAAgent()` → `wireSubagent()`**

Rename the function and update all internal references:
- `qaAgentId` → `subagentId`
- All `broadcastEnvelope` calls: change channel to `'subagent'`, payload types to `subagent_*`
- DB function calls: `insertQaAgentEntry` → `insertSubagentEntry`, etc.
- Keep `readQaFinishFile()` calls as-is (QA-domain)

- [ ] **Step 4: Move `buildQAAgentSystemPrompt()` to registry**

Delete the function from `websocket.ts` — it now lives in `subagent-registry.ts`. Update all call sites to use `getSubagentType('qa')!.buildPrompt(inputs, context)`.

- [ ] **Step 5: Extract subagent handler into new `'subagent'` channel**

Currently all agent messages are handled in the `'qa'` channel case. Create a new `else if (envelope.channel === 'subagent')` block. Move all agent lifecycle message handlers into it:
- `start_subagent` (was `start_qa_agent`)
- `stop_subagent` (was `stop_qa_agent`)
- `subagent_message` (was `qa_agent_message`)
- `list_subagents` (was `list_qa_agents`)
- `get_subagent_entries` (was `get_qa_agent_entries`)
- `delete_subagent` (was `delete_qa_agent`)
- `clear_subagent_entries` (was `clear_qa_agent_entries`)
- `register_external_subagent` (was `register_external_qa`)
- `external_subagent_entry` (was `external_qa_entry`)
- `external_subagent_done` (was `external_qa_done`)

The `'qa'` channel case keeps only browser/PinchTab handlers.

- [ ] **Step 6: Generalize `start_subagent` handler**

The handler currently has QA-specific logic (PinchTab start, flow resolution, target URL detection). Refactor to:

1. Parse `subagentType` and `cli` from payload
2. Look up `SubagentTypeDefinition` from registry
3. If `subagentType === 'qa'`: run QA-specific setup (PinchTab, flow resolution, target URL)
4. If `subagentType === 'plan_reviewer'`: read the file at `inputs.filePath` into `context.fileContent`
5. Call `definition.buildPrompt(inputs, context)`
6. Create `ClaudeSession` with `subagentId`, `mcpServers: definition.mcpServers`, `permissionMode: definition.permissionMode`
7. Create `SubagentRecord`, persist to DB, `wireSubagent()`, broadcast

- [ ] **Step 7: Update ID prefixes**

Change `qa-agent-` → `subagent-` and `qa-ext-` → `subagent-ext-` in ID generation.

- [ ] **Step 8: Update `qaAgentCount` → `subagentCount`**

In the session list broadcast (around line 1331), rename `qaAgentCount: countQaAgentsByParent(...)` to `subagentCount: countSubagentsByParent(...)`.

- [ ] **Step 9: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | head -80
```

Fix any remaining type errors from the rename.

- [ ] **Step 10: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "refactor: rename QA agent handlers to subagent, split channel routing"
```

---

## Task 6: zeus-bridge Internal Renames (`src/main/mcp/zeus-bridge.ts`)

**Files:**
- Modify: `src/main/mcp/zeus-bridge.ts`

- [ ] **Step 1: Update `zeus_qa_run` internal messages**

Change `{ type: 'start_qa_agent', ... }` to `{ type: 'start_subagent', subagentType: 'qa', cli: 'claude', inputs: { task, targetUrl: ... }, ... }`. Listen for `start_subagent_response` instead of `start_qa_agent_response`.

- [ ] **Step 2: Update `zeus_qa_start` internal messages**

Change `{ type: 'register_external_qa', ... }` to `{ type: 'register_external_subagent', subagentType: 'qa', ... }`. Listen for `register_external_subagent_response`.

- [ ] **Step 3: Update `zeus_qa_log` internal messages**

Change `{ type: 'external_qa_entry', qaAgentId: ... }` to `{ type: 'external_subagent_entry', subagentId: ... }`.

- [ ] **Step 4: Update `zeus_qa_end` internal messages**

Change `{ type: 'external_qa_done', qaAgentId: ... }` to `{ type: 'external_subagent_done', subagentId: ... }`.

- [ ] **Step 5: Update channel from `'qa'` to `'subagent'`**

All `sendToZeus('qa', ...)` calls that send agent lifecycle messages change to `sendToZeus('subagent', ...)`. Browser-related calls stay on `'qa'` — specifically, `zeus_qa_status` sends `get_qa_status` on `channel: 'qa'` and this does NOT change (it's PinchTab status, not subagent lifecycle).

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/zeus-bridge.ts
git commit -m "refactor: zeus-bridge uses subagent WS messages internally"
```

---

## Task 7: Frontend Store Rename (`src/renderer/src/stores/useZeusStore.ts`)

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Rename interface and state fields**

```typescript
// OLD
interface QaAgentClient {
  info: QaAgentSessionInfo;
  entries: NormalizedEntry[];
}
// State:
qaAgents: Record<string, QaAgentClient[]>;
activeQaAgentId: Record<string, string | null>;

// NEW
interface SubagentClient {
  info: SubagentSessionInfo;
  entries: NormalizedEntry[];
}
// State:
subagents: Record<string, SubagentClient[]>;
activeSubagentId: Record<string, string | null>;
```

- [ ] **Step 2: Rename all action functions**

| Old | New |
|-----|-----|
| `startQAAgent(task, workingDir, ...)` | `startSubagent(subagentType, cli, inputs, workingDir, ...)` |
| `stopQAAgent(qaAgentId)` | `stopSubagent(subagentId)` |
| `deleteQAAgent(qaAgentId, parentSessionId)` | `deleteSubagent(subagentId, parentSessionId)` |
| `sendQAAgentMessage(qaAgentId, text)` | `sendSubagentMessage(subagentId, text)` |
| `clearQAAgentEntries(qaAgentId)` | `clearSubagentEntries(subagentId)` |
| `selectQaAgent(parentSessionId, qaAgentId)` | `selectSubagent(parentSessionId, subagentId)` |
| `fetchQaAgents(parentSessionId)` | `fetchSubagents(parentSessionId)` |
| `fetchQaAgentEntries(qaAgentId)` | `fetchSubagentEntries(subagentId)` |

Update the WS message payloads inside these functions:
- `type: 'start_qa_agent'` → `type: 'start_subagent'`
- `type: 'stop_qa_agent'` → `type: 'stop_subagent'`
- etc.
- Change `channel: 'qa'` → `channel: 'subagent'` for all agent lifecycle messages.

- [ ] **Step 3: Update WS message listeners**

In the WebSocket `onmessage` handler, update all `qa_agent_*` payload type checks:
- `qa_agent_started` → `subagent_started`
- `qa_agent_stopped` → `subagent_stopped`
- `qa_agent_deleted` → `subagent_deleted`
- `qa_agent_entry` → `subagent_entry`
- `qa_agent_list` → `subagent_list`
- `qa_agent_entries` → `subagent_entries`

Inside each handler, rename `qaAgentId` → `subagentId`, `qaAgents` → `subagents`, `activeQaAgentId` → `activeSubagentId`.

- [ ] **Step 4: Update session fetch calls**

Where the store sends `list_qa_agents` on session change, update to `list_subagents` on `channel: 'subagent'`.

- [ ] **Step 5: Update reset/cleanup**

In the reset handler or session cleanup, update `qaAgents: {}` → `subagents: {}`, `activeQaAgentId: {}` → `activeSubagentId: {}`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "refactor: rename QA agent store fields and actions to subagent"
```

---

## Task 8: SubagentPanel UI (`src/renderer/src/components/QAPanel.tsx` → `SubagentPanel.tsx`)

**Files:**
- Rename: `src/renderer/src/components/QAPanel.tsx` → `src/renderer/src/components/SubagentPanel.tsx`
- Modify: `src/renderer/src/components/SubagentPanel.tsx`

- [ ] **Step 1: Rename the file**

```bash
git mv src/renderer/src/components/QAPanel.tsx src/renderer/src/components/SubagentPanel.tsx
```

- [ ] **Step 2: Update all store references**

Find-and-replace within the file:
- `qaAgents` → `subagents`
- `activeQaAgentId` → `activeSubagentId`
- `startQAAgent` → `startSubagent`
- `stopQAAgent` → `stopSubagent`
- `deleteQAAgent` → `deleteSubagent`
- `sendQAAgentMessage` → `sendSubagentMessage`
- `clearQAAgentEntries` → `clearSubagentEntries`
- `selectQaAgent` → `selectSubagent`
- `fetchQaAgents` → `fetchSubagents`
- `fetchQaAgentEntries` → `fetchSubagentEntries`
- `qaAgentId` → `subagentId` (in data access, e.g. `a.info.qaAgentId`)

- [ ] **Step 3: Add type selector state**

Add state for the type selector and input form:

```typescript
const [panelView, setPanelView] = useState<'selector' | 'form' | 'agents'>('selector');
const [selectedType, setSelectedType] = useState<SubagentType | null>(null);
const [formInputs, setFormInputs] = useState<Record<string, string>>({});
```

Import `listSubagentTypes` and `SubagentTypeDefinition` — these need to be accessible from the renderer. Since the registry lives in the main process, expose the type definitions as a static list that the renderer knows about (hard-coded in the component, or sent via WS on connect).

For simplicity, define the input field configs directly in the component (mirror what the registry has). **Add a comment noting this must stay in sync with `subagent-registry.ts` when new types are added.**

```typescript
// Keep in sync with src/main/services/subagent-registry.ts
const SUBAGENT_TYPES = [
  {
    type: 'qa' as SubagentType,
    name: 'QA Tester',
    icon: Eye,
    description: 'Browser-based QA testing with PinchTab automation',
    inputFields: [
      { key: 'task', label: 'Task', type: 'textarea' as const, required: true, placeholder: 'What to test...' },
      { key: 'targetUrl', label: 'Target URL', type: 'text' as const, required: false, placeholder: 'Auto-detected' },
    ],
  },
  {
    type: 'plan_reviewer' as SubagentType,
    name: 'Plan Reviewer',
    icon: FileSearch,
    description: 'Review implementation plans for completeness and feasibility',
    inputFields: [
      { key: 'task', label: 'Review Instructions', type: 'textarea' as const, required: true, placeholder: 'Review this plan for...' },
      { key: 'filePath', label: 'Plan File', type: 'file' as const, required: true, placeholder: 'docs/superpowers/plans/...' },
    ],
  },
];
```

- [ ] **Step 4: Build the Type Selector view**

Render a grid of cards when `panelView === 'selector'`:

```tsx
{panelView === 'selector' && (
  <div className="p-3 space-y-2">
    <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
      Spawn Subagent
    </div>
    {SUBAGENT_TYPES.map((def) => (
      <button
        key={def.type}
        onClick={() => { setSelectedType(def.type); setFormInputs({}); setPanelView('form'); }}
        className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-bg-card transition-colors text-left"
      >
        <def.icon className="size-5 text-primary mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-medium">{def.name}</div>
          <div className="text-xs text-text-muted">{def.description}</div>
        </div>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: Build the dynamic Input Form view**

Render when `panelView === 'form'` and `selectedType` is set:

```tsx
{panelView === 'form' && selectedType && (() => {
  const def = SUBAGENT_TYPES.find((d) => d.type === selectedType)!;
  return (
    <div className="p-3 space-y-3">
      <button onClick={() => setPanelView('selector')} className="text-xs text-text-muted hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back
      </button>
      <div className="text-sm font-medium">{def.name}</div>
      <div className="text-xs text-text-muted">CLI: Claude</div>
      {def.inputFields.map((field) => (
        <div key={field.key}>
          <label className="text-xs text-text-muted block mb-1">{field.label}{field.required && ' *'}</label>
          {field.type === 'textarea' ? (
            <textarea
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm resize-none"
              rows={3}
              placeholder={field.placeholder}
              value={formInputs[field.key] ?? ''}
              onChange={(e) => setFormInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          ) : (
            <input
              type="text"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm"
              placeholder={field.placeholder}
              value={formInputs[field.key] ?? ''}
              onChange={(e) => setFormInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <Button size="sm" onClick={() => handleStartSubagent(def)} disabled={!def.inputFields.filter(f => f.required).every(f => formInputs[f.key]?.trim())}>
        <Play className="size-3 mr-1" /> Start Agent
      </Button>
    </div>
  );
})()}
```

- [ ] **Step 6: Add `handleStartSubagent` function**

```typescript
function handleStartSubagent(def: typeof SUBAGENT_TYPES[0]) {
  if (!ctx) return;
  startSubagent(
    def.type,
    'claude',
    formInputs,
    ctx.workingDir,
    ctx.parentSessionId,
    ctx.parentSessionType,
  );
  setPanelView('agents');
}
```

- [ ] **Step 7: Add type badge to agent list picker**

In the agent list dropdown, add a small badge showing the subagent type:

```tsx
<span className="text-[9px] text-text-muted uppercase">{a.info.subagentType === 'qa' ? 'QA' : 'Review'}</span>
```

- [ ] **Step 8: Conditionally show QA-specific features**

The browser mode tab (snapshot, screenshot, actions, CDP tabs) should only show when the selected agent has `subagentType === 'qa'`. Add a check:

```typescript
const selectedAgent = agents.find(a => a.info.subagentId === activeId);
const isQaAgent = selectedAgent?.info.subagentType === 'qa';
```

Wrap browser-mode UI in `{isQaAgent && ( ... )}`.

- [ ] **Step 9: Add "+" button to switch back to type selector**

In the agent view header, add a button to spawn a new agent:

```tsx
<button onClick={() => setPanelView('selector')} title="New subagent">
  <Plus className="size-4" />
</button>
```

- [ ] **Step 10: Rename the default export**

```typescript
// OLD: export default QAPanel;
export default SubagentPanel;
```

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/SubagentPanel.tsx
git commit -m "refactor: rename QAPanel to SubagentPanel, add type selector and dynamic forms"
```

---

## Task 9: RightPanel, SessionInfoPanel, SessionSidebar Updates

**Files:**
- Modify: `src/renderer/src/components/RightPanel.tsx`
- Modify: `src/renderer/src/components/SessionInfoPanel.tsx`
- Modify: `src/renderer/src/components/SessionSidebar.tsx`

- [ ] **Step 1: Update RightPanel.tsx**

1. Change import: `QAPanel` → `SubagentPanel` from `./SubagentPanel`
2. Change tab type: `'qa'` → `'subagents'` in `ActivityBarIcon` tab prop type and usages
3. Change icon: `Eye` → `Bot` (import `Bot` from lucide-react)
4. Change tooltip: `"QA Preview"` → `"Subagents"`
5. Rename `runningQaAgentCount` → `runningSubagentCount`
6. Update store selector: `s.qaAgents` → `s.subagents`
7. Render `<SubagentPanel />` instead of `<QAPanel />`

- [ ] **Step 2: Update SessionInfoPanel.tsx**

1. Rename `EMPTY_QA_AGENTS` → `EMPTY_SUBAGENTS`
2. Rename store reference: `s.qaAgents` → `s.subagents`
3. Rename `qaAgents` variable → `subagents`
4. Rename `runningQaAgents` → `runningSubagents`
5. Update `a.info?.qaAgentId` → `a.info?.subagentId`

- [ ] **Step 3: Update SessionSidebar.tsx**

1. Rename `session.qaAgentCount` → `session.subagentCount` (lines 266, 269)

- [ ] **Step 4: Update `activeRightTab` type in `useZeusStore.ts`**

**Note:** This reopens `useZeusStore.ts` which was already committed in Task 7. This is intentional — the `activeRightTab` type is UI-layer concern that belongs with the RightPanel changes.

In `useZeusStore.ts`, find the `activeRightTab` type and update `'qa'` → `'subagents'`:

```typescript
// OLD: activeRightTab: 'source-control' | 'explorer' | 'qa' | 'info' | 'settings' | null
activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'info' | 'settings' | null
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RightPanel.tsx src/renderer/src/components/SessionInfoPanel.tsx src/renderer/src/components/SessionSidebar.tsx src/renderer/src/stores/useZeusStore.ts
git commit -m "refactor: update RightPanel, SessionInfo, Sidebar for subagent naming"
```

---

## Task 10: Build & Typecheck Verification

- [ ] **Step 1: Run TypeScript type check**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Fix any remaining type errors**

Search for any lingering `qaAgent`, `QaAgent`, `qa_agent` references:

```bash
grep -rn "qaAgent\|QaAgent\|qa_agent" src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.d.ts'
```

Fix any found references (should only be QA-domain things like `QAService`, `qa-server.ts`, flow types).

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type errors from subagent rename"
```

---

## Task 11: Manual Smoke Test

- [ ] **Step 1: Start the Electron app**

```bash
npm run dev
```

- [ ] **Step 2: Verify Subagent Panel**

1. Click the "Subagents" icon (Bot) in the right sidebar
2. Verify type selector shows "QA Tester" and "Plan Reviewer"
3. Click "QA Tester" → verify input form renders with Task and Target URL fields
4. Click back → click "Plan Reviewer" → verify input form renders with Task and Plan File fields

- [ ] **Step 3: Verify QA agent still works**

1. From QA Tester form, enter a task and start the agent
2. Verify agent appears in the agent list with "QA" badge
3. Verify log entries stream correctly
4. Verify stop/delete work

- [ ] **Step 4: Verify DB migration**

Check that existing QA sessions from before the migration are visible in the subagent panel.

- [ ] **Step 5: Test Plan Reviewer**

1. From Plan Reviewer form, enter a task and file path (e.g. `docs/superpowers/plans/2026-03-19-subagent-system.md`)
2. Verify agent spawns and produces review output
3. Verify "Review" badge shows in agent list

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 0 | — | Create branch |
| 1 | `types.ts` | Rename shared types, split payload |
| 2 | `db.ts` | DB migration v10, rename all functions |
| 3 | `subagent-registry.ts` | New file: type definitions + prompt builders |
| 4 | `claude-session.ts` | Rename options, generic MCP attachment |
| 5 | `websocket.ts` | Rename handlers, split channels, use registry |
| 6 | `zeus-bridge.ts` | Internal WS messages renamed |
| 7 | `useZeusStore.ts` | Rename state/actions/listeners |
| 8 | `SubagentPanel.tsx` | Rename + type selector + dynamic forms |
| 9 | `RightPanel.tsx`, `SessionInfoPanel.tsx`, `SessionSidebar.tsx` | Tab/badge/label renames |
| 10 | — | Typecheck + build verification |
| 11 | — | Manual smoke test |
