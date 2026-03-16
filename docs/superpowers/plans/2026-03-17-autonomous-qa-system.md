# Autonomous QA System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude CLI sessions native browser testing tools via an MCP server so Claude can autonomously verify UI changes — navigate, snapshot, screenshot, capture console/network/errors, and self-correct.

**Architecture:** A standalone MCP QA server (spawned by Claude CLI via `--mcp-config`) bridges PinchTab HTTP API and CDP data. A CDP client inside QAService captures Chrome DevTools events (console, network, errors) via WebSocket, writes them to a shared temp file. The MCP server reads that file for observability tools. Frontend gets live CDP events via the existing `qa` WebSocket channel.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP protocol), `ws` (CDP WebSocket, already installed), PinchTab (already installed), electron-vite (build pipeline)

**Spec:** `docs/superpowers/specs/2026-03-17-autonomous-qa-system-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/services/cdp-client.ts` | CREATE | CDP WebSocket client — connects to Chrome debug port, captures console/network/error events, writes ring buffers to temp file |
| `src/main/mcp/qa-server.ts` | CREATE | Standalone MCP stdio server — speaks JSON-RPC to Claude CLI, proxies PinchTab HTTP, reads CDP temp file |
| `electron.vite.config.ts` | MODIFY | Add `qa-server.ts` as additional main process entry point |
| `src/main/services/qa.ts` | MODIFY | Launch Chrome with `--remote-debugging-port`, manage CDP client lifecycle, forward CDP events to WebSocket |
| `src/main/services/claude-session.ts` | MODIFY | Add `enableQA`/`qaTargetUrl` to SessionOptions, add `--mcp-config` and `--append-system-prompt` to buildArgs |
| `src/main/services/websocket.ts` | MODIFY | Map `enableQA`/`qaTargetUrl` from payload to SessionOptions, auto-start QA when Claude session has `enableQA` |
| `src/shared/types.ts` | MODIFY | Add `enableQA`/`qaTargetUrl` to `ClaudeStartPayload`, add CDP event types to `QaPayload` |
| `src/renderer/src/stores/useZeusStore.ts` | MODIFY | Add `qaConsoleLogs`/`qaNetworkRequests`/`qaJsErrors` state, handle CDP payloads, add `enableQA` to startClaudeSession |
| `src/renderer/src/components/QAPanel.tsx` | MODIFY | Add Console/Network/Errors sub-tabs |
| `src/renderer/src/components/NewClaudeSessionModal.tsx` | MODIFY | Add "Enable QA" toggle and "Dev Server URL" input |
| `src/renderer/src/components/RightPanel.tsx` | MODIFY | Add error badge on QA icon when JS errors exist |
| `package.json` | MODIFY | Add `@modelcontextprotocol/sdk` dependency |

---

## Chunk 1: CDP Client + QAService Integration

### Task 1: Install MCP SDK dependency

**Files:**
- Modify: `package.json:50-76`

- [ ] **Step 1: Install @modelcontextprotocol/sdk**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('@modelcontextprotocol/sdk')" && echo "OK"
```
Expected: "OK" (no errors)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk dependency for MCP QA server"
```

---

### Task 2: Create CDP Client

**Files:**
- Create: `src/main/services/cdp-client.ts`

This is a self-contained module that connects to Chrome's DevTools Protocol via WebSocket, captures Runtime and Network events, and writes buffered state to a temp file for the MCP server to read.

- [ ] **Step 1: Create cdp-client.ts with types and RingBuffer**

```typescript
// src/main/services/cdp-client.ts
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Types ───

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status: number;
  duration: number;
  type: string;
  failed: boolean;
  error?: string;
}

export interface JsError {
  message: string;
  stack: string;
  source: string;
  line: number;
  timestamp: number;
}

export interface CdpState {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  errors: JsError[];
  updatedAt: number;
}

const CDP_STATE_FILE = path.join(os.tmpdir(), 'zeus-qa-cdp-state.json');
const RING_BUFFER_SIZE = 100;
const DEBOUNCE_MS = 200;

class RingBuffer<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > RING_BUFFER_SIZE) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}
```

- [ ] **Step 2: Add CdpClient class with connection discovery**

Append to `src/main/services/cdp-client.ts`:

