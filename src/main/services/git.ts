import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import chokidar from 'chokidar';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { GitStatusData, GitFileChange, GitFileStatus } from '../../shared/types';

const execFileAsync = promisify(execFile);

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.css': 'css', '.html': 'html', '.json': 'json', '.md': 'markdown',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.yaml': 'yaml', '.yml': 'yaml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.sql': 'sql',
  '.xml': 'xml', '.svg': 'xml', '.toml': 'toml', '.env': 'plaintext',
};

// ─── GitWatcher ───

export class GitWatcher extends EventEmitter {
  private workingDir: string;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(workingDir: string) {
    super();
    this.workingDir = workingDir;
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  async start(): Promise<void> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: this.workingDir,
      });
    } catch {
      this.emit('not_a_repo');
      return;
    }

    await this.refresh();
    this.emit('connected');

    // Heartbeat every 30s so the UI knows we're alive
    this.heartbeatTimer = setInterval(() => {
      if (!this.stopped) this.emit('heartbeat');
    }, 30_000);

    this.watcher = chokidar.watch(this.workingDir, {
      ignored: [
        /[/\\]\.git[/\\]/,
        /[/\\]node_modules[/\\]/,
        /[/\\]\.next[/\\]/,
        /[/\\]dist[/\\]/,
        /[/\\]build[/\\]/,
      ],
      ignoreInitial: true,
      persistent: true,
    });

    this.watcher.on('all', () => {
      this.debouncedRefresh();
    });
  }

  private debouncedRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.refresh().catch((err) => {
        this.emit('error', err);
      });
    }, 500);
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-b'], {
        cwd: this.workingDir,
        maxBuffer: 1024 * 1024,
      });
      const data = parseGitStatus(stdout);
      this.emit('status', data);
    } catch (err) {
      this.emit('error', err);
    }
  }

  // ─── Staging ───

  async stageFiles(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await execFileAsync('git', ['add', '--', ...files], { cwd: this.workingDir });
    await this.refresh();
  }

  async unstageFiles(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await execFileAsync('git', ['reset', 'HEAD', '--', ...files], { cwd: this.workingDir });
    await this.refresh();
  }

  async stageAll(): Promise<void> {
    await execFileAsync('git', ['add', '-A'], { cwd: this.workingDir });
    await this.refresh();
  }

  async unstageAll(): Promise<void> {
    await execFileAsync('git', ['reset', 'HEAD'], { cwd: this.workingDir });
    await this.refresh();
  }

  // ─── Discard ───

  async discardFiles(files: string[]): Promise<void> {
    if (files.length === 0) return;

    // Need to figure out which files are tracked (checkout) vs untracked (clean)
    const { stdout: lsOutput } = await execFileAsync(
      'git',
      ['ls-files', '--error-unmatch', '--', ...files],
      { cwd: this.workingDir },
    ).catch(() => ({ stdout: '' }));

    const trackedSet = new Set(lsOutput.split('\n').filter(Boolean));
    const tracked = files.filter((f) => trackedSet.has(f));
    const untracked = files.filter((f) => !trackedSet.has(f));

    if (tracked.length > 0) {
      await execFileAsync('git', ['checkout', '--', ...tracked], { cwd: this.workingDir });
    }
    if (untracked.length > 0) {
      await execFileAsync('git', ['clean', '-f', '--', ...untracked], { cwd: this.workingDir });
    }

    await this.refresh();
  }

  // ─── File Contents (for Monaco diff editor) ───

  async getFileContents(
    file: string,
    staged: boolean,
  ): Promise<{ original: string; modified: string; language: string }> {
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
      // New/untracked file — no HEAD version
    }

    // Modified content
    let modified: string;
    if (staged) {
      try {
        const { stdout } = await execFileAsync('git', ['show', `:${file}`], {
          cwd: this.workingDir,
          maxBuffer: 5 * 1024 * 1024,
        });
        modified = stdout;
      } catch {
        modified = '';
      }
    } else {
      const fullPath = path.resolve(this.workingDir, file);
      try {
        modified = await readFile(fullPath, 'utf-8');
      } catch {
        modified = '';
      }
    }

    return { original, modified, language };
  }

  // ─── Save File ───

  async saveFile(file: string, content: string): Promise<{ success: boolean; error?: string }> {
    const resolved = path.resolve(this.workingDir, file);
    const workingDirResolved = path.resolve(this.workingDir);

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

  // ─── Commit ───

  async commit(
    message: string,
  ): Promise<{ success: boolean; error?: string; commitHash?: string }> {
    try {
      const { stdout } = await execFileAsync('git', ['commit', '-m', message], {
        cwd: this.workingDir,
      });

      const match = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const commitHash = match?.[1];

      await this.refresh();
      return { success: true, commitHash };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.removeAllListeners();
  }
}

// ─── GitWatcherManager ───

export class GitWatcherManager {
  private watchers = new Map<string, GitWatcher>();

  async startWatching(
    sessionId: string,
    workingDir: string,
  ): Promise<{ watcher: GitWatcher; isNew: boolean }> {
    const existing = this.watchers.get(sessionId);
    if (existing && existing.getWorkingDir() === workingDir) {
      return { watcher: existing, isNew: false };
    }
    await this.stopWatching(sessionId);
    const watcher = new GitWatcher(workingDir);
    this.watchers.set(sessionId, watcher);
    await watcher.start();
    return { watcher, isNew: true };
  }

  async stopWatching(sessionId: string): Promise<void> {
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      await watcher.stop();
      this.watchers.delete(sessionId);
    }
  }

  getWatcher(sessionId: string): GitWatcher | undefined {
    return this.watchers.get(sessionId);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.watchers.values()).map((w) => w.stop());
    await Promise.all(promises);
    this.watchers.clear();
  }
}

