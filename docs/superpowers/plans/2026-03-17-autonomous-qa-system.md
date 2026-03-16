# Autonomous QA System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude sessions native browser testing tools via an MCP server so it can autonomously navigate, inspect, screenshot, and fix UI issues without human intervention.

**Architecture:** A CDP client captures Chrome DevTools events (console, network, errors) via WebSocket. An MCP QA server runs as a standalone stdio process exposing 14 tools to Claude CLI. Zeus orchestrates the lifecycle — auto-starting PinchTab, CDP, and the MCP server when a Claude session enables QA.

**Tech Stack:** Node.js, Chrome DevTools Protocol (raw WebSocket), MCP JSON-RPC over stdio, PinchTab HTTP API, Electron IPC, React/Zustand frontend.

**Spec:** `docs/superpowers/specs/2026-03-17-autonomous-qa-system-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/services/cdp-client.ts` | CREATE | Chrome DevTools Protocol WebSocket client with ring buffers |
| `src/main/services/mcp-qa-server.ts` | CREATE | Standalone MCP stdio server exposing QA tools to Claude |
| `src/shared/types.ts` | MODIFY | Add `enableQA`, `qaTargetUrl` to ClaudeStartPayload; add CDP event types; add new QA payload types |
| `src/main/services/qa.ts` | MODIFY | Add `--remote-debugging-port` to instance launch; add MCP server lifecycle management |
| `src/main/services/claude-session.ts` | MODIFY | Add `enableQA`/`qaTargetUrl` to SessionOptions; inject `--mcp-server` flag; inject QA system prompt |
| `src/main/services/websocket.ts` | MODIFY | Pass `enableQA`/`qaTargetUrl` through to ClaudeSession; add CDP event forwarding handlers |
| `src/renderer/src/stores/useZeusStore.ts` | MODIFY | Add console/network/error state arrays; add handlers for CDP payloads |
| `src/renderer/src/components/QAPanel.tsx` | MODIFY | Add Console/Network/Errors tabs alongside existing Snapshot/Screenshot/Text |
| `src/renderer/src/components/NewClaudeSessionModal.tsx` | MODIFY | Add enableQA switch and qaTargetUrl input |

---

## Chunk 1: CDP Client + Types

### Task 1: Add CDP and QA Types to Shared Types

**Files:**
- Modify: `src/shared/types.ts:214-223` (ClaudeStartPayload)
- Modify: `src/shared/types.ts:388-413` (QaPayload)

- [ ] **Step 1: Add CDP event types and extend ClaudeStartPayload**

Add after the existing QaSnapshotNode interface (line ~386):

```typescript
// ─── CDP / Observability Types ───

export interface QaConsoleLog {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface QaNetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  type: string;
  failed: boolean;
  error?: string;
}

export interface QaJsError {
  message: string;
  stack: string;
  source: string;
  line: number;
  timestamp: number;
}
```

- [ ] **Step 2: Add `enableQA` and `qaTargetUrl` to ClaudeStartPayload**

In `ClaudeStartPayload` (line ~214), add:

```typescript
enableQA?: boolean;
qaTargetUrl?: string;
```

- [ ] **Step 3: Add `enableQA` to ClaudeSessionInfo**

In `ClaudeSessionInfo` (line ~309), add:

```typescript
enableQA?: boolean;
qaTargetUrl?: string;
```

- [ ] **Step 4: Extend QaPayload with CDP event types**

Add new server→client payload types to the QaPayload union:

```typescript
  // Server → Client (CDP observability)
  | { type: 'qa_console_logs'; logs: QaConsoleLog[] }
  | { type: 'qa_network_requests'; requests: QaNetworkRequest[] }
  | { type: 'qa_js_errors'; errors: QaJsError[] }
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(qa): add CDP event types and enableQA to payloads"
```

---

### Task 2: Create CDP Client

**Files:**
- Create: `src/main/services/cdp-client.ts`

The CDP client connects to Chrome's DevTools Protocol debug port via WebSocket, enables `Runtime` and `Network` domains, and passively captures console logs, network requests, and JS errors into ring buffers.

- [ ] **Step 1: Create cdp-client.ts with RingBuffer utility**

```typescript
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { QaConsoleLog, QaNetworkRequest, QaJsError } from '../../shared/types';

class RingBuffer<T> {
  private buf: T[] = [];
  private readPointer = 0;

  constructor(private capacity = 100) {}

  push(item: T): void {
    if (this.buf.length >= this.capacity) {
      this.buf.shift();
      if (this.readPointer > 0) this.readPointer--;
    }
    this.buf.push(item);
  }

  getAll(): T[] {
    return [...this.buf];
  }

  getSinceLastRead(): T[] {
    const items = this.buf.slice(this.readPointer);
    this.readPointer = this.buf.length;
    return items;
  }

  getLast(n: number): T[] {
    return this.buf.slice(-n);
  }

  clear(): void {
    this.buf = [];
    this.readPointer = 0;
  }
}
```