```typescript
// ─── CDP Client ───

const CDP_DISCOVERY_URL = 'http://127.0.0.1:9222';
const CDP_MAX_RETRIES = 5;
const CDP_RETRY_INTERVAL = 1000;

export class CdpClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private consoleBuf = new RingBuffer<ConsoleEntry>();
  private networkBuf = new RingBuffer<NetworkEntry>();
  private errorBuf = new RingBuffer<JsError>();
  private pendingRequests = new Map<string, { url: string; method: string; startTime: number; type: string }>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  async connect(): Promise<void> {
    const wsUrl = await this.discoverWebSocketUrl();
    console.log(`[CDP] Connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        console.log('[CDP] Connected');
        this.connected = true;
        await this.enableDomains();
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleCdpMessage(msg);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        console.log('[CDP] Disconnected');
        this.connected = false;
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        console.error('[CDP] WebSocket error:', err.message);
        if (!this.connected) reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getState(): CdpState {
    return {
      console: this.consoleBuf.getAll(),
      network: this.networkBuf.getAll(),
      errors: this.errorBuf.getAll(),
      updatedAt: Date.now(),
    };
  }

  clearBuffers(): void {
    this.consoleBuf.clear();
    this.networkBuf.clear();
    this.errorBuf.clear();
    this.scheduleWrite();
  }

  private async discoverWebSocketUrl(): Promise<string> {
    for (let i = 0; i < CDP_MAX_RETRIES; i++) {
      try {
        const res = await fetch(`${CDP_DISCOVERY_URL}/json/list`);
        if (res.ok) {
          const tabs = await res.json() as Array<{ webSocketDebuggerUrl?: string; type?: string }>;
          const page = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
      } catch { /* not ready yet */ }
      if (i < CDP_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, CDP_RETRY_INTERVAL));
      }
    }
    throw new Error(`CDP: Could not discover WebSocket URL after ${CDP_MAX_RETRIES} attempts`);
  }

  private async enableDomains(): Promise<void> {
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  private send(method: string, params?: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket not open'));
      }
      const id = ++this.messageId;
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
```

- [ ] **Step 3: Add CDP message handlers**

Append to `src/main/services/cdp-client.ts`:

```typescript
  private handleCdpMessage(msg: { method?: string; params?: Record<string, unknown> }): void {
    if (!msg.method) return;

    switch (msg.method) {
      case 'Runtime.consoleAPICalled':
        this.handleConsole(msg.params!);
        break;
      case 'Runtime.exceptionThrown':
        this.handleException(msg.params!);
        break;
      case 'Network.requestWillBeSent':
        this.handleRequestStart(msg.params!);
        break;
      case 'Network.responseReceived':
        this.handleResponse(msg.params!);
        break;
      case 'Network.loadingFailed':
        this.handleLoadingFailed(msg.params!);
        break;
    }
  }

  private handleConsole(params: Record<string, unknown>): void {
    const type = params.type as string;
    const args = params.args as Array<{ type: string; value?: unknown; description?: string }> | undefined;
    const message = args
      ?.map(a => a.value !== undefined ? String(a.value) : (a.description ?? ''))
      .join(' ') ?? '';

    const entry: ConsoleEntry = {
      level: (['warning'].includes(type) ? 'warn' : type) as ConsoleEntry['level'],
      message,
      timestamp: Date.now(),
    };
    this.consoleBuf.push(entry);
    this.emit('console', entry);
    this.scheduleWrite();
  }

  private handleException(params: Record<string, unknown>): void {
    const detail = params.exceptionDetails as Record<string, unknown> | undefined;
    if (!detail) return;

    const exception = detail.exception as Record<string, unknown> | undefined;
    const stackTrace = detail.stackTrace as { callFrames?: Array<{ url: string; lineNumber: number }> } | undefined;
    const firstFrame = stackTrace?.callFrames?.[0];

    const entry: JsError = {
      message: (exception?.description ?? exception?.value ?? detail.text ?? 'Unknown error') as string,
      stack: exception?.description as string ?? '',
      source: firstFrame?.url ?? '',
      line: firstFrame?.lineNumber ?? 0,
      timestamp: Date.now(),
    };
    this.errorBuf.push(entry);
    this.emit('js_error', entry);
    this.scheduleWrite();
  }

  private handleRequestStart(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const request = params.request as Record<string, string>;
    this.pendingRequests.set(requestId, {
      url: request.url,
      method: request.method,
      startTime: Date.now(),
      type: (params.type as string) ?? 'Other',
    });
  }

  private handleResponse(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const response = params.response as Record<string, unknown>;
    const entry: NetworkEntry = {
      requestId,
      url: pending.url,
      method: pending.method,
      status: (response.status as number) ?? 0,
      duration: Date.now() - pending.startTime,
      type: pending.type,
      failed: false,
    };
    this.networkBuf.push(entry);
    this.pendingRequests.delete(requestId);
    this.emit('network', entry);
    this.scheduleWrite();
  }

  private handleLoadingFailed(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const entry: NetworkEntry = {
      requestId,
      url: pending.url,
      method: pending.method,
      status: 0,
      duration: Date.now() - pending.startTime,
      type: pending.type,
      failed: true,
      error: (params.errorText as string) ?? 'Loading failed',
    };
    this.networkBuf.push(entry);
    this.pendingRequests.delete(requestId);
    this.emit('network', entry);
    this.scheduleWrite();
  }
```

- [ ] **Step 4: Add temp file writing and cleanup**

Append to `src/main/services/cdp-client.ts`:

```typescript
  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeStateFile();
    }, DEBOUNCE_MS);
  }

  private writeStateFile(): void {
    try {
      const state = this.getState();
      const tmpFile = `${CDP_STATE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(state));
      fs.renameSync(tmpFile, CDP_STATE_FILE);
    } catch (err) {
      console.error('[CDP] Failed to write state file:', (err as Error).message);
    }
  }

  private cleanup(): void {
    try {
      if (fs.existsSync(CDP_STATE_FILE)) fs.unlinkSync(CDP_STATE_FILE);
      const tmp = `${CDP_STATE_FILE}.tmp`;
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch { /* best effort */ }
  }
}

export { CDP_STATE_FILE };
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors related to `cdp-client.ts`

- [ ] **Step 6: Commit**

```bash
git add src/main/services/cdp-client.ts
git commit -m "feat: add CDP client for Chrome DevTools Protocol event capture"
```

---

### Task 3: Update QAService to manage CDP lifecycle

**Files:**
- Modify: `src/main/services/qa.ts:1-10` (imports)
- Modify: `src/main/services/qa.ts:50-90` (QAService class — start method)
- Modify: `src/main/services/qa.ts:121-132` (launchInstance)
- Modify: `src/main/services/qa.ts:134-140` (stopInstance)
- Modify: `src/main/services/qa.ts:92-113` (stop method)

- [ ] **Step 1: Add CDP imports and port constant**

At top of `src/main/services/qa.ts`, add import after line 5:

```typescript
import { CdpClient } from './cdp-client';
```

Add constant after `HEALTH_CHECK_MAX_RETRIES` (line 10):

```typescript
const CDP_PORT = parseInt(process.env.ZEUS_CDP_PORT ?? '9222', 10);
```

- [ ] **Step 2: Add CDP client field and accessor to QAService**

In `QAService` class (after `private running = false;` on line 52), add:

```typescript
  private cdpClient: CdpClient | null = null;

  getCdpClient(): CdpClient | null {
    return this.cdpClient;
  }
```

- [ ] **Step 3: Update launchInstance to pass chromeFlags and start CDP**

Replace `launchInstance` method (lines 121-132):

```typescript
  async launchInstance(headless = false): Promise<QaInstanceInfo> {
    const res = await pinchtabFetch('/instance/start', {
      method: 'POST',
      body: { headless, chromeFlags: [`--remote-debugging-port=${CDP_PORT}`] },
    });
    if (!res.ok) throw new Error(`Failed to launch instance: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;

    const instance: QaInstanceInfo = {
      instanceId: (data.instanceId ?? data.id ?? 'default') as string,
      headless,
    };

    // Start CDP client after Chrome instance is ready
    try {
      this.cdpClient = new CdpClient();
      await this.cdpClient.connect();
      console.log('[Zeus] CDP client connected');
    } catch (err) {
      console.warn('[Zeus] CDP client failed to connect (QA will work without observability):', (err as Error).message);
      this.cdpClient = null;
    }

    return instance;
  }
```

- [ ] **Step 4: Update stopInstance to disconnect CDP**

Replace `stopInstance` method (lines 134-140):

```typescript
  async stopInstance(instanceId: string): Promise<void> {
    if (this.cdpClient) {
      this.cdpClient.disconnect();
      this.cdpClient = null;
    }

    const res = await pinchtabFetch('/instance/stop', {
      method: 'POST',
      body: { instanceId },
    });
    if (!res.ok) throw new Error(`Failed to stop instance: ${res.status} ${await res.text()}`);
  }
```

- [ ] **Step 5: Update stop() to clean up CDP**

In the `stop()` method (line 92), add CDP cleanup at the start:

```typescript
  async stop(): Promise<void> {
    if (this.cdpClient) {
      this.cdpClient.disconnect();
      this.cdpClient = null;
    }

    if (!this.proc) return;
    // ... rest of existing stop() code unchanged ...
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/main/services/qa.ts
git commit -m "feat: integrate CDP client into QAService for Chrome observability"
```

---

### Task 4: Update shared types for CDP events and enableQA

**Files:**
- Modify: `src/shared/types.ts:214-223` (ClaudeStartPayload)
- Modify: `src/shared/types.ts:388-413` (QaPayload)

- [ ] **Step 1: Add enableQA and qaTargetUrl to ClaudeStartPayload**

In `src/shared/types.ts`, add two fields to `ClaudeStartPayload` after `enableGitWatcher` (line 222):

```typescript
  enableQA?: boolean;
  qaTargetUrl?: string;
```

- [ ] **Step 2: Add CDP event types to QaPayload**

In `src/shared/types.ts`, add three new payload variants before the `qa_error` line (before line 413):

```typescript
  | { type: 'cdp_console'; logs: Array<{ level: string; message: string; timestamp: number }> }
  | { type: 'cdp_network'; requests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string }> }
  | { type: 'cdp_error'; errors: Array<{ message: string; stack: string; timestamp: number }> }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add enableQA to ClaudeStartPayload and CDP event types to QaPayload"
```

---

## Chunk 2: MCP QA Server + Build Pipeline

### Task 5: Configure electron-vite for MCP server entry point

**Files:**
- Modify: `electron.vite.config.ts`

The MCP server is a standalone Node.js script that Claude CLI spawns. It needs its own entry point in the build output.

- [ ] **Step 1: Add qa-server as additional main entry**

Update `electron.vite.config.ts` to add `rollupOptions` for multiple entries:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-qa-server': resolve(__dirname, 'src/main/mcp/qa-server.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
});
```

- [ ] **Step 2: Verify build config is valid**

```bash
npx electron-vite build 2>&1 | head -20
```
Expected: Build starts without config errors (may fail on missing qa-server.ts — that's fine for now)

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts
git commit -m "build: add MCP QA server as additional electron-vite entry point"
```

---

### Task 6: Create MCP QA Server

**Files:**
- Create: `src/main/mcp/qa-server.ts`

This is a standalone stdio server that Claude CLI spawns. It uses `@modelcontextprotocol/sdk` for MCP protocol and `fetch()` for PinchTab HTTP API. For CDP data, it reads `/tmp/zeus-qa-cdp-state.json`.

- [ ] **Step 1: Create qa-server.ts with imports and helpers**

```typescript
// src/main/mcp/qa-server.ts
// Standalone MCP server — spawned by Claude CLI via --mcp-config
// Bridges Claude tool calls to PinchTab HTTP API and CDP state file

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PINCHTAB_PORT = parseInt(process.env.ZEUS_PINCHTAB_PORT ?? '9867', 10);
const PINCHTAB_BASE = `http://127.0.0.1:${PINCHTAB_PORT}`;
const CDP_STATE_FILE = path.join(os.tmpdir(), 'zeus-qa-cdp-state.json');

// Track read pointers for since_last_call
let lastConsoleRead = 0;
let lastNetworkRead = 0;
let lastErrorRead = 0;

async function pinchtabFetch(
  endpoint: string,
  options: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<Response> {
  const { method = 'GET', body, timeout = 30_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${PINCHTAB_BASE}${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPinchtab(): Promise<boolean> {
  try {
    const res = await fetch(`${PINCHTAB_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function readCdpState(): { console: unknown[]; network: unknown[]; errors: unknown[]; updatedAt: number } {
  try {
    if (!fs.existsSync(CDP_STATE_FILE)) return { console: [], network: [], errors: [], updatedAt: 0 };
    const raw = fs.readFileSync(CDP_STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { console: [], network: [], errors: [], updatedAt: 0 };
  }
}
```

- [ ] **Step 2: Add server initialization and browser control tools**

Append to `src/main/mcp/qa-server.ts`:

```typescript
// ─── MCP Server ───

const server = new McpServer({
  name: 'zeus-qa',
  version: '1.0.0',
});

// ─── Browser Control Tools (PinchTab) ───

server.tool(
  'qa_navigate',
  'Navigate browser to a URL and wait for page load',
  { url: z.string().describe('The URL to navigate to') },
  async ({ url }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running. Start QA service first.' }], isError: true };
    }
    try {
      const start = Date.now();
      const res = await pinchtabFetch('/nav', { method: 'POST', body: { url } });
      if (!res.ok) throw new Error(`Navigate failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as Record<string, string>;
      const loadTime = Date.now() - start;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ title: data.title ?? '', url: data.url ?? url, loadTime }) }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_snapshot',
  'Capture the accessibility tree of the current page. Returns element refs that can be used with qa_click and qa_fill.',
  { filter: z.enum(['interactive', 'full']).optional().describe('Filter mode: interactive shows only actionable elements, full shows everything') },
  async ({ filter }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const body: Record<string, unknown> = {};
      if (filter) body.format = filter === 'interactive' ? 'compact' : 'full';
      const res = await pinchtabFetch('/snapshot', { method: 'POST', body });
      if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const raw = typeof data.html === 'string' ? data.html : JSON.stringify(data, null, 2);
      const elements: Array<{ ref: string; role: string; name: string }> = [];
      if (data.refs && typeof data.refs === 'object') {
        for (const [ref, info] of Object.entries(data.refs as Record<string, Record<string, string>>)) {
          elements.push({ ref, role: info?.role ?? 'unknown', name: info?.name ?? info?.text ?? ref });
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ elements, raw }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_screenshot',
  'Take a screenshot of the current page',
  {},
  async () => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const res = await pinchtabFetch('/screenshot', { timeout: 15_000 });
      if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const mimeType = (res.headers.get('content-type') ?? 'image/jpeg') as 'image/jpeg' | 'image/png';
      return { content: [{ type: 'image' as const, data: buffer.toString('base64'), mimeType }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_click',
  'Click an element identified by accessibility ref from qa_snapshot',
  { ref: z.string().describe('Element ref from snapshot') },
  async ({ ref }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { action: 'click', ref } });
      const ok = res.ok;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: ok, message: ok ? undefined : await res.text() }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_type',
  'Type text at the currently focused element (keystroke by keystroke)',
  { text: z.string().describe('Text to type') },
  async ({ text }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { action: 'type', value: text } });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: res.ok }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_fill',
  'Fill a form field identified by ref with a value (clears existing content first)',
  {
    ref: z.string().describe('Element ref from snapshot'),
    value: z.string().describe('Value to fill'),
  },
  async ({ ref, value }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { action: 'fill', ref, value } });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: res.ok }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_press',
  'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.)',
  { key: z.string().describe('Key to press') },
  async ({ key }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { action: 'press', key } });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: res.ok }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'qa_scroll',
  'Scroll the page up or down',
  {
    direction: z.enum(['up', 'down']).describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels (default 300)'),
  },
  async ({ direction, amount }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running' }], isError: true };
    }
    try {
      const pixels = (amount ?? 300) * (direction === 'up' ? -1 : 1);
      const res = await pinchtabFetch('/action', { method: 'POST', body: { action: 'scroll', value: String(pixels) } });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: res.ok }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);
```

- [ ] **Step 3: Add observability tools (CDP data)**

Append to `src/main/mcp/qa-server.ts`:

```typescript
// ─── Observability Tools (CDP State File) ───

server.tool(
  'qa_console_logs',
  'Get captured browser console output',
  {
    limit: z.number().optional().describe('Max entries to return (default all)'),
    since_last_call: z.boolean().optional().describe('Only return entries since last call'),
  },
  async ({ limit, since_last_call }) => {
    const state = readCdpState();
    let logs = state.console as Array<{ level: string; message: string; timestamp: number }>;
    if (since_last_call) {
      logs = logs.filter(l => l.timestamp > lastConsoleRead);
    }
    if (limit) logs = logs.slice(-limit);
    lastConsoleRead = Date.now();
    return { content: [{ type: 'text' as const, text: JSON.stringify({ logs, count: logs.length }) }] };
  },
);

server.tool(
  'qa_network_requests',
  'Get captured network requests',
  {
    limit: z.number().optional().describe('Max entries to return'),
    since_last_call: z.boolean().optional().describe('Only return entries since last call'),
    failed_only: z.boolean().optional().describe('Only show failed requests'),
  },
  async ({ limit, since_last_call, failed_only }) => {
    const state = readCdpState();
    let requests = state.network as Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string; timestamp?: number }>;
    if (since_last_call) {
      requests = requests.filter(r => (r.timestamp ?? 0) > lastNetworkRead);
    }
    if (failed_only) {
      requests = requests.filter(r => r.failed || r.status >= 400);
    }
    if (limit) requests = requests.slice(-limit);
    lastNetworkRead = Date.now();
    return { content: [{ type: 'text' as const, text: JSON.stringify({ requests, count: requests.length }) }] };
  },
);

