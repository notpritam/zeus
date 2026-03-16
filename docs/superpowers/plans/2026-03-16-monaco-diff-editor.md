# Monaco Diff Editor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text diff overlay in the right panel with a full Monaco-powered diff editor in the center content area, matching VS Code's source control experience.

**Architecture:** Clicking a changed file in Source Control sends `git_file_contents` over WebSocket. The backend returns both the HEAD version and working copy. The renderer opens a tabbed Monaco DiffEditor in the center panel. Edits to the right pane can be saved back to disk via `git_save_file`. ViewMode extends to `'diff'` with `previousViewMode` for restoring Claude/Terminal.

**Tech Stack:** `@monaco-editor/react`, `monaco-editor`, React 19, Zustand, WebSocket envelopes, Node.js `fs`/`child_process`

**Spec:** `docs/superpowers/specs/2026-03-16-monaco-diff-editor-design.md`

---

## Chunk 1: Dependencies & Shared Types

### Task 1: Install Monaco dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm install @monaco-editor/react monaco-editor
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
node -e "require('@monaco-editor/react'); require('monaco-editor'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Verify build still works**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```
Expected: Build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @monaco-editor/react and monaco-editor for diff viewer"
```

---

### Task 2: Update shared types

**Files:**
- Modify: `src/shared/types.ts:55-73` (GitPayload union)

Replace the `git_diff` and `git_diff_result` entries in `GitPayload` with the new file contents and save types.

- [ ] **Step 1: Add new types, remove old ones**

In `src/shared/types.ts`, replace lines 67-68:

```ts
  | { type: 'git_diff'; file: string; staged: boolean }
  | { type: 'git_diff_result'; file: string; diff: string }
```

With:

```ts
  | { type: 'git_file_contents'; file: string; staged: boolean }
  | { type: 'git_file_contents_result'; file: string; staged: boolean; original: string; modified: string; language: string }
  | { type: 'git_file_contents_error'; file: string; error: string }
  | { type: 'git_save_file'; file: string; content: string }
  | { type: 'git_save_file_result'; file: string; success: boolean; error?: string }
```

The full `GitPayload` type should now be:

```ts
export type GitPayload =
  | { type: 'start_watching'; workingDir: string }
  | { type: 'stop_watching' }
  | { type: 'git_connected' }
  | { type: 'git_disconnected' }
  | { type: 'git_heartbeat' }
  | { type: 'git_status'; data: GitStatusData }
  | { type: 'git_stage'; files: string[] }
  | { type: 'git_unstage'; files: string[] }
  | { type: 'git_stage_all' }
  | { type: 'git_unstage_all' }
  | { type: 'git_discard'; files: string[] }
  | { type: 'git_file_contents'; file: string; staged: boolean }
  | { type: 'git_file_contents_result'; file: string; staged: boolean; original: string; modified: string; language: string }
  | { type: 'git_file_contents_error'; file: string; error: string }
  | { type: 'git_save_file'; file: string; content: string }
  | { type: 'git_save_file_result'; file: string; success: boolean; error?: string }
  | { type: 'git_commit'; message: string }
  | { type: 'git_commit_result'; success: boolean; error?: string; commitHash?: string }
  | { type: 'refresh' }
  | { type: 'git_error'; message: string }
  | { type: 'not_a_repo' };
```

- [ ] **Step 2: Verify no TypeScript errors from type change**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npx tsc --noEmit 2>&1 | head -30
```

