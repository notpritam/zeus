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

// ─── Helpers ───

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
      const res = await pinchtabFetch('/navigate', { method: 'POST', body: { url } });
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
      const res = await pinchtabFetch('/snapshot');
      if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const raw = JSON.stringify(data, null, 2);
      const elements: Array<{ ref: string; role: string; name: string }> = [];
      if (Array.isArray(data.nodes)) {
        for (const node of data.nodes as Array<Record<string, unknown>>) {
          elements.push({
            ref: (node.ref ?? '') as string,
            role: (node.role ?? 'unknown') as string,
            name: (node.name ?? node.ref ?? '') as string,
          });
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
      const data = await res.json() as Record<string, string>;
      if (!data.base64) throw new Error('Screenshot response missing base64 field');
      return { content: [{ type: 'image' as const, data: data.base64, mimeType: 'image/jpeg' as const }] };
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
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'click', ref } });
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
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'type', value: text } });
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
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'fill', ref, value } });
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
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'press', key } });
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
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'scroll', value: String(pixels) } });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: res.ok }) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

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
      const navRes = await pinchtabFetch('/navigate', { method: 'POST', body: { url } });
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
        const snapRes = await pinchtabFetch('/snapshot');
        if (snapRes.ok) {
          const snapData = await snapRes.json() as Record<string, unknown>;
          const elements: Array<{ ref: string; role: string; name: string }> = [];
          if (Array.isArray(snapData.nodes)) {
            for (const node of snapData.nodes as Array<Record<string, unknown>>) {
              elements.push({
                ref: (node.ref ?? '') as string,
                role: (node.role ?? 'unknown') as string,
                name: (node.name ?? node.ref ?? '') as string,
              });
            }
          }
          result.snapshot = { elements };
        }
      } catch { /* non-fatal */ }

      // 4. Screenshot
      try {
        const ssRes = await pinchtabFetch('/screenshot', { timeout: 15_000 });
        if (ssRes.ok) {
          const ssData = await ssRes.json() as Record<string, string>;
          if (ssData.base64) {
            result.screenshot = `data:image/jpeg;base64,${ssData.base64}`;
          }
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