server.tool(
  'qa_js_errors',
  'Get captured JavaScript errors',
  {
    limit: z.number().optional().describe('Max entries to return'),
    since_last_call: z.boolean().optional().describe('Only return entries since last call'),
  },
  async ({ limit, since_last_call }) => {
    const state = readCdpState();
    let errors = state.errors as Array<{ message: string; stack: string; timestamp: number }>;
    if (since_last_call) {
      errors = errors.filter(e => e.timestamp > lastErrorRead);
    }
    if (limit) errors = errors.slice(-limit);
    lastErrorRead = Date.now();
    return { content: [{ type: 'text' as const, text: JSON.stringify({ errors, count: errors.length }) }] };
  },
);
```

- [ ] **Step 4: Add compound qa_run_test_flow tool**

Append to `src/main/mcp/qa-server.ts`:

```typescript
// ─── Compound Tool ───

server.tool(
  'qa_run_test_flow',
  'Run a complete test check: navigate, wait, snapshot, screenshot, collect console/network/errors. Call this after making UI changes.',
  {
    url: z.string().describe('URL to test (e.g., http://localhost:5173)'),
    wait_for_network_idle: z.boolean().optional().describe('Wait for network idle before capturing (default true)'),
  },
  async ({ url, wait_for_network_idle }) => {
    if (!(await checkPinchtab())) {
      return { content: [{ type: 'text' as const, text: 'Error: PinchTab not running. Start QA service first.' }], isError: true };
    }

    const result: Record<string, unknown> = {};

    try {
      // 1. Navigate
      const navStart = Date.now();
      const navRes = await pinchtabFetch('/nav', { method: 'POST', body: { url } });
      if (!navRes.ok) throw new Error(`Navigate failed: ${navRes.status}`);
      const navData = await navRes.json() as Record<string, string>;
      result.title = navData.title ?? '';
      result.url = navData.url ?? url;
      result.loadTime = Date.now() - navStart;

      // 2. Wait for network idle (simple delay)
      if (wait_for_network_idle !== false) {
        await new Promise(r => setTimeout(r, 1500));
      }

      // 3. Snapshot
      try {
        const snapRes = await pinchtabFetch('/snapshot', { method: 'POST', body: {} });
        if (snapRes.ok) {
          const snapData = await snapRes.json() as Record<string, unknown>;
          const elements: Array<{ ref: string; role: string; name: string }> = [];
          if (snapData.refs && typeof snapData.refs === 'object') {
            for (const [ref, info] of Object.entries(snapData.refs as Record<string, Record<string, string>>)) {
              elements.push({ ref, role: info?.role ?? 'unknown', name: info?.name ?? info?.text ?? ref });
            }
          }
          result.snapshot = { elements };
        }
      } catch { /* non-fatal */ }

      // 4. Screenshot
      try {
        const ssRes = await pinchtabFetch('/screenshot', { timeout: 15_000 });
        if (ssRes.ok) {
          const buffer = Buffer.from(await ssRes.arrayBuffer());
          result.screenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
      } catch { /* non-fatal */ }

      // 5. CDP data
      const cdp = readCdpState();
      const consoleErrors = (cdp.console as Array<{ level: string; message: string; timestamp: number }>)
        .filter(c => c.level === 'error');
      const failedRequests = (cdp.network as Array<{ url: string; method: string; status: number; failed: boolean }>)
        .filter(n => n.failed || n.status >= 400);
      const jsErrors = cdp.errors as Array<{ message: string }>;

      result.console = consoleErrors;
      result.network = failedRequests;
      result.errors = jsErrors;

      // 6. Summary
      const issues: string[] = [];
      if (consoleErrors.length > 0) issues.push(`${consoleErrors.length} console error(s)`);
      if (failedRequests.length > 0) {
        const details = failedRequests.map(r => `${r.method} ${r.url} -> ${r.status || 'failed'}`).join(', ');
        issues.push(`${failedRequests.length} failed request(s): ${details}`);
      }
      if (jsErrors.length > 0) issues.push(`${jsErrors.length} JS error(s)`);
      result.summary = issues.length === 0
        ? `Page loaded successfully. Title: "${result.title}". No errors detected.`
        : `Page loaded. Issues: ${issues.join('; ')}.`;

      // Build response content
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      const { screenshot, ...textResult } = result;
      content.push({ type: 'text', text: JSON.stringify(textResult, null, 2) });
      if (typeof screenshot === 'string') {
        const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
        content.push({ type: 'image', data: base64, mimeType: 'image/jpeg' });
      }

      return { content };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error running test flow: ${(err as Error).message}` }], isError: true };
    }
  },
);
```

- [ ] **Step 5: Add server startup**

Append to `src/main/mcp/qa-server.ts`:

```typescript
// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[zeus-qa] MCP server started on stdio');
}

main().catch((err) => {
  console.error('[zeus-qa] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Verify build produces the MCP server output**

```bash
npx electron-vite build 2>&1 | tail -5
ls -la out/main/mcp-qa-server.js 2>/dev/null || ls -la out/main/ | grep qa
```
Expected: `mcp-qa-server.js` exists in build output

- [ ] **Step 8: Commit**

```bash
git add src/main/mcp/qa-server.ts
git commit -m "feat: add MCP QA server with PinchTab and CDP tool bridges"
```

---

## Chunk 3: Claude Session Integration + WebSocket Wiring

### Task 7: Update ClaudeSession to add MCP config and system prompt

**Files:**
- Modify: `src/main/services/claude-session.ts:1-16` (imports)
- Modify: `src/main/services/claude-session.ts:21-27` (SessionOptions)
- Modify: `src/main/services/claude-session.ts:183-206` (buildArgs)

- [ ] **Step 1: Add path and app imports**

At top of `src/main/services/claude-session.ts`, add after the existing imports (line 15):

```typescript
import path from 'path';
import { app } from 'electron';
```

- [ ] **Step 2: Add enableQA and qaTargetUrl to SessionOptions**

Update `SessionOptions` interface (lines 21-27):

```typescript
export interface SessionOptions {
  workingDir: string;
  permissionMode?: PermissionMode; // default: 'bypassPermissions'
  model?: string;
  resumeSessionId?: string;
  resumeAtMessageId?: string;
  enableQA?: boolean;
  qaTargetUrl?: string;
}
```

- [ ] **Step 3: Update buildArgs to inject MCP config and system prompt**

In `buildArgs()` method, add after the resume block (after line 203, before `return args;`):

```typescript
    // QA MCP server integration
    if (this.options.enableQA) {
      const mcpServerPath = path.resolve(app.getAppPath(), 'out/main/mcp-qa-server.js');
      const mcpConfig = JSON.stringify({
        mcpServers: {
          'zeus-qa': {
            command: 'node',
            args: [mcpServerPath],
          },
        },
      });
      args.push('--mcp-config', mcpConfig);

      const targetUrl = this.options.qaTargetUrl || 'http://localhost:5173';
      const qaPrompt = [
        'You have access to QA browser testing tools via the zeus-qa MCP server.',
        `After making UI changes, call qa_run_test_flow with url "${targetUrl}".`,
        'Check the summary for errors. If issues found, fix them and re-test.',
        'Do not claim work is complete until qa_run_test_flow returns a clean report.',
      ].join(' ');
      args.push('--append-system-prompt', qaPrompt);
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "feat: add --mcp-config and --append-system-prompt for QA-enabled sessions"
```

---

### Task 8: Update WebSocket handler to map enableQA and forward CDP events

**Files:**
- Modify: `src/main/services/websocket.ts:401-405` (handleClaude start_claude section)
- Modify: `src/main/services/websocket.ts:435-443` (after claude_started broadcast)
- Modify: `src/main/services/websocket.ts:1056-1066` (handleQA launch_instance section)

- [ ] **Step 1: Map enableQA and qaTargetUrl in handleClaude**

Update the `createSession` call in `handleClaude` (lines 401-405):

```typescript
      const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
        workingDir,
        permissionMode: opts.permissionMode ?? 'bypassPermissions',
        model: opts.model,
        enableQA: opts.enableQA,
        qaTargetUrl: opts.qaTargetUrl,
      });
```

- [ ] **Step 2: Auto-start QA when enableQA is set**

After the `broadcastEnvelope` for `claude_started` and the git watcher comment (after line 443), add QA auto-start:

```typescript
      // Auto-start QA if enabled
      if (opts.enableQA) {
        try {
          if (!qaService?.isRunning()) {
            qaService = new QAService();
            await qaService.start();
          }
          const instance = await qaService.launchInstance(true);
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'qa_started' }, auth: '',
          });
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'instance_launched', instance }, auth: '',
          });

          // Wire CDP events to frontend
          const cdp = qaService.getCdpClient();
          if (cdp) {
            cdp.on('console', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_console', logs: [entry] }, auth: '',
              });
            });
            cdp.on('network', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_network', requests: [entry] }, auth: '',
              });
            });
            cdp.on('js_error', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_error', errors: [entry] }, auth: '',
              });
            });
          }
        } catch (err) {
          console.warn('[Zeus] QA auto-start failed (non-fatal):', (err as Error).message);
        }
      }
