# QA Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated QA agent to the QA panel — a hidden Claude session that autonomously tests web apps, finds bugs, fixes code, and re-tests, with output rendered as a compact action log.

**Architecture:** Reuse existing `ClaudeSession` class but construct it directly (not via `ClaudeSessionManager`) and store as a module-level `qaAgentSession` variable alongside `qaService`. Stream `NormalizedEntry` events, translate them to compact `QaAgentLogEntry` objects, and broadcast on the `qa` WebSocket channel. Frontend renders entries in a new "Agent" mode tab in `QAPanel.tsx`.

**Tech Stack:** Electron main process (TypeScript), ClaudeSession, WebSocket envelope protocol, Zustand store, React (QAPanel component)

**Spec:** `docs/superpowers/specs/2026-03-17-qa-agent-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/types.ts` | Add `QaAgentLogEntry` type and new QA agent payload variants to `QaPayload` |
| `src/main/services/websocket.ts` | Add `qaAgentSession` module var, `wireQAAgent()` helper, handlers for `start_qa_agent`, `stop_qa_agent`, `qa_agent_message`; update `stop_qa` to kill agent |
| `src/renderer/src/stores/useZeusStore.ts` | Add agent state fields, actions, WebSocket listener cases |
| `src/renderer/src/components/QAPanel.tsx` | Add Browser/Agent mode toggle, agent log view, task input, follow-up input |

---

## Chunk 1: Backend Types + WebSocket Handlers

### Task 1: Add shared types

**Files:**
- Modify: `src/shared/types.ts` (lines 431-461, QaPayload union)

- [ ] **Step 1: Add `QaAgentLogEntry` type to shared types**

In `src/shared/types.ts`, add before the `QaPayload` type:

```typescript
// ─── QA Agent ───

export type QaAgentLogEntry =
  | { kind: 'tool_call'; tool: string; args: string; timestamp: number }
  | { kind: 'tool_result'; tool: string; summary: string; success: boolean; timestamp: number }
  | { kind: 'text'; content: string; timestamp: number }
  | { kind: 'error'; message: string; timestamp: number }
  | { kind: 'user_message'; content: string; timestamp: number };
```

- [ ] **Step 2: Add QA agent payload variants to `QaPayload`**

Add these to the `QaPayload` union type:

```typescript
  // Client → Server (QA Agent)
  | { type: 'start_qa_agent'; task: string; workingDir: string; targetUrl?: string }
  | { type: 'stop_qa_agent' }
  | { type: 'qa_agent_message'; text: string }
  // Server → Client (QA Agent)
  | { type: 'qa_agent_started'; sessionId: string }
  | { type: 'qa_agent_stopped' }
  | { type: 'qa_agent_entry'; entry: QaAgentLogEntry }
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add QaAgentLogEntry and QA agent payload types"
```

---

### Task 2: Add QA agent session wiring in websocket.ts

**Files:**
- Modify: `src/main/services/websocket.ts`

- [ ] **Step 1: Add module-level `qaAgentSession` variable**

Near line 77, after `let qaService: QAService | null = null;`, add:

```typescript
// QA agent — hidden Claude session managed outside ClaudeSessionManager
let qaAgentSession: ClaudeSession | null = null;
```

Also add the import for `ClaudeSession` and `SessionOptions` if not already imported (they come via `ClaudeSessionManager` import — check and add `ClaudeSession` directly):

```typescript
import { ClaudeSessionManager, ClaudeSession } from './claude-session';
```

- [ ] **Step 2: Add the QA agent system prompt constant**

After the module-level variables, add:

```typescript
function buildQAAgentSystemPrompt(targetUrl: string): string {
  return `You are a QA agent for a web application running at ${targetUrl}.

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
Be concise — the user sees a compact action log, not a full chat.
Never use AskUserQuestion — make your best judgment and proceed.`;
}
```

- [ ] **Step 3: Add `wireQAAgent()` helper function**

This translates `NormalizedEntry` events into `QaAgentLogEntry` and broadcasts them. Add after the existing `wireClaudeSession` function:

```typescript
function wireQAAgent(session: ClaudeSession): void {
  // Track tool_use entries by id for status transitions
  const toolEntries = new Map<string, string>(); // id → toolName

  session.on('entry', (entry: NormalizedEntry) => {
    const now = Date.now();

    if (entry.entryType.type === 'assistant_message' && entry.content.trim()) {
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          entry: { kind: 'text', content: entry.content, timestamp: now },
        },
      });
    }

    if (entry.entryType.type === 'tool_use') {
      const { toolName, status } = entry.entryType;

      if (status === 'created') {
        // New tool call
        toolEntries.set(entry.id, toolName);
        let args = '';
        try {
          const parsed = JSON.parse(entry.content);
          // Compact args: show key fields only
          if (parsed.url) args = parsed.url;
          else if (parsed.ref) args = `ref=${parsed.ref}`;
          else if (parsed.command) args = parsed.command.slice(0, 80);
          else if (parsed.file_path) args = parsed.file_path;
          else args = entry.content.slice(0, 100);
        } catch {
          args = entry.content.slice(0, 100);
        }

        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_entry',
            entry: { kind: 'tool_call', tool: toolName, args, timestamp: now },
          },
        });
      } else if (status === 'success' || status === 'failed' || status === 'timed_out') {
        // Tool completed — send result
        const summary = entry.content.slice(0, 200);
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_entry',
            entry: {
              kind: 'tool_result',
              tool: toolName,
              summary,
              success: status === 'success',
              timestamp: now,
            },
          },
        });
        toolEntries.delete(entry.id);
      }
    }

    if (entry.entryType.type === 'error_message') {
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          entry: { kind: 'error', message: entry.content, timestamp: now },
        },
      });
    }
  });

  // Auto-approve AskUserQuestion to prevent deadlock
  session.on('approval_needed', (approval) => {
    if (approval.toolName === 'AskUserQuestion') {
      session.approveTool(approval.approvalId);
    }
  });

  // Session completed
  session.on('done', () => {
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_stopped' },
    });
    qaAgentSession = null;
  });

  // Session crashed
  session.on('error', (err) => {
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_entry',
        entry: { kind: 'error', message: `Agent crashed: ${err.message}`, timestamp: Date.now() },
      },
    });
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_stopped' },
    });
    qaAgentSession = null;
  });
}
```

- [ ] **Step 4: Verify `wireQAAgent` compiles**

The code uses `session.approveTool(approval.approvalId)` which matches `ClaudeSession.approveTool()` at line 152 of `claude-session.ts`. No changes needed — just verify the import of `NormalizedEntry` is already present in websocket.ts (it is, from `./claude-types`).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(ws): add wireQAAgent helper and QA agent system prompt"
```

---

### Task 3: Add QA agent handlers in handleQA

**Files:**
- Modify: `src/main/services/websocket.ts` (inside `handleQA` function, lines 1099-1218)

- [ ] **Step 1: Add `start_qa_agent` handler**

Add new `else if` branches inside `handleQA`, before the final `else` block:

```typescript
  else if (payload.type === 'start_qa_agent') {
    // Guard: reject if agent already running
    if (qaAgentSession) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: 'QA agent already running. Stop it first.' },
      });
      return;
    }

    try {
      // Ensure QA service + browser instance are ready
      if (!qaService?.isRunning()) {
        qaService = new QAService();
        await qaService.start();
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'qa_started' },
        });
      }
      const instances = await qaService.listInstances();
      if (instances.length === 0) {
        const instance = await qaService.launchInstance(true);
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'instance_launched', instance },
        });
        // Wire CDP events
        const cdp = qaService.getCdpClient();
        if (cdp) {
          cdp.on('console', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_console', logs: [entry] } });
          });
          cdp.on('network', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_network', requests: [entry] } });
          });
          cdp.on('js_error', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_error', errors: [entry] } });
          });
        }
      }

      // Spawn hidden Claude session
      const targetUrl = payload.targetUrl || 'http://localhost:5173';
      const session = new ClaudeSession({
        workingDir: payload.workingDir,
        permissionMode: 'bypassPermissions',
        enableQA: true,
        qaTargetUrl: targetUrl,
      });

      qaAgentSession = session;

      // Wire entry streaming to QA panel
      wireQAAgent(session);

      // Start with task as the prompt + system prompt context
      const prompt = `${buildQAAgentSystemPrompt(targetUrl)}\n\n---\n\nTask: ${payload.task}`;
      await session.start(prompt);

      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_agent_started', sessionId: 'qa-agent' },
      });
    } catch (err) {
      qaAgentSession = null;
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: `Failed to start QA agent: ${(err as Error).message}` },
      });
    }
  }