// ─── Init ───

export async function initGitRepo(
  workingDir: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync('git', ['init'], { cwd: workingDir });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── Parser ───

/**
 * Parses `git status --porcelain -b` output.
 *
 * Each status line has two columns: X (index/staged) and Y (worktree/unstaged).
 * We separate them into `staged` and `unstaged` arrays.
 *
 * XY meanings:
 *   ' ' = unmodified in that column
 *   M   = modified
 *   A   = added
 *   D   = deleted
 *   R   = renamed
 *   ??  = untracked (always unstaged)
 *   UU  = unmerged conflict
 */
function parseGitStatus(output: string): GitStatusData {
  const lines = output.split('\n').filter(Boolean);

  let branch = '';
  let ahead = 0;
  let behind = 0;
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.startsWith('## ')) {
      const branchLine = line.slice(3);
      const dotIdx = branchLine.indexOf('...');
      branch = dotIdx >= 0 ? branchLine.slice(0, dotIdx) : branchLine.split(' ')[0];
      const aheadMatch = branchLine.match(/ahead (\d+)/);
      const behindMatch = branchLine.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
      continue;
    }

    if (line.length < 4) continue;

    const x = line[0]; // index (staged)
    const y = line[1]; // worktree (unstaged)
    const rest = line.slice(3);

    // Handle renames: "old -> new"
    const renameMatch = rest.match(/^(.+) -> (.+)$/);
    const file = renameMatch ? renameMatch[2] : rest;
    const oldFile = renameMatch ? renameMatch[1] : undefined;

    // Untracked files — always unstaged
    if (x === '?' && y === '?') {
      unstaged.push({ file, status: '??', oldFile });
      continue;
    }

    // Unmerged conflicts — show in both
    if (x === 'U' || y === 'U') {
      staged.push({ file, status: 'UU', oldFile });
      unstaged.push({ file, status: 'UU', oldFile });
      continue;
    }

    // Index (staged) column
    if (x !== ' ' && x !== '?') {
      const status = (x === 'R' ? 'R' : x) as GitFileStatus;
      staged.push({ file, status, oldFile });
    }

    // Worktree (unstaged) column
    if (y !== ' ' && y !== '?') {
      const status = y as GitFileStatus;
      unstaged.push({ file, status, oldFile });
    }
  }

  return { branch, staged, unstaged, ahead, behind };
}