```

- [ ] **Step 3: Wire CDP events when launching instance manually via QA panel**

In `handleQA`, after the `instance_launched` envelope in the `launch_instance` handler (around line 1063), add:

```typescript
      // Wire CDP events to frontend
      const cdp = qaService!.getCdpClient();
      if (cdp) {
        cdp.on('console', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_console', logs: [entry] }, auth: '',
          });
        });
        cdp.on('network', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_network', requests: [entry] }, auth: '',
          });
        });
        cdp.on('js_error', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_error', errors: [entry] }, auth: '',
          });
        });
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat: wire enableQA session option and forward CDP events to frontend"
```

---

## Chunk 4: Frontend — Store, QA Panel, Session Modal

### Task 9: Update Zustand store for CDP state and enableQA

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts:86-96` (QA state)
- Modify: `src/renderer/src/stores/useZeusStore.ts:109-117` (startClaudeSession)
- Modify: QA channel subscription handler in `connect()`

- [ ] **Step 1: Add CDP state fields to ZeusState interface**

After `qaTabs: QaTabInfo[];` (line 95), add:

```typescript
  qaConsoleLogs: Array<{ level: string; message: string; timestamp: number }>;
  qaNetworkRequests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string }>;
  qaJsErrors: Array<{ message: string; stack: string; timestamp: number }>;
```

