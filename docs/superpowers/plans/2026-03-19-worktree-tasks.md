# Worktree-Based Multi-Task System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to run multiple Claude sessions in parallel on isolated git worktrees, each with its own branch, directory, and lifecycle — from creation through merge/PR/discard.

**Architecture:** A new `task` channel on the existing WebSocket envelope protocol. Backend has two services: `WorktreeManager` (low-level git worktree CRUD via `child_process.execFile`) and `TaskManager` (lifecycle: create → run → complete → merge/PR/discard). Each task creates a git worktree under `<project>/.worktrees/<slug>/`, starts a Claude session in that directory, and watches for git changes independently. The frontend gets a new `TaskPanel` component and store slice to show active tasks and resolution options.

**Tech Stack:** Node.js `child_process.execFile` for git operations, `better-sqlite3` for persistence (existing), WebSocket envelope protocol (existing), Zustand store (existing), React + Tailwind (existing).

**Reference Implementation:** `ref-vibe-kanban/crates/worktree-manager/` and `ref-vibe-kanban/crates/workspace-manager/` — adapted from Rust to TypeScript, simplified from multi-repo to single-repo.

**Review Status:** Approved with 10 fixes applied:
1. `session.on('exit')` → `'done'` + `'error'` (ClaudeSession API)
2. Added missing `deletedAt: null` to all `insertClaudeSession` calls
3. Fixed broken `projectPath` placeholder — now reads from `payload.projectPath`
4. Fixed misleading "relative" comment on `worktreeDir` (it's absolute)
5. Added git watcher startup for worktree directories
6. Added clean working tree check before `git checkout` in `mergeTask`
7. Added `task_diff` response handling in Zustand store
8. `taskError` now auto-clears after 5s and clears on success actions
9. Added concurrent merge/discard protection via `withLock()`
10. Added `pruneOldTasks()` wired into existing `pruneOldSessions()`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/main/services/worktree-manager.ts` | Low-level git worktree operations: create, ensure, cleanup, list, diff-summary. All operations use `child_process.execFile('git', ...)` with cwd set to the project repo root. |
| `src/main/services/task-manager.ts` | High-level task lifecycle: create task (worktree + branch + DB record + Claude session), continue task, merge, create-PR, archive, discard. Coordinates between WorktreeManager, ClaudeSessionManager, GitWatcher, and DB. |
| `src/renderer/src/components/TaskPanel.tsx` | UI for listing tasks, creating new tasks, and resolving completed tasks (merge/PR/discard). Sits in the left sidebar or as a view mode. |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/shared/types.ts` | Add `TaskRecord` interface, `TaskStatus` type, `TaskPayload` union, add `'task'` to `WsEnvelope.channel` |
| `src/main/services/db.ts` | Add migration 12: `tasks` table. Add CRUD functions: `insertTask`, `updateTask`, `getTask`, `getAllTasks`, `deleteTask`. |
| `src/main/services/websocket.ts` | Add `handleTask()` function, route `'task'` channel in the switch statement, wire task creation to Claude session + git watcher start. |
| `src/renderer/src/stores/useZeusStore.ts` | Add task state slice: `tasks`, `activeTaskId`, task actions, WebSocket message handler for `'task'` channel. |
| `src/renderer/src/components/SessionSidebar.tsx` | Add task indicators to session cards (show which task a session belongs to). |
| `src/renderer/src/components/RightPanel.tsx` | Add `'tasks'` tab to the right panel tab list. |

---

## Task 1: Shared Types — `TaskRecord`, `TaskPayload`

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add TaskStatus and TaskRecord types**

Add after the `McpPayload` type (around line 717):

```typescript
// ─── Task / Worktree Types ───

export type TaskStatus = 'creating' | 'running' | 'completed' | 'merged' | 'pr_created' | 'archived' | 'discarded' | 'error';

export interface TaskRecord {
  id: string;
  name: string;
  prompt: string;
  branch: string;           // e.g. "zeus/a1b2-add-dark-mode"
  baseBranch: string;       // e.g. "main"
  worktreeDir: string;      // absolute: "/Users/foo/myapp/.worktrees/a1b2-add-dark-mode"
  projectPath: string;      // absolute: "/Users/foo/myapp"
  status: TaskStatus;
  sessionId: string | null; // linked Claude session envelope ID
  prUrl: string | null;
  diffSummary: string | null;  // "3 files, +120 -15"
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
```

- [ ] **Step 2: Add TaskPayload union type**

```typescript
export type TaskPayload =
  // Client → Server
  | { type: 'create_task'; name: string; prompt: string; projectPath: string; baseBranch?: string; permissionMode?: PermissionMode; model?: string }
  | { type: 'list_tasks' }
  | { type: 'get_task'; taskId: string }
  | { type: 'continue_task'; taskId: string; prompt: string }
  | { type: 'merge_task'; taskId: string }
  | { type: 'create_pr'; taskId: string; title?: string; body?: string }
  | { type: 'archive_task'; taskId: string }
  | { type: 'unarchive_task'; taskId: string }
  | { type: 'discard_task'; taskId: string }
  | { type: 'get_task_diff'; taskId: string }
  // Server → Client
  | { type: 'task_created'; task: TaskRecord }
  | { type: 'task_updated'; task: TaskRecord }
  | { type: 'task_list'; tasks: TaskRecord[] }
  | { type: 'task_deleted'; taskId: string }
  | { type: 'task_diff'; taskId: string; diff: string; summary: string }
  | { type: 'task_error'; message: string; taskId?: string };
```

- [ ] **Step 3: Add `'task'` to WsEnvelope channel union**

Update the `channel` field in `WsEnvelope`:

```typescript
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android' | 'mcp' | 'task';
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (new types are additive, nothing uses them yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(tasks): add TaskRecord, TaskPayload, and TaskStatus shared types"
```

---

## Task 2: Database Migration — `tasks` Table

**Files:**
- Modify: `src/main/services/db.ts`

- [ ] **Step 1: Add migration 12 — create tasks table**

After the `if (currentVersion < 11)` block (around line 224), add:

```typescript
if (currentVersion < 12) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      branch        TEXT NOT NULL,
      base_branch   TEXT NOT NULL,
      worktree_dir  TEXT NOT NULL,
      project_path  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'creating',
      session_id    TEXT,
      pr_url        TEXT,
      diff_summary  TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      completed_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path);
    CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  `);
}
```

Update `SCHEMA_VERSION` from `11` to `12`.

- [ ] **Step 2: Add DB helper functions**

Add after the existing DB helper functions:

```typescript
// ─── Tasks ───

