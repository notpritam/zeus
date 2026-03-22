# Agent Rooms — Q&A and Design Decisions

> Every design question raised during brainstorming, the problem it addresses, and how the design handles it.

---

## Q1: What's the primary actor initiating cross-session communication?

**Question:** Who talks to whom? Is it AI agents autonomously discovering each other, the human user routing messages, or both?

**Answer: Both — but with a structure.**

- The PM agent (AI) autonomously spawns, directs, and dismisses other agents
- Worker agents communicate with each other through the room group chat
- The human user can intervene at any time by typing into the PM's session
- The user can also spawn/dismiss agents directly from the UI

The PM is the primary coordinator. The user is the override — they can always step in, but they don't have to.

---

## Q2: How is the "room" scoped? What IS a room?

**Question:** Is a room tied to a task? Is it explicit? Is it the PM's session?

**Options considered:**
- A) Task = Room (rigid, one room per task)
- B) Explicit rooms (flexible, but more abstraction overhead)
- C) PM's session IS the room (natural, minimal new concepts)

**Answer: Option C — the PM's session is the room.**

When a Claude session creates a room, that session becomes the PM. Its chat thread is the group feed. Its session ID seeds the room. No separate "room" abstraction that exists independently — a room always has a PM.

**But** the PM has a stable `agent_id` decoupled from the `claude_session_id`. If the PM's Claude session dies, the agent_id persists. A new session takes over. This gives us the best of C (natural mapping) without its limitation (PM death = room death).

---

## Q3: How do agents "see" and "talk to" each other?

**Question:** What's the mechanism — MCP tools (pull) or injected messages (push)?

**Options considered:**
- A) MCP tools — agents call `room_read_messages()` when they want to check
- B) Injected system prompts — Zeus pushes messages into agents' conversations
- C) Hybrid — agents pull, but Zeus pushes urgent messages

**Answer: Option A for worker agents, with Zeus-driven turns for the PM.**

Worker agents pull via MCP tools. They check `room_read_messages()` after each major step (instructed by system prompt). This is safe — no risk of disrupting their thought process mid-turn.

The PM is different. It needs to be reactive. Zeus watches for significant room events (agent done, errors, PM-directed questions) and injects a new user turn into the PM's stdin. This wakes the PM up without it needing to poll.

**Why not push for everyone?** Pushing content into an active Claude session mid-turn can corrupt its reasoning. The agent might be mid-thought about a file edit, and suddenly it gets a room message injected. Pull is safer for workers. The PM is the exception because its JOB is to react to room events — it expects interruptions.

---

## Q4: MCP tools are synchronous — how does the PM spawn agents without blocking?

**Question:** When the PM calls `room_spawn_agent()`, MCP expects a tool result immediately. But the spawned agent takes minutes to complete. Does the PM freeze?

**Problem stated plainly:** MCP tools are request→response. Claude calls a tool, waits for the result, then continues. If `room_spawn_agent()` blocks until the agent finishes, the PM can't spawn multiple agents. It's stuck waiting for the first one.

**Answer: Every room MCP tool returns instantly. Zero blocking.**

```
room_spawn_agent({ role: "architect", prompt: "..." })
→ returns IMMEDIATELY: { agentId: "agent-001", status: "spawning" }
```

The agent boots in the background as a separate process. The PM gets an acknowledgment and moves on. It can spawn 5 agents in rapid succession, post directives to all of them, and then its turn ends.

**How does the PM know when agents finish?** Through Zeus-driven turn injection (see Q5). Zeus watches for `signal_done` events and wakes the PM up with a summary.

This is the fundamental async pattern:
1. PM spawns agents (instant, non-blocking)
2. PM posts directives (instant)
3. PM's turn ends naturally
4. Agents work in background
5. Agents post findings / signal done
6. Zeus injects new turn into PM: "here's what happened"
7. PM wakes up, reads messages, decides next steps
8. Repeat until all work is done

---

## Q5: After the PM spawns agents and its turn ends — how does it wake up?

**Question:** The PM issued directives, its Claude turn ended. No user is typing. Agents are working in the background. What triggers the PM's next turn?

**Answer: Zeus injects user turns into the PM's stdin.**

Zeus watches the `room_messages` table. When significant events happen, Zeus sends a new user message to the PM's Claude session via `ProtocolPeer` (the stdin/stdout JSON protocol already used for Claude communication).

