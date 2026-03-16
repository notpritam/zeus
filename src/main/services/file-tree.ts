import { EventEmitter } from 'events';
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import type { FileTreeEntry } from '../../shared/types';

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.css': 'css', '.html': 'html', '.json': 'json', '.md': 'markdown',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.yaml': 'yaml', '.yml': 'yaml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.sql': 'sql',
  '.xml': 'xml', '.svg': 'xml', '.toml': 'toml', '.env': 'plaintext',
};

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ─── FileTreeService ───

export class FileTreeService extends EventEmitter {
  private workingDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private watcher: any = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(workingDir: string) {
    super();
    this.workingDir = workingDir;
  }

  async start(): Promise<void> {
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

    // Emit connected on next tick so listeners can be wired first
    this.watcher.on('ready', () => {
      this.emit('connected');
    });

    const changedDirs = new Set<string>();

    this.watcher.on('all', (_event: string, filePath: string) => {
      if (this.stopped) return;
      // Collect parent directory of changed file
      const dir = path.dirname(filePath);
      const rel = path.relative(this.workingDir, dir);
      changedDirs.add(rel || '');

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const dirs = Array.from(changedDirs);
        changedDirs.clear();
        this.emit('files_changed', { directories: dirs });
      }, 300);
    });
  }

  private validatePath(requestedPath: string): string {
    const resolved = path.resolve(this.workingDir, requestedPath);
    const workingDirResolved = path.resolve(this.workingDir);
    if (!resolved.startsWith(workingDirResolved + path.sep) && resolved !== workingDirResolved) {
      throw new Error('Path traversal not allowed');
    }
    return resolved;
  }

  async listDirectory(dirPath: string): Promise<FileTreeEntry[]> {
    const resolved = this.validatePath(dirPath);

    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries: FileTreeEntry[] = [];

    for (const dirent of dirents) {
      // Skip hidden/ignored directories
      if (dirent.name.startsWith('.') && dirent.isDirectory()) continue;
      if (['node_modules', '.next', 'dist', 'build', '.git'].includes(dirent.name)) continue;

      const relPath = dirPath ? `${dirPath}/${dirent.name}` : dirent.name;

      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, path: relPath, type: 'directory' });
      } else if (dirent.isFile()) {
        let size: number | undefined;
        try {
          const s = await stat(path.join(resolved, dirent.name));
          size = s.size;
        } catch { /* ignore */ }
        entries.push({ name: dirent.name, path: relPath, type: 'file', size });
      }
    }

    // Sort: directories first, then files, each alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries;
  }

  async readFile(filePath: string): Promise<{ content: string; language: string }> {
    const resolved = this.validatePath(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const language = EXT_TO_LANGUAGE[ext] || 'plaintext';

    if (BINARY_EXTENSIONS.has(ext)) {
      throw new Error('Binary files cannot be displayed');
    }

    const stats = await stat(resolved);
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error('File too large (>5MB)');
    }

    const content = await readFile(resolved, 'utf-8');
    return { content, language };
  }

  async saveFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resolved = this.validatePath(filePath);
      await writeFile(resolved, content, 'utf-8');
      return { success: true };
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

// ─── FileTreeServiceManager ───

export class FileTreeServiceManager {
  private services = new Map<string, FileTreeService>();

  async startWatching(sessionId: string, workingDir: string): Promise<FileTreeService> {
    await this.stopWatching(sessionId);
    const service = new FileTreeService(workingDir);
    this.services.set(sessionId, service);
    await service.start();
    return service;
  }

  async stopWatching(sessionId: string): Promise<void> {
    const service = this.services.get(sessionId);
    if (service) {
      await service.stop();
      this.services.delete(sessionId);
    }
  }

  getService(sessionId: string): FileTreeService | undefined {
    return this.services.get(sessionId);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.services.values()).map((s) => s.stop());
    await Promise.all(promises);
    this.services.clear();
  }
}