export function insertTask(task: {
  id: string;
  name: string;
  prompt: string;
  branch: string;
  baseBranch: string;
  worktreeDir: string;
  projectPath: string;
  status: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}): void {
  if (!db) return;
  db.prepare(`
    INSERT INTO tasks (id, name, prompt, branch, base_branch, worktree_dir, project_path, status, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, task.name, task.prompt, task.branch, task.baseBranch, task.worktreeDir, task.projectPath, task.status, task.sessionId, task.createdAt, task.updatedAt);
}

export function updateTaskStatus(id: string, status: string, extra?: { sessionId?: string; prUrl?: string; diffSummary?: string; completedAt?: number }): void {
  if (!db) return;
  const now = Date.now();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];

  if (extra?.sessionId !== undefined) { updates.push('session_id = ?'); params.push(extra.sessionId); }
  if (extra?.prUrl !== undefined) { updates.push('pr_url = ?'); params.push(extra.prUrl); }
  if (extra?.diffSummary !== undefined) { updates.push('diff_summary = ?'); params.push(extra.diffSummary); }
  if (extra?.completedAt !== undefined) { updates.push('completed_at = ?'); params.push(extra.completedAt); }

  params.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function getTask(id: string): TaskRecord | null {
  if (!db) return null;
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToTaskRecord(row) : null;
}

export function getAllTasks(projectPath?: string): TaskRecord[] {
  if (!db) return [];
  const query = projectPath
    ? db.prepare("SELECT * FROM tasks WHERE project_path = ? AND status != 'discarded' ORDER BY created_at DESC")
    : db.prepare("SELECT * FROM tasks WHERE status != 'discarded' ORDER BY created_at DESC");
  const rows = (projectPath ? query.all(projectPath) : query.all()) as Record<string, unknown>[];
  return rows.map(rowToTaskRecord);
}

export function deleteTask(id: string): void {
  if (!db) return;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

/**
 * Prune old discarded/merged tasks (call from pruneOldSessions).
 */
export function pruneOldTasks(maxAgeDays = 30): void {
  if (!db) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = db.prepare(
    `DELETE FROM tasks WHERE status IN ('discarded', 'merged', 'archived') AND updated_at < ?`,
  ).run(cutoff);
  if (result.changes > 0) {
    console.log(`[Zeus DB] Pruned ${result.changes} old task(s)`);
  }
}

function rowToTaskRecord(row: Record<string, unknown>): TaskRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    prompt: row.prompt as string,
    branch: row.branch as string,
    baseBranch: row.base_branch as string,
    worktreeDir: row.worktree_dir as string,
    projectPath: row.project_path as string,
    status: row.status as TaskStatus,
    sessionId: (row.session_id as string) || null,
    prUrl: (row.pr_url as string) || null,
    diffSummary: (row.diff_summary as string) || null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    completedAt: (row.completed_at as number) || null,
  };
}
```

You will need to add the import for `TaskRecord` and `TaskStatus` at the top of the file:

```typescript
import type { TaskRecord, TaskStatus } from '../../shared/types';
```

Also wire `pruneOldTasks` into the existing `pruneOldSessions()` function (around line 261). Add at the end of that function:

```typescript
  pruneOldTasks(maxAgeDays);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/db.ts
git commit -m "feat(tasks): add tasks table migration and CRUD helpers"
```

---

## Task 3: WorktreeManager — Git Worktree Operations

**Files:**
- Create: `src/main/services/worktree-manager.ts`

This is the low-level service. All methods are static async, using `execFileAsync('git', ...)`. Patterns taken directly from vibe-kanban's `worktree_manager.rs`, simplified for single-repo.

- [ ] **Step 1: Create worktree-manager.ts with core operations**

```typescript
// WorktreeManager — low-level git worktree operations
// Adapted from vibe-kanban's worktree_manager.rs for Node.js

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;       // commit hash
  isLocked: boolean;
}

export class WorktreeManager {
  /**
   * Create a new worktree with a new branch.
   * Equivalent to: git worktree add <path> -b <branch> <baseBranch>
   */
  static async createWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
  ): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', worktreePath, '-b', branchName, baseBranch],
        { cwd: repoPath },
      );
    } catch (err) {
      // Retry: clean metadata and try once more (vibe-kanban pattern)
      console.warn('[WorktreeManager] First attempt failed, cleaning metadata and retrying:', (err as Error).message);
      await WorktreeManager.forceCleanupMetadata(repoPath, worktreePath);
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await execFileAsync(
        'git',
        ['worktree', 'add', worktreePath, '-b', branchName, baseBranch],
        { cwd: repoPath },
      );
    }

    // Verify worktree was created
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree creation succeeded but path does not exist: ${worktreePath}`);
    }
  }

  /**
   * Ensure a worktree exists at the given path for the given branch.
   * If it exists and is valid, no-op. If missing, recreate.
   */
  static async ensureWorktreeExists(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
  ): Promise<void> {
    const isValid = await WorktreeManager.isWorktreeValid(repoPath, worktreePath);
    if (isValid) return;

    // Cleanup any stale state and recreate
    await WorktreeManager.cleanupWorktree(repoPath, worktreePath);

    // Check if branch exists
    const branchExists = await WorktreeManager.branchExists(repoPath, branchName);
    if (branchExists) {
      // Branch exists — just add worktree (don't create branch)
      const parentDir = path.dirname(worktreePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      await execFileAsync(
        'git',
        ['worktree', 'add', worktreePath, branchName],
        { cwd: repoPath },
      );
    } else {
      // Branch gone too — recreate from base
      await WorktreeManager.createWorktree(repoPath, worktreePath, branchName, baseBranch);
    }
  }

  /**
   * Check if a worktree path is valid (exists on disk + registered in git).
   */
  static async isWorktreeValid(repoPath: string, worktreePath: string): Promise<boolean> {
    if (!fs.existsSync(worktreePath)) return false;

    // Check .git file exists (worktrees have a .git FILE, not directory)
    const gitFile = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFile) || fs.statSync(gitFile).isDirectory()) return false;

    // Verify git recognizes it
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['worktree', 'list', '--porcelain'],
        { cwd: repoPath },
      );
      const resolvedPath = fs.realpathSync(worktreePath);
      return stdout.includes(resolvedPath);
    } catch {
      return false;
    }
  }

  /**
   * Comprehensive worktree cleanup (4-step, from vibe-kanban):
   * 1. git worktree remove --force
   * 2. Force-clean .git/worktrees/<name> metadata
   * 3. Remove filesystem directory
   * 4. git worktree prune
   */
  static async cleanupWorktree(repoPath: string, worktreePath: string): Promise<void> {
    // Step 1: git worktree remove
    try {
      await execFileAsync(
        'git',
        ['worktree', 'remove', '--force', worktreePath],
        { cwd: repoPath },
      );
    } catch {
      // Non-fatal — may already be removed
    }

    // Step 2: Force-clean metadata
    await WorktreeManager.forceCleanupMetadata(repoPath, worktreePath);

    // Step 3: Remove filesystem directory
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    // Step 4: Prune stale worktrees
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Force-remove git worktree metadata directory.
   * Looks in .git/worktrees/ for entries pointing to worktreePath.
   */
  static async forceCleanupMetadata(repoPath: string, worktreePath: string): Promise<void> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--git-common-dir'],
        { cwd: repoPath },
      );
      const gitCommonDir = stdout.trim();
      const worktreesDir = path.resolve(repoPath, gitCommonDir, 'worktrees');

      if (!fs.existsSync(worktreesDir)) return;

      const resolvedTarget = fs.existsSync(worktreePath)
        ? fs.realpathSync(worktreePath)
        : worktreePath;

      const entries = fs.readdirSync(worktreesDir);
      for (const entry of entries) {
        const gitdirFile = path.join(worktreesDir, entry, 'gitdir');
        if (!fs.existsSync(gitdirFile)) continue;

        const gitdirContent = fs.readFileSync(gitdirFile, 'utf-8').trim();
        // gitdir points to <worktreePath>/.git — compare parent
        const pointsTo = path.dirname(gitdirContent);
        const resolvedPointsTo = fs.existsSync(pointsTo)
          ? fs.realpathSync(pointsTo)
          : pointsTo;

        if (resolvedPointsTo === resolvedTarget || pointsTo === worktreePath) {
          fs.rmSync(path.join(worktreesDir, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * List all worktrees for a repository.
   */
  static async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: repoPath },
    );

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as WorktreeInfo);
        current = { path: line.slice(9), isLocked: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'locked') {
        current.isLocked = true;
      }
    }
    if (current.path) worktrees.push(current as WorktreeInfo);

    return worktrees;
  }

  /**
   * Get a diff summary between worktree branch and base branch.
   * Returns e.g. "3 files changed, 120 insertions, 15 deletions"
   */
  static async getDiffSummary(repoPath: string, branchName: string, baseBranch: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--stat', `${baseBranch}...${branchName}`],
        { cwd: repoPath },
      );
      const lines = stdout.trim().split('\n');
      return lines[lines.length - 1]?.trim() || 'no changes';
    } catch {
      return 'unable to compute diff';
    }
  }

  /**
   * Get full diff between worktree branch and base branch.
   */
  static async getDiff(repoPath: string, branchName: string, baseBranch: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', `${baseBranch}...${branchName}`],
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout;
    } catch {
      return '';
    }
  }

  /**
   * Check if a branch exists in the repo.
   */
  static async branchExists(repoPath: string, branchName: string): Promise<boolean> {
    try {
      await execFileAsync(
        'git',
        ['rev-parse', '--verify', `refs/heads/${branchName}`],
        { cwd: repoPath },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a local branch.
   */
  static async deleteBranch(repoPath: string, branchName: string, force = false): Promise<void> {
    await execFileAsync(
      'git',
      ['branch', force ? '-D' : '-d', branchName],
      { cwd: repoPath },
    );
  }

  /**
   * Merge a branch into the current branch.
   */
  static async mergeBranch(repoPath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(
        'git',
        ['merge', branchName, '--no-ff', '-m', `Merge task branch ${branchName}`],
        { cwd: repoPath },
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Get the current branch of a repo.
   */
  static async getCurrentBranch(repoPath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: repoPath },
    );
    return stdout.trim();
  }

  /**
   * Push a branch to origin with upstream tracking.
   */
  static async pushBranch(repoPath: string, branchName: string): Promise<void> {
    await execFileAsync(
      'git',
      ['push', '-u', 'origin', branchName],
      { cwd: repoPath, timeout: 30_000 },
    );
  }

  /**
   * Generate a branch name from a task name.
   * E.g. "Add dark mode support" → "zeus/a1b2c3-add-dark-mode-support"
   */
  static generateBranchName(taskId: string, taskName: string): string {
    const shortId = taskId.slice(0, 6);
    const slug = taskName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return `zeus/${shortId}-${slug || 'task'}`;
  }

  /**
   * Get the worktree directory path for a task.
   */
  static getWorktreePath(projectPath: string, taskId: string, taskName: string): string {
    const slug = taskName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    const dirName = `${taskId.slice(0, 6)}-${slug || 'task'}`;
    return path.join(projectPath, '.worktrees', dirName);
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/worktree-manager.ts
git commit -m "feat(tasks): add WorktreeManager for git worktree operations"
```

---

## Task 4: TaskManager — Task Lifecycle Service

**Files:**
- Create: `src/main/services/task-manager.ts`

This is the high-level orchestrator. It coordinates WorktreeManager, DB, ClaudeSessionManager, and GitWatcher. It does NOT directly reference WebSocket — it returns results that the WebSocket handler broadcasts.

- [ ] **Step 1: Create task-manager.ts**

```typescript
// TaskManager — high-level task lifecycle
// Coordinates: WorktreeManager (git), DB (persistence), ClaudeSessionManager (execution)

import crypto from 'crypto';
import { WorktreeManager } from './worktree-manager';
import {
  insertTask,
  updateTaskStatus,
  getTask,
  getAllTasks,
  deleteTask,
} from './db';
import type { TaskRecord, PermissionMode } from '../../shared/types';

export interface CreateTaskOptions {
  name: string;
  prompt: string;
  projectPath: string;
  baseBranch?: string;       // defaults to current branch
  permissionMode?: PermissionMode;
  model?: string;
}

export interface CreateTaskResult {
  task: TaskRecord;
  worktreePath: string;      // absolute path for Claude session
  branch: string;
}

export class TaskManager {
  // Prevent concurrent merge/discard operations on the same task
  private static readonly activeOps = new Set<string>();

  private static async withLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    if (TaskManager.activeOps.has(taskId)) {
      throw new Error('Another operation is already in progress for this task');
    }
    TaskManager.activeOps.add(taskId);
    try {
      return await fn();
    } finally {
      TaskManager.activeOps.delete(taskId);
    }
  }

  /**
   * Create a task: generate IDs, create worktree + branch, insert DB record.
   * Does NOT start Claude session (caller does that with the returned info).
   */
  static async createTask(opts: CreateTaskOptions): Promise<CreateTaskResult> {
    const taskId = crypto.randomUUID();
    const baseBranch = opts.baseBranch || await WorktreeManager.getCurrentBranch(opts.projectPath);
    const branch = WorktreeManager.generateBranchName(taskId, opts.name);
    const worktreePath = WorktreeManager.getWorktreePath(opts.projectPath, taskId, opts.name);
    const now = Date.now();

    // Create the git worktree + branch
    await WorktreeManager.createWorktree(opts.projectPath, worktreePath, branch, baseBranch);

    // Insert DB record
    insertTask({
      id: taskId,
      name: opts.name,
      prompt: opts.prompt,
      branch,
      baseBranch,
      worktreeDir: worktreePath,
      projectPath: opts.projectPath,
      status: 'creating',
      sessionId: null,
      createdAt: now,
      updatedAt: now,
    });

    const task = getTask(taskId);
    if (!task) throw new Error('Failed to read back inserted task');

    return { task, worktreePath, branch };
  }

  /**
   * Mark a task as running with a linked Claude session.
   */
  static markRunning(taskId: string, sessionId: string): TaskRecord | null {
    updateTaskStatus(taskId, 'running', { sessionId });
    return getTask(taskId);
  }

  /**
   * Mark a task as completed (Claude session finished).
   */
  static async markCompleted(taskId: string): Promise<TaskRecord | null> {
    const task = getTask(taskId);
    if (!task) return null;

    // Compute diff summary
    const summary = await WorktreeManager.getDiffSummary(task.projectPath, task.branch, task.baseBranch);
    updateTaskStatus(taskId, 'completed', { diffSummary: summary, completedAt: Date.now() });
    return getTask(taskId);
  }

  /**
   * Mark a task as errored.
   */
  static markError(taskId: string): TaskRecord | null {
    updateTaskStatus(taskId, 'error');
    return getTask(taskId);
  }

  /**
   * Merge task branch into base branch, then cleanup worktree + branch.
   */
  static async mergeTask(taskId: string): Promise<{ task: TaskRecord | null; error?: string }> {
    return TaskManager.withLock(taskId, async () => {
      const task = getTask(taskId);
      if (!task) return { task: null, error: 'Task not found' };

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      // Check for clean working tree before checkout (prevents losing uncommitted work)
      try {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: task.projectPath });
        if (stdout.trim()) {
          return { task, error: 'Main repo working tree is dirty — commit or stash changes before merging' };
        }
      } catch {
        // Non-fatal — proceed with checkout
      }

      // Checkout base branch in the main repo
      await execFileAsync('git', ['checkout', task.baseBranch], { cwd: task.projectPath });

      // Merge
      const result = await WorktreeManager.mergeBranch(task.projectPath, task.branch);
      if (!result.success) {
        return { task, error: result.error };
      }

      // Cleanup worktree + branch
      await WorktreeManager.cleanupWorktree(task.projectPath, task.worktreeDir);
      try {
        await WorktreeManager.deleteBranch(task.projectPath, task.branch);
      } catch {
        // Branch may already be merged and deleted
      }

      updateTaskStatus(taskId, 'merged', { completedAt: Date.now() });
      return { task: getTask(taskId) };
    });
  }

  /**
   * Create a PR for the task branch.
   */
  static async createPR(taskId: string, title?: string, body?: string): Promise<{ task: TaskRecord | null; prUrl?: string; error?: string }> {
    const task = getTask(taskId);
    if (!task) return { task: null, error: 'Task not found' };

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Push branch
    try {
      await WorktreeManager.pushBranch(task.projectPath, task.branch);
    } catch (err) {
      return { task, error: `Push failed: ${(err as Error).message}` };
    }

    // Create PR via gh CLI
    try {
      const prTitle = title || task.name;
      const prBody = body || `Task: ${task.name}\n\nPrompt: ${task.prompt}`;
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', task.baseBranch, '--head', task.branch],
        { cwd: task.projectPath, timeout: 30_000 },
      );
      const prUrl = stdout.trim();
      updateTaskStatus(taskId, 'pr_created', { prUrl });
      return { task: getTask(taskId), prUrl };
    } catch (err) {
      return { task, error: `PR creation failed: ${(err as Error).message}` };
    }
  }

  /**
   * Archive: remove worktree but keep branch (can unarchive later).
   */
  static async archiveTask(taskId: string): Promise<TaskRecord | null> {
    const task = getTask(taskId);
    if (!task) return null;

    await WorktreeManager.cleanupWorktree(task.projectPath, task.worktreeDir);
    updateTaskStatus(taskId, 'archived');
    return getTask(taskId);
  }

  /**
   * Unarchive: recreate worktree from existing branch.
   */
  static async unarchiveTask(taskId: string): Promise<TaskRecord | null> {
    const task = getTask(taskId);
    if (!task) return null;

    await WorktreeManager.ensureWorktreeExists(task.projectPath, task.worktreeDir, task.branch, task.baseBranch);
    updateTaskStatus(taskId, 'completed');
    return getTask(taskId);
  }

  /**
   * Discard: remove worktree + delete branch + remove from DB.
   */
  static async discardTask(taskId: string): Promise<void> {
    return TaskManager.withLock(taskId, async () => {
      const task = getTask(taskId);
      if (!task) return;

      await WorktreeManager.cleanupWorktree(task.projectPath, task.worktreeDir);
      try {
        await WorktreeManager.deleteBranch(task.projectPath, task.branch, true);
      } catch {
        // Branch may not exist
      }

      updateTaskStatus(taskId, 'discarded');
    });
  }

  /**
   * Get diff between task branch and base branch.
   */
  static async getTaskDiff(taskId: string): Promise<{ diff: string; summary: string } | null> {
    const task = getTask(taskId);
    if (!task) return null;

    const [diff, summary] = await Promise.all([
      WorktreeManager.getDiff(task.projectPath, task.branch, task.baseBranch),
      WorktreeManager.getDiffSummary(task.projectPath, task.branch, task.baseBranch),
    ]);

    return { diff, summary };
  }

  /**
   * List all tasks, optionally filtered by project.
   */
  static listTasks(projectPath?: string): TaskRecord[] {
    return getAllTasks(projectPath);
  }

  /**
   * Recover tasks on startup: ensure worktrees exist for non-terminal tasks.
   */
  static async recoverTasks(): Promise<void> {
    const tasks = getAllTasks();
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'completed') {
        try {
          await WorktreeManager.ensureWorktreeExists(
            task.projectPath,
            task.worktreeDir,
            task.branch,
            task.baseBranch,
          );
        } catch (err) {
          console.error(`[TaskManager] Failed to recover worktree for task ${task.id}:`, err);
          updateTaskStatus(task.id, 'error');
        }
      }

      // Mark running tasks without a process as completed
      if (task.status === 'running') {
        updateTaskStatus(task.id, 'completed');
      }
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/task-manager.ts
git commit -m "feat(tasks): add TaskManager for task lifecycle orchestration"
```

---

## Task 5: WebSocket Handler — `handleTask()`

**Files:**
- Modify: `src/main/services/websocket.ts`

Wire the new `'task'` channel into the WebSocket message router. The handler creates tasks, starts Claude sessions in worktree dirs, and handles resolution actions.

- [ ] **Step 1: Add imports**

Add to the imports at the top of `websocket.ts`:

```typescript
import { TaskManager } from './task-manager';
import type { TaskPayload } from '../../shared/types';
```

- [ ] **Step 2: Add `handleTask()` function**

Add after the `handleMcp()` function (around line 3330):

```typescript
async function handleTask(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as TaskPayload;

  if (payload.type === 'create_task') {
    try {
      const { task, worktreePath } = await TaskManager.createTask({
        name: payload.name,
        prompt: payload.prompt,
        projectPath: payload.projectPath,
        baseBranch: payload.baseBranch,
        permissionMode: payload.permissionMode,
        model: payload.model,
      });

      // Now start a Claude session in the worktree directory
      const sessionId = `task-${task.id}-${Date.now()}`;
      const resolvedMcps = mcpRegistry.resolveSessionMcps({});
      const mcpServersForSession = resolvedMcps.map((s) => ({
        name: s.name, command: s.command, args: s.args, env: s.env,
      }));

      const session = await claudeManager.createSession(sessionId, payload.prompt, {
        workingDir: worktreePath,
        permissionMode: payload.permissionMode ?? 'bypassPermissions',
        model: payload.model,
        zeusSessionId: sessionId,
        mcpServers: mcpServersForSession.length > 0 ? mcpServersForSession : undefined,
      });

      // Persist Claude session (deletedAt required by ClaudeSessionRow)
      const randomIcon = SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: sessionId,
        claudeSessionId: null,
        status: 'running',
        prompt: payload.prompt,
        name: payload.name,
        icon: randomIcon,
        color: null,
        notificationSound: true,
        workingDir: worktreePath,
        qaTargetUrl: null,
        permissionMode: payload.permissionMode ?? 'bypassPermissions',
        model: payload.model ?? null,
        startedAt: Date.now(),
        endedAt: null,
        deletedAt: null,
      });

      // Link task to session
      const updatedTask = TaskManager.markRunning(task.id, sessionId);

      // Persist initial user message
      upsertClaudeEntry(sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: 'user_message' },
        content: payload.prompt,
      });

      // Wire Claude session events (reuse existing wireClaudeSession)
      wireClaudeSession(ws, session, { ...envelope, sessionId });

      // Listen for session end to mark task completed
      // ClaudeSession emits 'done' (success) and 'error' (failure), NOT 'exit'
      const markTaskDone = async () => {
        const completed = await TaskManager.markCompleted(task.id);
        if (completed) {
          broadcastEnvelope({
            channel: 'task', sessionId: '', auth: '',
            payload: { type: 'task_updated', task: completed },
          });
        }
      };
      session.on('done', markTaskDone);
      session.on('error', async () => {
        const errored = TaskManager.markError(task.id);
        if (errored) {
          broadcastEnvelope({
            channel: 'task', sessionId: '', auth: '',
            payload: { type: 'task_updated', task: errored },
          });
        }
      });

      // Start git watcher for the worktree directory
      const { watcher, isNew } = await gitManager.startWatching(sessionId, worktreePath);
      if (isNew) {
        watcher.on('status', (data: GitStatusData) => {
          broadcastEnvelope({
            channel: 'git', sessionId, auth: '',
            payload: { type: 'git_status', data } as GitPayload,
          });
        });
        watcher.on('error', (err: Error) => {
          broadcastEnvelope({
            channel: 'git', sessionId, auth: '',
            payload: { type: 'git_error', error: err.message } as GitPayload,
          });
        });
      }

      // Track ownership
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(sessionId);

      broadcastEnvelope({
        channel: 'claude', sessionId, auth: '',
        payload: { type: 'claude_started' },
      });

      broadcastEnvelope({
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_created', task: updatedTask ?? task },
      });
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_error', message: (err as Error).message },
      });
    }
  } else if (payload.type === 'list_tasks') {
    const tasks = TaskManager.listTasks();
    sendEnvelope(ws, {
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'task_list', tasks },
    });
  } else if (payload.type === 'merge_task') {
    try {
      const { task, error } = await TaskManager.mergeTask(payload.taskId);
      if (error) {
        sendEnvelope(ws, {
          channel: 'task', sessionId: '', auth: '',
          payload: { type: 'task_error', message: error, taskId: payload.taskId },
        });
      } else if (task) {
        broadcastEnvelope({
          channel: 'task', sessionId: '', auth: '',
          payload: { type: 'task_updated', task },
        });
      }
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_error', message: (err as Error).message, taskId: payload.taskId },
      });
    }
  } else if (payload.type === 'create_pr') {
    try {
      const { task, prUrl, error } = await TaskManager.createPR(payload.taskId, payload.title, payload.body);
      if (error) {
        sendEnvelope(ws, {
          channel: 'task', sessionId: '', auth: '',
          payload: { type: 'task_error', message: error, taskId: payload.taskId },
        });
      } else if (task) {
        broadcastEnvelope({
          channel: 'task', sessionId: '', auth: '',
          payload: { type: 'task_updated', task },
        });
      }
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_error', message: (err as Error).message, taskId: payload.taskId },
      });
    }
  } else if (payload.type === 'archive_task') {
    const task = await TaskManager.archiveTask(payload.taskId);
    if (task) {
      broadcastEnvelope({
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_updated', task },
      });
    }
  } else if (payload.type === 'unarchive_task') {
    const task = await TaskManager.unarchiveTask(payload.taskId);
    if (task) {
      broadcastEnvelope({
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_updated', task },
      });
    }
  } else if (payload.type === 'discard_task') {
    await TaskManager.discardTask(payload.taskId);
    broadcastEnvelope({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'task_deleted', taskId: payload.taskId },
    });
  } else if (payload.type === 'get_task_diff') {
    const result = await TaskManager.getTaskDiff(payload.taskId);
    if (result) {
      sendEnvelope(ws, {
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_diff', taskId: payload.taskId, diff: result.diff, summary: result.summary },
      });
    }
  } else if (payload.type === 'continue_task') {
    try {
      const task = getTask(payload.taskId);
      if (!task) throw new Error('Task not found');
      if (!task.worktreeDir) throw new Error('Task has no worktree');

      // Start a new Claude session in the same worktree
      const sessionId = `task-${task.id}-${Date.now()}`;
      const session = await claudeManager.createSession(sessionId, payload.prompt, {
        workingDir: task.worktreeDir,
        permissionMode: 'bypassPermissions',
        zeusSessionId: sessionId,
      });

      const randomIcon = SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: sessionId, claudeSessionId: null, status: 'running',
        prompt: payload.prompt, name: `${task.name} (continued)`,
        icon: randomIcon, color: null, notificationSound: true,
        workingDir: task.worktreeDir, qaTargetUrl: null,
        permissionMode: 'bypassPermissions', model: null,
        startedAt: Date.now(), endedAt: null, deletedAt: null,
      });

      const updatedTask = TaskManager.markRunning(task.id, sessionId);

      upsertClaudeEntry(sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: 'user_message' },
        content: payload.prompt,
      });

      wireClaudeSession(ws, session, { ...envelope, sessionId });

      // ClaudeSession emits 'done' and 'error', NOT 'exit'
      session.on('done', async () => {
        const completed = await TaskManager.markCompleted(task.id);
        if (completed) {
          broadcastEnvelope({
            channel: 'task', sessionId: '', auth: '',
            payload: { type: 'task_updated', task: completed },
          });
        }
      });
      session.on('error', async () => {
        const errored = TaskManager.markError(task.id);
        if (errored) {
          broadcastEnvelope({
            channel: 'task', sessionId: '', auth: '',
            payload: { type: 'task_updated', task: errored },
          });
        }
      });

      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(sessionId);

      broadcastEnvelope({
        channel: 'claude', sessionId, auth: '',
        payload: { type: 'claude_started' },
      });

      if (updatedTask) {
        broadcastEnvelope({
          channel: 'task', sessionId: '', auth: '',
          payload: { type: 'task_updated', task: updatedTask },
        });
      }
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'task', sessionId: '', auth: '',
        payload: { type: 'task_error', message: (err as Error).message, taskId: payload.taskId },
      });
    }
  }
}
```

**Note:** The `create_task` payload includes `projectPath` (added in Task 1). The handler passes it directly to `TaskManager.createTask()`.

- [ ] **Step 3: Route the `'task'` channel in the message switch**

Find the switch statement that routes channels (around line 3330), add before the `default:` case:

```typescript
case 'task':
  handleTask(ws, envelope).catch((err) => {
    console.error('[Task] Unhandled error in handleTask:', err);
    sendEnvelope(ws, {
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'task_error', message: (err as Error).message },
    });
  });
  break;