**Trigger rules:**

| Event | Inject? | Timing |
|-------|---------|--------|
| Agent signals done | Yes | Batched (5s window) |
| Agent posts finding | Yes | Batched |
| Agent asks PM a question | Yes | Immediate |
| Agent-to-agent chatter | No | PM reads on next natural turn |
| Agent crash/error | Yes | Immediate |
| Agent idle too long | Yes | After configurable threshold |
| All agents done | Yes | Immediate |

**Batching:** If 3 agents post findings within 5 seconds, the PM gets ONE injection listing all 3. Prevents PM from being spammed with rapid-fire updates. Exception: immediate-priority events bypass batching.

**Injection format:** Zeus sends a user turn summarizing what happened, then the PM calls `room_read_messages()` for full content. The injection is a nudge, not the full data.

---

## Q6: What if a worker agent needs to interact with another agent? How is this displayed?

**Question:** QA agent can't test something, needs to ask the frontend agent. How does this work mechanically, and what does the user see?

**Answer: All agent-to-agent communication goes through the room group chat. No private channels.**

**The mechanic:**

1. QA posts a message with `to: "agent-frontend-id"` and `type: "question"`
2. Zeus stores it in `room_messages` with the `to` and `mentions` fields
3. Frontend agent picks it up on its next `room_read_messages()` call
4. Frontend responds via `room_post_message()` with `to: "agent-qa-id"`
5. QA picks up the response on its next poll

**Why no private DMs:** The PM needs to see everything. If agents have side conversations, the PM loses situational awareness. The room metaphor means everyone talks out loud. The PM can intervene if agents are going in circles.

**What the user sees in the UI:**

```
[qa → @frontend] Can't test login, submit button not rendering.
                  How do I trigger auth component?        [question]

[frontend → @qa] Needs AuthProvider context. Navigate to /login
                  after full mount. Wait for
                  [data-testid='login-submit'].           [finding]
```

- Messages are tagged with sender role and visual badge (question/finding/directive)
- Directed messages show `→ @target` in the header
- The PM sees this exchange but isn't woken up for agent-to-agent chatter
- The PM CAN intervene if it sees the exchange on its next turn ("@qa that's wrong, actually do X")

**Latency concern:** There's a delay between QA posting a question and Frontend reading it (depends on when Frontend next checks). For development tasks, seconds to low minutes of delay is acceptable. This isn't real-time chat — it's async collaboration.

---

## Q7: Can we spawn agents WITHOUT room awareness?

**Question:** Not every agent needs the full room context. Some just need to do a task and return a result. Can we have "dumb" workers?

**Answer: Yes — isolated agents.**

When spawning, set `roomAware: false`:

```
room_spawn_agent({
  role: "dep-checker",
  prompt: "List all outdated dependencies in package.json",
  roomAware: false
})
```

Isolated agents:
- Get NO room MCP tools (no `room_post_message`, no `room_read_messages`)
- Cannot see other agents or the group chat
- Just run their prompt, do the work, exit
- Zeus captures their output automatically
- A `[SYSTEM]` message is posted: "Isolated agent 'dep-checker' finished."
- PM reads the result via `room_get_agent_state(agentId)`

This is essentially what Zeus subagents (QA agents) do today — fire-and-forget. We're formalizing it as a spawn mode. Cheap, fast, no coordination overhead.

**When to use isolated vs room-aware:**
- Simple, self-contained tasks → isolated (grep, lint, test run, dependency check)
- Tasks requiring coordination or shared context → room-aware (architect, tester, reviewer)

---

## Q8: What happens when the PM dies?

**Question:** PM's Claude session crashes (context overflow, network error, manual stop). Room has active agents. What now?

**Answer: Two-tier recovery — resume first, respawn second.**

**Tier 1: Resume.** Zeus tries to resume the PM's Claude session using the stored `claude_session_id` and `last_message_id`. If Claude's session is still alive on their end, this works — PM picks up exactly where it left off. Same agent_id, same session_id. No context loss.

**Tier 2: Respawn.** If resume fails (session expired, context too large), Zeus spawns a new Claude session and injects the room context:

1. Room task description
2. Full `room_messages` log (the group chat history)
3. Current `room_agents` list with statuses
4. Last PM turn summary (if available)

