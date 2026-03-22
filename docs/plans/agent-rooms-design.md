# Agent Rooms — Inter-Agent Communication & Orchestration

> Multi-agent coordination layer for Zeus. Agents share a room, communicate through a group chat, and are orchestrated by a PM agent — all fully async, non-blocking.

---

## 1. Core Concept

A **Room** is a shared workspace where multiple agents collaborate on a task. One agent is the **PM (Project Manager)** — the orchestrator. All other agents are **workers**. Every agent in the room can see every other agent, read the shared message log, and post to it.

The PM's session view IS the room view. Its conversation thread doubles as the group chat feed.

### Mental Model

Think of it as a war room:
- Everyone talks out loud (no private DMs)
- The PM assigns work, checks progress, routes information
- Workers do their tasks, report back, ask questions
- Anyone can see what anyone else posted
- The PM can bring people in or dismiss them
- If the PM leaves, a new PM takes the chair — the room persists

### Key Principle: Agents Are Roles, Not Processes

A PM has a stable `agent_id` that persists across Claude session restarts. The `claude_session_id` is disposable — it changes on respawn. The agent identity (role, history, relationships) lives in Zeus's DB, not in Claude's context window.

---

## 1.1 Relationship to Existing Subagent System

Zeus already has `subagent_sessions` and `subagent_entries` tables, plus the `wireSubagent()` flow in `websocket.ts`. Rooms **replace subagents for multi-agent coordination** but **coexist for simple fire-and-forget use cases**.

| | Subagents (existing) | Room Agents (new) |
|--|---------------------|-------------------|
| **Use case** | Single-task worker (QA run, plan review) | Multi-agent coordination with shared context |
| **Communication** | None — result returned to parent via deferred response | Group chat, directed messages, PM orchestration |
| **Discovery** | Parent knows child, child doesn't know siblings | All agents know all agents |
| **Lifecycle** | Spawn → run → return result → kill | Spawn → run → communicate → signal done (or be dismissed/paused/resumed) |
| **State persistence** | `subagent_sessions` + `subagent_entries` | `room_agents` + `room_messages` + per-agent `claude_entries` |
| **PM injection** | None | Zeus drives PM turns based on room events |

**Migration path**: Existing QA subagents continue to work as-is. When a room is active, `room_spawn_agent({ roomAware: false })` uses the same underlying `ClaudeSession` spawn but registers in `room_agents` instead of `subagent_sessions`. Over time, room-aware agents replace subagents for any task needing coordination.

**No breaking changes**: The `subagent` channel, `wireSubagent()`, and `subagent_sessions` table remain untouched. Rooms are additive.

---

## 2. Room Lifecycle

### 2.1 Creation

User starts a Claude session and gives it a task that needs multiple agents. The PM decides (or the user explicitly instructs) to create a room.

```
User: "Build the new GitHub feature. You'll need an architect, tester, and reviewer."

PM calls: room_create({ name: "GitHub Feature X", task: "Build new GitHub feature" })

Zeus:
  1. Creates Room record in SQLite
  2. Registers PM as first agent in room_agents
  3. Posts [SYSTEM] message: "Room created. PM: <role>. Task: <description>"
  4. Returns room_id to PM
```

### 2.2 Agent Spawning (Non-Blocking)

PM spawns agents. **Every spawn returns instantly.** The agent boots in the background.

```
PM calls: room_spawn_agent({
  role: "architect",
  model: "claude-opus-4-6",
  prompt: "You are the architect for GitHub Feature X. Design the API schema and component structure.",
  roomAware: true,           // gets room MCP tools (default)
  permissionMode: "plan"
})

Zeus:
  1. Creates room_agents record (agent_id, room_id, role, status: "spawning")
  2. Starts Claude session in background (same as start_claude today)
  3. Appends room context to the agent's system prompt (see §3.2)
  4. Injects room MCP tools into the agent's MCP config
  5. Returns IMMEDIATELY: { agentId: "agent-001", status: "spawning" }
  6. Posts [SYSTEM] "Agent 'architect' (agent-001) joined."
  7. When agent's Claude session is ready, updates status: "running"
```

**Isolated agents** (no room awareness):

```
PM calls: room_spawn_agent({
  role: "dep-checker",
  prompt: "Read package.json and list all outdated dependencies.",
  roomAware: false    // no room MCP tools, no group chat access
})

Zeus:
  1. Spawns Claude session, NO room MCP tools injected
  2. Agent does its work, exits
  3. Zeus captures result (see §2.2.1), posts [SYSTEM] "Isolated agent 'dep-checker' finished."
  4. PM reads result via room_get_agent_state(agentId)
```

### 2.2.1 Isolated Agent Result Capture

When an isolated agent's Claude session finishes (`done` event), Zeus extracts its result:

1. **Primary**: Read the last `assistant_message` entry from `claude_entries` for that session. Store its `content` field in `room_agents.result`.
2. **Fallback**: If no assistant message exists (agent crashed before responding), store the error or empty string.
3. **Extended inspection**: The PM (or any room-aware agent) can call `room_get_agent_log({ agentId })` to read the full `claude_entries` for that agent's session — not just the summary.

For room-aware agents that call `room_signal_done({ summary })`, the `summary` parameter is stored directly in `room_agents.result`.

