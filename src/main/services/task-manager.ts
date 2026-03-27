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
} from '../db/queries/tasks';
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
