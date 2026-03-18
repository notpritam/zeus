# Session Terminal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-Claude-session terminal panel (VS Code style) toggled with Cmd+J, supporting multiple tabs per session.

**Architecture:** Extend the existing `terminal.ts` PTY system with a frontend-managed mapping from Claude sessions to terminal tabs. The `SessionTerminalPanel` component embeds in `ClaudeView` as a resizable bottom split. Two backend type extensions (`cwd` and `correlationId` on `StartSessionPayload`) plus Zustand state for tab management. No new backend services.

**Tech Stack:** React, Zustand, xterm.js, node-pty (existing), WebSocket (existing)

**Spec:** `docs/superpowers/specs/2026-03-19-session-terminal-panel-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Add `cwd` + `correlationId` to `StartSessionPayload`, add `correlationId` to `SessionStartedPayload` |
| `src/main/services/websocket.ts` | Modify | Pass `cwd` + `correlationId` through in `handleControl` |
| `src/renderer/src/hooks/useTerminal.ts` | Modify | Add `onExit` callback parameter |
| `src/renderer/src/stores/useZeusStore.ts` | Modify | Add session terminal state slice + actions |
| `src/renderer/src/components/SessionTerminalPanel.tsx` | Create | Terminal panel with tab bar, xterm, drag handle |
| `src/renderer/src/components/ClaudeView.tsx` | Modify | Embed `SessionTerminalPanel` as bottom split |
| `src/renderer/src/App.tsx` | Modify | Add Cmd+J global shortcut |

---

### Task 1: Add `cwd` and `correlationId` to session payloads (Backend)

**Files:**
- Modify: `src/shared/types.ts:205-219`
- Modify: `src/main/services/websocket.ts:266-314`

The `correlationId` is needed to prevent a race condition: if multiple `start_session` messages are in flight simultaneously (user rapidly clicking [+] to add tabs), the `session_started` responses must be matched to the correct pending tab. Without a correlation ID, the first response would be assigned to whichever tab happened to be first in the pending map.

- [ ] **Step 1: Add `cwd` and `correlationId` fields to `StartSessionPayload`**

In `src/shared/types.ts`, modify the existing interface:

```typescript
export interface StartSessionPayload {
  type: 'start_session';
  cols?: number;
  rows?: number;
  cwd?: string;           // working directory, defaults to $HOME
  correlationId?: string;  // echoed back in session_started for request matching
}
```

- [ ] **Step 2: Add `correlationId` to `SessionStartedPayload`**

In `src/shared/types.ts`, modify:

```typescript
export interface SessionStartedPayload {
  type: 'session_started';
  sessionId: string;
  shell: string;
  correlationId?: string;  // echoed from start_session
}
```

- [ ] **Step 3: Update `handleControl` in websocket.ts**

In `src/main/services/websocket.ts`, update the `start_session` handler. The `cwd` variable must be declared **before** `createSession()` is called (currently `cwd` is declared at line 298, after the `createSession` call at line 271).

Replace the entire `start_session` block (lines 266-316):

```typescript
if (payload.type === 'start_session') {
  const opts = envelope.payload as StartSessionPayload;
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const cwd = opts.cwd || process.env.HOME || '/';

  const { sessionId, shell } = createSession(
    { cols, rows, cwd },
    (sid, data) => {
      broadcastEnvelope({
        channel: 'terminal',
        sessionId: sid,
        payload: { type: 'output', data },
        auth: '',
      });
    },
    (sid, code) => {
      markExited(sid, code);
      updateTerminalSession(sid, { status: 'exited', endedAt: Date.now(), exitCode: code });
      broadcastEnvelope({
        channel: 'terminal',
        sessionId: sid,
        payload: { type: 'exit', code },
        auth: '',
      });
      broadcastSessionUpdated(sid);
      const owned = clientSessions.get(ws);
      if (owned) owned.delete(sid);
    },
  );

  // Register in session registry
  const record = registerSession(sessionId, shell, cols, rows, cwd);

  // Persist to DB
  insertTerminalSession(record);

  // Track ownership
  if (!clientSessions.has(ws)) clientSessions.set(ws, new Set());
  clientSessions.get(ws)!.add(sessionId);

  // Broadcast session_started with correlationId echoed back
  broadcastEnvelope({
    channel: 'control',
    sessionId,
    payload: {
      type: 'session_started',
      sessionId,
      shell,
      correlationId: opts.correlationId,
    },
    auth: '',
  });

  broadcastSessionUpdated(sessionId);
}
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/services/websocket.ts
git commit -m "feat: add cwd and correlationId to StartSessionPayload"
```

---

### Task 2: Add `onExit` callback to `useTerminal` hook

**Files:**
- Modify: `src/renderer/src/hooks/useTerminal.ts`

- [ ] **Step 1: Add `onExit` parameter to the hook signature**

```typescript
export function useTerminal(
  sessionId: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onExit?: (code: number) => void,
) {
```

- [ ] **Step 2: Call `onExit` in the exit handler**

Inside the `zeusWs.on('terminal', ...)` callback, in the `exit` branch (line 91-93), add the callback after writing exit message to xterm:

```typescript
} else if (payload.type === 'exit') {
  const { code } = envelope.payload as TerminalExitPayload;
  term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
  onExit?.(code);
}
```

- [ ] **Step 3: Verify existing `TerminalView` still works (no regression)**

`TerminalView.tsx` calls `useTerminal(sessionId, containerRef)` without `onExit` — the parameter is optional, so no changes needed there.

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useTerminal.ts
git commit -m "feat: add onExit callback to useTerminal hook"
```