The new session gets a new `claude_session_id`, but the PM's `agent_id` stays the same. To the room, the PM never left — it just had a "brain transplant."

**What's lost on respawn:** The PM's internal reasoning chain. The new PM knows WHAT happened (from room messages) but not WHY the old PM made certain decisions. This is acceptable — a new PM joining a project mid-flight is a real-world scenario that works. The room messages need to be decision-rich (not just status updates) so the new PM has enough context.

**What survives on respawn:** Everything in room_messages, agent statuses, agent results, the task description. The group chat IS the persistent memory.

---

## Q9: How do agents discover each other?

**Question:** When an architect agent starts, how does it know there's a tester, a QA agent, and a reviewer also working in the room?

**Answer: Two mechanisms — initial injection + runtime discovery.**

**At spawn time:** Zeus appends room context to the agent's system prompt. This includes the current agent roster:

```
Current agents in this room:
- PM (pm-001) — status: running
- architect (agent-001) — status: running (that's you)
- tester (agent-002) — status: running
- qa (agent-003) — status: idle
```

**At runtime:** The agent calls `room_list_agents()` to get the current roster. This is live — it reflects agents that joined or left after the initial injection.

**Why both?** The system prompt gives immediate awareness without a tool call. `room_list_agents()` gives live updates. Agents spawned later won't be in the initial injection, so runtime discovery fills the gap.

---

## Q10: Is this limited to Claude models?

**Question:** Can the room have agents running different LLMs (GPT, Gemini, local models)?

**Answer: The room protocol is model-agnostic. The current implementation is Claude-only, but the design supports any agent that speaks MCP.**

Room communication happens through MCP tools (`room_post_message`, `room_read_messages`, etc.). Any agent backend that supports MCP can participate. The room doesn't care what's generating the messages — it only cares that the agent calls the right tools.

**Current reality:** All agents are Claude sessions with different models (opus, sonnet, haiku).

**Future:** Swap in GPT, Gemini, local models, or even non-LLM scripts. As long as they call the MCP tools, they're room citizens.

This is why the data model stores `model` on `room_agents` — each agent can be a different model. The room orchestration layer is above the LLM layer.

---

## Q11: How does the group chat display in the UI?

**Question:** What does the user actually see on their phone/web when looking at a room?

**Answer: The PM's session view transforms into the room feed.**

The group chat is the primary view — a chronological timeline of all room messages. Each message shows:
- **Sender**: role + icon (e.g., "🏗 architect", "🧪 tester")
- **Direction**: if directed, shows "→ @target"
- **Type badge**: question, finding, directive, done, error
- **Content**: markdown rendered

System messages (agent joined/left/done) are visually muted/compact.

A **sidebar** shows the agent roster with live statuses. Clicking an agent opens its individual Claude session view (same ClaudeView component we have today) — you can see its internal thinking, tool calls, etc.

The **input box** at the bottom lets the user (or PM) type directives. User messages always go to the PM session as a user turn.

---

## Q12: What's the relationship between Rooms and the existing Task/Worktree system?

**Question:** Zeus already has tasks with git worktrees for isolation. How do rooms relate?

**Answer: A room can optionally be linked to a task, but they're independent concepts.**

- A **Task** = git worktree isolation (branch, directory, diff tracking)
- A **Room** = multi-agent coordination (agents, messages, orchestration)

You can have:
- A room with no task (agents discussing architecture, no code changes yet)
- A task with no room (single agent working in isolation)
- A room linked to a task (the common case — agents collaborating on a feature branch)

When linked, agents in the room can be pointed at the task's worktree directory. The room's completion can trigger the task's merge/PR flow.

The `tasks` table gets an optional `room_id` column to link them.

---

## Q13: What happens if Zeus injects a turn while the PM is mid-response?

**Question:** The PM is actively generating a response (calling tools, writing text). Zeus tries to inject a user turn because an agent signaled done. What happens? Does it corrupt the session?

**Answer: Zeus tracks PM session state and only injects when idle.**

The Claude protocol is strictly turn-based: user message → assistant response → `result` event → next user message. Injecting a user message while the PM is mid-turn would violate the protocol.

Zeus maintains a state machine for the PM session:
- **idle** — after `result` event, before next user message. Injection allowed.
- **processing** — between user message and `result`. Injection queued.
- **waiting_approval** — tool approval pending. Injection queued.