### 2.2.2 Spawn Failure Handling

If an agent's Claude session fails to start (bad model, npx failure, system resource limits):

1. Zeus catches the `error` event from `ClaudeSession`
2. Updates `room_agents.status` → `dead`
3. Stores the error message in `room_agents.result`
4. Posts `[SYSTEM]` error message to room: "Agent '<role>' failed to start: <error>"
5. Triggers immediate PM turn injection (same priority as agent crash)

### 2.3 Active Operation

Once agents are running, the room operates through the message log (§4) and Zeus-driven PM turns (§5).

### 2.4 Agent Dismissal

```
PM calls: room_dismiss_agent({ agentId: "agent-001" })

Zeus:
  1. Sends interrupt/stop to the agent's Claude session
  2. Updates room_agents status: "dismissed"
  3. Posts [SYSTEM] "Agent 'architect' (agent-001) dismissed by PM."
  4. Agent's session can be resumed later if needed
```

### 2.5 Agent Self-Completion

```
Agent calls: room_signal_done({ summary: "Architecture complete. Design posted." })

Zeus:
  1. Updates room_agents status: "done"
  2. Stores summary in room_agents.result
  3. Posts [SYSTEM] "Agent 'architect' signaled done: Architecture complete."
  4. Triggers PM turn injection (see §5)
```

### 2.6 Room Completion

```
PM calls: room_complete({ summary: "Feature built, tested, PR ready." })

Zeus:
  1. Dismisses all remaining active agents
  2. Updates room status: "completed"
  3. Posts [SYSTEM] "Room completed. Summary: ..."
  4. Room becomes read-only archive
```

### 2.7 PM Death & Recovery

If the PM's Claude session dies (crash, context overflow, manual stop):

```
Zeus detects PM session exit
  │
  ├─ Step 1: Try resume
  │   Send resume_claude with session_id + last_message_id
  │   If resume succeeds → PM picks up where it left off
  │   Same agent_id, same claude_session_id
  │
  └─ Step 2: If resume fails → Respawn
      1. Start new Claude session
      2. Construct context payload from:
         - Room task description
         - Full room_messages log (the group chat history)
         - Current room_agents list with statuses
         - Last PM summary (if any)
      3. Inject as first user turn: "You are resuming as PM for room '<name>'. Here is the context: ..."
      4. Update room_agents: PM's claude_session_id → new session ID
      5. agent_id stays the same (PM identity preserved)
      6. Post [SYSTEM] "PM session respawned. New session linked."
```

The PM's agent_id is stable. The claude_session_id is disposable. All history lives in room_messages, not in any single Claude context.

---

## 3. MCP Tools

### 3.1 PM Tools (injected into PM's session)

| Tool | Returns | Blocking? |
|------|---------|-----------|
| `room_create({ name, task })` | `{ roomId }` | No |
| `room_spawn_agent({ role, model?, prompt, roomAware?, permissionMode?, workingDir? })` | `{ agentId, status: "spawning" }` | No |
| `room_dismiss_agent({ agentId })` | `{ dismissed: true }` | No |
| `room_list_agents()` | Agent list with statuses | No |
| `room_get_agent_state({ agentId })` | Agent detail + last activity + result | No |
| `room_post_message({ message, type?, to? })` | `{ messageId }` | No |
| `room_read_messages({ since?, limit? })` | Message array | No |
| `room_pause_agent({ agentId })` | `{ paused: true }` | No |
| `room_resume_agent({ agentId })` | `{ resumed: true, status }` | No |
| `room_replace_pm({ newModel?, newPrompt? })` | `{ newAgentId, status }` | No |
| `room_complete({ summary })` | `{ completed: true }` | No |

### 3.2 Worker Agent Tools (injected into room-aware agents)

| Tool | Returns | Blocking? |
|------|---------|-----------|
| `room_post_message({ message, type?, to? })` | `{ messageId }` | No |
| `room_read_messages({ since?, limit? })` | Message array | No |
| `room_list_agents()` | Agent list with statuses | No |
| `room_get_agent_state({ agentId })` | Agent detail | No |
| `room_signal_done({ summary })` | `{ signaled: true }` | No |

Workers do NOT get `room_spawn_agent`, `room_dismiss_agent`, `room_pause_agent`, `room_resume_agent`, `room_replace_pm`, or `room_complete`. Only the PM orchestrates.

### 3.5 Extended Tools (PM only)

| Tool | Returns | Blocking? |
|------|---------|-----------|
| `room_get_agent_log({ agentId, limit? })` | Array of `claude_entries` for that agent's session | No |

Used by the PM to inspect an agent's internal conversation — what tools it called, what it was thinking, etc. Useful for debugging or when the PM needs more detail than `room_get_agent_state` provides.

### 3.3 Isolated Agents

No room tools at all. They receive a prompt, execute it, and exit. Zeus captures the output.

### 3.4 MCP Bootstrapping Strategy

Room MCP tools are delivered via two mechanisms:

**1. `room_create` lives in `zeus-bridge` (not `zeus-room`)**

The bootstrap problem: a regular Claude session doesn't have room tools yet — it needs to call `room_create` first. But `zeus-room` is only injected for sessions that already have a `roomId`. Chicken-and-egg.