```

- [ ] **Step 2: Add `stop_qa_agent` handler**

```typescript
  else if (payload.type === 'stop_qa_agent') {
    if (qaAgentSession) {
      qaAgentSession.kill();
      // The 'done'/'error' handler in wireQAAgent will broadcast qa_agent_stopped
      // and set qaAgentSession = null
    } else {
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_agent_stopped' },
      });
    }
  }
```

- [ ] **Step 3: Add `qa_agent_message` handler**

```typescript
  else if (payload.type === 'qa_agent_message') {
    if (!qaAgentSession) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: 'No QA agent running' },
      });
      return;
    }

    // Broadcast user message to QA panel log
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_entry',
        entry: { kind: 'user_message', content: payload.text, timestamp: Date.now() },
      },
    });

    try {
      await qaAgentSession.sendMessage(payload.text);
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: `Failed to send message: ${(err as Error).message}` },
      });
    }
  }
```

- [ ] **Step 4: Update existing `stop_qa` handler to also kill agent**

Find the existing `stop_qa` handler (around line 1116) and add agent cleanup:

```typescript
  else if (payload.type === 'stop_qa') {
    // Kill QA agent if running (it depends on PinchTab)
    if (qaAgentSession) {
      qaAgentSession.kill();
      // wireQAAgent handlers will clean up
    }

    if (qaService) {
      await qaService.stop();
      qaService = null;
    }
    broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'qa_stopped' }, auth: '' });
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(ws): add QA agent start/stop/message handlers"
```

---

## Chunk 2: Frontend Store + QA Panel UI

### Task 4: Add QA agent state to Zustand store

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add agent state fields to the store interface**

Find the QA state fields (around line 88) and add after `qaJsErrors`:

```typescript
// QA Agent
qaAgentRunning: boolean;
qaAgentSessionId: string | null;
qaAgentEntries: QaAgentLogEntry[];
```

Add the import at the top:

```typescript
import type { QaAgentLogEntry } from '@shared/types'; // or however shared types are imported
```

- [ ] **Step 2: Add initial values**

Find the QA initial values (around line 328) and add:

```typescript
qaAgentRunning: false,
qaAgentSessionId: null,
qaAgentEntries: [],
```

- [ ] **Step 3: Add agent actions**

Add these actions near the existing QA actions:

```typescript
startQAAgent: (task: string, workingDir: string, targetUrl?: string) => {
  set({ qaAgentEntries: [], qaError: null });
  zeusWs.send({
    channel: 'qa', sessionId: '', auth: '',
    payload: { type: 'start_qa_agent', task, workingDir, targetUrl },
  });
},

stopQAAgent: () => {
  zeusWs.send({
    channel: 'qa', sessionId: '', auth: '',
    payload: { type: 'stop_qa_agent' },
  });
},

sendQAAgentMessage: (text: string) => {
  zeusWs.send({
    channel: 'qa', sessionId: '', auth: '',
    payload: { type: 'qa_agent_message', text },
  });
},