If triggers fire while the PM is busy, events are queued. When the PM returns to `idle`, all queued events are delivered as a single batched injection. User messages from the human always take priority over queued injections.

---

## Q14: How does Zeus capture the result of an isolated agent?

**Question:** Isolated agents have no room MCP tools — they can't call `room_signal_done()`. How does Zeus know what they produced?

**Answer: Zeus reads the last assistant message from the agent's claude_entries.**

When an isolated agent's session emits `done`:
1. Zeus queries `claude_entries` for that session, ordered by `seq DESC`, looking for the last `assistant_message` entry.
2. Stores its `content` in `room_agents.result`.
3. Posts a `[SYSTEM]` message to the room with the summary.
4. If no assistant message exists (agent crashed), stores the error.

For deeper inspection, the PM can call `room_get_agent_log({ agentId })` to see the full conversation log of any agent — including tool calls, thinking, etc.

---

## Q15: How are @mentions resolved in room messages?

**Question:** When an agent writes `@architect` in a message, how does Zeus know which agent_id that refers to? Is it parsed from content or explicitly set?

**Answer: Auto-populated by Zeus from message content + the `to` field.**

When a message is inserted, Zeus:
1. Scans the `content` for `@<role>` patterns (e.g., `@architect`, `@pm`, `@qa`)
2. Resolves each to an `agent_id` by matching against `room_agents.role` in that room (case-insensitive)
3. If `toAgentId` is set, that id is always included in `mentions`
4. Unresolvable mentions are silently ignored

This means agents use natural language (`@architect`, `@pm`) while Zeus handles the resolution to stable IDs. The PM injection trigger checks both `to_agent_id` and the resolved `mentions` array — either one containing the PM's agent_id triggers an immediate injection.

---

## Q16: What if an agent spawn fails?

**Question:** PM calls `room_spawn_agent`, Zeus tries to start a Claude session, but it fails (bad model, system resources, npx error). What happens?

**Answer: Agent goes to `dead` status, error posted to room, PM is woken up.**

1. Zeus catches the `error` event from the `ClaudeSession`
2. Updates `room_agents.status` → `dead`
3. Stores the error in `room_agents.result`
4. Posts `[SYSTEM]` error: "Agent 'architect' failed to start: <error message>"
5. Triggers immediate PM turn injection (same priority as agent crash)

The PM reads the error, decides whether to retry with different params, reassign the task, or proceed without that agent.

---

## Q17: How does the seq ordering work for room messages?

**Question:** Multiple agents can post messages simultaneously. How do we ensure correct ordering?

**Answer: Per-room seq computed at insert time within a transaction.**

```sql
INSERT INTO room_messages (..., seq, ...)
VALUES (...,
  (SELECT COALESCE(MAX(seq), 0) + 1 FROM room_messages WHERE room_id = ?),
  ...);
```

SQLite's single-writer guarantee serializes all inserts. WAL mode allows concurrent reads while writes are being processed. No application-level locking needed. The transaction wrapping ensures no gaps or duplicates in the seq number.

---

## Q18: How do rooms relate to the existing subagent system?

**Question:** Zeus already has `subagent_sessions`, `subagent_entries` tables, and `wireSubagent()`. Does the room system replace this? Extend it? Are we maintaining two parallel agent systems?

**Answer: Rooms coexist with subagents. They serve different use cases.**

- **Subagents** (existing): Fire-and-forget single-task workers. QA agent runs tests, returns result, dies. No inter-agent communication. Parent-child relationship only. Deferred response pattern (caller blocks until result).
- **Room agents** (new): Multi-agent coordination with shared context, group chat, PM orchestration, pause/resume, etc.

They use the same underlying `ClaudeSession` class but different wiring:
- Subagents go through `wireSubagent()` → `subagent_sessions` table → `subagent` WebSocket channel
- Room agents go through `room-manager.ts` → `room_agents` table → `room` WebSocket channel

**No breaking changes.** The existing subagent system stays untouched. Room `room_spawn_agent({ roomAware: false })` is conceptually similar to a subagent but uses the room infrastructure. Over time, for tasks needing coordination, rooms replace subagents naturally.

---

## Q19: How does the PM get room MCP tools? Can they be added to a running session?

**Question:** MCP servers are set at spawn time via `--mcp-config`. You can't hot-add tools to a running Claude session. How does the PM get `zeus-room` tools?

