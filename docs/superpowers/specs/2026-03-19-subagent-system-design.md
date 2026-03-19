# Generalized Subagent System — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Branch:** `feat/subagent-system`
**Replaces:** QA-specific agent infrastructure

---

## Problem

The current agent infrastructure is hardcoded to QA testing: types are `QaAgent*`, DB tables are `qa_agent_*`, WebSocket messages are `qa_agent_*`, and the UI is `QAPanel`. This makes it impossible to add new agent types (Plan Reviewer, Code Reviewer, etc.) without duplicating the entire stack.

## Solution

Refactor the QA agent infrastructure into a generalized **Subagent System**. A subagent is an agent spawned by another agent (or by a main session if there is no parent agent). The parent passes its session ID so the subagent's output is grouped under it. Two discriminators define behavior:
- **`subagentType`** — what it does (`'qa'`, `'plan_reviewer'`, future types)
- **`cli`** — what binary runs it (`'claude'`, future: `'codex'`, `'gemini'`)

A **SubagentTypeDefinition** registry declares each type's inputs, prompt builder, MCP servers, and CLI options. The UI becomes a generic `SubagentPanel` that renders dynamic forms per type.

---

## Architecture

### Subagent Type System

```typescript
// ─── CLI Backend ───

type SubagentCli = 'claude';  // extensible later: 'codex' | 'gemini'

// ─── Input Fields ───

interface SubagentInputField {
  key: string;              // 'task', 'targetUrl', 'filePath'
  label: string;
  type: 'text' | 'textarea' | 'file';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | (() => string);
}

// ─── MCP Server Config ───

interface SubagentMcpConfig {
  name: string;             // 'qa-server'
  command: string;          // path to MCP server binary/script
  args?: string[];
  env?: Record<string, string>;
}

// ─── Subagent Context ───

interface SubagentContext {
  workingDir: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  targetUrl?: string;          // resolved URL (for QA)
  resolvedFlow?: ResolvedFlow; // flow runner output (for QA)
  fileContent?: string;        // read file content (for Plan Reviewer)
}

// ─── Type Definition ───

interface SubagentTypeDefinition {
  type: SubagentType;
  name: string;                    // "QA Tester", "Plan Reviewer"
  icon: string;                    // lucide icon name
  description: string;
  inputFields: SubagentInputField[];
  buildPrompt: (inputs: Record<string, string>, context: SubagentContext) => string;
  permissionMode: PermissionMode;
  mcpServers: SubagentMcpConfig[]; // QA: [qa-server], Plan Reviewer: []
  cli: SubagentCli;                // CLI backend (just the default for now)
}

// ─── Session Info (shared between main + renderer) ───

interface SubagentSessionInfo {
  subagentId: string;              // was qaAgentId
  subagentType: SubagentType;
  cli: SubagentCli;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;              // kept top-level for QA backward compat
  status: SubagentStatus;
  startedAt: number;
}

// ─── start_subagent Payload Shape ───
// Replaces start_qa_agent. QA-specific fields (flowId, personas, targetUrl)
// move into the generic `inputs` bag. The handler extracts them based on
// subagentType from the registry.

type StartSubagentPayload = {
  type: 'start_subagent';
  subagentType: SubagentType;
  cli: SubagentCli;
  inputs: Record<string, string>;  // type-specific: { task, targetUrl } or { task, filePath }
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  workingDir: string;
  name?: string;
  responseId?: string;
};
```

### Registered Types

**QA Tester (`'qa'`):**
- inputFields: `task` (textarea, required), `targetUrl` (text, optional, auto-detected)
- mcpServers: `[{ name: 'qa-server', ... }]`
- permissionMode: `'bypassPermissions'`
- buildPrompt: existing `buildQAAgentSystemPrompt()` + flow/persona logic
- cli: `'claude'`

**Plan Reviewer (`'plan_reviewer'`):**
- inputFields: `task` (textarea, required), `filePath` (file, required)
- mcpServers: `[]`
- permissionMode: `'plan'`
- buildPrompt: reads file at `filePath`, wraps in review prompt instructing Claude to check completeness, feasibility, missing steps, ordering, and dependencies
- cli: `'claude'`

---

## Rename Map

### Shared Types (`src/shared/types.ts`)