**Solution**: Add `room_create` as a tool on `zeus-bridge`, which is already injected into ALL parent Claude sessions. When any session calls `room_create`:
1. Zeus creates the room + PM agent record
2. Returns `{ roomId, agentId }` to the caller
3. The calling session is now the PM — but it doesn't have `zeus-room` tools yet
4. Zeus stores `roomId` + `agentId` on the session record so the PM can use them on resume
5. On the PM's next turn, Zeus injects a system message: "Room created. Your room tools (room_spawn_agent, room_post_message, etc.) will be available on session restart. For now, you can use room_create_and_spawn via zeus-bridge to get started."

For **immediate use without restart**, `zeus-bridge` also exposes thin proxy tools: `room_spawn_agent`, `room_post_message`, `room_read_messages`, `room_list_agents`, `room_dismiss_agent`, `room_complete`. These proxy through to `room-manager.ts` directly. This way the PM can orchestrate immediately — no session restart needed.

Worker agents spawned INTO a room always get `zeus-room` injected at start (they have a `roomId` from birth).

**2. `zeus-room` for spawned room-aware agents**

```typescript
// In claude-session.ts:buildArgs(), for agents spawned into a room:
if (this.options.roomId && this.options.roomAware !== false) {
  const roomPath = path.resolve(app.getAppPath(), 'out/main/mcp-zeus-room.mjs');
  mcpServers['zeus-room'] = {
    command: 'node',
    args: [roomPath],
    env: {
      ZEUS_ROOM_ID: this.options.roomId,
      ZEUS_AGENT_ID: this.options.agentId,
      ZEUS_AGENT_ROLE: this.options.agentRole,   // 'pm' | 'worker'
      ZEUS_WS_URL: wsUrl
    }
  };
}
```

**PM vs Worker tool filtering**: The `zeus-room` MCP server reads `ZEUS_AGENT_ROLE` from env. If `pm`, it exposes all tools (spawn, dismiss, complete, etc.). If `worker`, it exposes only worker tools (post, read, list, signal_done). One MCP server binary, two tool sets.

**The PM session also keeps `zeus-bridge`** — it needs both bridge tools (QA, session management) and room tools. They coexist as separate MCP servers in the `--mcp-config`.

**3. Build pipeline**

`zeus-room.ts` must compile to `mcp-zeus-room.mjs` and be included in the build output. Add to `electron.vite.config.ts`:

```typescript
// In the main process build config, alongside existing MCP entries:
build: {
  rollupOptions: {
    input: {
      index: 'src/main/index.ts',
      'mcp-zeus-bridge': 'src/main/mcp/zeus-bridge.ts',
      'mcp-qa-server': 'src/main/mcp/qa-server.ts',
      'mcp-zeus-room': 'src/main/mcp/zeus-room.ts',   // ← NEW
    }
  }
}
```

### 3.5 System Prompt Injection for Room-Aware Agents

When a room-aware agent is spawned, Zeus appends to its system prompt:

```
--- ROOM CONTEXT ---
You are working in Room "{room_name}" (room_id: {room_id}).
Your role: {role}
Your agent ID: {agent_id}

Current agents in this room:
{for each agent: "- {role} ({agentId}) — status: {status}"}

You have MCP tools for room communication:
- room_post_message(message, type?, to?) — post to room group chat
- room_read_messages(since?, limit?) — read room messages
- room_list_agents() — see all agents in the room
- room_get_agent_state(agentId) — check another agent's status
- room_signal_done(summary) — signal that your task is complete

IMPORTANT:
- After completing each significant step, call room_read_messages() to check for new directives or questions from other agents.
- If another agent asks you a question (message directed to you), respond via room_post_message().
- When your assigned task is fully complete, call room_signal_done() with a summary.
- All communication is visible to the entire room. There are no private messages.
--- END ROOM CONTEXT ---
```

---

## 4. Room Message System

### 4.1 Message Types

| Type | Purpose | Example |
|------|---------|---------|
| `system` | Zeus-generated events | "Agent 'architect' joined." |
| `directive` | PM assigns/routes work | "@tester write test plan based on architect's design" |
| `finding` | Agent shares work output | "## API Design\n POST /features ..." |
| `question` | Agent asks another agent | "@frontend how do I trigger auth component?" |
| `status_update` | Progress without completion | "50% through test suite, 12/24 passing" |
| `signal_done` | Agent completed task | "Architecture complete. Design posted." |
| `error` | Something went wrong | "Build failed: missing dependency X" |

### 4.2 Message Schema

```typescript
interface RoomMessage {
  messageId: string;          // UUID
  roomId: string;             // FK → rooms
  fromAgentId: string | null; // null for SYSTEM messages
  toAgentId: string | null;   // null = broadcast, set = directed (but still visible to all)
  type: 'system' | 'directive' | 'finding' | 'question' | 'status_update' | 'signal_done' | 'error';
  content: string;            // markdown
  mentions: string[];         // agent_ids referenced in content
  metadata: unknown;          // structured data (test results, code snippets, etc.)
  seq: number;                // auto-increment for ordering
  timestamp: string;          // ISO 8601
}
```

### 4.3 Directed Messages

The `toAgentId` field is a **routing hint**, not a privacy filter. All messages are visible to all agents. Directed messages:
- Display with "→ @target" in the UI
- Help agents prioritize (messages directed at you > general broadcasts)
- Help the PM see conversation flows between agents

