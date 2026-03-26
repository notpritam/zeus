# Quick Session Switching & Collapsible Sidebar Sections

**Date:** 2026-03-26
**Branch:** `zeus/f587a3-fix-switch-tab-quick`

## Problem

There is no keyboard shortcut to jump between existing Claude sessions. Users must click the sidebar manually. Additionally, the sidebar section lists (Claude, Terminal) cannot be collapsed, wasting vertical space when one section is not actively used.

## Feature 1: Cmd+1–9 Session Switching

### Behavior

- `Cmd+1` through `Cmd+9` (macOS) / `Ctrl+1` through `Ctrl+9` (other platforms) switch to Claude sessions by their sidebar position.
- Sidebar position is determined by the existing sort order: `lastActivityAt` descending, fallback to `startedAt`.
- `Cmd+1` = topmost Claude session, `Cmd+2` = second, etc.
- Only Claude sessions are numbered. Terminal sessions are not included in the shortcut mapping.
- If the target index has no session (e.g., `Cmd+5` but only 3 sessions exist), the shortcut is a no-op.
- Pressing the shortcut for the already-active session is also a no-op.

### Implementation Location

- **App.tsx** — add cases for digits `1`–`9` in the existing global `keydown` handler (lines ~159–188).
- **useZeusStore.ts** — no changes needed; reuse existing `selectClaudeSession(id)`.
- **SessionSidebar.tsx** — render a small index badge (`1`–`9`) on the first 9 Claude session cards so users know the mapping.
- **SettingsModal.tsx** — add `Cmd+1–9` / `Switch Claude Session` to the documented shortcuts list.
- **CommandPalette.tsx** — add `Cmd+1–9` shortcut hint to the palette if desired (optional).

### Sort Order Contract

The sort used in App.tsx to resolve `Cmd+N` → session ID must be identical to the sort used in SessionSidebar.tsx to render the list. Extract the sort comparator into a shared utility or compute the sorted list once in the store/parent and pass it down.

## Feature 2: Collapsible Sidebar Sections

### Behavior

- The "Claude" and "Terminal" section headers in the sidebar are clickable.
- Clicking a header toggles the visibility of the session list below it.
- When collapsed: the header remains visible with a chevron indicator (right-pointing when collapsed, down-pointing when expanded). The "+ New" button stays visible next to the header.
- When expanded: current behavior, full session list shown.
- Default state on app start: both sections expanded.
- Collapse state is component-local (`useState`), not persisted to store or localStorage.

### Implementation Location

- **SessionSidebar.tsx** — add `useState<boolean>` for `claudeCollapsed` and `terminalCollapsed`. Wrap session list renders in a conditional. Add chevron icon to section headers. Make headers clickable.

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/App.tsx` | Add `Cmd+1`–`Cmd+9` handler in global keydown listener |
| `src/renderer/src/components/SessionSidebar.tsx` | Add collapse toggle state + chevron UI; add index badges on Claude cards |
| `src/renderer/src/components/SettingsModal.tsx` | Document new shortcuts |

## Out of Scope

- Terminal session shortcuts
- Persisting collapse state
- Command palette session search (future enhancement)
- Reordering/pinning sessions
