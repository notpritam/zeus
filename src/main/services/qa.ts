import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { QaInstanceInfo, QaTabInfo, QaSnapshotNode } from '../../shared/types';

const PINCHTAB_PORT = 9867;
const PINCHTAB_BASE = `http://127.0.0.1:${PINCHTAB_PORT}`;
const HEALTH_CHECK_INTERVAL = 500;
const HEALTH_CHECK_MAX_RETRIES = 10;

function findBinaryPath(): string {
  // Try the npm package bin first
  const npmBin = path.resolve(__dirname, '../../node_modules/pinchtab/bin/pinchtab');
  if (fs.existsSync(npmBin)) return npmBin;

  // Try require.resolve
  try {
    const pkgDir = path.dirname(require.resolve('pinchtab/package.json'));
    const resolved = path.join(pkgDir, 'bin', 'pinchtab');
    if (fs.existsSync(resolved)) return resolved;
  } catch { /* not found */ }

  throw new Error('PinchTab binary not found. Run: npm install pinchtab');
}

async function pinchtabFetch(
  endpoint: string,
  options: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<Response> {
  const { method = 'GET', body, timeout = 30_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${PINCHTAB_BASE}${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── QAService ───

export class QAService extends EventEmitter {
  private proc: ChildProcess | null = null;
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;

    const binaryPath = findBinaryPath();
    console.log(`[Zeus] Starting PinchTab from ${binaryPath}`);

    this.proc = spawn(binaryPath, ['serve', `--port=${PINCHTAB_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      console.log(`[PinchTab] ${data.toString().trim()}`);
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[PinchTab] ${data.toString().trim()}`);
    });

    this.proc.on('exit', (code) => {
      console.log(`[Zeus] PinchTab exited with code ${code}`);
      this.running = false;
      this.proc = null;
      this.emit('stopped');
    });

    this.proc.on('error', (err) => {
      console.error(`[Zeus] PinchTab spawn error: ${err.message}`);
      this.running = false;
      this.proc = null;
      this.emit('error', err);
    });

    // Wait for PinchTab to be ready
    await this.waitForHealth();
    this.running = true;
    console.log(`[Zeus] PinchTab ready on port ${PINCHTAB_PORT}`);
  }

  async stop(): Promise<void> {
    if (!this.proc) return;

    return new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        if (this.proc) {
          this.proc.kill('SIGKILL');
        }
        cleanup();
      }, 3000);

      const cleanup = () => {
        clearTimeout(killTimeout);
        this.proc = null;
        this.running = false;
        resolve();
      };

      this.proc!.once('exit', cleanup);
      this.proc!.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── PinchTab API Proxy Methods ───

  async launchInstance(headless = false): Promise<QaInstanceInfo> {
    const res = await pinchtabFetch('/instance/start', {
      method: 'POST',
      body: { headless },
    });
    if (!res.ok) throw new Error(`Failed to launch instance: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      instanceId: (data.instanceId ?? data.id ?? 'default') as string,
      headless,
    };
  }

  async stopInstance(instanceId: string): Promise<void> {
    const res = await pinchtabFetch('/instance/stop', {
      method: 'POST',
      body: { instanceId },
    });
    if (!res.ok) throw new Error(`Failed to stop instance: ${res.status} ${await res.text()}`);
  }

  async listInstances(): Promise<QaInstanceInfo[]> {
    try {
      const res = await pinchtabFetch('/instances', { timeout: 5000 });
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map((d: Record<string, unknown>) => ({
          instanceId: (d.instanceId ?? d.id ?? 'unknown') as string,
          headless: (d.headless ?? false) as boolean,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const res = await pinchtabFetch('/nav', {
      method: 'POST',
      body: { url },
    });
    if (!res.ok) throw new Error(`Navigate failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    return { url: data.url ?? url, title: data.title ?? '' };
  }

  async snapshot(filter?: 'interactive' | 'full'): Promise<{ nodes: QaSnapshotNode[]; raw: string }> {
    const body: Record<string, unknown> = {};
    if (filter) body.format = filter === 'interactive' ? 'compact' : 'full';

    const res = await pinchtabFetch('/snapshot', { method: 'POST', body });
    if (!res.ok) throw new Error(`Snapshot failed: ${res.status} ${await res.text()}`);

    const data = await res.json() as Record<string, unknown>;
    const raw = typeof data.html === 'string' ? data.html : JSON.stringify(data, null, 2);

    // Parse into tree nodes if refs are available
    const nodes: QaSnapshotNode[] = [];
    if (data.refs && typeof data.refs === 'object') {
      for (const [ref, info] of Object.entries(data.refs as Record<string, Record<string, string>>)) {
        nodes.push({
          ref,
          role: info?.role ?? 'unknown',
          name: info?.name ?? info?.text ?? ref,
        });
      }
    }

    return { nodes, raw };
  }

  async screenshot(): Promise<string> {
    const res = await pinchtabFetch('/screenshot', { timeout: 15_000 });
    if (!res.ok) throw new Error(`Screenshot failed: ${res.status} ${await res.text()}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  async action(kind: string, ref?: string, value?: string, key?: string): Promise<{ success: boolean; message?: string }> {
    const body: Record<string, unknown> = { action: kind };
    if (ref) body.ref = ref;
    if (value) body.value = value;
    if (key) body.key = key;

    const res = await pinchtabFetch('/action', { method: 'POST', body });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, message: `${res.status}: ${text}` };
    }
    return { success: true };
  }

  async text(): Promise<string> {
    const res = await pinchtabFetch('/text', { method: 'POST' });
    if (!res.ok) throw new Error(`Text extraction failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    return data.text ?? data.content ?? JSON.stringify(data);
  }

  async listTabs(): Promise<QaTabInfo[]> {
    try {
      const res = await pinchtabFetch('/tabs', { timeout: 5000 });
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map((t: Record<string, string>) => ({
          tabId: t.tabId ?? t.id ?? 'unknown',
          url: t.url ?? '',
          title: t.title ?? '',
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  // ─── Internals ───

  private async waitForHealth(): Promise<void> {
    for (let i = 0; i < HEALTH_CHECK_MAX_RETRIES; i++) {
      try {
        const res = await fetch(`${PINCHTAB_BASE}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL));
    }
    throw new Error(`PinchTab did not become healthy after ${HEALTH_CHECK_MAX_RETRIES * HEALTH_CHECK_INTERVAL}ms`);
  }
}