### 4.4 Mentions Population

The `mentions` field is **auto-populated by Zeus** when a message is inserted. Zeus scans the message `content` for `@<role>` patterns (e.g., `@architect`, `@qa`, `@pm`) and resolves them to `agent_id`s by matching against `room_agents.role` in that room.

Rules:
- `@<role>` matches by role name (case-insensitive): `@architect` → agent with `role = "architect"`
- If `toAgentId` is set by the caller, that agent_id is always included in `mentions`
- If multiple agents share a role (unlikely but possible), all matching agent_ids are included
- Unresolvable mentions (e.g., `@nonexistent`) are silently ignored

**PM injection trigger**: Zeus checks if `room.pm_agent_id` is in the resolved `mentions` array OR if `to_agent_id == room.pm_agent_id`. Either condition triggers immediate PM injection. This means both `room_post_message({ to: pmAgentId, ... })` AND `room_post_message({ message: "@pm help me", ... })` will wake the PM.

### 4.5 Read Cursor Semantics

When an agent calls `room_read_messages()`, Zeus:
1. Reads messages where `seq > agent's room_read_cursors.last_seq` (or all if no cursor exists)
2. Applies `limit` (default 50) and returns the messages
3. **Auto-updates** `room_read_cursors.last_seq` to the highest `seq` in the returned set

This is an atomic read-and-advance operation. The agent never needs to manually update its cursor. If `since` is explicitly provided, it overrides the cursor for that call but still updates the cursor to the highest returned seq.

The cursor is also used by Zeus to determine "does this agent have unread messages?" for:
- Worker turn-boundary nudge (§6.1 Layer 2): check if `room_messages` has entries with `to_agent_id = agent AND seq > cursor`
- Unread count in the agent sidebar UI

### 4.6 Persistence

All messages stored in SQLite `room_messages` table. Survives agent crashes, PM respawns, app restarts. The message log is the source of truth for the room's history — not any agent's context window.

---

## 5. PM Turn Injection (Zeus-Driven Orchestration)

### 5.1 The Problem

After the PM finishes a turn (spawned agents, posted directives), its Claude session has nothing to do. No user is typing. The PM just stops. But agents are working in the background — they'll post findings, signal done, ask questions. Something needs to wake the PM up.

### 5.2 The Solution

Zeus watches the `room_messages` table. When significant events happen, Zeus injects a new user turn into the PM's Claude session via `ProtocolPeer` (stdin stream-json).

### 5.3 Injection Triggers

| Event | Inject PM Turn? | Priority |
|-------|----------------|----------|
| Agent signals done | Yes | Normal — batch with other events (5s window) |
| Agent posts a finding | Yes | Normal — batch |
| Agent posts question directed at PM | Yes | Immediate |
| Agent-to-agent question/response | No | PM reads on next natural turn |
| Agent crashes / errors | Yes | Immediate |
| Agent idle too long (threshold: configurable) | Yes | Low — only after threshold |
| All agents done | Yes | Immediate |
| Isolated agent finished | Yes | Normal — batch |

### 5.4 Injection Format

Zeus sends a user turn to the PM's stdin:

```json
{
  "type": "user",
  "content": "Room update (auto):\n- @architect posted finding: \"API Design\" (142 words)\n- @architect signaled done: \"Architecture complete.\"\n- @tester status: running (no new messages)\n- @qa status: idle\n\nCheck room_read_messages() for full content. Decide next steps."
}
```

The PM wakes up, calls `room_read_messages()`, reads full content, makes decisions, posts directives, turn ends. Zeus waits for the next trigger.

### 5.5 PM Turn State Machine

Zeus must only inject a turn when the PM session is idle. The PM session has three states:

```
PM Session States:
  idle          — after emitting `result`, before next user message. Injection ALLOWED.
  processing    — between receiving user message and emitting `result`. Injection QUEUED.
  waiting_approval — tool approval pending. Injection QUEUED.

State Transitions:
  idle → processing        (user message sent or Zeus injects turn)
  processing → idle        (PM emits `result` event)
  processing → waiting_approval  (PM emits `approval_needed`)
  waiting_approval → processing  (approval resolved)
```

**Queueing**: If the PM is `processing` or `waiting_approval` when an injection trigger fires, Zeus queues the event. When the PM transitions back to `idle`, Zeus delivers all queued events as a single batched injection.

**User turn priority**: If the user types a message while injections are queued, the user message is sent first. Queued injections are folded into the next batch window after the user turn completes.

### 5.5.1 Required Changes to ClaudeSession

Today `ClaudeSession` only tracks `_isRunning: boolean`. The PM state machine requires a richer `turnState` property:

```typescript
// New property on ClaudeSession:
private _turnState: 'idle' | 'processing' | 'waiting_approval' = 'idle';
get turnState() { return this._turnState; }

// State transitions wired to existing events:
// In start() / sendMessage():  _turnState = 'processing'
// On 'result' event:           _turnState = 'idle'
// On 'approval_needed' event:  _turnState = 'waiting_approval'
// On approveTool/denyTool:     _turnState = 'processing'
// On 'done' / 'error':         _turnState = 'idle'
```