| Old | New |
|-----|-----|
| `QaAgentStatus` | `SubagentStatus` |
| `QaAgentSessionInfo` | `SubagentSessionInfo` (add `subagentType`, `cli` fields) |
| `QaPayload` (subagent-related messages) | `SubagentPayload` |
| `ClaudeSessionInfo.qaAgentCount` | `ClaudeSessionInfo.subagentCount` |
| `WsEnvelope.channel` union | Add `'subagent'` to the union type |
| `QaInstanceInfo` | unchanged (QA-domain, not subagent) |
| `QaTabInfo` | unchanged |
| `QaSnapshotNode` | unchanged |

**`qa_error` message** (line 592 in types.ts) splits: browser errors stay as `qa_error` in `QaBrowserPayload`, agent-level errors become `subagent_error` in `SubagentPayload`.

`QaPayload` splits into two:
- **`QaBrowserPayload`** — PinchTab/browser control messages (`start_qa`, `stop_qa`, `navigate`, `snapshot`, `screenshot`, `action`, `text`, `list_tabs`, CDP events, `list_qa_flows`, `qa_flows_list`). These stay QA-specific since flows are QA-domain.
- **`SubagentPayload`** — all agent lifecycle messages (renamed from `qa_agent_*`).

### WebSocket Messages

| Old | New |
|-----|-----|
| `start_qa_agent` | `start_subagent` (add `subagentType`, `cli` fields) |
| `qa_agent_started` | `subagent_started` (add `subagentType`, `cli`) |
| `qa_agent_stopped` | `subagent_stopped` |
| `qa_agent_deleted` | `subagent_deleted` |
| `qa_agent_entry` | `subagent_entry` |
| `qa_agent_list` | `subagent_list` |
| `qa_agent_entries` | `subagent_entries` |
| `qa_agent_message` | `subagent_message` |
| `stop_qa_agent` | `stop_subagent` |
| `delete_qa_agent` | `delete_subagent` |
| `get_qa_agent_entries` | `get_subagent_entries` |
| `clear_qa_agent_entries` | `clear_subagent_entries` |
| `list_qa_agents` | `list_subagents` |
| `register_external_qa` | `register_external_subagent` (add `subagentType`) |
| `register_external_qa_response` | `register_external_subagent_response` |
| `external_qa_entry` | `external_subagent_entry` |
| `external_qa_done` | `external_subagent_done` |
| `start_qa_agent_response` | `start_subagent_response` |

### WebSocket Channel Routing (Structural Change)

Currently all agent messages go through `channel: 'qa'`. This changes:

- **`channel: 'subagent'`** — all agent lifecycle messages (`start_subagent`, `subagent_started`, `subagent_entry`, `stop_subagent`, etc.)
- **`channel: 'qa'`** — PinchTab/browser messages only (`start_qa`, `navigate`, `snapshot`, CDP events, etc.)

This requires a **new handler block** in `websocket.ts`. Currently the `'qa'` case handles both browser control and agent lifecycle. After the refactor:

```
case 'qa':      → handles QaBrowserPayload only
case 'subagent': → handles SubagentPayload (extracted from old 'qa' case)
```

The frontend store listener similarly splits: subagent messages arrive on `channel === 'subagent'`, browser messages on `channel === 'qa'`.

### Database (`src/main/services/db.ts`)

| Old | New |
|-----|-----|
| `qa_agent_sessions` (table) | `subagent_sessions` |
| `qa_agent_entries` (table) | `subagent_entries` |
| `qa_agent_id` (column in entries) | `subagent_id` |
| `QaAgentSessionRow` | `SubagentSessionRow` (add `subagent_type`, `cli`) |
| `QaAgentSessionDbRow` | `SubagentSessionDbRow` |
| `QaAgentEntryRow` | `SubagentEntryRow` |
| `insertQaAgentSession()` | `insertSubagentSession()` |
| `updateQaAgentSessionStatus()` | `updateSubagentSessionStatus()` |
| `updateQaAgentResumeData()` | `updateSubagentResumeData()` |
| `getQaAgentSession()` | `getSubagentSession()` |
| `getQaAgentSessionsByParent()` | `getSubagentSessionsByParent()` |
| `deleteQaAgentSession()` | `deleteSubagentSession()` |
| `clearQaAgentEntries()` | `clearSubagentEntries()` |
| `deleteQaAgentsByParent()` | `deleteSubagentsByParent()` |
| `countQaAgentsByParent()` | `countSubagentsByParent()` |
| `insertQaAgentEntry()` | `insertSubagentEntry()` |
| `getQaAgentEntries()` | `getSubagentEntries()` |
| `getAllQaAgentSessions()` | `getAllSubagentSessions()` |
| `markStaleQaAgentsErrored()` | `markStaleSubagentsErrored()` |

