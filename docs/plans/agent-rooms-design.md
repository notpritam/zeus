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
  3. Zeus captures result, posts [SYSTEM] "Isolated agent 'dep-checker' finished."
  4. PM reads result via room_get_agent_state(agentId)
```

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
| `room_spawn_agent({ role, model?, prompt, roomAware?, permissionMode? })` | `{ agentId, status: "spawning" }` | No |
| `room_dismiss_agent({ agentId })` | `{ dismissed: true }` | No |
| `room_list_agents()` | Agent list with statuses | No |
| `room_get_agent_state({ agentId })` | Agent detail + last activity + result | No |
| `room_post_message({ message, type?, to? })` | `{ messageId }` | No |
| `room_read_messages({ since?, limit? })` | Message array | No |
| `room_complete({ summary })` | `{ completed: true }` | No |

### 3.2 Worker Agent Tools (injected into room-aware agents)

| Tool | Returns | Blocking? |
|------|---------|-----------|
| `room_post_message({ message, type?, to? })` | `{ messageId }` | No |
| `room_read_messages({ since?, limit? })` | Message array | No |
| `room_list_agents()` | Agent list with statuses | No |
| `room_get_agent_state({ agentId })` | Agent detail | No |
| `room_signal_done({ summary })` | `{ signaled: true }` | No |

Workers do NOT get `room_spawn_agent`, `room_dismiss_agent`, or `room_complete`. Only the PM orchestrates.

### 3.3 Isolated Agents

No room tools at all. They receive a prompt, execute it, and exit. Zeus captures the output.

### 3.4 System Prompt Injection for Room-Aware Agents

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

### 4.4 Persistence

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

### 5.5 Batching

To avoid spamming the PM with rapid-fire updates, Zeus batches events within a 5-second window. If 3 agents post findings within 5 seconds, the PM gets one injection with all 3 listed. Exception: immediate-priority events (errors, PM-directed questions) bypass batching.

### 5.6 User Can Also Drive PM Turns

The user (on phone/web) can type into the PM's session directly. This shows up as a normal user turn. The PM treats it the same as any other input — reads it, acts on it. User messages always override/interrupt batched injections.

---

## 6. Worker Agent Behavior

### 6.1 Self-Directed Polling

Worker agents don't get Zeus-injected turns. They drive themselves. Their system prompt instructs:

> "After completing each significant step, call room_read_messages() to check for new directives or questions directed at you."

This creates a natural check-in cadence: agent writes code → checks room → writes more code → checks room.

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
  room_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  task        TEXT NOT NULL,           -- description of what the room is working on
  pm_agent_id TEXT NOT NULL,           -- FK → room_agents.agent_id
  status      TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
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
  spawned_by        TEXT,                     -- FK → room_agents.agent_id (null for PM)
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
  mentions      TEXT NOT NULL DEFAULT '[]', -- JSON array of agent_ids
  metadata      TEXT,                       -- JSON, structured data
  seq           INTEGER NOT NULL,           -- auto-increment per room
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

### 7.2 Indexes

```sql
CREATE INDEX idx_room_agents_room ON room_agents(room_id);
CREATE INDEX idx_room_agents_session ON room_agents(claude_session_id);
CREATE INDEX idx_room_messages_room_seq ON room_messages(room_id, seq);
CREATE INDEX idx_room_messages_to ON room_messages(to_agent_id);
```

### 7.3 Relationship to Existing Tables

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

## 12. Implementation Phases

### Phase 1: Foundation (Data + MCP)
- Add rooms, room_agents, room_messages, room_read_cursors tables
- Implement room MCP server (zeus-room) with all tools from §3
- Room CRUD in a new `src/main/services/room-manager.ts`
- Wire MCP tools to room-manager

### Phase 2: Spawn & Lifecycle
- Extend `ClaudeSessionManager` to support room-aware spawning
- System prompt injection for room context (§3.4)
- Agent status tracking (spawning → running → done/dismissed)
- PM death detection and resume/respawn logic (§2.7)

### Phase 3: PM Turn Injection
- Room message watcher (poll room_messages for new entries)
- PM turn injection via ProtocolPeer stdin
- Batching logic (5s window, immediate for high-priority)
- User turn priority (user input overrides injected turns)

### Phase 4: WebSocket + UI
- Add `room` channel to WebSocket server
- Broadcast room events to renderer
- Room view component (group chat feed)
- Agent sidebar with status indicators
- Click-through to individual agent sessions

### Phase 5: Polish & Resilience
- Agent resume/pause
- PM handoff/replacement
- Room archival
- Multi-model agent spawning
- Configurable idle thresholds
- Room message search/filter

---

## 13. File Structure (New Files)

```
src/
  main/
    services/
      room-manager.ts          — Room CRUD, agent lifecycle, message posting
      room-injection.ts        — PM turn injection logic, batching, triggers
    mcp/
      zeus-room.ts             — MCP server exposing room tools to agents
  shared/
    room-types.ts              — Room, RoomAgent, RoomMessage type definitions
  renderer/
    src/
      components/
        RoomView.tsx           — Main room UI (group chat feed)
        RoomAgentSidebar.tsx   — Agent list with status
        RoomMessage.tsx        — Individual message rendering
      stores/
        useRoomStore.ts        — Zustand store for room state
```