**Answer: `zeus-room` is injected at session start, same pattern as `zeus-bridge`.**

Today, `zeus-bridge` is always injected for non-subagent sessions in `claude-session.ts:buildArgs()`. The `zeus-room` MCP server follows the exact same pattern:

```typescript
// In buildArgs(), for room-aware agents:
if (this.options.roomId && this.options.roomAware !== false) {
  mcpServers['zeus-room'] = {
    command: 'node',
    args: [roomPath],
    env: { ZEUS_ROOM_ID, ZEUS_AGENT_ID, ZEUS_AGENT_ROLE, ZEUS_WS_URL }
  };
}
```

**PM vs Worker tool sets**: One MCP server binary (`zeus-room.ts`), two tool sets. The server reads `ZEUS_AGENT_ROLE` from env — if `pm`, it registers all tools (spawn, dismiss, complete). If `worker`, only communication tools (post, read, list, signal_done).

**Key implication**: The PM session must be started WITH room context. If a user is in a regular Claude session and decides "I want to make this a room," they need to call `room_create` via `zeus-bridge` (which can be available to all sessions), and then the PM role is assigned to that existing session. The `zeus-room` tools would need to be available from the start OR the session restarts with room config. The simplest approach: always inject `zeus-room` (with limited tools like just `room_create`) into all parent sessions. After `room_create` is called, the full tool set becomes available on the next turn/session.

---

## Q20: ClaudeSession only has `_isRunning` — how does PM turn injection know when to inject?

**Question:** The PM state machine requires idle/processing/waiting_approval states, but `ClaudeSession` only tracks a boolean `_isRunning`. How does the injection system know when it's safe to inject?

**Answer: Add `turnState` property to `ClaudeSession`.**

This is a small, backward-compatible addition:

```typescript
private _turnState: 'idle' | 'processing' | 'waiting_approval' = 'idle';
get turnState() { return this._turnState; }
```

State transitions are wired to existing events:
- `start()` / `sendMessage()` → `'processing'`
- `result` event → `'idle'`
- `approval_needed` event → `'waiting_approval'`
- `approveTool()` / `denyTool()` → `'processing'`
- `done` / `error` → `'idle'`

Existing code never reads `turnState`, so nothing breaks. The `room-injection.ts` module checks `session.turnState === 'idle'` before injecting. If not idle, events are queued and delivered when the session transitions to idle.

---

## Q21: What if worker agents don't reliably poll for room messages?

**Question:** The system prompt says "check room_read_messages() after each major step." But LLMs don't reliably follow this. An agent deep in a 15-tool-call coding session may never check. What happens?

**Answer: Three-layer defense — instruction, turn-boundary nudge, zombie detection.**

**Layer 1 (cheap, usually works):** System prompt instruction to poll after significant steps. Works ~70% of the time.

**Layer 2 (reliable, fires between turns):** When a worker's turn completes (`result` event) and there are unread messages directed at it (Zeus checks `room_read_cursors`), Zeus injects a follow-up turn: "You have unread room messages directed at you. Call room_read_messages() before continuing." This is the same mechanism as PM injection but only fires at natural pause points.

**Layer 3 (last resort):** Zeus tracks `last_activity_at` per agent. If an agent goes 5 minutes with no activity (no `entry` events, no room messages), Zeus posts a `[SYSTEM]` idle warning and triggers PM injection. The PM decides: wait, send a nudge message, or dismiss the zombie.

No single layer is 100% reliable. Together, they cover the spectrum from "agent just forgot" to "agent is stuck in an infinite loop."

---

## Q22: What about cost? 10 Opus sessions running simultaneously could be expensive.

**Question:** There are no resource limits. A room with 10 concurrent Opus 4 agents could burn through API credits fast. What guardrails exist?

**Answer: Agent caps, token tracking, and zombie prevention.**

**Caps:**
- Max 8 concurrent agents per room (configurable)
- Max 15 total agents across all rooms (configurable)
- Max 5 active rooms simultaneously (configurable)
- `room_spawn_agent` returns an error when limits are hit

**Token tracking:**
- Each agent tracks cumulative tokens in `room_agents.tokens_used`
- Updated from `token_usage` entries in `claude_entries`
- PM sees token counts in `room_list_agents()` responses
- Optional room-level token budget — warnings at 80%, PM alert at 100%