### WebSocket Handler (`src/main/services/websocket.ts`)

| Old | New |
|-----|-----|
| `QaAgentRecord` | `SubagentRecord` (add `subagentType`, `cli`) |
| `qaAgentSessions` (Map) | `subagentSessions` (Map) |
| `qaAgentIdCounter` | `subagentIdCounter` |
| `wireQAAgent()` | `wireSubagent()` |
| `buildQAAgentSystemPrompt()` | moved to registry / `subagent-registry.ts` |
| `readQaFinishFile()` | unchanged (QA-domain, see Unchanged section) |
| `externalQaParentMap` | `externalSubagentParentMap` |
| `stopQaAgentsByParent()` (if exists) | `stopSubagentsByParent()` |
| `qa-agent-` ID prefix | `subagent-` |
| `qa-ext-` ID prefix | `subagent-ext-` |

### Claude Session (`src/main/services/claude-session.ts`)

| Old | New |
|-----|-----|
| `qaAgentId` (option property) | `subagentId` |
| `isQAAgent` (variable) | `isSubagent` |
| `ZEUS_QA_AGENT_ID` (env var) | unchanged (external contract — `qa-server.ts` reads it) |
| Comment referencing `qa_agent_stopped` | Update to `subagent_stopped` |

**MCP attachment rewrite (not just rename):** The current `if (isQAAgent)` block at lines 229-237 hardcodes attachment of the `zeus-qa` MCP server. This block gets **replaced** by a generic loop that reads `SubagentTypeDefinition.mcpServers` from the registry:

```typescript
// OLD: hardcoded QA MCP server
const isQAAgent = !!this.options.qaAgentId;
if (isQAAgent) { /* attach zeus-qa MCP server */ }

// NEW: generic MCP server attachment
const isSubagent = !!this.options.subagentId;
if (isSubagent && this.options.mcpServers) {
  for (const mcp of this.options.mcpServers) {
    // attach each MCP server from the type definition
  }
}
```

The calling code in `websocket.ts` passes `mcpServers` from the registry when creating the `ClaudeSession`. For QA subagents, `ZEUS_QA_AGENT_ID` is set to `record.subagentId` — this mapping preserves the `qa-server.ts` contract.

### Frontend Store (`src/renderer/src/stores/useZeusStore.ts`)

| Old | New |
|-----|-----|
| `QaAgentClient` | `SubagentClient` (add `subagentType`, `cli` to info) |
| `qaAgents` (state) | `subagents` |
| `activeQaAgentId` (state) | `activeSubagentId` |
| `startQAAgent()` | `startSubagent()` (add `subagentType`, `cli` params) |
| `stopQAAgent()` | `stopSubagent()` |
| `deleteQAAgent()` | `deleteSubagent()` |
| `sendQAAgentMessage()` | `sendSubagentMessage()` |
| `clearQAAgentEntries()` | `clearSubagentEntries()` |
| `selectQaAgent()` | `selectSubagent()` |
| `fetchQaAgents()` | `fetchSubagents()` |
| `fetchQaAgentEntries()` | `fetchSubagentEntries()` |
| All `qa_agent_*` message listeners | `subagent_*` listeners |

### Frontend Components

| Old | New |
|-----|-----|
| `QAPanel.tsx` | `SubagentPanel.tsx` |
| `RightPanel.tsx` tab `'qa'` | `'subagents'` |
| `RightPanel.tsx` icon `Eye` | `Bot` |
| `RightPanel.tsx` tooltip `"QA Preview"` | `"Subagents"` |
| `RightPanel.tsx` `runningQaAgentCount` | `runningSubagentCount` |
| `SessionInfoPanel.tsx` `qaAgentCount` | `subagentCount` |
| `SessionInfoPanel.tsx` `EMPTY_QA_AGENTS` | `EMPTY_SUBAGENTS` |
| `SessionSidebar.tsx` `qaAgentCount` references | `subagentCount` |

### MCP / External (`src/main/mcp/zeus-bridge.ts`)