Expected: Will show errors in files that still reference `git_diff` / `git_diff_result` — that's fine, those get fixed in later tasks. Verify the types file itself has no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: replace git_diff types with git_file_contents and git_save_file in GitPayload"
```

---

## Chunk 2: Backend Changes

### Task 3: Add `getFileContents()` and `saveFile()` to GitWatcher, remove `getDiff()`

**Files:**
- Modify: `src/main/services/git.ts:1-5` (imports — add `fs/promises`, `path`)
- Modify: `src/main/services/git.ts:131-158` (replace `getDiff` with `getFileContents` + `saveFile`)

- [ ] **Step 1: Add fs/path imports**

At the top of `src/main/services/git.ts`, after line 4 (`import chokidar...`), add:

```ts
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
```

- [ ] **Step 2: Add language detection map**

After the `execFileAsync` line (line 7), add:

```ts
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.css': 'css',
  '.html': 'html',
  '.json': 'json',
  '.md': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.xml': 'xml',
  '.svg': 'xml',
  '.toml': 'toml',
  '.env': 'plaintext',
};
```

- [ ] **Step 3: Replace `getDiff` method with `getFileContents` and `saveFile`**

In `src/main/services/git.ts`, delete the entire `getDiff` method (lines 131-158, from `// ─── Diff ───` to the closing `}`), and replace with:

```ts
  // ─── File Contents (for Monaco diff editor) ───

  async getFileContents(
    file: string,
    staged: boolean,
  ): Promise<{ original: string; modified: string; language: string }> {
    // Language detection from extension
    const ext = path.extname(file).toLowerCase();
    const language = EXT_TO_LANGUAGE[ext] || 'plaintext';

    // Original content: HEAD version
    let original = '';
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${file}`], {
        cwd: this.workingDir,
        maxBuffer: 5 * 1024 * 1024,
      });
      original = stdout;
    } catch {
      // New/untracked file — no HEAD version, original stays empty
    }

    // Modified content
    // Modified content: staged reads from index, unstaged reads from disk.
    // Deleted files: git show / readFile will throw → catch returns empty string.
    let modified = '';
    if (staged) {
      // Staged version from index
      try {
        const { stdout } = await execFileAsync('git', ['show', `:${file}`], {
          cwd: this.workingDir,
          maxBuffer: 5 * 1024 * 1024,
        });
        modified = stdout;
      } catch {
        // File deleted in index or not staged — empty
        modified = '';
      }
    } else {
      // Working copy from disk
      const fullPath = path.resolve(this.workingDir, file);
      try {
        modified = await readFile(fullPath, 'utf-8');
      } catch {
        // File deleted on disk — empty
        modified = '';
      }
    }

    return { original, modified, language };
  }

  // ─── Save File (write edits from Monaco back to disk) ───

  async saveFile(file: string, content: string): Promise<{ success: boolean; error?: string }> {
    const resolved = path.resolve(this.workingDir, file);
    const workingDirResolved = path.resolve(this.workingDir);

    // Security: prevent path traversal
    if (!resolved.startsWith(workingDirResolved + path.sep) && resolved !== workingDirResolved) {
      return { success: false, error: 'Path traversal not allowed' };
    }

    try {
      await writeFile(resolved, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
```

- [ ] **Step 4: Verify TypeScript compiles for this file**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npx tsc --noEmit src/main/services/git.ts 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat: add getFileContents and saveFile to GitWatcher, remove getDiff"
```

---

### Task 4: Update WebSocket handlers

**Files:**
- Modify: `src/main/services/websocket.ts:17-18` (add GitPayload import if missing)
- Modify: `src/main/services/websocket.ts:580-598` (replace `git_diff` handler with `git_file_contents` + `git_save_file`)

- [ ] **Step 1: Ensure `GitPayload` is imported**

Check the imports at the top of `src/main/services/websocket.ts`. If `GitPayload` is not imported from `'../types'`, add it. It may already be referenced; if it's imported via a different path check `src/main/types.ts` to see if it re-exports from shared.

- [ ] **Step 2: Replace the `git_diff` handler block**

In `src/main/services/websocket.ts`, find the block at lines 580-598:

```ts
  } else if (payload.type === 'git_diff') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const diff = await watcher.getDiff(payload.file, payload.staged);
        sendEnvelope(_ws, {
          channel: 'git',
          sessionId,
          payload: { type: 'git_diff_result', file: payload.file, diff },
          auth: '',
        });
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  }
```

Replace it with:

```ts
  } else if (payload.type === 'git_file_contents') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const result = await watcher.getFileContents(payload.file, payload.staged);
        sendEnvelope(_ws, {
          channel: 'git',
          sessionId,
          payload: {
            type: 'git_file_contents_result',
            file: payload.file,
            staged: payload.staged,
            original: result.original,
            modified: result.modified,
            language: result.language,
          },
          auth: '',
        });
      } catch (err) {
        sendEnvelope(_ws, {
          channel: 'git',
          sessionId,
          payload: {
            type: 'git_file_contents_error',
            file: payload.file,
            error: (err as Error).message,
          },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_save_file') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.saveFile(payload.file, payload.content);
      sendEnvelope(_ws, {
        channel: 'git',
        sessionId,
        payload: {
          type: 'git_save_file_result',
          file: payload.file,
          success: result.success,
          error: result.error,
        },
        auth: '',
      });
    }
  }
```

Note: Both `git_file_contents_result` and `git_file_contents_error` use `sendEnvelope` (unicast to requesting client), not `broadcastEnvelope`. Same for `git_save_file_result`.

- [ ] **Step 3: Verify build**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat: replace git_diff WS handler with git_file_contents and git_save_file"
```

---

## Chunk 3: Store Updates

### Task 5: Update Zustand store — add diff tab state, remove old diff state

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts:22` (extend ViewMode)
- Modify: `src/renderer/src/stores/useZeusStore.ts:94-118` (interface — remove old, add new)
- Modify: `src/renderer/src/stores/useZeusStore.ts:122+` (initial state)
- Modify: `src/renderer/src/stores/useZeusStore.ts:381-383` (remove git_diff_result handler, add new handlers)
- Modify: `src/renderer/src/stores/useZeusStore.ts:702-713` (remove getDiff/clearDiff, add new actions)

This is a large change across one file. Work methodically top to bottom.

- [ ] **Step 1: Extend ViewMode type**

At line 22 of `src/renderer/src/stores/useZeusStore.ts`, change:

```ts
type ViewMode = 'terminal' | 'claude';
```

To:

```ts
type ViewMode = 'terminal' | 'claude' | 'diff';

interface DiffTab {
  id: string;                   // unique: `${sessionId}:${file}`
  sessionId: string;
  file: string;
  staged: boolean;
  original: string;             // HEAD content
  modified: string;             // working copy content (updated on edit)
  language: string;             // monaco language id
  isDirty: boolean;             // has unsaved edits
}
```

- [ ] **Step 2: Update the ZeusState interface**

Remove these lines from the interface (around lines 103-108):

```ts
  getDiff: (sessionId: string, file: string, staged: boolean) => void;
  clearDiff: () => void;
  // ...
  gitDiff: { file: string; diff: string } | null;
```

Add these new entries to the interface:

```ts
  // Diff tab state
  openDiffTabs: DiffTab[];
  activeDiffTabId: string | null;
  previousViewMode: 'terminal' | 'claude';

  // Diff tab actions
  openDiffTab: (sessionId: string, file: string, staged: boolean) => void;
  closeDiffTab: (tabId: string) => void;
  closeAllDiffTabs: () => void;
  setActiveDiffTab: (tabId: string) => void;
  updateDiffContent: (tabId: string, content: string) => void;
  saveDiffFile: (tabId: string) => void;
  returnToHome: () => void;
```

- [ ] **Step 3: Update initial state values**

In the `create<ZeusState>((set, get) => ({` block, remove:

```ts
  gitDiff: null,
```

Add:

```ts
  openDiffTabs: [],
  activeDiffTabId: null,
  previousViewMode: 'terminal' as const,
```

- [ ] **Step 4: Replace `git_diff_result` handler in WS subscription**

In the git channel subscription (around line 381-383), remove:

```ts
      if (payload.type === 'git_diff_result') {
        set({ gitDiff: { file: payload.file, diff: payload.diff } });
      }
```

Add these three handlers in its place. Tab ID uses `${sid}:${payload.file}` (no staged flag — one tab per file). The `staged` flag comes from `payload.staged` which the backend now echoes back:

```ts
      if (payload.type === 'git_file_contents_result') {
        const tabId = `${sid}:${payload.file}`;
        const existing = get().openDiffTabs.find((t) => t.id === tabId);
        if (existing) {
          // Tab already open — update contents and activate
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === tabId
                ? { ...t, staged: payload.staged, original: payload.original, modified: payload.modified, language: payload.language, isDirty: false }
                : t,
            ),
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
          }));
        } else {
          const newTab: DiffTab = {
            id: tabId,
            sessionId: sid,
            file: payload.file,
            staged: payload.staged,
            original: payload.original,
            modified: payload.modified,
            language: payload.language,
            isDirty: false,
          };
          set((state) => ({
            openDiffTabs: [...state.openDiffTabs, newTab],
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
            previousViewMode:
              state.viewMode !== 'diff'
                ? (state.viewMode as 'terminal' | 'claude')
                : state.previousViewMode,
          }));
        }
      }

      if (payload.type === 'git_file_contents_error') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: payload.error },
        }));
      }

      if (payload.type === 'git_save_file_result') {
        const saveTabId = `${sid}:${payload.file}`;
        if (payload.success) {
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === saveTabId ? { ...t, isDirty: false } : t,
            ),
          }));
        } else if (payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
      }
```

- [ ] **Step 5: Remove old `getDiff` and `clearDiff` actions, add new diff actions**

Remove the `getDiff` and `clearDiff` action implementations (lines 702-713):

```ts
  getDiff: (sessionId: string, file: string, staged: boolean) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_diff', file, staged },
      auth: '',
    });
  },

  clearDiff: () => {
    set({ gitDiff: null });
  },
```

Add the new diff tab actions in their place:

```ts
  openDiffTab: (sessionId: string, file: string, staged: boolean) => {
    const tabId = `${sessionId}:${file}`;
    const existing = get().openDiffTabs.find((t) => t.id === tabId);
    if (existing) {
      // Tab already open — just activate it
      set((state) => ({
        activeDiffTabId: tabId,
        viewMode: 'diff' as ViewMode,
        previousViewMode:
          state.viewMode !== 'diff'
            ? (state.viewMode as 'terminal' | 'claude')
            : state.previousViewMode,
      }));
      return;
    }
    // Request file contents from backend
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_file_contents', file, staged },
      auth: '',
    });
  },

  closeDiffTab: (tabId: string) => {
    set((state) => {
      const remaining = state.openDiffTabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeDiffTabId;
      let newViewMode = state.viewMode;

      if (state.activeDiffTabId === tabId) {
        if (remaining.length > 0) {
          // Select next tab
          const closedIdx = state.openDiffTabs.findIndex((t) => t.id === tabId);
          const nextIdx = Math.min(closedIdx, remaining.length - 1);
          newActiveId = remaining[nextIdx].id;
        } else {
          // No more tabs — restore previous view
          newActiveId = null;
          newViewMode = state.previousViewMode;
        }
      }

      return {
        openDiffTabs: remaining,
        activeDiffTabId: newActiveId,
        viewMode: newViewMode,
      };
    });
  },

  closeAllDiffTabs: () => {
    set((state) => ({
      openDiffTabs: [],
      activeDiffTabId: null,
      viewMode: state.previousViewMode,
    }));
  },

  setActiveDiffTab: (tabId: string) => {
    set((state) => ({
      activeDiffTabId: tabId,
      viewMode: 'diff' as ViewMode,
      previousViewMode:
        state.viewMode !== 'diff'
          ? (state.viewMode as 'terminal' | 'claude')
          : state.previousViewMode,
    }));
  },

  updateDiffContent: (tabId: string, content: string) => {
    set((state) => ({
      openDiffTabs: state.openDiffTabs.map((t) =>
        t.id === tabId ? { ...t, modified: content, isDirty: true } : t,
      ),
    }));
  },

  saveDiffFile: (tabId: string) => {
    const tab = get().openDiffTabs.find((t) => t.id === tabId);
    if (!tab) return;
    zeusWs.send({
      channel: 'git',
      sessionId: tab.sessionId,
      payload: { type: 'git_save_file', file: tab.file, content: tab.modified },
      auth: '',
    });
  },

  returnToHome: () => {
    set((state) => ({
      viewMode: state.previousViewMode,
    }));
  },
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```

Expected: May still fail due to GitPanel referencing `getDiff`/`clearDiff`/`gitDiff`. That's expected — fixed in Task 8. The store itself should have no internal errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat: add diff tab state and actions to store, remove old gitDiff state"
```

---

## Chunk 4: Frontend Components

### Task 6: Create `DiffTabBar.tsx`

**Files:**
- Create: `src/renderer/src/components/DiffTabBar.tsx`

- [ ] **Step 1: Create the DiffTabBar component**

Create `src/renderer/src/components/DiffTabBar.tsx`:

```tsx
import { X, MessageSquare, TerminalSquare, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useZeusStore } from '@/stores/useZeusStore';
import type { GitFileStatus } from '../../../../shared/types';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-destructive' },
  '??': { label: 'U', color: 'text-text-muted' },
  R: { label: 'R', color: 'text-info' },
};

function getFileStatus(
  file: string,
  sessionId: string,
  gitStatus: Record<string, { staged: { file: string; status: GitFileStatus }[]; unstaged: { file: string; status: GitFileStatus }[] }>,
): { label: string; color: string } {
  const status = gitStatus[sessionId];
  if (!status) return STATUS_STYLES['M'];
  const match =
    status.staged.find((c) => c.file === file) ||
    status.unstaged.find((c) => c.file === file);
  if (!match) return STATUS_STYLES['M'];
  return STATUS_STYLES[match.status] || STATUS_STYLES['M'];
}

export default function DiffTabBar() {
  const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const previousViewMode = useZeusStore((s) => s.previousViewMode);
  const viewMode = useZeusStore((s) => s.viewMode);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const closeDiffTab = useZeusStore((s) => s.closeDiffTab);
  const setActiveDiffTab = useZeusStore((s) => s.setActiveDiffTab);
  const returnToHome = useZeusStore((s) => s.returnToHome);
  const saveDiffFile = useZeusStore((s) => s.saveDiffFile);

  if (openDiffTabs.length === 0) return null;

  const activeTab = openDiffTabs.find((t) => t.id === activeDiffTabId);
  const isHomeActive = viewMode !== 'diff';

  return (
    <div className="bg-bg-card border-border flex shrink-0 items-center border-b">
      {/* Home tab */}
      <button
        className={`border-border flex items-center gap-1.5 border-r px-3 py-1.5 text-[11px] transition-colors ${
          isHomeActive
            ? 'bg-bg border-t-2 border-t-primary text-primary'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        onClick={returnToHome}
      >
        {previousViewMode === 'claude' ? (
          <>
            <MessageSquare className="size-3" />
            Claude
          </>
        ) : (
          <>
            <TerminalSquare className="size-3" />
            Terminal
          </>
        )}
      </button>

      {/* Diff tabs */}
      {openDiffTabs.map((tab) => {
        const isActive = viewMode === 'diff' && tab.id === activeDiffTabId;
        const fileName = tab.file.split('/').pop() || tab.file;
        const style = getFileStatus(tab.file, tab.sessionId, gitStatus);

        return (
          <div
            key={tab.id}
            className={`border-border group flex items-center gap-1 border-r px-2 py-1.5 text-[11px] ${
              isActive
                ? 'bg-bg border-t-2 border-t-primary text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <button
              className="flex items-center gap-1 truncate"
              onClick={() => setActiveDiffTab(tab.id)}
            >
              <span className={`${style.color} text-[10px] font-bold`}>{style.label}</span>
              <span className="max-w-[120px] truncate">{fileName}</span>
              {tab.isDirty && (
                <span className="bg-primary ml-0.5 inline-block size-1.5 rounded-full" />
              )}
            </button>
            <button
              className="text-text-ghost ml-1 opacity-0 transition-opacity hover:text-text-muted group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeDiffTab(tab.id);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}

      {/* Save button */}
      {activeTab && viewMode === 'diff' && (
        <div className="ml-auto pr-2">
          <Button
            variant="default"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            disabled={!activeTab.isDirty}
            onClick={() => saveDiffFile(activeTab.id)}
          >
            <Save className="size-3" />
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/DiffTabBar.tsx
git commit -m "feat: create DiffTabBar component for diff file tabs"
```

---

### Task 7: Create `DiffView.tsx` with Monaco DiffEditor

**Files:**
- Create: `src/renderer/src/components/DiffView.tsx`

- [ ] **Step 1: Create the DiffView component**

Create `src/renderer/src/components/DiffView.tsx`:

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useZeusStore } from '@/stores/useZeusStore';
import type { GitFileStatus } from '../../../../shared/types';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-destructive' },
  '??': { label: 'U', color: 'text-text-muted' },
  R: { label: 'R', color: 'text-info' },
};

function getFileStatus(
  file: string,
  sessionId: string,
  gitStatus: Record<string, { staged: { file: string; status: GitFileStatus }[]; unstaged: { file: string; status: GitFileStatus }[] }>,
): { label: string; color: string } {
  const status = gitStatus[sessionId];
  if (!status) return STATUS_STYLES['M'];
  const match =
    status.staged.find((c) => c.file === file) ||
    status.unstaged.find((c) => c.file === file);
  if (!match) return STATUS_STYLES['M'];
  return STATUS_STYLES[match.status] || STATUS_STYLES['M'];
}

// Use local Monaco bundling (Electron — no CDN)
loader.config({ monaco });

// Register Zeus dark theme
let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
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
  themeRegistered = true;
}

export default function DiffView() {
  const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const updateDiffContent = useZeusStore((s) => s.updateDiffContent);
  const saveDiffFile = useZeusStore((s) => s.saveDiffFile);
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const activeTab = openDiffTabs.find((t) => t.id === activeDiffTabId);

  // Register theme on mount
  useEffect(() => {
    ensureTheme();
  }, []);

  // Cmd+S / Ctrl+S handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeDiffTabId) {
          saveDiffFile(activeDiffTabId);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDiffTabId, saveDiffFile]);

  const handleEditorDidMount = useCallback(
    (editor: monaco.editor.IStandaloneDiffEditor) => {
      editorRef.current = editor;

      // Listen for changes on the modified (right) editor
      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onDidChangeModelContent(() => {
        const content = modifiedEditor.getValue();
        if (activeDiffTabId) {
          updateDiffContent(activeDiffTabId, content);
        }
      });
    },
    [activeDiffTabId, updateDiffContent],
  );

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-muted text-sm">No diff tab selected</p>
      </div>
    );
  }

  const fileName = activeTab.file;
  const dirName = fileName.includes('/')
    ? fileName.substring(0, fileName.lastIndexOf('/'))
    : '';
  const statusStyle = getFileStatus(activeTab.file, activeTab.sessionId, gitStatus);

  return (
    <div className="flex h-full flex-col">
      {/* Diff toolbar */}
      <div className="bg-bg-card border-border flex shrink-0 items-center gap-2 border-b px-3 py-1">
        <span className={`${statusStyle.color} text-[10px] font-bold`}>{statusStyle.label}</span>
        <span className="text-foreground text-xs">{fileName}</span>
        {dirName && (
          <span className="text-text-ghost text-[10px]">{dirName}</span>
        )}
        <span className="text-text-ghost text-[10px]">·</span>
        <span className="text-text-muted text-[10px]">
          {activeTab.staged ? 'Staged' : 'Unstaged'}
        </span>

        {/* Inline / Side-by-Side toggle */}
        <div className="ml-auto flex gap-1">
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              !renderSideBySide
                ? 'bg-primary/10 border-primary text-foreground border'
                : 'border-border text-text-muted border hover:text-text-secondary'
            }`}
            onClick={() => setRenderSideBySide(false)}
          >
            Inline
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              renderSideBySide
                ? 'bg-primary/10 border-primary text-foreground border'
                : 'border-border text-text-muted border hover:text-text-secondary'
            }`}
            onClick={() => setRenderSideBySide(true)}
          >
            Side-by-Side
          </button>
        </div>
      </div>

      {/* Monaco DiffEditor */}
      <div className="min-h-0 flex-1">
        <DiffEditor
          key={activeTab.id}
          original={activeTab.original}
          modified={activeTab.modified}
          language={activeTab.language}
          theme="zeus-dark"
          onMount={handleEditorDidMount}
          options={{
            renderSideBySide,
            originalEditable: false,
            readOnly: false,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            diffWordWrap: 'off',
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/DiffView.tsx
git commit -m "feat: create DiffView component with Monaco DiffEditor"
```

---

### Task 8: Update `GitPanel.tsx` — remove DiffViewer, use `openDiffTab`

**Files:**
- Modify: `src/renderer/src/components/GitPanel.tsx:47` (change `getDiff` to `openDiffTab`)
- Modify: `src/renderer/src/components/GitPanel.tsx:59` (change call site)
- Modify: `src/renderer/src/components/GitPanel.tsx:107-158` (remove `DiffViewer` component entirely)
- Remove usage of `DiffViewer` in the JSX render

- [ ] **Step 1: Update FileEntry to use `openDiffTab` instead of `getDiff`**

In `src/renderer/src/components/GitPanel.tsx`, in the `FileEntry` component:

Change line 47:
```ts
  const getDiff = useZeusStore((s) => s.getDiff);
```
To:
```ts
  const openDiffTab = useZeusStore((s) => s.openDiffTab);
```

Change line 59:
```ts
        onClick={() => getDiff(sessionId, change.file, variant === 'staged')}
```
To:
```ts
        onClick={() => openDiffTab(sessionId, change.file, variant === 'staged')}
```

- [ ] **Step 2: Remove the `DiffViewer` component**

Delete the entire `DiffViewer` function (lines 105-158, from `// ─── Diff viewer overlay ───` through the closing `}`).

Also remove any JSX that renders `<DiffViewer />` in the `GitPanel` component. Search for `<DiffViewer` in the file and remove it.

Remove the import of `X` from lucide-react if it's no longer used (it was used by DiffViewer's close button). Also remove `ScrollArea` import if only used by DiffViewer.

Remove the `gitDiff` and `clearDiff` store selectors if present in `GitPanel`:
```ts
const gitDiff = useZeusStore((s) => s.gitDiff);
const clearDiff = useZeusStore((s) => s.clearDiff);
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```

Expected: May still have errors in App.tsx/SessionSidebar — that's expected, fixed next.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/GitPanel.tsx
git commit -m "feat: replace DiffViewer overlay with openDiffTab in GitPanel"
```

---

### Task 9: Update `App.tsx` — render DiffTabBar + DiffView

**Files:**
- Modify: `src/renderer/src/App.tsx` (import new components, update center content area)

- [ ] **Step 1: Add imports**

At the top of `src/renderer/src/App.tsx`, add:

```ts
import DiffTabBar from '@/components/DiffTabBar';
import DiffView from '@/components/DiffView';
```

Also add to store selectors used in the component:

```ts
const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
```

- [ ] **Step 2: Update the desktop content area**

In the desktop layout section (around lines 219-238), replace the content panel inner div:

From:
```tsx
            <div data-testid="main-area-desktop" className="h-full">
              {viewMode === 'claude' ? (
                <ClaudeView
                  session={activeClaudeSession}
                  entries={activeEntries}
                  approvals={pendingApprovals}
                  onSendMessage={sendClaudeMessage}
                  onApprove={approveClaudeTool}
                  onDeny={denyClaudeTool}
                  onInterrupt={interruptClaude}
                />
              ) : (
                <TerminalView sessionId={activeSessionId} />
              )}
            </div>
```

To:
```tsx
            <div data-testid="main-area-desktop" className="flex h-full flex-col">
              {openDiffTabs.length > 0 && <DiffTabBar />}

              <div className="min-h-0 flex-1">
                {viewMode === 'diff' ? (
                  <DiffView />
                ) : viewMode === 'claude' ? (
                  <ClaudeView
                    session={activeClaudeSession}
                    entries={activeEntries}
                    approvals={pendingApprovals}
                    onSendMessage={sendClaudeMessage}
                    onApprove={approveClaudeTool}
                    onDeny={denyClaudeTool}
                    onInterrupt={interruptClaude}
                  />
                ) : (
                  <TerminalView sessionId={activeSessionId} />
                )}
              </div>
            </div>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: render DiffTabBar and DiffView in center content area"
```

---

### Task 10: Update `SessionSidebar.tsx` — extend viewMode prop

**Files:**
- Modify: `src/renderer/src/components/SessionSidebar.tsx:14`

- [ ] **Step 1: Update viewMode type and fix highlighting logic**

At line 14 of `src/renderer/src/components/SessionSidebar.tsx`, change:

```ts
  viewMode: 'terminal' | 'claude';
```

To:

```ts
  viewMode: 'terminal' | 'claude' | 'diff';
```

Then fix the session card highlighting at line 134 and 144. The `active` prop uses `viewMode === 'claude'` and `viewMode === 'terminal'` respectively. When `viewMode === 'diff'`, neither card would be highlighted — but the spec says the Claude session card should remain highlighted when viewing diffs (since diffs originate from Claude sessions).

Change line 134:
```tsx
active={viewMode === 'claude' && s.id === activeClaudeId}
```
To:
```tsx
active={(viewMode === 'claude' || viewMode === 'diff') && s.id === activeClaudeId}
```

This keeps the Claude card highlighted when the user is viewing a diff (they navigated from Claude's Source Control panel).

- [ ] **Step 2: Verify full build**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run build
```

Expected: Build succeeds with zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SessionSidebar.tsx
git commit -m "feat: extend SessionSidebar viewMode prop to include 'diff'"
```

---

## Chunk 5: Final Verification

### Task 11: Full build + smoke test

- [ ] **Step 1: Clean build**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
rm -rf out/
npm run build
```

Expected: Clean build succeeds.

- [ ] **Step 2: Run linter**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run lint
```

Fix any lint errors found.

- [ ] **Step 3: Run tests**

```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm test
```

Fix any test failures.

- [ ] **Step 4: Manual smoke test checklist**

Run the app:
```bash
cd /Users/notpritamm/Documents/Projects/zeus
npm run dev
```

Verify:
1. Start a Claude session with git watcher enabled on a git repo
2. Make file changes → Source Control panel shows them
3. Click a changed file → Monaco DiffEditor opens in center area
4. Tab bar appears at top with Home tab + file tab
5. Left pane shows HEAD version (read-only), right pane shows working copy (editable)
6. Edit the right pane → dot appears on tab (dirty indicator), Save button enables
7. Click Save (or Cmd+S) → file writes to disk, dirty indicator clears
8. Open multiple files → multiple tabs appear, can switch between them
9. Click Home tab → returns to Claude/Terminal view, tab bar stays visible
10. Close all tabs → tab bar disappears, fully back to normal view
11. Inline/Side-by-Side toggle works in diff toolbar

- [ ] **Step 5: Final commit (if any lint/test fixes were needed)**

```bash
git add -A
git commit -m "fix: lint and test fixes for Monaco diff editor integration"
```