---

### Task 3: Add session terminal Zustand state slice

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add types and state fields to `ZeusState` interface**

After the existing `// Right panel` section (around line 137), add:

```typescript
// Session terminal panel (per-Claude-session terminals)
sessionTerminals: Record<string, {
  tabs: Array<{
    tabId: string;
    terminalSessionId: string;
    label: string;
    createdAt: number;
    exited: boolean;
    exitCode?: number;
  }>;
  activeTabId: string | null;
  panelVisible: boolean;
}>;
terminalPanelHeight: number;
```

- [ ] **Step 2: Add action signatures to `ZeusState` interface**

After the existing right panel actions (around line 257), add:

```typescript
// Session terminal actions
createSessionTerminal: (claudeSessionId: string, cwd: string) => void;
closeSessionTerminal: (claudeSessionId: string, tabId: string) => void;
switchSessionTerminal: (claudeSessionId: string, tabId: string) => void;
toggleSessionTerminalPanel: (claudeSessionId: string) => void;
setSessionTerminalExited: (claudeSessionId: string, tabId: string, exitCode: number) => void;
restartSessionTerminal: (claudeSessionId: string, tabId: string, cwd: string) => void;
setTerminalPanelHeight: (height: number) => void;
destroyAllSessionTerminals: (claudeSessionId: string) => void;
```

- [ ] **Step 3: Add initial state values**

In the `create()` call, add initial values alongside existing state:

```typescript
sessionTerminals: {},
terminalPanelHeight: parseInt(localStorage.getItem('zeus-terminal-panel-height') || '30', 10),
```

- [ ] **Step 4: Add `pendingSessionTerminals` map at module level**

Before the `create()` call, add:

```typescript
// Maps correlationId (= tabId) → claudeSessionId for pending terminal tab creation
const pendingSessionTerminals = new Map<string, string>();
```

- [ ] **Step 5: Implement `toggleSessionTerminalPanel` action**

```typescript
toggleSessionTerminalPanel: (claudeSessionId: string) => {
  const state = get();
  const existing = state.sessionTerminals[claudeSessionId];

  if (!existing) {
    // First open — create state and auto-create first tab
    const session = state.claudeSessions.find(s => s.id === claudeSessionId);
    const cwd = session?.workingDir || '/';

    // Set panel visible, tab will be added when session_started arrives
    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: { tabs: [], activeTabId: null, panelVisible: true },
      },
    }));

    // Create the first terminal tab
    get().createSessionTerminal(claudeSessionId, cwd);
    return;
  }

  // Toggle visibility
  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: { ...existing, panelVisible: !existing.panelVisible },
    },
  }));
},
```