**No renaming of tool names.** External tool names (`zeus_qa_start`, `zeus_qa_run`, `zeus_qa_log`, `zeus_qa_end`, `zeus_qa_status`) stay unchanged — they are the public API for Claude CLI.

However, the **internal WebSocket messages** that zeus-bridge sends must be updated to use the new names. For example, `zeus_qa_run` currently sends `{ type: 'start_qa_agent', ... }` — this changes to `{ type: 'start_subagent', subagentType: 'qa', ... }`. The bridge listens for `start_subagent_response` instead of `start_qa_agent_response`. Similarly, `zeus_qa_start` sends `register_external_subagent` and listens for `register_external_subagent_response`.

### Unchanged (QA-Domain, Not Subagent)

These files/types are QA-specific infrastructure that the QA subagent type *uses*. They are NOT part of the subagent abstraction and stay as-is:

| File/Type | Reason |
|-----------|--------|
| `QAService` (`src/main/services/qa.ts`) | PinchTab binary management — browser infrastructure |
| `qa-server.ts` MCP (`src/main/mcp/qa-server.ts`) | Browser automation tools (`qa_navigate`, `qa_click`, etc.) |
| `flow-runner.ts` / `qa-flow-types.ts` | QA flow definitions — domain-specific |
| `QaInstanceInfo`, `QaTabInfo`, `QaSnapshotNode` | PinchTab data types |
| `QaBrowserPayload` (new name for browser subset) | Browser control messages |
| CDP observability (console, network, errors) | Browser-level, not agent-level |
| `ClaudeSessionInfo.enableQA` | Controls PinchTab attachment — session-level, not subagent |
| `ClaudeSessionInfo.qaTargetUrl` | Cached target URL for QA — session-level, not subagent |
| `qaFlows` / `fetchQaFlows` (store) | QA flow state — stays QA-prefixed |
| `list_qa_flows` / `qa_flows_list` (WS messages) | Part of `QaBrowserPayload`, QA-domain |
| `readQaFinishFile()` in websocket.ts | QA-domain utility — only QA agents write finish files via `qa_finish` tool. Called by `wireSubagent()` only when `subagentType === 'qa'` |

---

## New File: `src/main/services/subagent-registry.ts`

Central registry of subagent type definitions. Each type registers with:
- Input field declarations
- Prompt builder function
- MCP server configs
- CLI options
- Permission mode

```typescript
// Simplified API
function registerSubagentType(def: SubagentTypeDefinition): void;
function getSubagentType(type: SubagentType): SubagentTypeDefinition | undefined;
function listSubagentTypes(): SubagentTypeDefinition[];
```

The QA type definition lives here (extracts `buildQAAgentSystemPrompt` from websocket.ts).
The Plan Reviewer type definition lives here.

---

## Database Migration

SQLite doesn't reliably support `ALTER TABLE RENAME` across all versions. Use the safe copy pattern:

```sql
-- 1. Create new tables
CREATE TABLE subagent_sessions (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  parent_session_type TEXT NOT NULL DEFAULT 'claude',
  name TEXT,
  task TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  claude_session_id TEXT,
  last_message_id TEXT,
  working_dir TEXT,
  subagent_type TEXT NOT NULL DEFAULT 'qa',
  cli TEXT NOT NULL DEFAULT 'claude'
);

CREATE TABLE subagent_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subagent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);

-- 2. Copy data (explicit column mapping — source column order varies due to ALTERs)
INSERT INTO subagent_sessions
  (id, parent_session_id, parent_session_type, name, task, target_url,
   status, started_at, ended_at, claude_session_id, last_message_id,
   working_dir, subagent_type, cli)
SELECT
  id, parent_session_id, parent_session_type, name, task, target_url,
  status, started_at, ended_at, claude_session_id, last_message_id,
  working_dir, 'qa', 'claude'
FROM qa_agent_sessions;

INSERT INTO subagent_entries (id, subagent_id, kind, data, timestamp, seq)
  SELECT id, qa_agent_id, kind, data, timestamp, seq FROM qa_agent_entries;

-- 3. Create indexes
CREATE INDEX idx_subagent_parent ON subagent_sessions(parent_session_id);
CREATE INDEX idx_subagent_started ON subagent_sessions(started_at);
CREATE INDEX idx_subagent_type ON subagent_sessions(subagent_type);
CREATE INDEX idx_subagent_entries_agent ON subagent_entries(subagent_id, seq);

-- 4. Drop old tables
DROP TABLE IF EXISTS qa_agent_entries;
DROP TABLE IF EXISTS qa_agent_sessions;
```