This is a small, backward-compatible addition to `ClaudeSession`. Existing code doesn't use `turnState` and won't be affected. The `room-injection.ts` module reads `session.turnState` to decide whether to inject or queue.

### 5.6 Batching

To avoid spamming the PM with rapid-fire updates, Zeus batches events within a 5-second window. If 3 agents post findings within 5 seconds, the PM gets one injection with all 3 listed. Exception: immediate-priority events (errors, PM-directed questions) bypass batching.

### 5.7 User Can Also Drive PM Turns

The user (on phone/web) can type into the PM's session directly. This shows up as a normal user turn. The PM treats it the same as any other input — reads it, acts on it. User messages always override/interrupt batched injections.

---

## 6. Worker Agent Behavior

### 6.1 Worker Polling: Instruction-Based + Safety Net

Worker agents primarily drive themselves. Their system prompt instructs them to poll after each major step. But **LLMs don't reliably follow polling instructions** — an agent deep in a 15-tool-call coding session may ignore the directive for 10+ tool calls.

**Defense in depth (three layers):**

**Layer 1: System prompt instruction** (cheap, usually works)
> "After completing each significant step, call room_read_messages() to check for new directives or questions directed at you."

**Layer 2: Turn-boundary nudge** (reliable, but only fires between turns)
When a worker agent's turn completes (`result` event) and there are unread messages directed at it (checked via `room_read_cursors`), Zeus injects a follow-up turn:
```
"You have unread room messages directed at you. Call room_read_messages() before continuing."
```
This uses the same `ProtocolPeer.sendUserMessage()` mechanism as PM injection, but only fires when the agent naturally pauses. No mid-turn interruption.

**Layer 3: Zombie detection** (last resort)
Zeus tracks `last_activity_at` on each agent. If a running agent hasn't emitted an `entry` event or posted a room message for a configurable threshold (default: 5 minutes), Zeus:
1. Posts `[SYSTEM]` warning to room: "Agent '<role>' appears idle (no activity for 5m)"
2. Triggers PM turn injection so the PM can decide: wait, nudge, or dismiss

This creates a natural check-in cadence: agent writes code → checks room (Layer 1) → if it forgets, checks at turn boundary (Layer 2) → if it's stuck, PM gets alerted (Layer 3).

### 6.2 Agent-to-Agent Interaction

All agent-to-agent communication goes through the room group chat. No direct connections.

**Example: QA asks Frontend a question**

```
QA calls: room_post_message({
  message: "@frontend I'm testing login flow but submit button isn't rendering. How do I trigger the auth component?",
  type: "question",
  to: "agent-003"   // frontend's agent_id
})

Zeus stores in room_messages. Does NOT wake PM (agent-to-agent).

Frontend agent, on next room_read_messages() call, sees the question.

Frontend calls: room_post_message({
  message: "@qa Login form requires AuthProvider context. Navigate to /login after full mount. Wait for [data-testid='login-submit'] selector.",
  type: "finding",
  to: "agent-qa"
})

QA picks up the response on its next poll. Adjusts approach. Continues.
```

The PM sees this exchange on its next turn but doesn't need to be woken up for it. Agents resolved it themselves.

### 6.3 Agent Escalation to PM

If a worker agent is stuck and needs PM intervention:

```
Agent calls: room_post_message({
  message: "@pm I'm blocked. The test database isn't seeded and I can't run integration tests. Need someone to set up fixtures.",
  type: "question",
  to: "pm-agent-id"
})
```

Zeus detects `to: pm-agent-id` → triggers immediate PM turn injection.

---

## 7. Data Model

### 7.1 New Tables

```sql
-- The room itself
CREATE TABLE rooms (
  room_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  task         TEXT NOT NULL,           -- description of what the room is working on
  pm_agent_id  TEXT,                    -- FK → room_agents.agent_id (nullable at creation, set immediately after PM agent insert)
  status       TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed
  token_budget INTEGER,                -- optional max tokens across all agents (null = unlimited)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Every agent in a room (including PM)
CREATE TABLE room_agents (
  agent_id          TEXT PRIMARY KEY,         -- Zeus-generated, stable across respawns
  room_id           TEXT NOT NULL,            -- FK → rooms
  role              TEXT NOT NULL,            -- pm | architect | tester | qa | reviewer | custom
  claude_session_id TEXT,                     -- FK → claude_sessions.id (nullable, changes on respawn)
  model             TEXT,                     -- claude-opus-4-6, claude-sonnet-4-6, etc.
  status            TEXT NOT NULL DEFAULT 'spawning',
                                              -- spawning | running | idle | done | paused | dismissed | dead
  room_aware        INTEGER NOT NULL DEFAULT 1,  -- 1 = has room MCP tools, 0 = isolated
  prompt            TEXT NOT NULL,            -- original task/instructions
  result            TEXT,                     -- final output (for isolated agents or signal_done summary)
  tokens_used       INTEGER NOT NULL DEFAULT 0, -- cumulative token usage from claude_entries token_usage events
  spawned_by        TEXT,                     -- FK → room_agents.agent_id (null for PM)
  working_dir       TEXT,                     -- working directory for this agent's session
  last_activity_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- The group chat / message log
CREATE TABLE room_messages (
  message_id    TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,              -- FK → rooms
  from_agent_id TEXT,                       -- FK → room_agents (null = SYSTEM)
  to_agent_id   TEXT,                       -- FK → room_agents (null = broadcast)
  type          TEXT NOT NULL,              -- system | directive | finding | question | status_update | signal_done | error
  content       TEXT NOT NULL,              -- markdown
  mentions      TEXT NOT NULL DEFAULT '[]', -- JSON array of agent_ids (auto-populated, see §4.5)
  metadata      TEXT,                       -- JSON, structured data
  seq           INTEGER NOT NULL,           -- per-room ordering (see §7.4)
  timestamp     TEXT NOT NULL
);

-- Track what each agent has read (for unread detection)
CREATE TABLE room_read_cursors (
  agent_id    TEXT NOT NULL,    -- FK → room_agents
  room_id     TEXT NOT NULL,    -- FK → rooms
  last_seq    INTEGER NOT NULL DEFAULT 0,  -- last seq number this agent has read
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (agent_id, room_id)
);
```

