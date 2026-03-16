# Monaco Diff Editor Integration — Design Spec

## Overview

Replace the current plain-text diff overlay in the right panel with a full Monaco-powered diff editor in the center content area. Clicking a changed file in Source Control opens a tabbed, side-by-side diff view with syntax highlighting, line numbers, and editable working copy — matching VS Code's source control experience.

## Goals

- Click a file in Source Control → opens Monaco diff editor in center panel
- Tab bar for multiple open diffs + a "home" tab to return to Claude/Terminal
- Side-by-side diff: left = HEAD (read-only), right = working copy (editable)
- Inline/side-by-side toggle
- Explicit Save button to write edits back to disk
- Right panel (Source Control) stays open for navigation; user can close it manually
- Cmd+S keyboard shortcut to save active diff tab

## Non-Goals

- File explorer / tree view (separate feature)
- Git blame, git log, or merge conflict resolution
- Multiple editor themes or user-configurable Monaco settings
- Mobile layout support for diff view (desktop only; mobile falls back to Claude/Terminal)

---

## Architecture

### View Mode Extension

The existing `viewMode: 'terminal' | 'claude'` state expands to include `'diff'`. When any diff tab is open and active, viewMode is `'diff'` and the center panel renders the DiffView component. Clicking the "home" tab restores the previous viewMode (`terminal` or `claude`).

### New Shared Types (`src/shared/types.ts`)

```ts
// Add to GitPayload union:
| { type: 'git_file_contents'; file: string; staged: boolean }
| { type: 'git_file_contents_result'; file: string; original: string; modified: string; language: string }
| { type: 'git_file_contents_error'; file: string; error: string }
| { type: 'git_save_file'; file: string; content: string }
| { type: 'git_save_file_result'; file: string; success: boolean; error?: string }
```

Also **remove** the now-unused types:
```ts
// Remove from GitPayload:
| { type: 'git_diff'; file: string; staged: boolean }
| { type: 'git_diff_result'; file: string; diff: string }
```

### Backend Changes (`src/main/services/git.ts`)

**New method: `getFileContents(file, staged)`**
- Original content: `git show HEAD:<file>` (returns empty string for new/untracked files; catches errors gracefully)
- Modified content:
  - If file status is `D` (deleted): return empty string (file no longer exists on disk)
  - If `staged=false`: `fs.readFile(workingDir/file)` (working copy)
  - If `staged=true`: `git show :<file>` (index version)
- Language detection: derive from file extension using a lookup map:
  - `.ts` → `typescript`, `.tsx` → `typescriptreact`, `.js` → `javascript`, `.jsx` → `javascriptreact`
  - `.css` → `css`, `.html` → `html`, `.json` → `json`, `.md` → `markdown`
  - `.py` → `python`, `.rs` → `rust`, `.go` → `go`, `.yaml`/`.yml` → `yaml`
  - Default: `plaintext`
- Returns `{ original, modified, language }`
- On error: throws, caller sends `git_file_contents_error`

**New method: `saveFile(file, content)`**
- Validates file path: `path.resolve(workingDir, file)` must start with `path.resolve(workingDir)` (prevent path traversal)
- Writes content to resolved path via `fs.promises.writeFile`
- chokidar will automatically detect the change and trigger a git status refresh
- Returns `{ success: true }` or `{ success: false, error }`

**Remove:** The `getDiff()` method (replaced by `getFileContents`).

### WebSocket Changes (`src/main/services/websocket.ts`)

Add handlers in `handleGit()`:
- `git_file_contents` → calls `watcher.getFileContents()`, sends `git_file_contents_result` back to requesting client only (unicast via `sendEnvelope`). On error, sends `git_file_contents_error` to requesting client only.
- `git_save_file` → calls `watcher.saveFile()`, sends `git_save_file_result` back to requesting client only (unicast).

**Remove:** The `git_diff` handler (replaced by `git_file_contents`).

### Store Changes (`src/renderer/src/stores/useZeusStore.ts`)

