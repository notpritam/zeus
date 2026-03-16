# QA Agent — Dedicated Browser Automation Agent in QA Panel

**Date:** 2026-03-17
**Status:** Approved

## Summary

Add a dedicated QA agent to the QA panel that can autonomously test web applications, find bugs, fix code, and re-test — all controllable from a compact action log UI embedded in the existing QA panel.

The agent is a hidden Claude session (not shown in the main session list) with full permissions (`bypassPermissions`) and QA MCP tools enabled. Its output is rendered as a compact action log in the QA panel rather than the full Claude chat view.

## Goals

- Launch a QA agent from the QA panel with a natural language task
- Agent autonomously navigates, interacts, screenshots, reads console/network/errors
- Agent can also edit files and run shell commands to fix issues it finds
- Agent re-tests after fixes to confirm resolution
- User can send follow-up messages (conversational mode) or let it run (fire-and-forget)
- Agent output appears as compact action log in QA panel, not as a regular session

## Non-Goals

- No parallel multi-agent QA (one agent at a time)
- No persistent test suites or saved test flows
- No separate QA agent process — reuses existing Claude session infrastructure

## Architecture

### Backend

#### New WebSocket Payload Types

Add to `QaPayload` union in `src/shared/types.ts` only (main/types.ts re-exports automatically):

```typescript
| { type: 'start_qa_agent'; task: string; workingDir: string; targetUrl?: string }
| { type: 'stop_qa_agent' }
| { type: 'qa_agent_message'; text: string }
| { type: 'qa_agent_started'; sessionId: string }
| { type: 'qa_agent_stopped' }
| { type: 'qa_agent_entry'; entry: QaAgentLogEntry }
```

#### QA Agent Log Entry (defined in `src/shared/types.ts`)

```typescript
type QaAgentLogEntry =
  | { kind: 'tool_call'; tool: string; args: string; timestamp: number }
  | { kind: 'tool_result'; tool: string; summary: string; screenshot?: string; timestamp: number }
  | { kind: 'text'; content: string; timestamp: number }
  | { kind: 'error'; message: string; timestamp: number }
  | { kind: 'user_message'; content: string; timestamp: number }
```

Note: For `tool_result` with screenshots, store only a thumbnail reference key, not the full base64 string — screenshots are already visible in the QA panel's screenshot tab.

#### Session Spawning (`websocket.ts` — `handleQA`)

Extract agent logic into a `handleQAAgent()` helper (matching the `wireClaudeSession` pattern).

When `start_qa_agent` is received:

1. **Guard:** If a QA agent is already running, reject with `qa_error: "QA agent already running"`.
2. If QA service not running, start it and launch a browser instance first.
3. **Construct a `ClaudeSession` directly** — do NOT use `claudeManager.createSession()`. Store as module-level `let qaAgentSession: ClaudeSession | null`. This keeps it out of the session manager's `sessions` Map and prevents it appearing in `getAllSessions()`.
4. Start the session with:
   - `enableQA: true`
   - `permissionMode: 'bypassPermissions'`
   - `qaTargetUrl` from payload or default `http://localhost:5173`
   - `workingDir` from the payload
5. The task string is passed as the `prompt` argument to `ClaudeSession.start()` — it becomes the initial user message. No separate `sendMessage()` call needed.
6. Wire the session's streaming output to parse entries and broadcast as `qa_agent_entry` on the `qa` channel.
7. Wire both `done` AND `error` events to broadcast `qa_agent_stopped` and clean up `qaAgentSession = null`. On `error`, also send a final `qa_agent_entry` with `kind: 'error'` before stopping.

#### Entry Parsing

Claude session streams `NormalizedEntry` objects via `ClaudeLogProcessor.process()`. The entry types are discriminated on `entryType.type`. Translation rules:

- `entryType.type === 'assistant_message'` → `{ kind: 'text', content: message text, timestamp }`
- `entryType.type === 'tool_use'` with `status === 'created'` → `{ kind: 'tool_call', tool: toolName, args: JSON.stringify(input), timestamp }`
- `entryType.type === 'tool_use'` with `status === 'success' | 'failed'` → `{ kind: 'tool_result', tool: toolName, summary: truncated output, timestamp }` (tool entries are upserted by id, not appended — detect status transitions)
- Session `error` event → `{ kind: 'error', message, timestamp }`

#### Follow-up Messages

`qa_agent_message` payload:
1. Check `qaAgentSession` exists and is running. If not, return `qa_error`.
2. Forward text via `qaAgentSession.sendMessage()`.
3. Broadcast a `qa_agent_entry` with `kind: 'user_message'` so the QA panel shows what the user said.

#### Stopping

`stop_qa_agent` kills the Claude session via `qaAgentSession.kill()`. The exit event handler broadcasts `qa_agent_stopped`.