- [ ] **Step 6: Implement `createSessionTerminal` action**

Uses `correlationId` to safely match `session_started` responses back to the correct tab, even under concurrent creation.

```typescript
createSessionTerminal: (claudeSessionId: string, cwd: string) => {
  const state = get();
  const existing = state.sessionTerminals[claudeSessionId];
  const tabs = existing?.tabs || [];

  // 5-tab cap — count ALL tabs (including exited)
  if (tabs.length >= 5) return;

  // Generate stable tabId — also used as correlationId
  const tabId = crypto.randomUUID();

  // Store pending tab (terminalSessionId will be set on session_started)
  const pendingTab = {
    tabId,
    terminalSessionId: '', // filled when session_started arrives
    label: 'starting...',
    createdAt: Date.now(),
    exited: false,
  };

  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: {
        tabs: [...tabs, pendingTab],
        activeTabId: tabId,
        panelVisible: true,
      },
    },
  }));

  // Store mapping: correlationId → claudeSessionId
  pendingSessionTerminals.set(tabId, claudeSessionId);

  // Send start_session with cwd and correlationId
  zeusWs.send({
    channel: 'control',
    sessionId: '',
    payload: { type: 'start_session', cwd, correlationId: tabId },
    auth: '',
  });
},
```

- [ ] **Step 7: Update `session_started` handler to use `correlationId`**

Replace the existing `session_started` handler (line 495-501) with:

```typescript
if (payload.type === 'session_started') {
  const p = envelope.payload as SessionStartedPayload & { correlationId?: string };

  // Check if this session belongs to a pending session terminal tab
  const correlationId = p.correlationId;
  const matchedClaudeId = correlationId ? pendingSessionTerminals.get(correlationId) : undefined;

  if (correlationId && matchedClaudeId) {
    // This is a session terminal tab — link it using the correlationId as tabId
    pendingSessionTerminals.delete(correlationId);
    const shellName = p.shell.split('/').pop() || 'shell';
    set((state) => {
      const st = state.sessionTerminals[matchedClaudeId];
      if (!st) return {};
      const tabNumber = st.tabs.length;
      return {
        sessionTerminals: {
          ...state.sessionTerminals,
          [matchedClaudeId]: {
            ...st,
            tabs: st.tabs.map(t =>
              t.tabId === correlationId
                ? { ...t, terminalSessionId: p.sessionId, label: `${shellName} ${tabNumber}` }
                : t
            ),
          },
        },
        lastActivityAt: { ...state.lastActivityAt, [p.sessionId]: Date.now() },
      };
    });
  } else {
    // Normal standalone terminal session (existing behavior)
    set((state) => ({
      activeSessionId: p.sessionId,
      lastActivityAt: { ...state.lastActivityAt, [p.sessionId]: Date.now() },
    }));
  }
}
```

- [ ] **Step 8: Implement `closeSessionTerminal` action**

```typescript
closeSessionTerminal: (claudeSessionId: string, tabId: string) => {
  const state = get();
  const st = state.sessionTerminals[claudeSessionId];
  if (!st) return;

  const tab = st.tabs.find(t => t.tabId === tabId);
  if (!tab) return;

  // Kill PTY if still running
  if (!tab.exited && tab.terminalSessionId) {
    zeusWs.send({
      channel: 'control',
      sessionId: tab.terminalSessionId,
      payload: { type: 'stop_session' },
      auth: '',
    });
  }

  // Remove tab from state
  const newTabs = st.tabs.filter(t => t.tabId !== tabId);
  const newActiveTabId = st.activeTabId === tabId
    ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].tabId : null)
    : st.activeTabId;

  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: {
        ...st,
        tabs: newTabs,
        activeTabId: newActiveTabId,
        panelVisible: newTabs.length > 0 ? st.panelVisible : false,
      },
    },
  }));
},
```