**New state:**
```ts
// Diff tab data
openDiffTabs: DiffTab[]              // ordered list of open diff tabs
activeDiffTabId: string | null       // which tab is active
previousViewMode: 'terminal' | 'claude'  // to restore when closing all diff tabs (initial: 'terminal')

interface DiffTab {
  id: string                   // unique: `${sessionId}:${file}:${staged}`
  sessionId: string
  file: string
  staged: boolean
  original: string             // HEAD content
  modified: string             // working copy content (updated on edit)
  language: string             // monaco language id
  isDirty: boolean             // has unsaved edits
}
```

Initial values: `openDiffTabs: []`, `activeDiffTabId: null`, `previousViewMode: 'terminal'`.

**New actions:**
- `openDiffTab(sessionId, file, staged)` — if tab already open for this file, just activate it. Otherwise sends `git_file_contents` WS message. Saves current viewMode as `previousViewMode` (only if not already `'diff'`).
- `closeDiffTab(tabId)` — removes tab, if it was active selects next tab or restores previousViewMode if no tabs left
- `closeAllDiffTabs()` — clears all tabs, restores previousViewMode
- `setActiveDiffTab(tabId)` — switches active tab, sets viewMode to `'diff'`
- `updateDiffContent(tabId, content)` — updates modified content + marks isDirty = true
- `saveDiffFile(tabId)` — sends `git_save_file` WS message with file and content from tab
- `returnToHome()` — sets viewMode back to previousViewMode without closing tabs

**New WS subscription handlers (in git channel):**
- `git_file_contents_result` → creates DiffTab with isDirty=false, adds to openDiffTabs, sets activeDiffTabId, sets viewMode to `'diff'`
- `git_file_contents_error` → sets gitErrors[sid] with the error message (no tab is created; user sees error in Source Control panel)
- `git_save_file_result` → on success: clears isDirty for the matching tab. On failure: sets gitErrors[sid]

**Remove:** `gitDiff` state, `getDiff()` action, `clearDiff()` action, `git_diff_result` WS handler.

**ViewMode update:**
- `type ViewMode = 'terminal' | 'claude' | 'diff'`

### Frontend Components

#### `DiffTabBar.tsx` (NEW)

Tab bar rendered at the top of the center content area. Always visible when there are open diff tabs, even when viewing Claude/Terminal.

Structure:
- **Home tab**: Shows current session context (e.g., "Claude" or "Terminal" with icon). Click calls `returnToHome()`. Always present when diff tabs exist.
- **Diff tabs**: One per open file. Shows status badge color (M=amber, A=green, D=red) + filename. Close button (x) on each. Active tab has `border-top: 2px solid primary` and darker background. Dirty tabs show a dot indicator.
- **Save button**: Right-aligned. Disabled when active tab is not dirty. Label: "Save" when dirty, hidden/grayed when clean. Calls `saveDiffFile(activeDiffTabId)`.

Clicking a diff tab → `setActiveDiffTab(id)`
Clicking home tab → `returnToHome()`
Clicking close → `closeDiffTab(id)` (if tab isDirty, close anyway — no confirm dialog, keeps it simple)

#### `DiffView.tsx` (NEW)

The main diff viewer component rendered when `viewMode === 'diff'`.

Structure:
- **Diff toolbar**: File path, staged/unstaged badge, inline/side-by-side toggle buttons
- **Monaco DiffEditor**: Takes `original` and `modified` strings from active tab. Left side read-only, right side editable. Theme matches Zeus dark theme.
- onChange from Monaco right editor → `updateDiffContent(tabId, newContent)`

Monaco configuration:
- `theme`: Custom 'zeus-dark' theme (registered on mount)
- `renderSideBySide`: toggled by toolbar button (default: true)
- `originalEditable`: false
- `readOnly`: false (right side)
- `automaticLayout`: true (handles resize)
- `minimap`: disabled (space constraint in panel layout)
- `fontSize`: 13
- `lineNumbers`: 'on'
- `scrollBeyondLastLine`: false

