# Zeus Improvement Plan — Lessons from Claude Code Architecture

> Derived from analyzing the Claude Code source (March 31, 2026 npm sourcemap leak).
> This document maps Claude Code's production patterns to actionable improvements for Zeus.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Comparison](#architecture-comparison)
3. [High-Impact Improvements](#high-impact-improvements)
   - [1. Structured Agent Protocol](#1-structured-agent-protocol)
   - [2. Multi-Agent Coordinator Mode](#2-multi-agent-coordinator-mode)
   - [3. Dream System — Background Memory Consolidation](#3-dream-system--background-memory-consolidation)
   - [4. Task Streaming Architecture](#4-task-streaming-architecture)
   - [5. Permission Bridge](#5-permission-bridge)
   - [6. Hook System](#6-hook-system)
   - [7. Tool Registry & Deferred Loading](#7-tool-registry--deferred-loading)
4. [Medium-Impact Improvements](#medium-impact-improvements)
   - [8. Worktree Isolation per Session](#8-worktree-isolation-per-session)
   - [9. System Prompt Caching](#9-system-prompt-caching)
   - [10. Branded Type IDs](#10-branded-type-ids)
   - [11. Feature Gating System](#11-feature-gating-system)
   - [12. Agent Teams / Swarm Mode](#12-agent-teams--swarm-mode)
5. [Low-Effort / Quick Wins](#low-effort--quick-wins)
   - [13. Activity Ring Buffer](#13-activity-ring-buffer)
   - [14. Task Output File Streaming](#14-task-output-file-streaming)
   - [15. Concurrency-Safe Tool Batching](#15-concurrency-safe-tool-batching)
6. [What NOT to Copy](#what-not-to-copy)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Reference: Claude Code Key Files](#reference-claude-code-key-files)

---

## Executive Summary

Claude Code is a **785KB monolith** with 40+ tools, multi-agent orchestration, a memory "dream" engine, and a sophisticated permission bridge — all shipped as a CLI. Zeus is an **Electron orchestration layer** that wraps Claude CLI sessions and streams them remotely.

The key insight: **Claude Code already solved the "agent-as-a-service" problem internally.** Its bridge system, coordinator mode, and task management are exactly what Zeus is building externally. Zeus doesn't need to replicate Claude Code — it needs to **leverage the same patterns** at the Electron/WebSocket layer.

### Top 5 Changes (Ordered by Impact)

| # | Change | Why |
|---|--------|-----|
| 1 | **Structured Agent Protocol** | Replace raw text streaming with typed SDK messages (tool_use, tool_result, control_request) |
| 2 | **Coordinator Mode** | Enable Zeus to orchestrate multiple Claude sessions as workers from a single control plane |
| 3 | **Dream System** | Background memory consolidation across sessions — Zeus sees ALL sessions, perfect host for this |
| 4 | **Permission Bridge** | Round-trip permission requests through the Electron UI instead of auto-approving |
| 5 | **Hook System** | Settings-based hooks (pre/post tool use, session lifecycle) for extensibility |

---

## Architecture Comparison

```
┌─────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE (Internal)                   │
│                                                              │
│  cli.tsx → init() → setup() → QueryEngine.query()           │
│       ↓                          ↓                           │
│  System Prompt Assembly    StreamingToolExecutor              │
│       ↓                          ↓                           │
│  API Call (Anthropic)      Tool Execution (40+ tools)        │
│       ↓                          ↓                           │
│  Bridge (WebSocket)        State Mutations (AppState)        │
│       ↓                          ↓                           │
│  Remote UI (claude.ai)     Task Management + Dream           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     ZEUS (Current)                            │
│                                                              │
│  Electron Main → Services → Claude CLI (subprocess)          │
│       ↓              ↓              ↓                        │
│  WebSocket Server   DB (SQLite)   stream-json protocol       │
│       ↓              ↓              ↓                        │
│  Channel Router    Persistence   NormalizedEntry parsing      │
│       ↓                                                      │
│  React Renderer (Zustand slices)                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Difference:** Claude Code manages the agent loop internally. Zeus wraps it externally. This means Zeus has a unique advantage — it can **coordinate across multiple Claude instances** in ways that Claude Code's own coordinator mode cannot (different projects, different models, shared state via SQLite).

---

## High-Impact Improvements

### 1. Structured Agent Protocol

**Problem:** Zeus currently parses Claude CLI output as raw stream-json text and normalizes it into `NormalizedEntry`. This loses structured information about tool calls, permissions, and control flow.

**Claude Code Pattern:** The bridge uses typed `SDKMessage` variants:
```typescript
type SDKMessage =
  | { type: 'user_message'; content: string }
  | { type: 'assistant_message'; content: ContentBlock[] }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: 'control_request'; request_id: string; request: ControlRequest }
  | { type: 'control_response'; response: ControlResponse }
```

**What Zeus Should Do:**

1. Define a `ZeusSDKMessage` discriminated union in `src/shared/types.ts`
2. Parse Claude CLI stdout into these typed messages (the protocol peer already does partial parsing)
3. Store the full typed message alongside the `NormalizedEntry` (add a `rawMessage?: ZeusSDKMessage` field)
4. Use the structured data for richer UI rendering (tool inputs, diffs, permission details)

**Benefit:** Enables the Permission Bridge (item 5), richer tool cards, and coordinator mode.

---

### 2. Multi-Agent Coordinator Mode

**Problem:** Zeus can spawn multiple Claude sessions, but they don't know about each other. There's no way to have one session direct work to others.

**Claude Code Pattern:** Coordinator mode (`CLAUDE_CODE_COORDINATOR_MODE=1`) transforms a single Claude instance into an orchestrator:

```
Coordinator (Opus)
  ├── Worker A: "Research the codebase" (Sonnet, parallel)
  ├── Worker B: "Find all API endpoints" (Sonnet, parallel)
  │   ... wait for results ...
  ├── Coordinator synthesizes findings
  ├── Worker C: "Implement the fix at src/foo.ts:42" (Opus)
  └── Worker D: "Write tests for the fix" (Sonnet, parallel)
```

Workers communicate via `<task-notification>` XML messages. The coordinator reads actual findings before delegating — no lazy "based on your findings" delegation.

**What Zeus Should Do:**

1. **Add a "Coordinator Session" type** — a Claude session that receives summaries from other sessions
2. **Cross-session notifications** — when a task session completes, inject its summary into the coordinator's context via the existing WebSocket `claude` channel
3. **Coordinator UI panel** — show the dependency graph of sessions (which session spawned which)
4. **Implementation approach:**
   ```typescript
   // In task-manager.ts
   interface CoordinatorConfig {
     coordinatorSessionId: string;
     workerSessions: string[];
     synthesisStrategy: 'auto' | 'manual'; // auto = inject summaries, manual = user reviews
   }

   // When a worker task completes:
   onTaskComplete(taskId: string) {
     const summary = getTaskSummary(taskId);
     const coordinator = getCoordinatorSession(taskId);
     if (coordinator) {
       injectMessage(coordinator.sessionId, {
         role: 'user',
         content: `<task-notification>
           <task-id>${taskId}</task-id>
           <status>completed</status>
           <summary>${summary}</summary>
         </task-notification>`
       });
     }
   }
   ```

**Benefit:** Zeus becomes a true orchestration layer, not just a session viewer. Users can dispatch complex multi-step work from their phone.

---

### 3. Dream System — Background Memory Consolidation

**Problem:** Each Claude session has its own memory context. Cross-session learnings are lost. Users must manually transfer context between sessions.

**Claude Code Pattern:** The `autoDream` system runs as a forked subagent with a three-gate trigger:

1. **Time gate:** 24 hours since last dream
2. **Session gate:** 5+ sessions since last dream
3. **Lock gate:** File-based mutex (no concurrent dreams)

The dream follows four phases: Orient → Gather Signal → Consolidate → Prune Index.

**What Zeus Should Do:**

Zeus is the **perfect host** for dreaming because it sees ALL sessions across ALL projects:

1. **Dream Trigger Service** (`src/main/services/dream.ts`):
   ```typescript
   interface DreamConfig {
     minHoursSinceLast: number;   // default: 24
     minSessionsSinceLast: number; // default: 5
     lockFile: string;             // ~/.zeus/dream.lock
   }

   async function shouldDream(): Promise<boolean> {
     const lastDream = await db.getLastDreamTimestamp();
     const sessionCount = await db.getSessionCountSince(lastDream);
     const locked = await acquireLock(config.lockFile);
     return hoursSince(lastDream) >= config.minHoursSinceLast
         && sessionCount >= config.minSessionsSinceLast
         && locked;
   }
   ```

2. **Consolidation Prompt:** Spawn a background Claude session with read-only access to:
   - All session summaries since last dream
   - Current `MEMORY.md` files across projects
   - Git log summaries per project

3. **Output:** Updated memory files that future sessions inherit as context.

4. **UI:** "Dream" indicator in the Zeus status bar. Dream history viewable in settings.

**Benefit:** Zeus becomes a learning system. Patterns discovered in morning sessions inform afternoon sessions automatically.

---

### 4. Task Streaming Architecture

**Problem:** Zeus streams terminal output via WebSocket, but large outputs cause performance issues. The full transcript is re-serialized on every update.

**Claude Code Pattern:** Tasks write incremental output to disk files. The UI reads from an `outputOffset` cursor:

```typescript
interface TaskState {
  outputFile: string;    // /tmp/zeus/task-abc123.jsonl
  outputOffset: number;  // bytes read so far
}

// Reading new output:
function getNewOutput(task: TaskState): string {
  const content = readFileFrom(task.outputFile, task.outputOffset);
  task.outputOffset += content.length;
  return content;
}
```

**What Zeus Should Do:**

1. Write Claude session output to append-only JSONL files on disk
2. WebSocket sends only *new* lines since last read (delta streaming)
3. Store `outputOffset` per client connection (multiple clients can read at different speeds)
4. On reconnect, client provides its last offset → server sends catch-up delta

```typescript
// In claude-session.ts
class ClaudeSessionOutput {
  private outputPath: string;
  private writeStream: fs.WriteStream;

  append(entry: NormalizedEntry): void {
    this.writeStream.write(JSON.stringify(entry) + '\n');
  }

  readFrom(offset: number): { entries: NormalizedEntry[]; newOffset: number } {
    const content = fs.readFileSync(this.outputPath, { start: offset });
    const lines = content.toString().split('\n').filter(Boolean);
    return {
      entries: lines.map(JSON.parse),
      newOffset: offset + Buffer.byteLength(content),
    };
  }
}
```

**Benefit:** Handles long-running sessions without memory bloat. Supports multiple mobile clients viewing the same session. Crash recovery — output survives process restarts.

---

### 5. Permission Bridge

**Problem:** Zeus currently auto-approves or queues permission requests. There's no round-trip flow where the mobile user explicitly approves/denies tool execution in real-time.

**Claude Code Pattern:** Control requests flow bidirectionally over WebSocket:

```
Claude CLI stdout → { type: 'control_request', request_id: 'abc', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf /' } } }
     ↓
Electron Main Process (parses, forwards to renderer via WebSocket)
     ↓
React UI (shows modal: "Claude wants to run: rm -rf /")
     ↓
User taps Approve/Deny
     ↓
{ type: 'control_response', response: { request_id: 'abc', behavior: 'deny' } }
     ↓
Claude CLI stdin (permission denied, agent adjusts)
```

**What Zeus Should Do:**

1. Parse `control_request` messages from Claude CLI's stream-json output
2. Forward to renderer via the existing `permissions` WebSocket channel
3. Render an approval modal with:
   - Tool name and risk level (LOW/MEDIUM/HIGH)
   - Input preview (command text, file path, etc.)
   - "Always allow" checkbox (persists to permission rules DB)
4. Send response back to Claude CLI via stdin
5. Add timeout handling — if user doesn't respond in N seconds, use configured default (deny for HIGH risk, allow for LOW)

**Benefit:** Remote users have full control over what Claude does on their machine. Critical for the "headless dev server" use case.

---

### 6. Hook System

**Problem:** Zeus has an internal event bus but no user-configurable hooks. Users can't customize behavior (e.g., "run linter after every file edit", "notify Slack on session complete").

**Claude Code Pattern:** 26 hook events covering the full lifecycle:

```typescript
type HookEvent =
  | 'SessionStart' | 'SessionEnd'
  | 'PreToolUse' | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'PermissionRequest' | 'PermissionDenied'
  | 'FileChanged' | 'CwdChanged'
  | 'TaskCreated' | 'TaskCompleted'
  // ... 15 more

// Hook definition in settings.json:
{
  "hooks": {
    "PostToolUse": [
      {
        "match": { "tool_name": "FileEditTool" },
        "command": "eslint --fix ${file_path}",
        "timeout": 10000
      }
    ],
    "SessionEnd": [
      {
        "command": "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Session ${session_id} completed\"}'",
        "timeout": 5000
      }
    ]
  }
}
```

**What Zeus Should Do:**

1. Define hook events in `src/shared/types.ts` (start with 8 core events):
   - `session:start`, `session:end`
   - `task:created`, `task:completed`
   - `tool:pre-use`, `tool:post-use`
   - `file:changed`
   - `permission:requested`
2. Add a `hooks` section to Zeus settings (stored in DB or JSON config)
3. Hook executor service that runs shell commands with event context as env vars
4. Hook results shown in a dedicated "Hooks" panel in the UI

**Benefit:** Extensibility without code changes. Power users can wire Zeus into their existing toolchains.

---

### 7. Tool Registry & Deferred Loading

**Problem:** Zeus hardcodes its understanding of Claude's tools. When Claude adds new tools, Zeus doesn't know how to render them.

**Claude Code Pattern:** Tools register via `getAllBaseTools()` with schema, description, and feature gates. A `ToolSearchTool` enables runtime discovery. Tool schemas are cached for prompt efficiency.

**What Zeus Should Do:**

1. **Dynamic tool registry** — when Zeus sees a `tool_use` message with an unknown tool name, render it generically (JSON input/output) instead of erroring
2. **Tool metadata cache** — maintain a mapping of `toolName → { description, riskLevel, iconHint }` that updates as new tools appear
3. **Custom tool renderers** — allow plugin-style renderers for specific tools (e.g., a diff viewer for `FileEditTool`, a terminal for `BashTool`)

```typescript
// In src/shared/types.ts
interface ToolRendererConfig {
  toolName: string;
  component: 'diff-viewer' | 'terminal' | 'json-tree' | 'image' | 'generic';
  riskLevel: 'low' | 'medium' | 'high';
}

const TOOL_RENDERERS: ToolRendererConfig[] = [
  { toolName: 'Edit', component: 'diff-viewer', riskLevel: 'medium' },
  { toolName: 'Bash', component: 'terminal', riskLevel: 'high' },
  { toolName: 'Read', component: 'json-tree', riskLevel: 'low' },
  { toolName: 'Write', component: 'diff-viewer', riskLevel: 'medium' },
  // ... fallback to 'generic' for unknown tools
];
```

**Benefit:** Future-proof against Claude Code updates. New tools render immediately without Zeus code changes.

---

## Medium-Impact Improvements

### 8. Worktree Isolation per Session

**Current:** Zeus supports task worktrees but doesn't enforce isolation.

**Claude Code Pattern:** Each agent spawned via `AgentTool` with `isolation: 'worktree'` gets a dedicated git worktree. This prevents concurrent file conflicts between agents working on the same repo.

**Action:** Default all task sessions to worktree isolation. Add a `shared` flag for sessions that intentionally share a working directory.

---

### 9. System Prompt Caching

**Claude Code Pattern:** System prompt sections are memoized via `systemPromptSection(name, computeFn)` and only recomputed on `/clear` or `/compact`. A `DANGEROUS_uncachedSystemPromptSection()` function exists for volatile sections.

**Action:** Cache assembled system prompts per project in SQLite. Invalidate only when `CLAUDE.md`, memory files, or git status change. This reduces startup latency for repeated sessions.

---

### 10. Branded Type IDs

**Claude Code Pattern:** `SessionId` and `AgentId` are branded strings (`string & { __brand: 'SessionId' }`) preventing accidental mixing at compile time.

**Action:** Apply to Zeus's `sessionId`, `taskId`, `entryId` types in `src/shared/types.ts`. Catches bugs where a `taskId` is accidentally passed as a `sessionId`.

```typescript
type SessionId = string & { readonly __brand: unique symbol };
type TaskId = string & { readonly __brand: unique symbol };
type EntryId = string & { readonly __brand: unique symbol };

function toSessionId(s: string): SessionId { return s as SessionId; }
function toTaskId(s: string): TaskId { return s as TaskId; }
```

---

### 11. Feature Gating System

**Claude Code Pattern:** Compile-time `feature('FLAG')` with dead-code elimination. Runtime flags via GrowthBook with aggressive caching (`getFeatureValue_CACHED_MAY_BE_STALE()`).

**Action:** Zeus doesn't need compile-time DCE, but should add runtime feature flags:
- Store flags in SQLite (`feature_flags` table)
- Default flags per environment (dev/staging/prod)
- Override via settings UI
- Use for: experimental coordinator mode, dream system, new UI components

---

### 12. Agent Teams / Swarm Mode

**Claude Code Pattern:** The `tengu_amber_flint` feature gate enables full team orchestration with in-process teammates, tmux pane management, color assignments, and team memory sync.

**Action:** Zeus already has a `subagent` channel. Extend it to support:
- Named teams with persistent configurations
- Color-coded session indicators in the UI
- Team-scoped memory (shared context across team members)
- Broadcast messages to all team members

---

## Low-Effort / Quick Wins

### 13. Activity Ring Buffer

**Claude Code Pattern:** `SessionActivity[]` is a ring buffer of the last ~10 activities per session, providing a quick "what's happening now" view without loading full transcripts.

**Action:** Add `recentActivity: SessionActivity[]` (max 10 items) to Zeus's session state. Update on every tool_use/tool_result/text event. Display in a compact "Activity" strip in the session card.

```typescript
interface SessionActivity {
  type: 'tool_start' | 'text' | 'result' | 'error';
  summary: string;   // "Running bash: npm test"
  timestamp: number;
}
```

---

### 14. Task Output File Streaming

See [item 4](#4-task-streaming-architecture) for full details. The quick win version:
- Write session output to JSONL files
- Send only new entries over WebSocket (offset-based)
- ~50 lines of code, major perf improvement for long sessions

---

### 15. Concurrency-Safe Tool Batching

**Claude Code Pattern:** `StreamingToolExecutor` partitions tool calls into batches:
- Read-only tools (Read, Glob, Grep) → run in parallel
- Mutation tools (Edit, Write, Bash) → run exclusively
- If a Bash tool errors, abort sibling tools

**Action:** Zeus doesn't execute tools directly, but can use this pattern for **WebSocket message processing** — batch read-only queries (git status, file tree) but serialize mutation commands.

---

## What NOT to Copy

| Feature | Why Skip It |
|---------|-------------|
| **Buddy (Tamagotchi pet)** | Fun but irrelevant to Zeus's orchestration mission |
| **KAIROS (always-on mode)** | Zeus IS the always-on layer — don't duplicate |
| **ULTRAPLAN (remote planning)** | Zeus's sessions are already remote; redundant |
| **Undercover Mode** | Zeus doesn't contribute to external repos |
| **Penguin Mode (fast mode)** | This is an API-level optimization, not Zeus's concern |
| **Computer Use (Chicago)** | Zeus already has PinchTab/QA for browser automation |
| **Compile-time DCE** | Zeus ships as Electron, not npm — no sourcemap risk |
| **Source map bundling** | Obviously |

---

## Implementation Roadmap

### Phase 1: Foundation (1-2 weeks)
- [ ] **Structured Agent Protocol** — Define `ZeusSDKMessage` types, update protocol peer parsing
- [ ] **Branded Type IDs** — Add `SessionId`, `TaskId`, `EntryId` branded types
- [ ] **Activity Ring Buffer** — Add `recentActivity` to session state

### Phase 2: Streaming & Permissions (2-3 weeks)
- [ ] **Task Output File Streaming** — JSONL output files with offset-based reads
- [ ] **Permission Bridge** — Control request/response round-trip through UI
- [ ] **Feature Gating** — SQLite-backed feature flag system

### Phase 3: Orchestration (3-4 weeks)
- [ ] **Coordinator Mode** — Cross-session task notifications and synthesis
- [ ] **Hook System** — 8 core hook events with shell command execution
- [ ] **Tool Registry** — Dynamic tool metadata with pluggable renderers

### Phase 4: Intelligence (2-3 weeks)
- [ ] **Dream System** — Three-gate trigger + four-phase consolidation
- [ ] **Worktree Isolation** — Default isolation for all task sessions
- [ ] **Agent Teams** — Named teams with broadcast messaging

---

## Reference: Claude Code Key Files

These files in `tmp/claude-code2/` are the most relevant for Zeus development:

| File | What to Study |
|------|---------------|
| `bridge/bridgeApi.ts` | Session registration & polling pattern |
| `bridge/sessionRunner.ts` | How Claude spawns child processes |
| `bridge/replBridge.ts` | WebSocket message transport |
| `coordinator/coordinatorMode.ts` | Multi-agent orchestration prompt & protocol |
| `remote/SessionsWebSocket.ts` | WebSocket client with reconnect & queueing |
| `remote/RemoteSessionManager.ts` | Message routing & permission delegation |
| `Task.ts` + `tasks.ts` | Task lifecycle & ID generation |
| `tasks/LocalAgentTask/` | Background agent execution pattern |
| `services/autoDream/` | Three-gate trigger + consolidation phases |
| `services/tools/StreamingToolExecutor.ts` | Concurrent tool execution batching |
| `state/AppStateStore.ts` | State schema for UI binding |
| `tools/permissions/` | Permission modes, classifiers, risk levels |
| `memdir/memdir.ts` | Memory prompt building with truncation |
| `memdir/paths.ts` | Memory path resolution with security checks |
| `types/permissions.ts` | Full permission type system |
| `types/hooks.ts` | Hook event definitions & response schemas |
| `constants/systemPromptSections.ts` | Cached prompt section pattern |
| `entrypoints/init.ts` | Phased initialization (configs → analytics → security) |

---

*Document generated from analysis of Claude Code source (March 31, 2026 npm sourcemap exposure) and Zeus codebase as of March 31, 2026.*