- [ ] **Step 2: Add enableQA and qaTargetUrl to startClaudeSession signature**

Update the `startClaudeSession` action type (lines 109-117):

```typescript
  startClaudeSession: (config: {
    prompt: string;
    workingDir: string;
    sessionName?: string;
    permissionMode?: PermissionMode;
    model?: string;
    notificationSound?: boolean;
    enableGitWatcher?: boolean;
    enableQA?: boolean;
    qaTargetUrl?: string;
  }) => void;
```

- [ ] **Step 3: Add initial values for CDP state**

In the `create` call, after `qaTabs: [],` add:

```typescript
    qaConsoleLogs: [],
    qaNetworkRequests: [],
    qaJsErrors: [],
```

- [ ] **Step 4: Update startClaudeSession implementation to pass new fields**

Find the `startClaudeSession` implementation and add `enableQA` and `qaTargetUrl` to the payload sent via WebSocket.

- [ ] **Step 5: Handle CDP payloads in QA channel subscription**

In the `connect()` method's `qa` channel handler, add cases for the three new CDP event types:

```typescript
      } else if (p.type === 'cdp_console') {
        set((s) => ({ qaConsoleLogs: [...s.qaConsoleLogs, ...p.logs].slice(-100) }));
      } else if (p.type === 'cdp_network') {
        set((s) => ({ qaNetworkRequests: [...s.qaNetworkRequests, ...p.requests].slice(-100) }));
      } else if (p.type === 'cdp_error') {
        set((s) => ({ qaJsErrors: [...s.qaJsErrors, ...p.errors].slice(-100) }));
      }
```