```

- [ ] **Step 4: Add task recovery on startup**

In the `startServer()` function, after database initialization, add:

```typescript
// Recover tasks — ensure worktrees exist for active tasks
TaskManager.recoverTasks().catch((err) => {
  console.error('[Zeus] Task recovery failed:', err);
});
```

- [ ] **Step 5: Add `getTask` import from db.ts**

Add `getTask` to the db imports:

```typescript
import { ..., getTask } from './db';
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/websocket.ts src/shared/types.ts
git commit -m "feat(tasks): wire handleTask WebSocket handler with full CRUD + Claude session integration"
```

---

## Task 6: Zustand Store — Task State Slice

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add task state to ZeusState interface**

Add to the state interface:

```typescript
// Tasks
tasks: TaskRecord[];
activeTaskId: string | null;
taskError: string | null;
```

Add the import for `TaskRecord` and `TaskPayload` to the imports at the top.

- [ ] **Step 2: Add task actions to the interface**

```typescript
// Task actions
createTask: (name: string, prompt: string, projectPath: string, opts?: { baseBranch?: string; permissionMode?: PermissionMode; model?: string }) => void;
listTasks: () => void;
selectTask: (taskId: string | null) => void;
continueTask: (taskId: string, prompt: string) => void;
mergeTask: (taskId: string) => void;
createTaskPR: (taskId: string, title?: string, body?: string) => void;
archiveTask: (taskId: string) => void;
unarchiveTask: (taskId: string) => void;
discardTask: (taskId: string) => void;
getTaskDiff: (taskId: string) => void;
```

- [ ] **Step 3: Add initial state values**

In the `create()` call:

```typescript
tasks: [],
activeTaskId: null,
taskError: null,
```

- [ ] **Step 4: Add task action implementations**

```typescript
createTask: (name, prompt, projectPath, opts) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'create_task', name, prompt, projectPath, ...opts },
  });
},
listTasks: () => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'list_tasks' },
  });
},
selectTask: (taskId) => set({ activeTaskId: taskId }),
continueTask: (taskId, prompt) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'continue_task', taskId, prompt },
  });
},
mergeTask: (taskId) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'merge_task', taskId },
  });
},
createTaskPR: (taskId, title, body) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'create_pr', taskId, title, body },
  });
},
archiveTask: (taskId) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'archive_task', taskId },
  });
},
unarchiveTask: (taskId) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'unarchive_task', taskId },
  });
},
discardTask: (taskId) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'discard_task', taskId },
  });
},
getTaskDiff: (taskId) => {
  zeusWs.send({
    channel: 'task', sessionId: '', auth: '',
    payload: { type: 'get_task_diff', taskId },
  });
},
```

- [ ] **Step 5: Add WebSocket message handler for `'task'` channel**

In the `connect()` method's `onmessage` handler, add a case for `channel === 'task'`:

```typescript
} else if (channel === 'task') {
  const p = payload as TaskPayload;
  if (p.type === 'task_created') {
    set((s) => ({ tasks: [p.task, ...s.tasks], taskError: null }));
  } else if (p.type === 'task_updated') {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === p.task.id ? p.task : t)),
      taskError: null,
    }));
  } else if (p.type === 'task_list') {
    set({ tasks: p.tasks, taskError: null });
  } else if (p.type === 'task_deleted') {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== p.taskId),
      activeTaskId: s.activeTaskId === p.taskId ? null : s.activeTaskId,
      taskError: null,
    }));
  } else if (p.type === 'task_diff') {
    // Store diff data on the task record for display
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === p.taskId ? { ...t, diffSummary: p.summary } : t,
      ),
    }));
  } else if (p.type === 'task_error') {
    set({ taskError: p.message });
    // Auto-clear error after 5 seconds
    setTimeout(() => set({ taskError: null }), 5000);
  }
}
```

- [ ] **Step 6: Auto-fetch tasks on connect**

In the `connect()` method, after WebSocket opens and settings are fetched, add:

```typescript
// Fetch tasks
zeusWs.send({ channel: 'task', sessionId: '', auth: '', payload: { type: 'list_tasks' } });
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(tasks): add task state slice and actions to Zustand store"
```

---

## Task 7: TaskPanel — Frontend UI

**Files:**
- Create: `src/renderer/src/components/TaskPanel.tsx`
- Modify: `src/renderer/src/components/RightPanel.tsx`

- [ ] **Step 1: Create TaskPanel.tsx**

```tsx
import { useState } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus, GitBranch, GitMerge, GitPullRequest,
  Archive, Trash2, Play, RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { TaskRecord, TaskStatus } from '../../../shared/types';