**Zombie prevention:**
- Idle timeout (default 5m): agent with no activity → PM alerted
- Optional max turn count: agent exceeds N turns without progress → PM alerted
- PM auto-pause on inactivity: if PM itself is idle 15m with no room events, all agents paused

Nothing auto-kills agents — the PM (or user) always makes the final call. But the system surfaces problems early so they can be addressed before costs spiral.

---

## Q23: What about context window overflow for long-running rooms?

**Question:** A room running for an hour with 8 agents could generate hundreds of messages. When agents call `room_read_messages()`, won't it blow their context window?

**Answer: Pagination, read cursors, and summarization for PM respawn.**

- `room_read_messages({ since, limit })` — `limit` defaults to 50, agents should use `since` (their read cursor seq) to only fetch new messages
- Read cursors (`room_read_cursors`) track what each agent has seen, so they never re-read old messages
- For PM respawn: if room has 200+ messages, Zeus summarizes older ones and provides only the last 100 in full
- Individual Claude sessions naturally handle context compression via Claude's built-in mechanism
- Proactive detection: Zeus monitors PM token usage and warns at 80% context window, triggers respawn at 95%

---

## Q24: How does `room_read_messages()` interact with read cursors?

**Question:** Does the agent need to manually update its cursor after reading? What if it reads messages but crashes before processing them?

**Answer: `room_read_messages()` auto-updates the read cursor atomically.**

When an agent calls `room_read_messages()`:
1. Zeus reads messages where `seq > agent's room_read_cursors.last_seq`
2. Applies `limit` (default 50)
3. Returns the messages
4. **Atomically updates** `room_read_cursors.last_seq` to the highest `seq` in the returned set

The agent never manually manages its cursor. If it crashes after reading but before processing, the messages are "marked read" — but this is fine. On restart/resume, the agent re-reads the room context anyway. The cursor is a performance optimization (skip old messages), not a delivery guarantee.

---

## Q25: How does `room_create` become available if the session doesn't have room tools yet?

**Question:** A regular Claude session wants to create a room. But `zeus-room` is only injected for sessions that already have a roomId. How does the first `room_create` call happen?

**Answer: `room_create` lives on `zeus-bridge`, which is always available.**

`zeus-bridge` is already injected into all parent Claude sessions. We add `room_create` (and thin proxy tools for `room_spawn_agent`, `room_post_message`, `room_read_messages`, etc.) directly to `zeus-bridge`. This way:

- Any session can call `room_create` at any time — no restart needed
- The PM can immediately spawn agents and post messages via bridge proxies
- Worker agents spawned INTO the room get `zeus-room` natively (they have a roomId from birth)
- The bridge proxies route to the same `room-manager.ts` backend as `zeus-room`

This avoids the chicken-and-egg problem entirely. The PM operates through `zeus-bridge` proxies; workers operate through `zeus-room` directly. Same backend, different entry points.

---

## Q26: What happens to running agents when Zeus restarts?

**Question:** Zeus crashes or gets updated while a room has 5 active agents. What happens?

**Answer: Agents are marked dead, user manually recovers.**

On Zeus startup:
1. Query `room_agents WHERE status IN ('running', 'spawning')` — these are orphans (Claude CLI processes died with Zeus)
2. Set all to `status = 'dead'`
3. Post `[SYSTEM]` message: "Zeus restarted. N agents need recovery."
4. User sees the room in the UI with dead agents and decides which to resume

No auto-restart — the user picks which agents to bring back. Resuming an agent triggers the normal Claude session resume flow (or respawn if resume fails).

---

## Q27: Multiple agents writing to the same codebase — what about file conflicts?

**Question:** If the architect and tester are both editing files in the same directory, they'll step on each other.

**Answer: Three strategies, default is trust + git safety net.**

1. **Worktree-per-agent** (safest): each agent gets its own git worktree. Zero conflicts. PM merges. High disk usage.
2. **Shared worktree + coordination**: agents share a directory, coordinate via room messages ("I'm editing src/api.ts"). Git detects conflicts.
3. **Shared worktree, trust agents** (default): agents work in same directory, room prompt instructs them to work on different files. Git conflict detection is the safety net.

The default works because well-scoped agents rarely touch the same files (architect designs schema, tester writes tests, reviewer reads code). For cases where conflicts are likely, the PM can assign agents to separate worktrees via `workingDir` on `room_spawn_agent`.