Keyboard shortcut: Cmd+S (or Ctrl+S) when DiffView is focused → calls `saveDiffFile(activeDiffTabId)`.

#### `GitPanel.tsx` (MODIFY)

- Remove the `DiffViewer` overlay component entirely
- Remove `gitDiff` state usage and `clearDiff` action usage
- Change file click handler: instead of `getDiff()`, call `openDiffTab(sessionId, file, staged)`

#### `App.tsx` (MODIFY)

Center content area rendering logic (desktop):

```tsx
{openDiffTabs.length > 0 && <DiffTabBar />}

{viewMode === 'diff' ? (
  <DiffView />
) : viewMode === 'claude' ? (
  <ClaudeView ... />
) : (
  <TerminalView ... />
)}
```

The tab bar is always rendered above the content when diff tabs exist (so user can switch back even while viewing Claude).

Mobile layout: `viewMode === 'diff'` falls back to Claude/Terminal (no Monaco on mobile). The openDiffTab action is a no-op on mobile, or simply not triggered since Source Control panel is desktop-only.

#### `SessionSidebar.tsx` (MODIFY)

Update `viewMode` prop type from `'terminal' | 'claude'` to accept the full `ViewMode` type (`'terminal' | 'claude' | 'diff'`). When viewMode is `'diff'`, sidebar session highlighting behavior: treat it like the `previousViewMode` for determining which session card is highlighted (i.e., if viewing a diff while a Claude session is active, the Claude session card stays highlighted).

### Monaco Installation

Install both `@monaco-editor/react` and `monaco-editor` (peer dependency). Configure for **local bundling** since this is an Electron app (CDN unreliable for offline use and CSP):

```bash
npm install @monaco-editor/react monaco-editor
```

Configure the Monaco loader to use local files in the DiffView component:

```ts
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

loader.config({ monaco });
```

This ensures Monaco loads from the bundled node_modules rather than CDN.

### Monaco Theme

Register a custom theme matching Zeus design tokens (called once on DiffView mount):

```ts
monaco.editor.defineTheme('zeus-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#e0e0e0',
    'editorLineNumber.foreground': '#333333',
    'editorLineNumber.activeForeground': '#888888',
    'diffEditor.insertedTextBackground': '#22c55e18',
    'diffEditor.removedTextBackground': '#ef444418',
    'diffEditor.insertedLineBackground': '#22c55e0d',
    'diffEditor.removedLineBackground': '#ef44440d',
    'editor.lineHighlightBackground': '#1a1a1a',
    'editorGutter.background': '#0a0a0a',
  },
});
```

### Security

- `saveFile` must validate that the resolved file path is within the git watcher's `workingDir` (prevent path traversal with `../`)
- Use `path.resolve(workingDir, file)` and check `resolved.startsWith(path.resolve(workingDir) + path.sep)`

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/shared/types.ts` | MODIFY | Add git_file_contents/save types, remove git_diff/git_diff_result |
| `src/main/services/git.ts` | MODIFY | Add getFileContents(), saveFile(); remove getDiff() |
| `src/main/services/websocket.ts` | MODIFY | Add handlers for new types; remove git_diff handler |
| `src/renderer/src/stores/useZeusStore.ts` | MODIFY | Add diff tab state/actions/WS handlers; remove gitDiff; extend ViewMode |
| `src/renderer/src/components/DiffTabBar.tsx` | CREATE | Tab bar for diff files + home tab + save button |
| `src/renderer/src/components/DiffView.tsx` | CREATE | Monaco DiffEditor wrapper with toolbar + Cmd+S |
| `src/renderer/src/components/GitPanel.tsx` | MODIFY | Remove DiffViewer overlay, use openDiffTab instead |
| `src/renderer/src/components/SessionSidebar.tsx` | MODIFY | Update viewMode prop type to include 'diff' |
| `src/renderer/src/App.tsx` | MODIFY | Render DiffTabBar + DiffView when viewMode='diff' |
| `package.json` | MODIFY | Add @monaco-editor/react + monaco-editor |