clearQAAgentEntries: () => {
  set({ qaAgentEntries: [] });
},
```

- [ ] **Step 4: Add WebSocket listener cases for QA agent**

Find the `qa` channel listener (around line 855) and add these cases:

```typescript
if (payload.type === 'qa_agent_started') {
  set({ qaAgentRunning: true, qaAgentSessionId: payload.sessionId });
}
if (payload.type === 'qa_agent_stopped') {
  set({ qaAgentRunning: false, qaAgentSessionId: null });
}
if (payload.type === 'qa_agent_entry') {
  set((state) => ({
    qaAgentEntries: [...state.qaAgentEntries, payload.entry].slice(-500),
  }));
}
```

**Also update the existing `qa_stopped` handler** to reset agent state (since stopping PinchTab kills the agent on the backend):

Find the existing `qa_stopped` handler and add `qaAgentRunning: false, qaAgentSessionId: null` to its `set()` call:

```typescript
if (payload.type === 'qa_stopped') {
  set({
    qaRunning: false, qaInstances: [], qaTabs: [],
    qaSnapshot: null, qaSnapshotRaw: null, qaScreenshot: null,
    qaText: null, qaLoading: false, qaError: null,
    qaConsoleLogs: [], qaNetworkRequests: [], qaJsErrors: [],
    qaAgentRunning: false, qaAgentSessionId: null, // ← ADD THESE
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(store): add QA agent state, actions, and WebSocket listeners"
```

---

### Task 5: Add Agent mode UI to QAPanel

**Files:**
- Modify: `src/renderer/src/components/QAPanel.tsx`

- [ ] **Step 1: Add new state and store bindings**

At the top of the `QAPanel` component, add:

```typescript
const qaAgentRunning = useZeusStore((s) => s.qaAgentRunning);
const qaAgentEntries = useZeusStore((s) => s.qaAgentEntries);
const startQAAgent = useZeusStore((s) => s.startQAAgent);
const stopQAAgent = useZeusStore((s) => s.stopQAAgent);
const sendQAAgentMessage = useZeusStore((s) => s.sendQAAgentMessage);
const clearQAAgentEntries = useZeusStore((s) => s.clearQAAgentEntries);
```

Add local state:

```typescript
const [qaMode, setQaMode] = useState<'browser' | 'agent'>('browser');
const [agentTask, setAgentTask] = useState('');
const [agentFollowUp, setAgentFollowUp] = useState('');
const [agentTargetUrl, setAgentTargetUrl] = useState('http://localhost:5173');
const agentLogRef = useRef<HTMLDivElement>(null);
```

Add auto-scroll effect:

```typescript
useEffect(() => {
  if (agentLogRef.current) {
    agentLogRef.current.scrollTop = agentLogRef.current.scrollHeight;
  }
}, [qaAgentEntries]);
```

Import `useRef`, `useEffect` from React, and add icons: `Bot`, `Send` from lucide-react.

- [ ] **Step 2: Add mode toggle below the header**

After the header div (the one with "QA Preview" and the stop button), add a mode toggle:

```tsx
{/* Mode toggle */}
<div className="border-border flex shrink-0 border-b">
  <button
    onClick={() => setQaMode('browser')}
    className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
      qaMode === 'browser'
        ? 'border-primary text-foreground border-b-2'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    Browser
  </button>
  <button
    onClick={() => setQaMode('agent')}
    className={`relative flex-1 py-1.5 text-[10px] font-medium transition-colors ${
      qaMode === 'agent'
        ? 'border-primary text-foreground border-b-2'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    Agent
    {qaAgentRunning && (
      <span className="ml-1 inline-block size-1.5 rounded-full bg-green-500" />
    )}
  </button>
</div>
```

- [ ] **Step 3: Restructure early return and wrap browser content**

**IMPORTANT:** The current QAPanel has an early return when `!qaRunning` that shows "Start PinchTab". This blocks access to the Agent tab. Restructure so:

1. Move the mode toggle ABOVE the `!qaRunning` early return (it should always render).
2. The `!qaRunning` "Start PinchTab" screen only shows in **browser** mode.
3. Agent mode is always accessible — it auto-starts PinchTab when needed.

Replace the existing early return block (`if (!qaRunning) { return ... }`) with a conditional inside the browser mode:

```tsx
{qaMode === 'browser' && !qaRunning && (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
    <Eye className="text-muted-foreground/40 size-10" />
    <p className="text-muted-foreground text-xs">QA service not running</p>
    <Button size="sm" onClick={startQA} disabled={qaLoading} className="gap-1.5">
      {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
      Start PinchTab
    </Button>
    {qaError && <p className="text-destructive mt-1 text-[10px]">{qaError}</p>}
  </div>
)}

{qaMode === 'browser' && qaRunning && (
  <>
    {/* ... existing instance controls, URL bar, tabs, content, action bar ... */}
  </>
)}
```

- [ ] **Step 4: Add Agent mode view**

After the browser mode block, add:

```tsx
{qaMode === 'agent' && (
  <div className="flex min-h-0 flex-1 flex-col">
    {!qaAgentRunning ? (
      /* ─── Agent not running: task input ─── */
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <Bot className="text-muted-foreground/40 size-8" />
        <p className="text-muted-foreground text-[10px]">Describe a task for the QA agent</p>
        <input
          type="text"
          value={agentTargetUrl}
          onChange={(e) => setAgentTargetUrl(e.target.value)}
          className="bg-secondary text-foreground placeholder:text-muted-foreground w-full rounded px-2 py-1 text-[10px] outline-none"
          placeholder="Target URL"
        />
        <textarea
          value={agentTask}
          onChange={(e) => setAgentTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && agentTask.trim()) {
              e.preventDefault();
              startQAAgent(agentTask.trim(), getWorkingDir(), agentTargetUrl);
              setAgentTask('');
            }
          }}
          className="bg-secondary text-foreground placeholder:text-muted-foreground h-20 w-full resize-none rounded px-2 py-1.5 text-[10px] outline-none"
          placeholder="e.g. Test the login flow with valid and invalid credentials..."
        />
        <Button
          size="sm"
          onClick={() => {
            if (agentTask.trim()) {
              startQAAgent(agentTask.trim(), getWorkingDir(), agentTargetUrl);
              setAgentTask('');
            }
          }}
          disabled={!agentTask.trim()}
          className="gap-1.5"
        >
          <Play className="size-3" />
          Start Agent
        </Button>
      </div>
    ) : (
      /* ─── Agent running: action log ─── */
      <>
        {/* Agent header */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <span className="size-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
          <span className="text-foreground flex-1 text-[10px] font-medium">Agent running</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5"
            onClick={clearQAAgentEntries}
            title="Clear log"
          >
            <Trash2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive size-5"
            onClick={stopQAAgent}
            title="Stop agent"
          >
            <Square className="size-3" />
          </Button>
        </div>

        {/* Action log */}
        <div ref={agentLogRef} className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
          {qaAgentEntries.map((entry, i) => (
            <AgentLogEntry key={i} entry={entry} />
          ))}
        </div>

        {/* Follow-up input */}
        <div className="border-border flex shrink-0 items-center gap-1.5 border-t px-2 py-1.5">
          <input
            type="text"
            value={agentFollowUp}
            onChange={(e) => setAgentFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && agentFollowUp.trim()) {
                sendQAAgentMessage(agentFollowUp.trim());
                setAgentFollowUp('');
              }
            }}
            className="bg-secondary text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded px-2 py-1 text-[10px] outline-none"
            placeholder="Follow-up instruction..."
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 shrink-0"
            onClick={() => {
              if (agentFollowUp.trim()) {
                sendQAAgentMessage(agentFollowUp.trim());
                setAgentFollowUp('');
              }
            }}
            title="Send"
          >
            <Send className="size-3" />
          </Button>
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: Add `AgentLogEntry` component**

Add this component above the `QAPanel` function:

```tsx
function AgentLogEntry({ entry }: { entry: QaAgentLogEntry }) {
  if (entry.kind === 'tool_call') {
    return (
      <div className="flex items-start gap-1.5 rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">
        <span className="shrink-0 text-[9px] font-bold uppercase">{entry.tool}</span>
        <span className="min-w-0 flex-1 truncate text-blue-400/70">{entry.args}</span>
      </div>
    );
  }

  if (entry.kind === 'tool_result') {
    return (
      <div className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        entry.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
      }`}>
        <span className="mr-1 text-[9px] font-bold">{entry.success ? 'OK' : 'FAIL'}</span>
        <span className="text-[9px]">{entry.tool}</span>
        {entry.summary && (
          <span className="text-foreground/50 ml-1 text-[9px]">
            {entry.summary.slice(0, 120)}
          </span>
        )}
      </div>
    );
  }

  if (entry.kind === 'text') {
    return (
      <div className="bg-secondary text-foreground rounded px-1.5 py-1 text-[10px] leading-relaxed">
        {entry.content}
      </div>
    );
  }

  if (entry.kind === 'error') {
    return (
      <div className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
        {entry.message}
      </div>
    );
  }

  if (entry.kind === 'user_message') {
    return (
      <div className="bg-primary/10 text-foreground ml-6 rounded px-1.5 py-0.5 text-[10px]">
        {entry.content}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 6: Add `getWorkingDir` helper**

The agent needs a working directory. The store has `savedProjects` and `lastUsedProjectId` as direct state fields (not nested under `settings`). Note: `process.env.HOME` is not available in Electron renderer, so fallback to `'/'`.

```typescript
// Inside QAPanel component — add these store bindings at the top
const savedProjects = useZeusStore((s) => s.savedProjects);
const lastUsedProjectId = useZeusStore((s) => s.lastUsedProjectId);

const getWorkingDir = () => {
  if (lastUsedProjectId && savedProjects?.length) {
    const project = savedProjects.find((p) => p.id === lastUsedProjectId);
    if (project?.path) return project.path;
  }
  return '/';
};
```

- [ ] **Step 7: Disable "Stop PinchTab" button while agent runs**

Find the stop button in the header (the `<Square>` icon button that calls `stopQA`). Add `disabled={qaAgentRunning}`:

```tsx
<Button
  variant="ghost"
  size="icon-xs"
  className="text-muted-foreground hover:text-destructive size-5"
  onClick={stopQA}
  disabled={qaAgentRunning}
  title={qaAgentRunning ? 'Stop agent first' : 'Stop PinchTab'}
>
  <Square className="size-3" />
</Button>
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/QAPanel.tsx
git commit -m "feat(ui): add QA agent mode to QAPanel with action log and task input"
```

---

### Task 6: Type-check and build verification

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript type check**

```bash
npx tsc --noEmit --pretty
```

Expected: No errors. Fix any type mismatches (especially around `QaPayload` union, `ClaudeSession` constructor, and store types).

- [ ] **Step 2: Check `approveAction` method exists on ClaudeSession**

If `ClaudeSession` doesn't have `approveAction`, find the correct method name:

```bash
grep -n 'approve\|respondTo' src/main/services/claude-session.ts
```

Update `wireQAAgent` to use the correct method name.

- [ ] **Step 3: Check settings structure in store**

Verify how `settings` and `projects` are stored:

```bash
grep -n 'lastUsedProject\|projects' src/renderer/src/stores/useZeusStore.ts | head -20
```

Update `getWorkingDir` in QAPanel if the field names differ.

- [ ] **Step 4: Run the Electron build**

```bash
npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type and build issues for QA agent feature"
```

---

### Task 7: Integration test

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Manual test — Start QA agent**

1. Open the QA panel
2. Click "Agent" tab
3. Enter target URL: `http://localhost:5173`
4. Enter task: "Navigate to the page and take a screenshot. Report what you see."
5. Click "Start Agent"
6. Verify: agent starts, action log shows tool calls appearing

- [ ] **Step 3: Manual test — Follow-up message**

1. While agent is running, type a follow-up: "Now check the console logs for any errors"
2. Verify: user message appears in log, agent processes it

- [ ] **Step 4: Manual test — Stop agent**

1. Click Stop button
2. Verify: agent stops, UI resets to task input view

- [ ] **Step 5: Manual test — Edge cases**

1. Try starting a second agent while one is running → should show error
2. Stop PinchTab while agent runs → button should be disabled
3. Verify agent doesn't appear in the main Claude session list

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "feat: QA agent — dedicated browser automation agent in QA panel"
```