- [ ] **Step 9: Implement `switchSessionTerminal` action**

```typescript
switchSessionTerminal: (claudeSessionId: string, tabId: string) => {
  const st = get().sessionTerminals[claudeSessionId];
  if (!st) return;
  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: { ...st, activeTabId: tabId },
    },
  }));
},
```

- [ ] **Step 10: Implement `setSessionTerminalExited` action**

```typescript
setSessionTerminalExited: (claudeSessionId: string, tabId: string, exitCode: number) => {
  const st = get().sessionTerminals[claudeSessionId];
  if (!st) return;
  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: {
        ...st,
        tabs: st.tabs.map(t =>
          t.tabId === tabId ? { ...t, exited: true, exitCode } : t
        ),
      },
    },
  }));
},
```

- [ ] **Step 11: Implement `restartSessionTerminal` action**

Note: Restart clears terminal history entirely — the old xterm is disposed and a new one created. This is acceptable since the user is explicitly requesting a fresh start.

```typescript
restartSessionTerminal: (claudeSessionId: string, tabId: string, cwd: string) => {
  const st = get().sessionTerminals[claudeSessionId];
  if (!st) return;
  const tab = st.tabs.find(t => t.tabId === tabId);
  if (!tab) return;

  // Store mapping for the new session_started to match back
  pendingSessionTerminals.set(tabId, claudeSessionId);

  // Reset tab state (terminalSessionId will update on session_started)
  set((s) => ({
    sessionTerminals: {
      ...s.sessionTerminals,
      [claudeSessionId]: {
        ...st,
        tabs: st.tabs.map(t =>
          t.tabId === tabId
            ? { ...t, terminalSessionId: '', exited: false, exitCode: undefined, label: 'restarting...' }
            : t
        ),
      },
    },
  }));

  // Send start_session with correlationId = tabId
  zeusWs.send({
    channel: 'control',
    sessionId: '',
    payload: { type: 'start_session', cwd, correlationId: tabId },
    auth: '',
  });
},
```

- [ ] **Step 12: Implement `setTerminalPanelHeight` action**

```typescript
setTerminalPanelHeight: (height: number) => {
  const clamped = Math.min(80, Math.max(15, height));
  localStorage.setItem('zeus-terminal-panel-height', String(clamped));
  set({ terminalPanelHeight: clamped });
},
```

- [ ] **Step 13: Implement `destroyAllSessionTerminals` action**

```typescript
destroyAllSessionTerminals: (claudeSessionId: string) => {
  const st = get().sessionTerminals[claudeSessionId];
  if (!st) return;

  // Kill all running PTYs
  for (const tab of st.tabs) {
    if (!tab.exited && tab.terminalSessionId) {
      zeusWs.send({
        channel: 'control',
        sessionId: tab.terminalSessionId,
        payload: { type: 'stop_session' },
        auth: '',
      });
    }
  }

  // Clear state
  set((s) => {
    const { [claudeSessionId]: _, ...rest } = s.sessionTerminals;
    return { sessionTerminals: rest };
  });
},
```

- [ ] **Step 14: Hook into `deleteClaudeSession` and `archiveClaudeSession`**

In the existing `deleteClaudeSession` action (line 1824), add cleanup before the WS send:

```typescript
deleteClaudeSession: (id: string) => {
  get().destroyAllSessionTerminals(id);  // NEW — cleanup terminals
  zeusWs.send({
    channel: 'claude',
    sessionId: id,
    payload: { type: 'delete_claude_session' },
    auth: '',
  });
},
```

Do the same in `archiveClaudeSession` (line 1842):

```typescript
archiveClaudeSession: (id: string) => {
  get().destroyAllSessionTerminals(id);  // NEW — cleanup terminals
  zeusWs.send({
    channel: 'claude',
    sessionId: id,
    payload: { type: 'archive_claude_session' },
    auth: '',
  });
},
```

