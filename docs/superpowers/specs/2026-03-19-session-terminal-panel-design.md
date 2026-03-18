# Session Terminal Panel — Virtual Terminal Layer

**Date:** 2026-03-19
**Status:** Approved

## Summary

Add a per-Claude-session terminal panel (VS Code style) toggled with Cmd+J. Each Claude session can have multiple terminal tabs (capped at 5), all spawned in the Claude session's working directory. Terminals are created on-demand and killed when the parent Claude session is archived/deleted.

## Requirements

- **Cmd+J** toggles a bottom terminal panel within the ClaudeView (no-op when no active Claude session)
- **On-demand creation** — terminal spawns only on first Cmd+J press
- **Working directory** — terminals start in the Claude session's `workingDir`
- **Multi-tab** — up to 5 terminal tabs per Claude session (all tabs count toward cap), with tab bar
- **Draggable resize** — split handle between Claude chat and terminal panel
- **Cleanup** — all terminals killed when Claude session is archived/deleted

## Architecture Decisions

### Backend Changes

Two targeted changes required:

**1. Add `cwd` and `correlationId` to `StartSessionPayload`**

The existing `StartSessionPayload` only has `type`, `cols`, `rows`. The `createSession()` function in `terminal.ts` already accepts `cwd` via `SessionOptions`, but the WebSocket handler in `websocket.ts` hardcodes `cwd` to `process.env.HOME`. Additionally, a `correlationId` field is needed to prevent a race condition when multiple `start_session` messages are in flight simultaneously (e.g., user rapidly clicking [+] to add tabs).

```typescript
// src/shared/types.ts — extend existing payloads
export interface StartSessionPayload {
  type: 'start_session';
  cols?: number;
  rows?: number;
  cwd?: string;           // NEW — working directory, defaults to $HOME
  correlationId?: string;  // NEW — echoed in session_started for request matching
}

export interface SessionStartedPayload {
  type: 'session_started';
  sessionId: string;
  shell: string;
  correlationId?: string;  // NEW — echoed from start_session
}
```

Update `handleControl()` in `websocket.ts` to read `cwd` from the payload, pass it to `createSession()`, and echo `correlationId` in the `session_started` broadcast.

**No new message types needed.** Cleanup on Claude session delete is handled by the frontend sending individual `stop_session` messages for each linked terminal (the frontend already knows the IDs from Zustand). This reuses the existing `stop_session` handler rather than adding a new code path.

### Frontend: Where the Real Work Is

#### Zustand State Slice

```typescript
// Per-tab state (frontend only)
interface SessionTerminalTab {
  tabId: string;              // stable UUID, used as React key — never changes
  terminalSessionId: string;  // current PTY session ID — changes on restart
  label: string;              // derived from shell name: "zsh 1", "bash 2", etc.
  createdAt: number;
  exited: boolean;            // true when PTY exits
  exitCode?: number;
}

// Per-Claude-session terminal state
sessionTerminals: Record<claudeSessionId, {
  tabs: SessionTerminalTab[];
  activeTabId: string | null;  // refers to tabId, not terminalSessionId
  panelVisible: boolean;
}>

// Global (persisted via manual localStorage read/write in actions)
terminalPanelHeight: number  // percentage, default 30
```

**Stable `tabId` vs mutable `terminalSessionId`:** xterm instances are keyed by `tabId` in the DOM (React key). When a user restarts an exited terminal, only `terminalSessionId` changes — the xterm instance is replaced in-place without breaking the `display: none` lifecycle of sibling tabs.

**Tab labels** derive from the `shell` field returned in `session_started` (e.g. `/bin/zsh` → `"zsh 1"`), not hardcoded to "bash".

**`terminalPanelHeight` persistence:** Manually read from `localStorage` on store initialization and written on change via store actions. The Zustand store does not use `persist` middleware, so this follows the existing pattern.

**5-tab cap:** Counts ALL tabs (including exited). Users must close an old tab to make room. This prevents memory bloat from accumulated exited xterm instances.

**Actions:**
- `createSessionTerminal(claudeSessionId: string, cwd: string)` — sends `start_session` with `cwd` and `correlationId`, stores tab on `session_started` response. No-op if tab count >= 5.
- `closeSessionTerminal(claudeSessionId: string, tabId: string)` — sends `stop_session` (if not exited), removes tab
- `switchSessionTerminal(claudeSessionId: string, tabId: string)` — sets `activeTabId`
- `toggleSessionTerminalPanel(claudeSessionId: string)` — toggles `panelVisible`; on first open, auto-creates first tab
- `setSessionTerminalExited(claudeSessionId: string, tabId: string, exitCode: number)` — marks exited
- `restartSessionTerminal(claudeSessionId: string, tabId: string)` — sends new `start_session`, updates `terminalSessionId` on the existing tab, clears `exited`
- `setTerminalPanelHeight(height: number)` — updates + writes to localStorage
- `destroyAllSessionTerminals(claudeSessionId: string)` — loops and sends `stop_session` for each non-exited tab, clears state

#### `useTerminal` Hook Change

Add an `onExit` callback parameter:

```typescript
export function useTerminal(
  sessionId: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onExit?: (code: number) => void,  // NEW
)
```

Inside the hook, the existing exit handler calls `onExit?.(code)` in addition to writing the exit message to xterm. The panel passes:

```typescript
onExit={(code) => setSessionTerminalExited(claudeSessionId, tabId, code)}
```

#### Scroll History Preservation

The existing `useTerminal` hook disposes xterm on unmount. Mounting/unmounting on tab switch wipes scroll history since the server doesn't buffer PTY output.

**Solution for v1:** Keep all xterm instances for the **active Claude session** mounted, hide inactive tabs with `display: none`. With a 5-tab cap, this is ~10-25MB max — acceptable. Instances are keyed by stable `tabId`.

**Cross-session behavior:** When the user switches to a different Claude session via the sidebar, the previous session's xterm instances are unmounted (ClaudeView only renders for the active session). Scrollback for those terminals is lost. This is an **accepted limitation for v1**. The future server-side ring buffer will solve this.

#### Focus Management

```
Cmd+J opens panel:
  → blur Claude input
  → requestAnimationFrame → focus active xterm

Cmd+J closes panel:
  → blur xterm
  → focus Claude input (#claude-input)

Terminal focused:
  → Claude input shortcuts (Enter to send) must not fire
  → xterm captures all key input

Claude input focused:
  → xterm key capture must not intercept
```

Implemented via `onFocus`/`onBlur` on the panel container, checking `relatedTarget` to avoid spurious blur events when switching between tabs within the panel.

**Cmd+J guard:** No-op unless `viewMode === 'claude'` and `activeClaudeId` is set.

#### PTY Exit Handling

The server broadcasts PTY exit on the `terminal` channel: `{ type: 'exit', code }` (a `TerminalExitPayload`). The `useTerminal` hook already handles this. The new `onExit` callback bridges it to the Zustand store:

1. `onExit` callback fires → sets `tab.exited = true, tab.exitCode = code` in Zustand
2. Shows "[Process exited with code N]" overlay on top of xterm (keeping scrollback visible underneath)
3. "Restart" button calls `restartSessionTerminal()` — sends new `start_session`, updates `terminalSessionId` on the existing tab

### New Component: `SessionTerminalPanel`

```
┌─ ClaudeView ──────────────────────────────┐
│                                           │
│  Claude chat (entries, input, approvals)  │
│                                           │
├─── drag handle ───────────────────────────┤
│ [zsh 1 ×] [zsh 2 ×] [+]            [−]  │  ← tab bar
│ ┌───────────────────────────────────────┐ │
│ │ $ npm run dev                         │ │  ← xterm.js
│ │ Server running on :5173               │ │
│ │ █                                     │ │
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

**Tab bar elements:**
- Tab buttons with inline `×` to close each tab
- `[+]` button to add new tab (spawns new PTY in session cwd). Disabled (grayed) when at 5-tab cap.
- `[−]` minimize button (same as Cmd+J close)

**Drag handle:**
- Horizontal resize handle between Claude chat and terminal panel
- Dragging updates `terminalPanelHeight` (percentage)
- Persisted to localStorage as a global value (same height across all sessions)
- Minimum 15%, maximum 80%
- Panel appears instantly (no animation for v1)

### Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| Cmd+J | Toggle terminal panel for active Claude session | Global (App.tsx), no-op when `viewMode !== 'claude'` or no `activeClaudeId` |

No additional shortcuts for v1. Tab creation via `[+]` button, tab closing via inline `×`. Shortcuts can be added later based on usage patterns.

## Build Order

1. **Backend: `cwd` in `StartSessionPayload`** — extend type, update `handleControl()` to pass `cwd` through
2. **Zustand slice** — `sessionTerminals` state + `terminalPanelHeight` + all actions
3. **`useTerminal` hook** — add `onExit` callback parameter
4. **`SessionTerminalPanel` component + embed in `ClaudeView`** — single tab, xterm, drag handle, resizable bottom split, panel visibility
5. **Cmd+J toggle** — global shortcut + focus management
6. **Multi-tab support** — tab bar, add/close/switch, `display: none` for history preservation, 5-tab cap
7. **PTY exit handling** — exited overlay + restart
8. **Cleanup on Claude session delete** — loop `stop_session` + Zustand cleanup
9. **QA testing** — test all interactions via QA agent

## Known Limitations (v1)

- **Scrollback lost on Claude session switch** — when switching between Claude sessions, unmounted xterm instances lose their buffer. Accepted for v1; future ring buffer will fix.
- **No terminal persistence across app restarts** — terminal tabs are ephemeral; only Claude sessions survive restarts.
- **No tab rename** — future enhancement, requires custom context menu UI.

## Not In Scope (Future)

- Server-side output ring buffer for replay on reconnect
- Split panes within terminal panel (horizontal/vertical splits)
- Tab drag-to-reorder
- Tab rename via context menu
- Terminal session persistence across app restarts
- Terminal-to-Claude integration (pipe terminal output into Claude context)
- Additional keyboard shortcuts (Cmd+Shift+T for new tab, etc.)