Also clear CDP state when QA starts (`qa_started`) or stops (`qa_stopped`) — set `qaConsoleLogs: [], qaNetworkRequests: [], qaJsErrors: []`.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat: add CDP state and enableQA to Zustand store"
```

---

### Task 10: Update QAPanel with Console/Network/Errors tabs

**Files:**
- Modify: `src/renderer/src/components/QAPanel.tsx:21` (QAViewTab type)
- Modify: `src/renderer/src/components/QAPanel.tsx` (add new tab buttons and content)

- [ ] **Step 1: Extend QAViewTab type and add state selectors**

Update the type at line 21:

```typescript
type QAViewTab = 'snapshot' | 'screenshot' | 'text' | 'console' | 'network' | 'errors';
```

Add after existing selectors inside `QAPanel()`:

```typescript
  const qaConsoleLogs = useZeusStore((s) => s.qaConsoleLogs);
  const qaNetworkRequests = useZeusStore((s) => s.qaNetworkRequests);
  const qaJsErrors = useZeusStore((s) => s.qaJsErrors);
```

- [ ] **Step 2: Add tab buttons for Console/Network/Errors**

Find the view tab selector buttons row. Add three more buttons after the existing Text button:

```tsx
<button
  className={`px-2 py-1 text-xs rounded ${viewTab === 'console' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
  onClick={() => setViewTab('console')}
>
  Console {qaConsoleLogs.filter(l => l.level === 'error').length > 0 && (
    <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" />
  )}
</button>
<button
  className={`px-2 py-1 text-xs rounded ${viewTab === 'network' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
  onClick={() => setViewTab('network')}
>
  Network {qaNetworkRequests.filter(r => r.failed || r.status >= 400).length > 0 && (
    <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" />
  )}
</button>
<button
  className={`px-2 py-1 text-xs rounded ${viewTab === 'errors' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
  onClick={() => setViewTab('errors')}
>
  Errors {qaJsErrors.length > 0 && (
    <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" />
  )}
</button>
```

- [ ] **Step 3: Add Console view content**

After the existing `text` view content block, add:

```tsx
{viewTab === 'console' && (
  <ScrollArea className="h-full">
    <div className="p-2 space-y-0.5">
      {qaConsoleLogs.length === 0 ? (
        <p className="text-muted-foreground text-xs text-center py-8">No console output captured</p>
      ) : (
        qaConsoleLogs.map((log, i) => (
          <div key={i} className={`flex gap-2 px-2 py-0.5 text-xs font-mono rounded ${
            log.level === 'error' ? 'bg-red-500/10 text-red-400' :
            log.level === 'warn' ? 'bg-yellow-500/10 text-yellow-400' :
            'text-muted-foreground'
          }`}>
            <span className="shrink-0 w-10 text-right opacity-60">
              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="shrink-0 w-10">[{log.level}]</span>
            <span className="break-all">{log.message}</span>
          </div>
        ))
      )}
    </div>
  </ScrollArea>
)}
```

- [ ] **Step 4: Add Network view content**

```tsx
{viewTab === 'network' && (
  <ScrollArea className="h-full">
    <div className="p-2">
      {qaNetworkRequests.length === 0 ? (
        <p className="text-muted-foreground text-xs text-center py-8">No network requests captured</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1 px-1">Method</th>
              <th className="text-left py-1 px-1">URL</th>
              <th className="text-left py-1 px-1">Status</th>
              <th className="text-right py-1 px-1">Time</th>
            </tr>
          </thead>
          <tbody>
            {qaNetworkRequests.map((req, i) => (
              <tr key={i} className={`border-b border-border/50 ${req.failed || req.status >= 400 ? 'text-red-400' : 'text-muted-foreground'}`}>
                <td className="py-0.5 px-1 font-mono">{req.method}</td>
                <td className="py-0.5 px-1 truncate max-w-[200px]" title={req.url}>{req.url}</td>
                <td className="py-0.5 px-1">
                  <span className={`inline-block px-1 rounded text-[10px] ${
                    req.status >= 400 || req.failed ? 'bg-red-500/20 text-red-400' :
                    req.status >= 200 && req.status < 300 ? 'bg-green-500/20 text-green-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>{req.failed ? 'FAIL' : req.status}</span>
                </td>
                <td className="py-0.5 px-1 text-right">{req.duration}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </ScrollArea>
)}
```

- [ ] **Step 5: Add Errors view content**

```tsx
{viewTab === 'errors' && (
  <ScrollArea className="h-full">
    <div className="p-2 space-y-2">
      {qaJsErrors.length === 0 ? (
        <p className="text-muted-foreground text-xs text-center py-8">No JavaScript errors captured</p>
      ) : (
        qaJsErrors.map((err, i) => (
          <div key={i} className="rounded bg-red-500/10 p-2 text-xs">
            <div className="font-medium text-red-400">{err.message}</div>
            {err.stack && (
              <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">{err.stack}</pre>
            )}
            <div className="mt-1 text-[10px] text-muted-foreground">
              {new Date(err.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))
      )}
    </div>
  </ScrollArea>
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/QAPanel.tsx
git commit -m "feat: add Console, Network, and Errors tabs to QA panel"
```

---

### Task 11: Update NewClaudeSessionModal with QA toggle

**Files:**
- Modify: `src/renderer/src/components/NewClaudeSessionModal.tsx:24-32` (onStart callback type)

- [ ] **Step 1: Add enableQA and qaTargetUrl to onStart callback type**

Update the `onStart` callback in `NewClaudeSessionModalProps` (lines 24-32):

```typescript
  onStart: (config: {
    prompt: string;
    workingDir: string;
    sessionName?: string;
    permissionMode?: PermissionMode;
    model?: string;
    notificationSound?: boolean;
    enableGitWatcher?: boolean;
    enableQA?: boolean;
    qaTargetUrl?: string;
  }) => void;
```

- [ ] **Step 2: Add local state for QA options**

Inside the `NewClaudeSessionModal` component, add state:

```typescript
const [enableQA, setEnableQA] = useState(false);
const [qaTargetUrl, setQaTargetUrl] = useState('http://localhost:5173');
```

- [ ] **Step 3: Add QA toggle UI**

Find the section with the git watcher toggle. Add a similar section right after it:

```tsx
<div className="flex items-center justify-between">
  <Label htmlFor="enable-qa" className="text-sm">Enable QA Testing</Label>
  <Switch
    id="enable-qa"
    checked={enableQA}
    onCheckedChange={setEnableQA}
  />
</div>
{enableQA && (
  <div className="space-y-1.5">
    <Label htmlFor="qa-url" className="text-xs text-muted-foreground">Dev Server URL</Label>
    <Input
      id="qa-url"
      value={qaTargetUrl}
      onChange={(e) => setQaTargetUrl(e.target.value)}
      placeholder="http://localhost:5173"
      className="h-8 text-xs"
    />
  </div>
)}
```

- [ ] **Step 4: Pass QA options in onStart call**

Find where `onStart` is called in the submit handler. Add the new fields:

```typescript
enableQA,
qaTargetUrl: enableQA ? qaTargetUrl : undefined,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/NewClaudeSessionModal.tsx
git commit -m "feat: add QA toggle and dev server URL to new Claude session modal"
```

---

### Task 12: Add error badge to QA icon in RightPanel

**Files:**
- Modify: `src/renderer/src/components/RightPanel.tsx:72-114` (ActivityBarIcon component)
- Modify: `src/renderer/src/components/RightPanel.tsx:133-137` (Activity bar)

- [ ] **Step 1: Update ActivityBarIcon to accept optional badge**

Add a `badge` prop:

```typescript
function ActivityBarIcon({
  icon: Icon,
  tab,
  tooltip,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tab: 'source-control' | 'explorer' | 'qa';
  tooltip: string;
  badge?: boolean;
}) {
```

Replace `<Icon className="size-5" />` with:

```tsx
<div className="relative">
  <Icon className="size-5" />
  {badge && (
    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500" />
  )}
</div>
```

- [ ] **Step 2: Create QA icon wrapper with error badge**

After `ActivityBarIcon`, add:

```tsx
function QAActivityBarIcon() {
  const qaJsErrors = useZeusStore((s) => s.qaJsErrors);
  return (
    <ActivityBarIcon
      icon={Eye}
      tab="qa"
      tooltip="QA Preview"
      badge={qaJsErrors.length > 0}
    />
  );
}
```

Replace `<ActivityBarIcon icon={Eye} tab="qa" tooltip="QA Preview" />` in the activity bar with `<QAActivityBarIcon />`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RightPanel.tsx
git commit -m "feat: add error badge to QA icon when JS errors are present"
```

---

## Chunk 5: Final Integration and Verification

### Task 13: End-to-end build and test verification

- [ ] **Step 1: Build the full project**

```bash
npx electron-vite build
```
Expected: Clean build, `out/main/mcp-qa-server.js` exists alongside `out/main/index.js`

- [ ] **Step 2: Verify MCP server is a valid standalone script**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | timeout 5 node out/main/mcp-qa-server.js 2>/dev/null || true
```
Expected: Server starts, outputs JSON-RPC response

- [ ] **Step 3: Run full test suite**

```bash
npm test
```
Expected: No new failures (pre-existing `SessionSidebar.test.tsx` failure is known)

- [ ] **Step 4: Final commit if any uncommitted changes**

```bash
git status && git add -A && git commit -m "feat: autonomous QA system v1 — MCP server + CDP client + frontend observability"
```

---

## Verification Checklist

1. `npx tsc --noEmit` — all types compile
2. `npx electron-vite build` — build succeeds, produces `out/main/mcp-qa-server.js`
3. `npm test` — existing tests pass (ignore pre-existing SessionSidebar failure)
4. Launch app → New Claude Session modal shows "Enable QA Testing" toggle
5. Start session with QA enabled → PinchTab starts, Chrome instance launches, CDP connects
6. QA panel shows Console/Network/Errors tabs with live data
7. Error badge appears on Eye icon when JS errors are captured
8. Claude session has `--mcp-config` and `--append-system-prompt` in its args
9. MCP server responds to `tools/list` with all 12 tools
10. `qa_run_test_flow` returns combined report with snapshot, screenshot, console, network, errors