**Insertion order for room creation** (resolves circular FK between rooms and room_agents):
1. Insert `rooms` row with `pm_agent_id = NULL`
2. Insert PM `room_agents` row with `room_id`
3. Update `rooms.pm_agent_id` to the PM's `agent_id`
All three statements run inside a single transaction.

### 7.2 Indexes

```sql
CREATE INDEX idx_room_agents_room ON room_agents(room_id);
CREATE INDEX idx_room_agents_session ON room_agents(claude_session_id);
CREATE INDEX idx_room_messages_room_seq ON room_messages(room_id, seq);
CREATE INDEX idx_room_messages_to ON room_messages(to_agent_id);
```

### 7.3 Concurrency & Seq Generation

SQLite's single-writer guarantee ensures `room_messages` inserts are serialized. WAL mode (already enabled in Zeus) allows concurrent reads. No application-level locking is needed beyond the per-room seq transaction.

**Seq generation** — `seq` is computed at insert time, per room:

```sql
-- Must run inside a transaction
INSERT INTO room_messages (message_id, room_id, ..., seq, ...)
VALUES (?, ?, ...,
  (SELECT COALESCE(MAX(seq), 0) + 1 FROM room_messages WHERE room_id = ?),
  ...);
```

This guarantees monotonically increasing seq per room. The transaction + SQLite's single writer ensures no gaps or duplicates.

### 7.4 Relationship to Existing Tables