- [ ] **Step 15: Verify build**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 16: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat: add session terminal Zustand state slice with correlationId matching"
```

---

### Task 4: Create `SessionTerminalPanel` component + embed in ClaudeView

**Files:**
- Create: `src/renderer/src/components/SessionTerminalPanel.tsx`
- Modify: `src/renderer/src/components/ClaudeView.tsx`

- [ ] **Step 1: Create the `SessionTerminalPanel` component**

Create `src/renderer/src/components/SessionTerminalPanel.tsx`:

```tsx
import { useRef, useCallback } from 'react';
import { Plus, Minus, X } from 'lucide-react';
import { useTerminal } from '@/hooks/useTerminal';
import { useZeusStore } from '@/stores/useZeusStore';

interface TerminalTabInstanceProps {
  tabId: string;
  terminalSessionId: string;
  claudeSessionId: string;
  isActive: boolean;
  exited: boolean;
  exitCode?: number;
  cwd: string;
}

function TerminalTabInstance({
  tabId,
  terminalSessionId,
  claudeSessionId,
  isActive,
  exited,
  exitCode,
  cwd,
}: TerminalTabInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setExited = useZeusStore((s) => s.setSessionTerminalExited);
  const restart = useZeusStore((s) => s.restartSessionTerminal);

  const onExit = useCallback(
    (code: number) => setExited(claudeSessionId, tabId, code),
    [claudeSessionId, tabId, setExited],
  );

  useTerminal(terminalSessionId || null, containerRef, onExit);

  return (
    <div
      className="absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden p-1"
      />
      {exited && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2">
            <p className="text-muted-foreground text-xs">
              Process exited with code {exitCode ?? '?'}
            </p>
            <button
              onClick={() => restart(claudeSessionId, tabId, cwd)}
              className="text-primary hover:text-primary/80 text-xs underline"
            >
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionTerminalPanelProps {
  claudeSessionId: string;
  cwd: string;
}

export default function SessionTerminalPanel({
  claudeSessionId,
  cwd,
}: SessionTerminalPanelProps) {
  const st = useZeusStore((s) => s.sessionTerminals[claudeSessionId]);
  const createTab = useZeusStore((s) => s.createSessionTerminal);
  const closeTab = useZeusStore((s) => s.closeSessionTerminal);
  const switchTab = useZeusStore((s) => s.switchSessionTerminal);
  const togglePanel = useZeusStore((s) => s.toggleSessionTerminalPanel);

  if (!st || !st.panelVisible) return null;

  const { tabs, activeTabId } = st;
  const canAddTab = tabs.length < 5;

  return (
    <div className="bg-background flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="border-border bg-card flex items-center gap-0.5 border-b px-2 py-1">
        {tabs.map((tab) => (
          <button
            key={tab.tabId}
            onClick={() => switchTab(claudeSessionId, tab.tabId)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              tab.tabId === activeTabId
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            } ${tab.exited ? 'opacity-60' : ''}`}
          >
            <span className="truncate max-w-[100px]">{tab.label}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(claudeSessionId, tab.tabId);
              }}
              className="text-muted-foreground hover:text-destructive ml-0.5 rounded p-0.5"
            >
              <X className="size-3" />
            </span>
          </button>
        ))}
        <button
          onClick={() => createTab(claudeSessionId, cwd)}
          disabled={!canAddTab}
          className="text-muted-foreground hover:text-foreground rounded p-1 disabled:opacity-30 disabled:cursor-not-allowed"
          title="New terminal tab"
        >
          <Plus className="size-3.5" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => togglePanel(claudeSessionId)}
          className="text-muted-foreground hover:text-foreground rounded p-1"
          title="Minimize terminal"
        >
          <Minus className="size-3.5" />
        </button>
      </div>

      {/* Terminal instances — all mounted, inactive hidden via display:none */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalTabInstance
            key={tab.tabId}
            tabId={tab.tabId}
            terminalSessionId={tab.terminalSessionId}
            claudeSessionId={claudeSessionId}
            isActive={tab.tabId === activeTabId}
            exited={tab.exited}
            exitCode={tab.exitCode}
            cwd={cwd}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add drag handle and resizable split to ClaudeView**

In `src/renderer/src/components/ClaudeView.tsx`, add import at the top (after existing imports):

```typescript
import SessionTerminalPanel from '@/components/SessionTerminalPanel';
```

(`useZeusStore` is already imported.)

Add state for drag-resizing inside the `ClaudeView` function, after the existing state declarations:

```typescript
// Session terminal panel
const sessionTerminalState = useZeusStore((s) =>
  session ? s.sessionTerminals[session.id] : undefined
);
const terminalPanelHeight = useZeusStore((s) => s.terminalPanelHeight);
const setTerminalPanelHeight = useZeusStore((s) => s.setTerminalPanelHeight);
const panelVisible = sessionTerminalState?.panelVisible ?? false;

// Drag resize state
const [isDragging, setIsDragging] = useState(false);
const claudeViewRef = useRef<HTMLDivElement>(null);

const handleDragStart = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  setIsDragging(true);
}, []);

useEffect(() => {
  if (!isDragging) return;

  const handleMouseMove = (e: MouseEvent) => {
    if (!claudeViewRef.current) return;
    const rect = claudeViewRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const pct = ((rect.height - mouseY) / rect.height) * 100;
    setTerminalPanelHeight(pct);
  };

  const handleMouseUp = () => setIsDragging(false);

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  return () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDragging, setTerminalPanelHeight]);
```

- [ ] **Step 3: Modify ClaudeView JSX to include the terminal panel**

Add `ref={claudeViewRef}` to the outer div (line 311):

```tsx
<div ref={claudeViewRef} data-testid="claude-view" className="bg-background flex h-full flex-col">
```

The current layout below the header has:
1. Entry list area (`<div className="relative min-h-0 flex-1">`)
2. Input bar

Wrap both in a new split container. Find the entry list div at line 389 and wrap everything from there through the closing `</div>` of the input bar (line 602) in a split layout:

```tsx
{/* Chat + Terminal split */}
<div className="relative min-h-0 flex-1 flex flex-col">
  {/* Chat area — takes remaining space */}
  <div
    className="min-h-0 flex flex-col"
    style={panelVisible ? { height: `${100 - terminalPanelHeight}%` } : { flex: '1' }}
  >
    {/* existing entry list div (line 389-433) stays here unchanged */}
    {/* existing floating scroll-to-bottom button stays here unchanged */}
    {/* existing input bar stays here unchanged */}
  </div>

  {/* Drag handle + Terminal panel */}
  {panelVisible && session && (
    <>
      <div
        onMouseDown={handleDragStart}
        className="border-border hover:bg-primary/20 h-1 shrink-0 cursor-row-resize border-y transition-colors"
        style={isDragging ? { backgroundColor: 'var(--primary)' } : undefined}
      />
      <div style={{ height: `${terminalPanelHeight}%` }} className="shrink-0">
        <SessionTerminalPanel
          claudeSessionId={session.id}
          cwd={session.workingDir || '/'}
        />
      </div>
    </>
  )}
</div>
```

- [ ] **Step 4: Verify build**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionTerminalPanel.tsx src/renderer/src/components/ClaudeView.tsx
git commit -m "feat: add SessionTerminalPanel component with drag resize in ClaudeView"
```

---

### Task 5: Add Cmd+J global shortcut + focus management

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ClaudeView.tsx`

- [ ] **Step 1: Add Cmd+J handler in App.tsx**

In `src/renderer/src/App.tsx`, add `toggleSessionTerminalPanel` to the destructured state (around line 72):

```typescript
const {
  // ... existing ...
  toggleSessionTerminalPanel,
} = useZeusStore();
```

In the `handleKeyDown` callback (line 165-189), add after the `Cmd+B` handler (line 186):

```typescript
} else if (e.key === 'j') {
  e.preventDefault();
  // Only toggle when viewing a Claude session
  if (viewMode === 'claude' && activeClaudeId) {
    toggleSessionTerminalPanel(activeClaudeId);
  }
}
```

Update the `useCallback` dependency array to include `toggleSessionTerminalPanel` and `activeClaudeId`.

- [ ] **Step 2: Add `id` to the Claude input element**

In `src/renderer/src/components/ClaudeView.tsx`, the input at line 570 already has `data-testid="claude-input"`. Add `id="claude-input"`:

```tsx
<Input
  ref={inputRef}
  id="claude-input"
  data-testid="claude-input"
  value={input}
  onChange={handleInputChange}
  ...
/>
```

- [ ] **Step 3: Add focus management effect**

In `ClaudeView`, add an effect to manage focus when the panel toggles:

```typescript
// Focus management: terminal panel ↔ claude input
useEffect(() => {
  if (panelVisible) {
    // Panel opened — blur input, xterm will auto-focus via useTerminal
    inputRef.current?.blur();
  } else {
    // Panel closed — return focus to claude input
    requestAnimationFrame(() => inputRef.current?.focus());
  }
}, [panelVisible]);
```

- [ ] **Step 4: Verify build**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ClaudeView.tsx
git commit -m "feat: add Cmd+J shortcut to toggle session terminal panel"
```

---

### Task 6: QA Testing

**Files:** None (testing only)

- [ ] **Step 1: Build the app and start dev server**

Run: `npm run dev`
Expected: Electron app starts without errors.

- [ ] **Step 2: Run QA agent to test basic Cmd+J toggle**

Use `zeus_qa_run` with task:
```
Test the session terminal panel feature:
1. Open a Claude session (or select an existing running one)
2. Press Cmd+J — a terminal panel should appear at the bottom of the Claude view
3. The terminal should be functional — type 'echo hello' and verify output
4. Press Cmd+J again — the terminal panel should hide
5. Press Cmd+J again — the terminal panel should reappear with the same terminal
6. Test the [+] button to add a new terminal tab
7. Test switching between tabs by clicking them
8. Test closing a tab with the × button
9. Test the minimize button [−]
10. Test drag-resizing the panel by dragging the handle between chat and terminal
```

- [ ] **Step 3: Run QA agent to test cleanup**

Use `zeus_qa_run` with task:
```
Test terminal cleanup when Claude session is deleted:
1. Open a Claude session and press Cmd+J to open terminal panel
2. Create 2 terminal tabs using the [+] button
3. Archive or delete the Claude session from the sidebar
4. Verify the terminal tabs are cleaned up (no orphaned processes)
5. Open a new Claude session and verify Cmd+J works fresh
```

- [ ] **Step 4: Run QA agent to test edge cases**

Use `zeus_qa_run` with task:
```
Test terminal panel edge cases:
1. When on the terminal view (not Claude view), press Cmd+J — should do nothing
2. When on settings view, press Cmd+J — should do nothing
3. Open a Claude session, open terminal panel, type 'exit' in the terminal
4. Verify the "[Process exited]" overlay appears with a Restart button
5. Click Restart and verify a new terminal session starts
6. Try to create 5 tabs — the [+] button should be disabled at 5
```

---

## Verification Checklist

After all tasks are complete, verify:

1. `npm run typecheck` — no errors
2. `npm run build` — builds successfully
3. Cmd+J toggles terminal panel in Claude view
4. Cmd+J is no-op outside Claude view
5. Terminal spawns in Claude session's working directory
6. Multiple tabs work (add, switch, close)
7. 5-tab cap enforced (all tabs count)
8. Drag resize works, height persists across panel toggles (default 30%)
9. PTY exit shows overlay with restart button
10. Restart clears terminal and starts fresh session
11. Claude session delete/archive kills all linked terminals
12. Focus moves correctly between Claude input and terminal
13. Rapid tab creation links correctly via correlationId
