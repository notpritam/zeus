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
