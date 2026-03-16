import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import chokidar from 'chokidar';
import type { GitStatusData, GitFileChange, GitFileStatus } from '../../shared/types';

const execFileAsync = promisify(execFile);

// ─── GitWatcher ───

export class GitWatcher extends EventEmitter {
  private workingDir: string;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(workingDir: string) {
    super();
    this.workingDir = workingDir;
  }

  async start(): Promise<void> {
    // Verify this is a git repo
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: this.workingDir,
      });
    } catch {
      this.emit('not_a_repo');
      return;
    }

    // Initial status
    await this.refresh();

    // Watch for file changes
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

  async commit(message: string): Promise<{ success: boolean; error?: string; commitHash?: string }> {
    try {
      await execFileAsync('git', ['add', '-A'], { cwd: this.workingDir });
      const { stdout } = await execFileAsync('git', ['commit', '-m', message], {
        cwd: this.workingDir,
      });

      // Extract commit hash from output (first line: "[branch hash] message")
      const match = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const commitHash = match?.[1];

      // Trigger refresh after commit
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

  async startWatching(sessionId: string, workingDir: string): Promise<GitWatcher> {
    // Stop existing watcher for this session if any
    await this.stopWatching(sessionId);

    const watcher = new GitWatcher(workingDir);
    this.watchers.set(sessionId, watcher);
    await watcher.start();
    return watcher;
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

// ─── Parser ───

function parseGitStatus(output: string): GitStatusData {
  const lines = output.split('\n').filter(Boolean);

  let branch = '';
  let ahead = 0;
  let behind = 0;
  const changes: GitFileChange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.startsWith('## ')) {
      // Parse branch line: "## branch...tracking [ahead N, behind M]"
      const branchLine = line.slice(3);

      // Extract branch name (before "..." or end of line)
      const dotIdx = branchLine.indexOf('...');
      branch = dotIdx >= 0 ? branchLine.slice(0, dotIdx) : branchLine.split(' ')[0];

      // Extract ahead/behind
      const aheadMatch = branchLine.match(/ahead (\d+)/);
      const behindMatch = branchLine.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
      continue;
    }

    // Status lines: XY filename or XY old -> new (for renames)
    if (line.length < 4) continue;

    const xy = line.slice(0, 2);
    const rest = line.slice(3);

    let status: GitFileStatus;
    if (xy === '??') {
      status = '??';
    } else if (xy === 'UU') {
      status = 'UU';
    } else {
      // Use the most meaningful status character
      const x = xy[0];
      const y = xy[1];
      if (x === 'R' || y === 'R') status = 'R';
      else if (x === 'A' || y === 'A') status = xy as GitFileStatus;
      else if (x === 'D' || y === 'D') status = 'D';
      else if (x === 'M' || y === 'M') status = 'M';
      else status = xy.trim() as GitFileStatus;
    }

    // Handle renames: "old -> new"
    const renameMatch = rest.match(/^(.+) -> (.+)$/);
    if (renameMatch) {
      changes.push({
        file: renameMatch[2],
        status: 'R',
        oldFile: renameMatch[1],
      });
    } else {
      changes.push({ file: rest, status });
    }
  }

  return { branch, changes, ahead, behind };
}