Migration runs on startup in `initializeDatabase()` as **migration 10** (`SCHEMA_VERSION` bumps from 9 to 10). Guard: `if (currentVersion < 10) { ... }` in `runMigrations()`. The migration checks for `qa_agent_sessions` table existence before running (idempotent).

---

## Session Spawning Flow

```
1. User opens SubagentPanel → sees type selector
2. Clicks "QA Tester" or "Plan Reviewer" → sees input form with CLI dropdown
3. Fills inputs, clicks "Start Agent" → frontend sends:
   { type: 'start_subagent', subagentType: 'plan_reviewer', cli: 'claude',
     inputs: { task: '...', filePath: '...' },
     parentSessionId, parentSessionType, workingDir }

4. Backend handler:
   a. Looks up SubagentTypeDefinition from registry
   b. For QA type: ensures PinchTab is running, resolves target URL, resolves flows
   c. For Plan Reviewer: reads file at filePath into context
   d. Calls definition.buildPrompt(inputs, context) to get the system prompt
   e. Spawns ClaudeSession (or future CLI) with the prompt + definition.mcpServers + definition.permissionMode
   f. Creates SubagentRecord, persists to DB
   g. Calls wireSubagent() to attach event listeners
   h. Broadcasts subagent_started

5. Agent runs → entries stream via subagent_entry → displayed in panel
6. Agent completes → subagent_stopped broadcast → UI updates status
```

---

## SubagentPanel UI

### Three States

**A. Type Selector** (default view, or when user clicks "+"):

Shows a grid of registered subagent types. Each card has icon, name, description. Clicking a card transitions to the input form for that type.

UX optimization: if only one type has ever been used in this session, skip the selector and show the input form directly. Show selector when 2+ types are registered.

**B. Input Form** (after selecting a type):

Dynamically rendered from `SubagentTypeDefinition.inputFields`. Always includes:
- CLI label showing current backend (currently just "Claude" — becomes a dropdown when multi-CLI support is added)
- Back button to return to type selector
- "Start Agent" submit button

Field types:
- `text`: single-line input
- `textarea`: multi-line input
- `file`: text input with file path (could add browse button later)

**C. Agent View** (after agent starts, or when selecting an existing agent):

Same as current QA agent log view, with additions:
- Agent list picker shows a **type badge** (QA / Reviewer) next to each agent name
- QA-specific features (browser mode, snapshot, screenshot, CDP tabs) only render when the selected agent has `subagentType === 'qa'`
- All other features (log view, message input, stop/delete) are generic

---

## Plan Reviewer Prompt

When spawned, the Plan Reviewer agent receives a prompt structured as:

```
You are a Plan Reviewer agent. Your job is to review implementation plans
for completeness, feasibility, and correctness.

Review the following implementation plan and provide:
1. **Completeness** — Are all necessary steps included? Any gaps?
2. **Ordering** — Are steps in the right order? Are dependencies respected?
3. **Feasibility** — Are any steps technically infeasible or overly complex?
4. **Risks** — What could go wrong? Missing error handling? Edge cases?
5. **Improvements** — Concrete suggestions to strengthen the plan.

---

Plan file: {filePath}

{fileContent}
```

The agent reviews the plan and produces structured feedback as assistant messages streamed to the panel.

---

## Error Handling

- If `filePath` doesn't exist (Plan Reviewer): return error before spawning, don't create a session
- If CLI binary not found: mark as unavailable in `CliOption.available`, disable in dropdown
- If subagentType is unknown: reject at WebSocket handler level with error message
- Existing error handling (agent crash, deferred response, resume) carries over unchanged from QA infrastructure

---

## Testing Strategy

1. **DB migration**: Verify existing QA data survives migration with correct `subagent_type='qa'` and `cli='claude'`
2. **QA agent**: Verify all existing QA functionality works identically after rename (spawn, stream, stop, resume, delete, external via zeus-bridge)
3. **Plan Reviewer**: Spawn with a real plan file, verify review output streams correctly
4. **UI**: Type selector renders both types, input forms are dynamic, agent view shows type badges
5. **TypeScript**: `npm run typecheck` passes with zero errors
6. **Build**: `npm run build` succeeds