Also: the existing `stop_qa` handler must also kill the QA agent if one is running (since stopping PinchTab breaks the agent's MCP tools).

#### Auto-approval for AskUserQuestion

Since the agent runs in `bypassPermissions` mode but `AskUserQuestion` still triggers an approval hook, add special handling: if the agent session receives an `approval_needed` event for `AskUserQuestion`, auto-approve with "Continue with your best judgment."

### System Prompt

```
You are a QA agent for a web application running at {{targetUrl}}.

You have full access to:
- Browser control: qa_navigate, qa_click, qa_fill, qa_type, qa_press, qa_scroll
- Browser inspection: qa_snapshot, qa_screenshot, qa_run_test_flow
- Browser observability: qa_console_logs, qa_network_requests, qa_js_errors
- File editing: Read, Edit, Write tools
- Shell commands: Bash tool

Your workflow:
1. Navigate to the target URL
2. Test the requested functionality
3. Take screenshots to verify visual state
4. Check console logs, network requests, and JS errors
5. If you find bugs: fix the code, then re-test to confirm the fix
6. Report findings concisely

Always use qa_run_test_flow after making code changes to verify the fix.
Be concise in your responses — the user sees a compact action log, not a full chat.
Never use AskUserQuestion — make your best judgment and proceed.
```

### Frontend

#### New Store State (`useZeusStore.ts`)

```typescript
qaAgentRunning: boolean;
qaAgentSessionId: string | null;
qaAgentEntries: QaAgentLogEntry[];
```

#### New Store Actions

```typescript
startQAAgent(task: string, workingDir: string, targetUrl?: string): void;
stopQAAgent(): void;
sendQAAgentMessage(text: string): void;
clearQAAgentEntries(): void;
```

#### WebSocket Listener Updates

Handle new payload types on `qa` channel:
- `qa_agent_started` → set `qaAgentRunning: true`, store sessionId
- `qa_agent_stopped` → set `qaAgentRunning: false`, clear sessionId
- `qa_agent_entry` → append to `qaAgentEntries` (cap at 500)

All agent payloads use `broadcastEnvelope` (any connected client should see progress).

#### QA Panel UI Changes (`QAPanel.tsx`)

**Mode toggle at top of panel:**
- "Browser" mode (existing tabs: snapshot, screenshot, text, console, network, errors)
- "Agent" mode (new: action log + input)

When no agent is running, Agent mode shows:
- Text input: "Describe a QA task..."
- Start button
- Target URL input (defaults to http://localhost:5173)

When agent is running, Agent mode shows:
- Scrollable compact action log:
  - Tool calls as action badges: `navigated → localhost:5173/login`
  - Tool results as one-liners: `screenshot captured` / `edited src/App.tsx`
  - Agent text as compact messages
  - User messages styled differently (right-aligned or dimmer)
  - Errors in red
  - Screenshots as small inline thumbnails
- Text input at bottom for follow-up messages
- Stop button in header

**Existing tabs remain accessible** during agent operation — console/network/errors update in real-time from CDP as the agent works.

**Disable "Stop PinchTab" button** while QA agent is running (stopping PinchTab would break the agent).

## Data Flow

```
User types task in QA Panel
    → WebSocket: {channel: 'qa', type: 'start_qa_agent', task: "test login", workingDir: "/path/to/project"}
    → Guard: reject if agent already running
    → Backend starts QA service (if needed) + launches browser (if needed)
    → Backend constructs ClaudeSession directly (not via manager)
    → Backend calls session.start(task) — task IS the prompt
    → Claude session streams NormalizedEntry objects
    → Backend parses entries → broadcasts {type: 'qa_agent_entry', entry}
    → Frontend appends to qaAgentEntries[]
    → QA Panel renders compact log

Follow-up:
    User types "now try wrong password"
    → WebSocket: {channel: 'qa', type: 'qa_agent_message', text: "..."}
    → Guard: check session exists and is running
    → Backend forwards to Claude session via sendMessage()
    → Streaming continues, new entries appear in log

Stop (explicit):
    User clicks Stop
    → WebSocket: {channel: 'qa', type: 'stop_qa_agent'}
    → Backend kills Claude session
    → Exit handler broadcasts {type: 'qa_agent_stopped'}
    → Frontend resets state

Stop (crash):
    Claude session exits with non-zero code
    → Error handler sends {type: 'qa_agent_entry', entry: {kind: 'error', ...}}
    → Error handler broadcasts {type: 'qa_agent_stopped'}
    → Frontend resets state

Stop (QA service stopped):
    User clicks "Stop PinchTab" (disabled while agent runs, but as fallback)
    → stop_qa handler also kills QA agent if running
    → Same cleanup as explicit stop
```

## Files to Modify

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add QA agent payload types and `QaAgentLogEntry` |
| `src/main/services/websocket.ts` | Add `handleQAAgent()` helper with `start_qa_agent`, `stop_qa_agent`, `qa_agent_message` handlers; update `stop_qa` to also kill agent |
| `src/main/services/claude-session.ts` | No changes needed — construct `ClaudeSession` directly |
| `src/renderer/src/stores/useZeusStore.ts` | Add agent state, actions, WebSocket listener |
| `src/renderer/src/components/QAPanel.tsx` | Add Agent mode with action log + input; disable Stop PinchTab while agent runs |

## Edge Cases

| Case | Handling |
|------|----------|
| Start agent while one already running | Reject with `qa_error` |
| Agent session crashes | Wire `error` event → send error entry + `qa_agent_stopped` |
| Send follow-up to finished agent | Check `isRunning` first, return `qa_error` if stopped |
| Stop PinchTab while agent runs | Button disabled; fallback: `stop_qa` also kills agent |
| CDP not connected | Agent's observability tools return empty arrays — acceptable degradation |

## Testing

- Start QA agent with "navigate to localhost:5173 and take a screenshot"
- Verify compact log shows tool calls and screenshot thumbnail
- Send follow-up message, verify conversational context maintained
- Stop agent, verify cleanup
- Verify agent doesn't appear in main session list
- Verify existing QA tabs (console, network, errors) still update during agent operation
- Crash the agent session, verify frontend resets cleanly
- Try starting a second agent while one runs, verify rejection
