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

Add to `QaPayload` union in `src/main/types.ts`:

```typescript
| { type: 'start_qa_agent'; task: string; targetUrl?: string }
| { type: 'stop_qa_agent' }
| { type: 'qa_agent_message'; text: string }
| { type: 'qa_agent_started'; sessionId: string }
| { type: 'qa_agent_stopped' }
| { type: 'qa_agent_entry'; entry: QaAgentLogEntry }
```

#### QA Agent Log Entry

```typescript
type QaAgentLogEntry =
  | { kind: 'tool_call'; tool: string; args: string; timestamp: number }
  | { kind: 'tool_result'; tool: string; summary: string; screenshot?: string; timestamp: number }
  | { kind: 'text'; content: string; timestamp: number }
  | { kind: 'error'; message: string; timestamp: number }
  | { kind: 'user_message'; content: string; timestamp: number }
```

#### Session Spawning (`websocket.ts` — `handleQA`)

When `start_qa_agent` is received:

1. If QA service not running, start it and launch a browser instance first
2. Spawn a Claude session via `ClaudeSessionManager` with:
   - `enableQA: true`
   - `permissionMode: 'bypassPermissions'`
   - `qaTargetUrl` from payload or default `http://localhost:5173`
   - Working directory from current project settings
3. Enhanced system prompt (see below)
4. Store the session reference as `qaAgentSession` alongside `qaService`
5. Wire the session's streaming output to parse entries and broadcast as `qa_agent_entry` on the `qa` channel
6. Send the initial task as the first user message to the session

#### Entry Parsing

Claude session streams `NormalizedEntry` objects. The WebSocket handler translates them:

- `assistant.text` → `{ kind: 'text', content, timestamp }`
- `tool_use` → `{ kind: 'tool_call', tool: name, args: JSON.stringify(input), timestamp }`
- `tool_result` → `{ kind: 'tool_result', tool: name, summary: truncated output, screenshot?: if qa_screenshot, timestamp }`
- Session errors → `{ kind: 'error', message, timestamp }`

#### Follow-up Messages

`qa_agent_message` payload forwards text to the running Claude session via `sendMessage()`. Also broadcasts a `qa_agent_entry` with `kind: 'user_message'` so the QA panel shows what the user said.

#### Stopping

`stop_qa_agent` kills the Claude session. The session's exit event broadcasts `qa_agent_stopped`.

#### Hidden Session

The QA agent session should NOT appear in `getAllSessions` / `getAllClaudeSessions` responses. Two options:
- Tag it with a `hidden: true` flag in the sessions DB and filter it out
- Simply don't insert it into the DB at all — manage it as an ephemeral in-memory session

Recommended: **Don't insert into DB.** The QA agent is ephemeral. No need to persist its history.

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
```

### Frontend

#### New Store State (`useZeusStore.ts`)

```typescript
qaAgentRunning: boolean;
qaAgentSessionId: string | null;
qaAgentEntries: QaAgentLogEntry[];
qaAgentTaskInput: string;
```

#### New Store Actions

```typescript
startQAAgent(task: string, targetUrl?: string): void;
stopQAAgent(): void;
sendQAAgentMessage(text: string): void;
clearQAAgentEntries(): void;
```

#### WebSocket Listener Updates

Handle new payload types on `qa` channel:
- `qa_agent_started` → set `qaAgentRunning: true`, store sessionId
- `qa_agent_stopped` → set `qaAgentRunning: false`, clear sessionId
- `qa_agent_entry` → append to `qaAgentEntries` (cap at 1000)

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
  - Tool calls as badges: `🔍 navigated → http://localhost:5173/login`
  - Tool results as one-liners: `📸 screenshot captured` / `✏️ edited src/App.tsx`
  - Agent text as compact messages
  - User messages styled differently (right-aligned or dimmer)
  - Errors in red
  - Screenshots as small inline thumbnails (tap to expand)
- Text input at bottom for follow-up messages
- Stop button in header

**Existing tabs remain accessible** during agent operation — console/network/errors update in real-time from CDP as the agent works.

## Data Flow

```
User types task in QA Panel
    → WebSocket: {channel: 'qa', type: 'start_qa_agent', task: "test login flow"}
    → Backend starts QA service (if needed) + launches browser (if needed)
    → Backend spawns hidden Claude session with QA MCP tools
    → Backend sends task as first message to Claude session
    → Claude session streams entries
    → Backend parses entries → broadcasts {type: 'qa_agent_entry', entry}
    → Frontend appends to qaAgentEntries[]
    → QA Panel renders compact log

Follow-up:
    User types "now try wrong password"
    → WebSocket: {channel: 'qa', type: 'qa_agent_message', text: "..."}
    → Backend forwards to Claude session
    → Streaming continues, new entries appear in log

Stop:
    User clicks Stop
    → WebSocket: {channel: 'qa', type: 'stop_qa_agent'}
    → Backend kills Claude session
    → Backend broadcasts {type: 'qa_agent_stopped'}
    → Frontend resets state
```

## Files to Modify

| File | Change |
|------|--------|
| `src/main/types.ts` | Add QA agent payload types and `QaAgentLogEntry` |
| `src/shared/types.ts` | Add `QaAgentLogEntry` type (shared) |
| `src/main/services/websocket.ts` | Add `start_qa_agent`, `stop_qa_agent`, `qa_agent_message` handlers |
| `src/main/services/claude-session.ts` | No changes needed — existing infra sufficient |
| `src/renderer/src/stores/useZeusStore.ts` | Add agent state, actions, WebSocket listener |
| `src/renderer/src/components/QAPanel.tsx` | Add Agent mode with action log + input |

## Testing

- Start QA agent with "navigate to localhost:5173 and take a screenshot"
- Verify compact log shows tool calls and screenshot thumbnail
- Send follow-up message, verify conversational context maintained
- Stop agent, verify cleanup
- Verify agent doesn't appear in main session list
- Verify existing QA tabs (console, network, errors) still update during agent operation