const STATUS_COLORS: Record<TaskStatus, string> = {
  creating: 'bg-yellow-500/20 text-yellow-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  merged: 'bg-purple-500/20 text-purple-400',
  pr_created: 'bg-cyan-500/20 text-cyan-400',
  archived: 'bg-zinc-500/20 text-zinc-400',
  discarded: 'bg-red-500/20 text-red-400',
  error: 'bg-red-500/20 text-red-400',
};

function TaskCard({ task }: { task: TaskRecord }) {
  const [expanded, setExpanded] = useState(false);
  const {
    selectTask, activeTaskId, mergeTask, createTaskPR,
    archiveTask, discardTask, continueTask, selectClaudeSession,
  } = useZeusStore();

  const isActive = activeTaskId === task.id;
  const [continuePrompt, setContinuePrompt] = useState('');

  return (
    <div
      className={`border-border rounded-lg border p-3 transition-colors ${
        isActive ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => {
            selectTask(isActive ? null : task.id);
            if (task.sessionId) selectClaudeSession(task.sessionId);
          }}
        >
          <GitBranch className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{task.name}</div>
            <div className="text-muted-foreground mt-0.5 truncate text-[10px] font-mono">
              {task.branch}
            </div>
          </div>
        </button>
        <Badge variant="outline" className={`shrink-0 text-[9px] ${STATUS_COLORS[task.status]}`}>
          {task.status}
        </Badge>
      </div>

      {task.diffSummary && (
        <div className="text-muted-foreground mt-1.5 text-[10px]">{task.diffSummary}</div>
      )}

      {/* Expand/collapse actions */}
      <button
        className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-[10px]"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Actions
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Resolution actions — only for completed/error tasks */}
          {(task.status === 'completed' || task.status === 'error') && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => mergeTask(task.id)}>
                <GitMerge className="mr-1 size-3" /> Merge
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => createTaskPR(task.id)}>
                <GitPullRequest className="mr-1 size-3" /> Create PR
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => archiveTask(task.id)}>
                <Archive className="mr-1 size-3" /> Archive
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-400" onClick={() => discardTask(task.id)}>
                <Trash2 className="mr-1 size-3" /> Discard
              </Button>
            </div>
          )}

          {/* Continue — send follow-up prompt */}
          {(task.status === 'completed' || task.status === 'error') && (
            <div className="flex gap-1.5">
              <Input
                value={continuePrompt}
                onChange={(e) => setContinuePrompt(e.target.value)}
                placeholder="Follow-up prompt..."
                className="h-6 text-[10px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && continuePrompt.trim()) {
                    continueTask(task.id, continuePrompt.trim());
                    setContinuePrompt('');
                  }
                }}
              />
              <Button
                size="sm" variant="outline" className="h-6 text-[10px]"
                disabled={!continuePrompt.trim()}
                onClick={() => {
                  if (continuePrompt.trim()) {
                    continueTask(task.id, continuePrompt.trim());
                    setContinuePrompt('');
                  }
                }}
              >
                <Play className="size-3" />
              </Button>
            </div>
          )}

          {/* Archived — unarchive */}
          {task.status === 'archived' && (
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => useZeusStore.getState().unarchiveTask(task.id)}>
              <RefreshCw className="mr-1 size-3" /> Unarchive
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskPanel() {
  const { tasks, savedProjects, lastUsedProjectId, createTask, taskError } = useZeusStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const currentProject = savedProjects.find((p) => p.id === lastUsedProjectId);
  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'creating');
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'error');
  const resolvedTasks = tasks.filter((t) => ['merged', 'pr_created', 'archived'].includes(t.status));

  const handleCreate = () => {
    if (!name.trim() || !prompt.trim() || !currentProject) return;
    createTask(name.trim(), prompt.trim(), currentProject.path);
    setName('');
    setPrompt('');
    setShowCreate(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">Tasks</span>
        <Button size="sm" variant="ghost" className="size-6 p-0" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Create form */}
        {showCreate && (
          <div className="border-border space-y-2 rounded-lg border p-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="text-xs" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Claude do?"
              className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs"
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleCreate} disabled={!name.trim() || !prompt.trim() || !currentProject}>
                Create Task
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {taskError && (
          <div className="rounded bg-red-500/10 p-2 text-[10px] text-red-400">{taskError}</div>
        )}

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Active</div>
            <div className="space-y-1.5">
              {activeTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Completed</div>
            <div className="space-y-1.5">
              {completedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* Resolved tasks */}
        {resolvedTasks.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase">Resolved</div>
            <div className="space-y-1.5">
              {resolvedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {tasks.length === 0 && !showCreate && (
          <div className="text-muted-foreground py-8 text-center text-xs">
            No tasks yet. Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add 'tasks' tab to RightPanel**

In `RightPanel.tsx`, add `'tasks'` to the `activeRightTab` type and add the tab button + panel rendering. Import `TaskPanel` and render it when the tasks tab is active.

Add to the tab buttons:

```tsx
<button onClick={() => setActiveRightTab('tasks')} className={...}>
  <GitBranch className="size-4" />
</button>
```

Add to the panel content switch:

```tsx
{activeRightTab === 'tasks' && <TaskPanel />}
```

- [ ] **Step 3: Update the activeRightTab type in types.ts or store**

Add `'tasks'` to the `activeRightTab` union:

```typescript
activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null;
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TaskPanel.tsx src/renderer/src/components/RightPanel.tsx src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(tasks): add TaskPanel UI with create/list/resolve actions"
```

---

## Task 8: Add `.worktrees/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Verify `.worktrees/` is already in .gitignore**

Check the current `.gitignore` — it should already have `.worktrees/` from a previous change. If not, add it.

- [ ] **Step 2: Commit if changed**

```bash
git add .gitignore
git commit -m "chore: ensure .worktrees/ is gitignored"
```

---

## Task 9: Integration — End-to-End Smoke Test

This task is manual verification. No code changes.

- [ ] **Step 1: Build and run**

```bash
npm run build
npm run dev
```

- [ ] **Step 2: Create a task**

1. Open Zeus, select a project
2. Go to Tasks tab in right panel
3. Click +, enter name "Test task", prompt "Create a hello.txt file"
4. Verify: worktree created at `<project>/.worktrees/<slug>/`
5. Verify: Claude session starts and runs in the worktree
6. Verify: task appears in the task list as "running"

- [ ] **Step 3: Complete and resolve**

1. Wait for Claude to finish
2. Verify: task status changes to "completed"
3. Verify: diff summary shows
4. Click "Merge" — verify changes appear on base branch
5. Verify: worktree cleaned up

- [ ] **Step 4: Test parallel tasks**

1. Create two tasks simultaneously
2. Verify: both get separate worktrees and branches
3. Verify: both Claude sessions run independently
4. Verify: no git conflicts

---

## Summary of All Files

| Action | File |
|--------|------|
| Modify | `src/shared/types.ts` — TaskRecord, TaskPayload, TaskStatus |
| Modify | `src/main/services/db.ts` — Migration 12, CRUD helpers |
| Create | `src/main/services/worktree-manager.ts` — Git worktree ops |
| Create | `src/main/services/task-manager.ts` — Task lifecycle |
| Modify | `src/main/services/websocket.ts` — handleTask(), channel routing |
| Modify | `src/renderer/src/stores/useZeusStore.ts` — Task state + actions |
| Create | `src/renderer/src/components/TaskPanel.tsx` — UI |
| Modify | `src/renderer/src/components/RightPanel.tsx` — Tasks tab |