- [ ] **Step 2: Add CDPClient class with connection logic**

```typescript
export class CDPClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private connected = false;

  readonly consoleLogs = new RingBuffer<QaConsoleLog>(100);
  readonly networkRequests = new RingBuffer<QaNetworkRequest>(100);
  readonly jsErrors = new RingBuffer<QaJsError>(100);

  // Track in-flight network requests for duration calculation
  private pendingRequests = new Map<string, {
    url: string;
    method: string;
    type: string;
    startTime: number;
  }>();

  async connect(port = 9222): Promise<void> {
    // Fetch the WebSocket debugger URL from Chrome's JSON endpoint
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const data = await res.json() as { webSocketDebuggerUrl: string };
    const wsUrl = data.webSocketDebuggerUrl;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        this.connected = true;
        try {
          await this.sendCommand('Runtime.enable');
          await this.sendCommand('Network.enable');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.method) this.handleEvent(msg.method, msg.params);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async evaluate(expression: string): Promise<{ result: unknown; error?: string }> {
    try {
      const response = await this.sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails) {
        return { result: undefined, error: response.exceptionDetails.text };
      }
      return { result: response.result?.value };
    } catch (err) {
      return { result: undefined, error: (err as Error).message };
    }
  }

  private sendCommand(method: string, params?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        return reject(new Error('CDP not connected'));
      }
      const id = ++this.msgId;
      const handler = (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) {
            this.ws?.off('message', handler);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch { /* ignore */ }
      };
      this.ws.on('message', handler);
      this.ws.send(JSON.stringify({ id, method, params }));

      // Timeout after 10s
      setTimeout(() => {
        this.ws?.off('message', handler);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 10_000);
    });
  }

  private handleEvent(method: string, params: any): void {
    if (method === 'Runtime.consoleAPICalled') {
      const log: QaConsoleLog = {
        level: params.type === 'warning' ? 'warn' : params.type,
        message: (params.args || [])
          .map((a: any) => a.value ?? a.description ?? JSON.stringify(a))
          .join(' '),
        timestamp: params.timestamp ?? Date.now(),
      };
      this.consoleLogs.push(log);
      this.emit('console', log);
    }

    if (method === 'Runtime.exceptionThrown') {
      const ex = params.exceptionDetails;
      const error: QaJsError = {
        message: ex?.text ?? 'Unknown error',
        stack: ex?.exception?.description ?? '',
        source: ex?.url ?? '',
        line: ex?.lineNumber ?? 0,
        timestamp: params.timestamp ?? Date.now(),
      };
      this.jsErrors.push(error);
      this.emit('error', error);
    }

    if (method === 'Network.requestWillBeSent') {
      this.pendingRequests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        type: params.type ?? 'Other',
        startTime: params.timestamp * 1000,
      });
    }

    if (method === 'Network.responseReceived') {
      const pending = this.pendingRequests.get(params.requestId);
      if (pending) {
        const req: QaNetworkRequest = {
          url: pending.url,
          method: pending.method,
          status: params.response.status,
          duration: Math.round((params.timestamp * 1000) - pending.startTime),
          type: pending.type,
          failed: params.response.status >= 400,
        };
        this.networkRequests.push(req);
        this.pendingRequests.delete(params.requestId);
        this.emit('network', req);
      }
    }

    if (method === 'Network.loadingFailed') {
      const pending = this.pendingRequests.get(params.requestId);
      if (pending) {
        const req: QaNetworkRequest = {
          url: pending.url,
          method: pending.method,
          status: 0,
          duration: Math.round((params.timestamp * 1000) - pending.startTime),
          type: pending.type,
          failed: true,
          error: params.errorText,
        };
        this.networkRequests.push(req);
        this.pendingRequests.delete(params.requestId);
        this.emit('network', req);
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/cdp-client.ts
git commit -m "feat(qa): add Chrome DevTools Protocol client with ring buffers"
```

---

## Chunk 2: MCP QA Server

### Task 3: Create MCP QA Server

**Files:**
- Create: `src/main/services/mcp-qa-server.ts`

This is a standalone Node.js script that runs as a child process. It speaks MCP JSON-RPC over stdio, proxying tool calls to PinchTab HTTP API and CDP WebSocket.

- [ ] **Step 1: Create mcp-qa-server.ts with stdio JSON-RPC transport**

