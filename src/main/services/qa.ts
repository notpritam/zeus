import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { QaInstanceInfo, QaTabInfo, QaSnapshotNode } from '../../shared/types';
import { CdpClient } from './cdp-client';

const PINCHTAB_PORT = 9867;
const PINCHTAB_BASE = `http://127.0.0.1:${PINCHTAB_PORT}`;
const HEALTH_CHECK_INTERVAL = 500;
const HEALTH_CHECK_MAX_RETRIES = 10;
// CDP port is derived from PinchTab instance port + 1 (e.g. 9868 → 9869)

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
  private cdpClient: CdpClient | null = null;

  getCdpClient(): CdpClient | null {
    return this.cdpClient;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const binaryPath = findBinaryPath();
    console.log(`[Zeus] Starting PinchTab from ${binaryPath}`);

    this.proc = spawn(binaryPath, ['server'], {
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
    if (this.cdpClient) {
      this.cdpClient.disconnect();
      this.cdpClient = null;
    }

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

  getPid(): number | null {
    return this.proc?.pid ?? null;
  }

  // ─── PinchTab API Proxy Methods ───

  async launchInstance(headless = false): Promise<QaInstanceInfo> {
    // PinchTab always-on strategy auto-launches an instance on start.
    // Check for existing instances first, only launch if none exist.
    const existing = await this.listInstances();
    if (existing.length > 0) {
      // Connect CDP to existing instance — derive CDP port from instance
      const instancePort = await this.getInstancePort(existing[0].instanceId);
      await this.connectCdp(instancePort);
      return existing[0];
    }

    const res = await pinchtabFetch('/instances/launch', {
      method: 'POST',
      body: { headless },
    });
    if (!res.ok) throw new Error(`Failed to launch instance: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;

    const instance: QaInstanceInfo = {
      instanceId: (data.id ?? data.instanceId ?? 'default') as string,
      headless,
    };

    // Wait for instance to be ready
    await new Promise((r) => setTimeout(r, 2000));
    const instancePort = await this.getInstancePort(instance.instanceId);
    await this.connectCdp(instancePort);

    return instance;
  }

  private async getInstancePort(instanceId: string): Promise<number | undefined> {
    try {
      const res = await pinchtabFetch(`/instances/${instanceId}`, { timeout: 5000 });
      if (!res.ok) {
        // Fall back to listing all instances
        const listRes = await pinchtabFetch('/instances', { timeout: 5000 });
        if (!listRes.ok) return undefined;
        const instances = await listRes.json() as Array<Record<string, unknown>>;
        const inst = instances.find(i => (i.id ?? i.instanceId) === instanceId) ?? instances[0];
        if (inst?.port) return parseInt(String(inst.port), 10);
        return undefined;
      }
      const data = await res.json() as Record<string, unknown>;
      if (data.port) return parseInt(String(data.port), 10);
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async connectCdp(instancePort?: number): Promise<void> {
    // PinchTab exposes CDP on instancePort + 1 (e.g. 9868 → 9869)
    const cdpPort = instancePort ? instancePort + 1 : undefined;
    try {
      this.cdpClient = new CdpClient(cdpPort);
      await this.cdpClient.connect();
      console.log(`[Zeus] CDP client connected on port ${cdpPort ?? 'default'}`);
    } catch (err) {
      console.warn('[Zeus] CDP client failed to connect (QA will work without observability):', (err as Error).message);
      this.cdpClient = null;
    }
  }

  async stopInstance(instanceId: string): Promise<void> {
    if (this.cdpClient) {
      this.cdpClient.disconnect();
      this.cdpClient = null;
    }

    const res = await pinchtabFetch(`/instances/${instanceId}/stop`, {
      method: 'POST',
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
    const res = await pinchtabFetch('/navigate', {
      method: 'POST',
      body: { url },
    });
    if (!res.ok) throw new Error(`Navigate failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    return { url: data.url ?? url, title: data.title ?? '' };
  }

  async snapshot(filter?: 'interactive' | 'full'): Promise<{ nodes: QaSnapshotNode[]; raw: string }> {
    const res = await pinchtabFetch('/snapshot');
    if (!res.ok) throw new Error(`Snapshot failed: ${res.status} ${await res.text()}`);

    const data = await res.json() as Record<string, unknown>;
    const raw = JSON.stringify(data, null, 2);

    // Parse nodes array from PinchTab response
    const nodes: QaSnapshotNode[] = [];
    if (Array.isArray(data.nodes)) {
      for (const node of data.nodes as Array<Record<string, unknown>>) {
        nodes.push({
          ref: (node.ref ?? '') as string,
          role: (node.role ?? 'unknown') as string,
          name: (node.name ?? node.ref ?? '') as string,
        });
      }
    }

    return { nodes, raw };
  }

  async screenshot(): Promise<string> {
    const res = await pinchtabFetch('/screenshot', { timeout: 15_000 });
    if (!res.ok) throw new Error(`Screenshot failed: ${res.status} ${await res.text()}`);

    // PinchTab returns JSON: { base64: "..." }
    const data = await res.json() as Record<string, string>;
    const base64 = data.base64;
    if (!base64) throw new Error('Screenshot response missing base64 field');
    return `data:image/jpeg;base64,${base64}`;
  }

  async action(kind: string, ref?: string, value?: string, key?: string): Promise<{ success: boolean; message?: string }> {
    const body: Record<string, unknown> = { kind };
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
    const res = await pinchtabFetch('/text');
    if (!res.ok) throw new Error(`Text extraction failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    return data.text ?? data.content ?? JSON.stringify(data);
  }

  async listTabs(): Promise<QaTabInfo[]> {
    try {
      const res = await pinchtabFetch('/tabs', { timeout: 5000 });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      // PinchTab returns { tabs: [...] }
      const tabs = Array.isArray(data.tabs) ? data.tabs : Array.isArray(data) ? data : [];
      return tabs.map((t: Record<string, string>) => ({
        tabId: t.id ?? t.tabId ?? 'unknown',
        url: t.url ?? '',
        title: t.title ?? '',
      }));
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