- `room_agents.claude_session_id` → `claude_sessions.id` (existing table)
- `claude_entries` still stores per-session entries (agent's internal conversation)
- `room_messages` is a NEW layer on top — cross-session communication only
- Rooms can optionally link to `tasks` (worktree isolation) via a `room_id` column on `tasks`

---

## 8. UI: Room View

### 8.1 Primary View: PM Session = Room Feed

The PM's session view in the renderer transforms into the room view when a room is active. The group chat messages interleave with the PM's own conversation.

```
┌─────────────────────────────────────────────────────────┐
│  Room: GitHub Feature X                 4 agents active  │
│  ─────────────────────────────────────────────────────── │
│                                                          │
│  [SYSTEM] Room created. Task: "GitHub feature X"         │
│                                                          │
│  [PM] @architect design the API. @tester wait.           │
│  @qa standby. @reviewer on call.                         │
│                                                          │
│  [SYSTEM] architect (agent-001) joined.                  │
│  [SYSTEM] tester (agent-002) joined.                     │
│  [SYSTEM] qa (agent-003) joined.                         │
│                                                          │
│  [architect] ## API Design                               │
│  POST /features — creates feature entry...               │
│  Components: FeatureCard, FeatureList...                 │
│                                          [finding] [done]│
│                                                          │
│  [qa → @frontend] Can't test login, submit               │
│  button not rendering. How to trigger?   [question]      │
│                                                          │
│  [frontend → @qa] Needs AuthProvider context.             │
│  Wait for [data-testid='login-submit'].  [finding]       │
│                                                          │
│  [SYSTEM] Isolated agent "dep-checker" finished.         │
│  > View result                                           │
│                                                          │
│  [PM] Architect done. Routing design to reviewer.        │
│  @tester go ahead with test plan.                        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Type directive to agents...]                           │
└──────────────────────────────────────────────────────────┘
```

### 8.2 Agent Sidebar

Right sidebar shows all agents in the room with live status:

```
┌─────────────────────┐
│  AGENTS              │
│                      │
│  ★ PM          running│
│  🏗 architect    done │
│  🧪 tester    running │
│  🔍 qa        running │
│  📋 reviewer    idle  │
│                      │
│  [+ Spawn Agent]     │
│  [Complete Room]     │
└─────────────────────┘
```

Clicking an agent opens its individual session view (its internal Claude conversation, tool calls, etc.) — the same ClaudeView we have today.

### 8.3 User Interactions

From the UI, the user can:
- **Type in the PM input box** → sends as user turn to PM session
- **Click an agent** → view its internal session (read-only or interactive)
- **Spawn agent manually** → UI sends room_spawn_agent via PM or directly via WebSocket
- **Dismiss agent** → UI triggers room_dismiss_agent
- **Pause/resume agent** → suspend and later resume an agent's Claude session

---

## 9. WebSocket Integration

### 9.1 New Channel: `room`

Add `room` to the existing channel enum. All room-related WebSocket messages flow through this channel.

### 9.2 Message Types (Server → Client)

| Payload Type | Data | When |
|-------------|------|------|
| `room_created` | Room record | Room is created |
| `room_updated` | Room record | Status/metadata changes |
| `room_agent_joined` | Agent record | Agent spawned and registered |
| `room_agent_updated` | Agent record | Status change (running/done/dismissed/etc.) |
| `room_message` | RoomMessage record | Any message posted to the room |
| `room_completed` | Room record + summary | Room is completed |

### 9.3 Message Types (Client → Server)

| Payload Type | Data | Purpose |
|-------------|------|---------|
| `create_room` | name, task, sessionId | User creates room from UI |
| `spawn_agent` | roomId, role, prompt, model, roomAware | User spawns agent from UI |
| `dismiss_agent` | roomId, agentId | User dismisses agent |
| `post_message` | roomId, message, type | User posts to room chat |
| `list_rooms` | — | Get all rooms |
| `get_room` | roomId | Get room detail + agents + recent messages |

### 9.4 Broadcasting

When a room_message is created (from any source — MCP tool, system event, user input):
1. Store in SQLite
2. Broadcast to ALL connected WebSocket clients via `room` channel
3. Check PM injection triggers (§5.3)

---

## 10. Multi-Model Support

Rooms are not limited to Claude. The `room_spawn_agent` tool accepts a `model` parameter. Zeus can spawn:

- **Claude sessions** (current implementation) — any Claude model
- **Other LLM providers** (future) — the agent spawn layer abstracts over the backend

For now, all agents are Claude sessions with different models (opus, sonnet, haiku). The room protocol (messages, status, lifecycle) is model-agnostic — it only depends on the agent being able to call MCP tools.

Future: swap Claude for GPT, Gemini, local models, or even non-LLM automation scripts — as long as they speak MCP, they participate in the room.

---

## 11. Session Resume & Continuity

### 11.1 Agent Resume

Any agent (including PM) can be paused and resumed:

```
room_pause_agent({ agentId: "agent-002" })
→ Zeus stops the Claude session (saves session_id + last_message_id)
→ Status: "paused"
→ [SYSTEM] "Agent 'tester' paused."

room_resume_agent({ agentId: "agent-002" })
→ Zeus calls resume_claude with saved session_id
→ Status: "running"
→ [SYSTEM] "Agent 'tester' resumed."
→ On resume, agent gets: "You were paused. Check room_read_messages() for updates since you were away."
```

### 11.2 PM Handoff

If the user wants to swap the PM (different model, different approach):

```
room_replace_pm({ newModel: "claude-opus-4-6", newPrompt: "..." })

Zeus:
  1. Pause current PM
  2. Spawn new PM session with full room context (§2.7 Step 2)
  3. Update rooms.pm_agent_id to new agent
  4. [SYSTEM] "PM replaced. New PM session active."
```

---

## 12. Resource Limits & Safety

### 12.1 Agent Caps

| Limit | Default | Configurable? |
|-------|---------|---------------|
| Max concurrent agents per room | 8 | Yes (room_create option) |
| Max total agents across all rooms | 15 | Yes (Zeus settings) |
| Max rooms active simultaneously | 5 | Yes (Zeus settings) |

When a limit is hit, `room_spawn_agent` returns an error: `{ error: "max_agents_reached", limit: 8 }`. The PM must dismiss or wait for agents to finish before spawning more.

### 12.2 Token Tracking

Each `room_agents` record has a `tokens_used INTEGER` column (see §7.1). Zeus updates this from `token_usage` entries in `claude_entries` for that agent's session. The PM can check via `room_list_agents()` — token counts are included in the response.

**Room-level budget** (optional): The `rooms` table has a `token_budget INTEGER` column (see §7.1, nullable = unlimited). When total tokens across all agents exceeds budget, Zeus:
1. Posts `[SYSTEM]` warning: "Room token budget 80% consumed (X / Y tokens)"
2. At 100%: Posts warning and triggers PM injection to decide whether to continue or wrap up
3. Does NOT auto-kill agents — the PM decides

### 12.3 Zombie Prevention

Agents running without progress are a cost risk. Three safeguards:

1. **Idle timeout** (configurable, default 5m): No `entry` events and no room messages → Zeus alerts PM (see §6.1 Layer 3)
2. **Max turn count** (optional): If an agent exceeds N turns without calling `room_signal_done` or posting a finding, Zeus alerts PM
3. **PM auto-pause on inactivity**: If the PM itself is idle for 15m with no room events, Zeus pauses all running agents to prevent unmonitored token burn. Room can be resumed later.

### 12.4 Context Window Overflow

Long-running rooms generate many messages. Agents that call `room_read_messages()` may get too much content for their context window.

**Mitigation:**
- `room_read_messages({ since, limit })` — `limit` defaults to 50 messages, not "all"
- Agents should use `since` (their read cursor) to only fetch new messages
- For PM respawn, if room_messages exceeds 200 entries, Zeus generates a summary of older messages and provides only the last 100 in full
- Individual agent sessions naturally shed old context via Claude's built-in context compression
- **Proactive detection**: Zeus tracks the PM's token usage. When the PM's cumulative tokens approach 80% of the model's context window (estimatable from `token_usage` entries), Zeus injects a warning: "Context window approaching limit. Consider completing current coordination and using room_complete, or Zeus will respawn your session with summarized context." At 95%, Zeus proactively triggers PM respawn with summarized room context (§2.7 Step 2).

### 12.5 Working Directory Assignment

When the PM spawns an agent, `working_dir` is determined by:

1. **Explicit**: PM passes `workingDir` in `room_spawn_agent()` — used as-is
2. **Task-linked room**: If the room is linked to a task with a worktree, agents default to the task's `worktree_dir`
3. **PM's directory**: If neither above, inherit the PM's own `working_dir`

Stored in `room_agents.working_dir` and passed to `ClaudeSession` at spawn time.

### 12.6 File Conflict Between Concurrent Agents

Multiple agents writing to the same codebase can create conflicts. Strategies by room configuration:

- **Worktree-per-agent** (safest): Each agent gets its own git worktree. No conflicts possible. PM merges results. High disk usage.
- **Shared worktree with file locking** (practical): Agents share a worktree but coordinate via room messages ("I'm editing src/api.ts"). Conflicts are detected by git and surfaced as room errors. The PM resolves.
- **Shared worktree, trust the agents** (simplest): Agents work in the same directory and use room communication to avoid stepping on each other. Appropriate when agents work on different files (architect on schema, tester on tests).

Default: **shared worktree, trust the agents** with git-based conflict detection as the safety net. The room system prompt can instruct agents to claim files before editing.

### 12.7 Orphaned Agent Reconciliation

If Zeus restarts (crash, update, user restart) while a room is active:

1. **On startup**: Zeus queries `room_agents WHERE status IN ('running', 'spawning')` and `rooms WHERE status = 'active'`
2. **For each orphaned agent**: The underlying Claude CLI process is dead (Zeus restart killed it). Set `status = 'dead'`
3. **For the room**: Post `[SYSTEM]` message: "Zeus restarted. N agents need recovery."
4. **User action**: From the UI, the user can resume individual agents (which triggers Claude session restart) or the PM (which triggers the full PM recovery flow from §2.7)
5. **No auto-restart**: Zeus doesn't automatically restart agents — the user decides which ones to bring back

---

## 13. Implementation Phases

### Phase 1: Foundation (Data + MCP + Basic WebSocket)
- Add rooms, room_agents, room_messages, room_read_cursors tables to `db.ts`
- Room CRUD in new `src/main/services/room-manager.ts`
- Implement `zeus-room` MCP server with all tools from §3
- Wire MCP tools to room-manager
- Add `room` WebSocket channel with basic broadcasting (room_created, room_message, room_agent_joined/updated)
- **Why WebSocket here**: enables visual debugging of room state from Phase 1 onward

### Phase 2: Spawn & Lifecycle + Minimal UI
- Extend `ClaudeSession` with `turnState` property (§5.5.1)
- MCP bootstrapping: inject `zeus-room` in `buildArgs()` for room-aware agents (§3.4)
- System prompt injection for room context (§3.5)
- Agent status tracking (spawning → running → done/dismissed/dead)
- Spawn failure handling (§2.2.2)
- Isolated agent result capture (§2.2.1)
- Basic Room UI: group chat feed + agent sidebar (read-only, no interactions yet)
- **Verification**: can spawn agents from PM, see their messages appear in room, see status changes in UI

### Phase 3: PM Turn Injection
- `room-injection.ts` — PM turn state machine (idle/processing/waiting_approval)
- Room message watcher (poll room_messages for new entries since last injection)
- Injection trigger logic with priority levels (§5.3)
- Batching (5s window, immediate bypass for high-priority)
- User turn priority (user input overrides queued injections)
- Worker turn-boundary nudge (Layer 2 of §6.1)
- **Verification**: PM auto-reacts when agents post findings or signal done

### Phase 4: Interactive UI + Resource Limits
- Room view interactions: spawn agent from UI, dismiss, post messages
- Click-through to individual agent sessions
- Agent caps, token tracking, zombie detection (§12)
- PM death detection and resume/respawn logic (§2.7)

### Phase 5: Polish & Resilience
- Agent pause/resume
- PM handoff/replacement
- Room archival (read-only completed rooms)
- Context window overflow mitigation (message summarization)
- Configurable thresholds (idle timeout, max turns, token budget)
- Room message search/filter

---

## 14. File Structure (New Files)

```
src/
  main/
    services/
      room-manager.ts          — Room CRUD, agent lifecycle, message posting
      room-injection.ts        — PM turn injection logic, batching, triggers
    mcp/
      zeus-room.ts             — MCP server exposing room tools to agents
    __tests__/
      room-manager.test.ts     — Room CRUD, agent spawn/dismiss, message posting tests
      room-injection.test.ts   — PM state machine, batching, trigger tests
  shared/
    room-types.ts              — Room, RoomAgent, RoomMessage type definitions
    __tests__/
      room-types.test.ts       — Type validation and serialization tests
  renderer/
    src/
      components/
        RoomView.tsx           — Main room UI (group chat feed)
        RoomAgentSidebar.tsx   — Agent list with status
        RoomMessage.tsx        — Individual message rendering
      stores/
        useRoomStore.ts        — Zustand store for room state
```