```typescript
#!/usr/bin/env node

// MCP QA Server — Standalone stdio process
// Speaks MCP JSON-RPC protocol with Claude CLI.
// Proxies tool calls to PinchTab (HTTP) and CDP (WebSocket).

import { CDPClient } from './cdp-client';

const PINCHTAB_PORT = parseInt(process.env.PINCHTAB_PORT || '9867', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const PINCHTAB_BASE = `http://127.0.0.1:${PINCHTAB_PORT}`;

const cdp = new CDPClient();
let cdpConnected = false;

// ─── Stdio Transport ───

let inputBuffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  inputBuffer += chunk;
  processBuffer();
});

function processBuffer(): void {
  // MCP uses Content-Length framing OR newline-delimited JSON
  // Claude CLI uses newline-delimited JSON-RPC
  const lines = inputBuffer.split('\n');
  inputBuffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg);
    } catch {
      // Skip malformed lines
    }
  }
}

function sendResponse(id: string | number | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id: string | number | null, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(msg + '\n');
}
```

- [ ] **Step 2: Add MCP protocol handlers (initialize, tools/list)**

```typescript
// ─── Tool Definitions ───

const TOOLS = [
  {
    name: 'qa_navigate',
    description: 'Navigate to a URL and wait for page load.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'qa_snapshot',
    description: 'Capture the accessibility tree of the current page.',
    inputSchema: {
      type: 'object',
      properties: { filter: { type: 'string', enum: ['interactive', 'full'] } },
    },
  },
  {
    name: 'qa_screenshot',
    description: 'Take a JPEG screenshot of the current page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'qa_click',
    description: 'Click an element identified by accessibility ref.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'qa_type',
    description: 'Type text keystroke by keystroke at the focused element.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'qa_fill',
    description: 'Fill a form field identified by ref with a value.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, value: { type: 'string' } },
      required: ['ref', 'value'],
    },
  },
  {
    name: 'qa_press',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc.).',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'qa_scroll',
    description: 'Scroll the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'qa_console_logs',
    description: 'Get captured console output since last call or last N entries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        since_last_call: { type: 'boolean' },
      },
    },
  },
  {
    name: 'qa_network_requests',
    description: 'Get captured network requests.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        since_last_call: { type: 'boolean' },
        failed_only: { type: 'boolean' },
      },
    },
  },
  {
    name: 'qa_js_errors',
    description: 'Get captured JavaScript errors.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        since_last_call: { type: 'boolean' },
      },
    },
  },
  {
    name: 'qa_evaluate',
    description: 'Execute JavaScript in the page context and return the result.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    name: 'qa_wait',
    description: 'Wait for a condition (element, navigation, network idle).',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', enum: ['element', 'navigation', 'network_idle'] },
        selector: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['condition'],
    },
  },
  {
    name: 'qa_run_test_flow',
    description: 'Run a complete test: navigate, wait, snapshot, screenshot, collect console/network/errors. Returns combined report.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        wait_for_network_idle: { type: 'boolean' },
      },
      required: ['url'],
    },
  },
];

async function handleMessage(msg: any): Promise<void> {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    // Try connecting CDP on init
    try {
      await cdp.connect(CDP_PORT);
      cdpConnected = true;
    } catch {
      cdpConnected = false;
      // CDP is optional — PinchTab-only mode
    }
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'zeus-qa', version: '1.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // No response needed for notifications
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await executeTool(name, args ?? {});
      sendResponse(id, result);
    } catch (err) {
      sendResponse(id, {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      });
    }
    return;
  }

  // Unknown method
  sendError(id, -32601, `Method not found: ${method}`);
}
```

- [ ] **Step 3: Add PinchTab HTTP helper and tool implementations**

```typescript
// ─── PinchTab HTTP Proxy ───

async function pinchtabFetch(
  endpoint: string,
  opts: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<Response> {
  const { method = 'GET', body, timeout = 30_000 } = opts;
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

// ─── Tool Execution ───

async function executeTool(name: string, args: Record<string, unknown>): Promise<any> {
  switch (name) {
    case 'qa_navigate': {
      const start = Date.now();
      const res = await pinchtabFetch('/nav', { method: 'POST', body: { url: args.url } });
      if (!res.ok) throw new Error(`Navigate failed: ${res.status}`);
      const data = await res.json() as Record<string, string>;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            title: data.title ?? '',
            url: data.url ?? args.url,
            loadTime: Date.now() - start,
          }),
        }],
      };
    }

    case 'qa_snapshot': {
      const body: Record<string, unknown> = {};
      if (args.filter) body.format = args.filter === 'interactive' ? 'compact' : 'full';
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
      return {
        content: [{ type: 'text', text: JSON.stringify({ elements, raw }) }],
      };
    }

    case 'qa_screenshot': {
      const res = await pinchtabFetch('/screenshot', { timeout: 15_000 });
      if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' }],
      };
    }

    case 'qa_click':
      return actionTool('click', args.ref as string);

    case 'qa_type':
      return actionTool('type', undefined, args.text as string);

    case 'qa_fill':
      return actionTool('fill', args.ref as string, args.value as string);

    case 'qa_press':
      return actionTool('press', undefined, undefined, args.key as string);

    case 'qa_scroll':
      return actionTool('scroll', undefined, String(args.amount ?? 3), args.direction as string);

    case 'qa_console_logs': {
      if (!cdpConnected) return textResult({ logs: [], note: 'CDP not connected' });
      const logs = args.since_last_call
        ? cdp.consoleLogs.getSinceLastRead()
        : args.limit
          ? cdp.consoleLogs.getLast(args.limit as number)
          : cdp.consoleLogs.getAll();
      return textResult({ logs });
    }

    case 'qa_network_requests': {
      if (!cdpConnected) return textResult({ requests: [], note: 'CDP not connected' });
      let requests = args.since_last_call
        ? cdp.networkRequests.getSinceLastRead()
        : args.limit
          ? cdp.networkRequests.getLast(args.limit as number)
          : cdp.networkRequests.getAll();
      if (args.failed_only) requests = requests.filter((r) => r.failed);
      return textResult({ requests });
    }

    case 'qa_js_errors': {
      if (!cdpConnected) return textResult({ errors: [], note: 'CDP not connected' });
      const errors = args.since_last_call
        ? cdp.jsErrors.getSinceLastRead()
        : args.limit
          ? cdp.jsErrors.getLast(args.limit as number)
          : cdp.jsErrors.getAll();
      return textResult({ errors });
    }

    case 'qa_evaluate': {
      if (!cdpConnected) throw new Error('CDP not connected — cannot evaluate JS');
      const result = await cdp.evaluate(args.expression as string);
      return textResult(result);
    }

    case 'qa_wait': {
      const timeout = (args.timeout as number) ?? 10_000;
      const condition = args.condition as string;

      if (condition === 'network_idle') {
        // Poll CDP pending requests until none for 500ms
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (cdpConnected && cdp['pendingRequests'].size === 0) {
            await sleep(500);
            if (cdp['pendingRequests'].size === 0) {
              return textResult({ success: true, timedOut: false });
            }
          }
          await sleep(200);
        }
        return textResult({ success: false, timedOut: true });
      }

      if (condition === 'element' && args.selector) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (cdpConnected) {
            const { result } = await cdp.evaluate(
              `!!document.querySelector(${JSON.stringify(args.selector)})`,
            );
            if (result === true) return textResult({ success: true, timedOut: false });
          }
          await sleep(300);
        }
        return textResult({ success: false, timedOut: true });
      }

      // navigation — just wait a bit
      await sleep(Math.min(timeout, 2000));
      return textResult({ success: true, timedOut: false });
    }

    case 'qa_run_test_flow': {
      const url = args.url as string;
      const start = Date.now();

      // Navigate
      const navRes = await pinchtabFetch('/nav', { method: 'POST', body: { url } });
      if (!navRes.ok) throw new Error(`Navigate failed: ${navRes.status}`);
      const navData = await navRes.json() as Record<string, string>;

      // Wait for network idle if requested
      if (args.wait_for_network_idle && cdpConnected) {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (cdp['pendingRequests'].size === 0) {
            await sleep(500);
            if (cdp['pendingRequests'].size === 0) break;
          }
          await sleep(200);
        }
      } else {
        await sleep(1000); // Basic settle time
      }

      // Snapshot
      const snapRes = await pinchtabFetch('/snapshot', { method: 'POST', body: { format: 'compact' } });
      const snapData = snapRes.ok ? await snapRes.json() as Record<string, unknown> : {};
      const elements: Array<{ ref: string; role: string; name: string }> = [];
      if (snapData.refs && typeof snapData.refs === 'object') {
        for (const [ref, info] of Object.entries(snapData.refs as Record<string, Record<string, string>>)) {
          elements.push({ ref, role: info?.role ?? 'unknown', name: info?.name ?? info?.text ?? ref });
        }
      }

      // Screenshot
      const ssRes = await pinchtabFetch('/screenshot', { timeout: 15_000 });
      const screenshotContent = ssRes.ok
        ? { type: 'image' as const, data: Buffer.from(await ssRes.arrayBuffer()).toString('base64'), mimeType: 'image/jpeg' as const }
        : null;

      // CDP data
      const consoleLogs = cdpConnected ? cdp.consoleLogs.getSinceLastRead() : [];
      const networkReqs = cdpConnected ? cdp.networkRequests.getSinceLastRead() : [];
      const jsErrors = cdpConnected ? cdp.jsErrors.getSinceLastRead() : [];

      // Build summary
      const issues: string[] = [];
      const errorLogs = consoleLogs.filter((l) => l.level === 'error');
      if (errorLogs.length > 0) issues.push(`${errorLogs.length} console error(s)`);
      const failedReqs = networkReqs.filter((r) => r.failed);
      if (failedReqs.length > 0) {
        issues.push(failedReqs.map((r) => `${r.method} ${r.url} -> ${r.status || 'failed'}`).join(', '));
      }
      if (jsErrors.length > 0) issues.push(`${jsErrors.length} JS error(s)`);

      const summary = issues.length > 0
        ? `Page loaded. Issues: ${issues.join('; ')}`
        : 'Page loaded. No errors detected.';

      const report = {
        title: navData.title ?? '',
        url: navData.url ?? url,
        loadTime: Date.now() - start,
        snapshot: { elements },
        console: consoleLogs,
        network: networkReqs,
        errors: jsErrors,
        summary,
      };

      const content: any[] = [{ type: 'text', text: JSON.stringify(report, null, 2) }];
      if (screenshotContent) content.push(screenshotContent);
      return { content };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function actionTool(
  kind: string,
  ref?: string,
  value?: string,
  key?: string,
): Promise<any> {
  const body: Record<string, unknown> = { action: kind };
  if (ref) body.ref = ref;
  if (value) body.value = value;
  if (key) body.key = key;
  const res = await pinchtabFetch('/action', { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text();
    return textResult({ success: false, message: `${res.status}: ${text}` });
  }
  return textResult({ success: true });
}

function textResult(data: unknown): any {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Graceful Shutdown ───

process.on('SIGTERM', () => {
  cdp.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  cdp.disconnect();
  process.exit(0);
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/mcp-qa-server.ts
git commit -m "feat(qa): add MCP QA server with all 14 tool implementations"
```

---

## Chunk 3: Service Integration (QA + Claude Session + WebSocket)

### Task 4: Extend QA Service for Debug Port and MCP Lifecycle

**Files:**
- Modify: `src/main/services/qa.ts:60` (spawn args)
- Modify: `src/main/services/qa.ts:121` (launchInstance)

- [ ] **Step 1: Add debug port support to QAService.launchInstance**

Modify `launchInstance` to pass `--remote-debugging-port` to PinchTab so Chrome is launched with CDP enabled:

```typescript
async launchInstance(headless = false, debugPort = 9222): Promise<QaInstanceInfo> {
  const res = await pinchtabFetch('/instance/start', {
    method: 'POST',
    body: { headless, chromeFlags: [`--remote-debugging-port=${debugPort}`] },
  });
  if (!res.ok) throw new Error(`Failed to launch instance: ${res.status} ${await res.text()}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    instanceId: (data.instanceId ?? data.id ?? 'default') as string,
    headless,
  };
}
```

- [ ] **Step 2: Add MCP server process management to QAService**

Add these methods to the QAService class:

```typescript
private mcpProc: ChildProcess | null = null;

async startMCPServer(): Promise<string> {
  if (this.mcpProc) return 'already_running';

  const serverPath = path.resolve(__dirname, 'mcp-qa-server.js');
  if (!fs.existsSync(serverPath)) {
    throw new Error(`MCP QA server not found at ${serverPath}`);
  }

  this.mcpProc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PINCHTAB_PORT: String(PINCHTAB_PORT) },
  });

  this.mcpProc.stderr?.on('data', (data: Buffer) => {
    console.log(`[MCP-QA] ${data.toString().trim()}`);
  });

  this.mcpProc.on('exit', (code) => {
    console.log(`[MCP-QA] Server exited: code=${code}`);
    this.mcpProc = null;
  });

  return serverPath;
}

stopMCPServer(): void {
  if (this.mcpProc) {
    this.mcpProc.kill('SIGTERM');
    this.mcpProc = null;
  }
}

getMCPServerPath(): string {
  return path.resolve(__dirname, 'mcp-qa-server.js');
}
```

- [ ] **Step 3: Update stop() to also stop MCP server**

In `QAService.stop()`, add `this.stopMCPServer()` before stopping PinchTab.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/qa.ts
git commit -m "feat(qa): add debug port support and MCP server lifecycle to QAService"
```

---

### Task 5: Integrate QA into Claude Session

**Files:**
- Modify: `src/main/services/claude-session.ts:21-27` (SessionOptions)
- Modify: `src/main/services/claude-session.ts:183-206` (buildArgs)
- Modify: `src/main/services/claude-session.ts:65` (start method)

- [ ] **Step 1: Add QA options to SessionOptions**

```typescript
export interface SessionOptions {
  workingDir: string;
  permissionMode?: PermissionMode;
  model?: string;
  resumeSessionId?: string;
  resumeAtMessageId?: string;
  enableQA?: boolean;
  qaTargetUrl?: string;
  mcpServerPath?: string; // Path to compiled MCP QA server JS
}
```

- [ ] **Step 2: Inject --mcp-server flag in buildArgs()**

Add after the model check (line ~203):

```typescript
if (this.options.enableQA && this.options.mcpServerPath) {
  args.push(`--mcp-server=zeus-qa:node ${this.options.mcpServerPath}`);
}
```

- [ ] **Step 3: Inject QA system prompt into the user's prompt**

Modify the `start()` method to prepend QA instructions when enabled:

```typescript
async start(prompt: string): Promise<void> {
  const args = this.buildArgs();
  const mode = this.options.permissionMode ?? 'bypassPermissions';

  // Inject QA system prompt
  let fullPrompt = prompt;
  if (this.options.enableQA) {
    const qaUrl = this.options.qaTargetUrl || 'http://localhost:5173';
    const qaPrefix = `You have access to QA browser testing tools via the zeus-qa MCP server.\n` +
      `After making UI changes, call qa_run_test_flow with url="${qaUrl}" to verify your work.\n` +
      `Check the summary for errors. If issues are found, fix them and re-test.\n` +
      `Do not claim work is complete until qa_run_test_flow returns a clean report.\n\n`;
    fullPrompt = qaPrefix + prompt;
  }

  // ... rest of start() uses fullPrompt instead of prompt
```

Update the `sendUserMessage` call at the end of `start()` to use `fullPrompt`.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "feat(qa): inject MCP server and QA prompt into Claude sessions"
```

---

### Task 6: Wire QA Through WebSocket Handler

**Files:**
- Modify: `src/main/services/websocket.ts:396-446` (handleClaude, start_claude handler)

- [ ] **Step 1: Pass enableQA and qaTargetUrl to ClaudeSession**

In `handleClaude`, when handling `start_claude`, update the session creation:

```typescript
if (payload.type === 'start_claude') {
  const opts = envelope.payload as ClaudeStartPayload;
  const workingDir = opts.workingDir || process.env.HOME || '/';

  // Auto-start QA if enabled
  let mcpServerPath: string | undefined;
  if (opts.enableQA) {
    try {
      if (!qaService?.isRunning()) {
        qaService = new QAService();
        await qaService.start();
        broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'qa_started' }, auth: '' });
      }
      // Launch a browser instance with debug port
      await qaService.launchInstance(true, 9222);
      mcpServerPath = qaService.getMCPServerPath();
    } catch (err) {
      console.error('[Zeus] Failed to auto-start QA:', (err as Error).message);
      // Continue without QA — non-fatal
    }
  }

  try {
    const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
      workingDir,
      permissionMode: opts.permissionMode ?? 'bypassPermissions',
      model: opts.model,
      enableQA: opts.enableQA,
      qaTargetUrl: opts.qaTargetUrl,
      mcpServerPath,
    });
    // ... rest of handler unchanged
```

- [ ] **Step 2: Persist enableQA in DB record**

Add `enableQA` to the `insertClaudeSession` call (alongside existing fields).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(qa): auto-start PinchTab and wire QA options through WebSocket"
```

---

## Chunk 4: Frontend — Store + Modal + QA Panel

### Task 7: Add CDP State to Zustand Store

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add CDP state fields**

Add to the store state (near existing QA state around line ~540):

```typescript
qaConsoleLogs: QaConsoleLog[];
qaNetworkRequests: QaNetworkRequest[];
qaJsErrors: QaJsError[];
```

Initialize them in the store creation:

```typescript
qaConsoleLogs: [],
qaNetworkRequests: [],
qaJsErrors: [],
```

- [ ] **Step 2: Add handlers for CDP payloads in the QA channel subscriber**

After the existing `qa_error` handler (around line ~807):

```typescript
if (payload.type === 'qa_console_logs') {
  set((state) => ({
    qaConsoleLogs: [...state.qaConsoleLogs, ...payload.logs].slice(-100),
  }));
}
if (payload.type === 'qa_network_requests') {
  set((state) => ({
    qaNetworkRequests: [...state.qaNetworkRequests, ...payload.requests].slice(-100),
  }));
}
if (payload.type === 'qa_js_errors') {
  set((state) => ({
    qaJsErrors: [...state.qaJsErrors, ...payload.errors].slice(-100),
  }));
}
```

- [ ] **Step 3: Clear CDP state on qa_stopped**

Update the `qa_stopped` handler to also clear CDP arrays:

```typescript
qaConsoleLogs: [], qaNetworkRequests: [], qaJsErrors: [],
```

- [ ] **Step 4: Import new types**

Add `QaConsoleLog`, `QaNetworkRequest`, `QaJsError` to the import from `shared/types`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(qa): add CDP observability state to Zustand store"
```

---

### Task 8: Add enableQA Toggle to New Session Modal

**Files:**
- Modify: `src/renderer/src/components/NewClaudeSessionModal.tsx`

- [ ] **Step 1: Add state variables**

```typescript
const [enableQA, setEnableQA] = useState(false);
const [qaTargetUrl, setQaTargetUrl] = useState('http://localhost:5173');
```

Reset them in the `useEffect` when modal opens:

```typescript
setEnableQA(false);
setQaTargetUrl('http://localhost:5173');
```

- [ ] **Step 2: Add enableQA to onStart config type and handleSubmit**

Update the `onStart` prop type to include `enableQA?: boolean` and `qaTargetUrl?: string`.

Update `handleSubmit`:

```typescript
onStart({
  prompt: prompt.trim(),
  workingDir,
  sessionName: sessionName.trim() || undefined,
  permissionMode,
  model: model.trim() || undefined,
  notificationSound,
  enableGitWatcher,
  enableQA,
  qaTargetUrl: enableQA ? qaTargetUrl.trim() || undefined : undefined,
});
```

- [ ] **Step 3: Add UI controls after the Git Watcher toggle**

```tsx
{/* QA Browser Testing */}
<div className="flex items-center justify-between">
  <div>
    <Label htmlFor="enable-qa" className="text-xs font-semibold">
      QA Browser Testing
    </Label>
    <p className="text-muted-foreground text-[10px]">Auto-test UI changes with PinchTab</p>
  </div>
  <Switch
    id="enable-qa"
    checked={enableQA}
    onCheckedChange={setEnableQA}
  />
</div>

{enableQA && (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold">
      Target URL <span className="text-muted-foreground font-normal">(dev server)</span>
    </Label>
    <Input
      value={qaTargetUrl}
      onChange={(e) => setQaTargetUrl(e.target.value)}
      placeholder="http://localhost:5173"
      className="text-xs"
    />
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/NewClaudeSessionModal.tsx
git commit -m "feat(qa): add QA browser testing toggle to session modal"
```

---

### Task 9: Add Console/Network/Errors Tabs to QA Panel

**Files:**
- Modify: `src/renderer/src/components/QAPanel.tsx`

- [ ] **Step 1: Extend the view tab type and add store subscriptions**

```typescript
type QAViewTab = 'snapshot' | 'screenshot' | 'text' | 'console' | 'network' | 'errors';

// Add store subscriptions
const qaConsoleLogs = useZeusStore((s) => s.qaConsoleLogs);
const qaNetworkRequests = useZeusStore((s) => s.qaNetworkRequests);
const qaJsErrors = useZeusStore((s) => s.qaJsErrors);
```

- [ ] **Step 2: Update the tab bar to include new tabs**

Replace the hardcoded tab array with all 6 tabs:

```tsx
{(['snapshot', 'screenshot', 'text', 'console', 'network', 'errors'] as QAViewTab[]).map((tab) => (
  <button
    key={tab}
    onClick={() => {
      setViewTab(tab);
      if (tab === 'snapshot') takeSnapshot('interactive');
      if (tab === 'screenshot') takeScreenshot();
      if (tab === 'text') extractQAText();
    }}
    className={`relative flex-1 py-1.5 text-[10px] font-medium capitalize transition-colors ${
      viewTab === tab
        ? 'border-primary text-foreground border-b-2'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    {tab}
    {tab === 'errors' && qaJsErrors.length > 0 && (
      <span className="bg-destructive absolute -top-0.5 right-1 size-1.5 rounded-full" />
    )}
    {tab === 'console' && qaConsoleLogs.some((l) => l.level === 'error') && (
      <span className="bg-destructive absolute -top-0.5 right-1 size-1.5 rounded-full" />
    )}
  </button>
))}
```

- [ ] **Step 3: Add Console tab content**

```tsx
{viewTab === 'console' && (
  <div className="p-2 space-y-0.5">
    {qaConsoleLogs.length === 0 ? (
      <p className="text-muted-foreground py-4 text-center text-[10px]">No console output</p>
    ) : (
      qaConsoleLogs.map((log, i) => (
        <div
          key={i}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            log.level === 'error'
              ? 'bg-destructive/10 text-destructive'
              : log.level === 'warn'
                ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground'
          }`}
        >
          <span className="font-semibold uppercase">{log.level}</span>{' '}
          <span>{log.message}</span>
        </div>
      ))
    )}
  </div>
)}
```

- [ ] **Step 4: Add Network tab content**

```tsx
{viewTab === 'network' && (
  <div className="p-2">
    {qaNetworkRequests.length === 0 ? (
      <p className="text-muted-foreground py-4 text-center text-[10px]">No network requests</p>
    ) : (
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-1 pr-2">Method</th>
            <th className="py-1 pr-2">URL</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1">Time</th>
          </tr>
        </thead>
        <tbody>
          {qaNetworkRequests.map((req, i) => (
            <tr key={i} className="border-border border-b last:border-0">
              <td className="text-foreground py-0.5 pr-2 font-mono font-semibold">{req.method}</td>
              <td className="text-foreground max-w-[150px] truncate py-0.5 pr-2" title={req.url}>
                {req.url.replace(/^https?:\/\/[^/]+/, '')}
              </td>
              <td className="py-0.5 pr-2">
                <span
                  className={`rounded px-1 py-0.5 font-mono ${
                    req.failed
                      ? 'bg-destructive/10 text-destructive'
                      : req.status >= 400
                        ? 'bg-yellow-500/10 text-yellow-600'
                        : 'bg-green-500/10 text-green-600'
                  }`}
                >
                  {req.status || 'ERR'}
                </span>
              </td>
              <td className="text-muted-foreground py-0.5 font-mono">{req.duration}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
)}
```

- [ ] **Step 5: Add Errors tab content**

```tsx
{viewTab === 'errors' && (
  <div className="p-2 space-y-1">
    {qaJsErrors.length === 0 ? (
      <p className="text-muted-foreground py-4 text-center text-[10px]">No JavaScript errors</p>
    ) : (
      qaJsErrors.map((err, i) => (
        <details key={i} className="bg-destructive/5 rounded border border-destructive/20">
          <summary className="text-destructive cursor-pointer px-2 py-1 text-[10px] font-medium">
            {err.message}
          </summary>
          <pre className="text-muted-foreground whitespace-pre-wrap border-t border-destructive/10 px-2 py-1 text-[9px]">
            {err.stack || `${err.source}:${err.line}`}
          </pre>
        </details>
      ))
    )}
  </div>
)}
```

- [ ] **Step 6: Add missing imports**

Import `Terminal, Wifi, AlertTriangle` from `lucide-react` if used, or keep the text-only approach above.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/QAPanel.tsx
git commit -m "feat(qa): add Console, Network, Errors tabs to QA panel"
```

---

## Chunk 5: CDP Event Forwarding to Frontend

### Task 10: Forward CDP Events via WebSocket

**Files:**
- Modify: `src/main/services/websocket.ts`

The MCP server runs as a standalone process, so it doesn't share state with the WebSocket server directly. We need the WebSocket handler to create its own CDP client connection and forward events to the frontend.

- [ ] **Step 1: Import CDPClient and track per-session CDP connections**

At the top of websocket.ts, add:

```typescript
import { CDPClient } from './cdp-client';

const cdpClients = new Map<string, CDPClient>(); // sessionId → CDPClient
```

- [ ] **Step 2: Connect CDP when QA is auto-started**

In the `handleClaude` start_claude handler, after launching the instance, connect a CDP client:

```typescript
if (opts.enableQA && qaService?.isRunning()) {
  // Give Chrome a moment to start the debug port
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const cdpClient = new CDPClient();
    await cdpClient.connect(9222);
    cdpClients.set(envelope.sessionId, cdpClient);

    // Forward CDP events to frontend
    cdpClient.on('console', (log) => {
      broadcastEnvelope({
        channel: 'qa', sessionId: envelope.sessionId,
        payload: { type: 'qa_console_logs', logs: [log] }, auth: '',
      });
    });
    cdpClient.on('network', (req) => {
      broadcastEnvelope({
        channel: 'qa', sessionId: envelope.sessionId,
        payload: { type: 'qa_network_requests', requests: [req] }, auth: '',
      });
    });
    cdpClient.on('error', (err) => {
      broadcastEnvelope({
        channel: 'qa', sessionId: envelope.sessionId,
        payload: { type: 'qa_js_errors', errors: [err] }, auth: '',
      });
    });
  } catch (err) {
    console.error('[Zeus] CDP connect failed:', (err as Error).message);
  }
}
```

- [ ] **Step 3: Disconnect CDP when Claude session ends**

In the session done/kill handlers, clean up CDP:

```typescript
const cdpClient = cdpClients.get(sessionId);
if (cdpClient) {
  cdpClient.disconnect();
  cdpClients.delete(sessionId);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(qa): forward CDP events to frontend via WebSocket"
```

---

### Task 11: Verify Build and Test

- [ ] **Step 1: Run TypeScript compilation**

```bash
npm run build
```

Fix any type errors.

- [ ] **Step 2: Run the app and verify**

Start the Electron app, create a new Claude session with QA enabled, verify:
1. PinchTab auto-starts
2. Browser instance launches
3. Claude has access to `qa_*` tools
4. Console/Network/Errors tabs populate in QA panel

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(qa): autonomous QA system complete"
```
