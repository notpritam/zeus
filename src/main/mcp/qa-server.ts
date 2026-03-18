// src/main/mcp/qa-server.ts
// Standalone MCP server — spawned by Claude CLI via --mcp-config
// Bridges Claude tool calls to PinchTab HTTP API and CDP state file

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import WebSocket from 'ws';

const PINCHTAB_PORT = parseInt(process.env.ZEUS_PINCHTAB_PORT ?? '9867', 10);
const PINCHTAB_BASE = `http://127.0.0.1:${PINCHTAB_PORT}`;
const CDP_STATE_FILE = path.join(os.tmpdir(), 'zeus-qa-cdp-state.json');
const ZEUS_WS_URL = process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:8888';
const QA_AGENT_ID = process.env.ZEUS_QA_AGENT_ID ?? '';

// Track read pointers for since_last_call
let lastConsoleRead = 0;
let lastNetworkRead = 0;
let lastErrorRead = 0;

// ─── Helpers ───

async function pinchtabFetch(
  endpoint: string,
  options: { method?: string; body?: unknown; timeout?: number; query?: Record<string, string> } = {},
): Promise<Response> {
  const { method = 'GET', body, timeout = 30_000, query } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let url = `${PINCHTAB_BASE}${endpoint}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }
  try {
    return await fetch(url, {
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

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

const NOT_RUNNING = errorResult('Error: PinchTab not running. Start QA service first.');

// ─── MCP Server ───

const server = new McpServer({
  name: 'zeus-qa',
  version: '2.0.0',
});

// ═══════════════════════════════════════════
// ─── Navigation & Page Info ───
// ═══════════════════════════════════════════

server.tool(
  'qa_navigate',
  'Navigate browser to a URL and wait for page load',
  { url: z.string().describe('The URL to navigate to') },
  async ({ url }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const start = Date.now();
      const res = await pinchtabFetch('/navigate', { method: 'POST', body: { url } });
      if (!res.ok) throw new Error(`Navigate failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as Record<string, string>;
      return textResult({ title: data.title ?? '', url: data.url ?? url, loadTime: Date.now() - start });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_snapshot',
  'Capture the accessibility tree of the current page. Returns element refs for qa_click/qa_fill. Use selector param to scope to a section. Use format=compact to reduce token usage.',
  {
    selector: z.string().optional().describe('CSS selector to scope snapshot to a subtree (e.g. "#main", ".sidebar")'),
    format: z.enum(['full', 'compact']).optional().describe('Output format: compact (default) reduces tokens, full gives all detail'),
  },
  async ({ selector, format }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const query: Record<string, string> = {};
      if (selector) query.selector = selector;
      if (format) query.format = format;
      const res = await pinchtabFetch('/snapshot', { query });
      if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_screenshot',
  'Take a screenshot of the current page',
  {
    full_page: z.boolean().optional().describe('Capture full scrollable page (default: viewport only)'),
  },
  async ({ full_page }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const query: Record<string, string> = {};
      if (full_page) query.fullPage = 'true';
      const res = await pinchtabFetch('/screenshot', { timeout: 15_000, query });
      if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
      const data = await res.json() as Record<string, string>;
      if (!data.base64) throw new Error('Screenshot response missing base64 field');
      return { content: [{ type: 'image' as const, data: data.base64, mimeType: 'image/jpeg' as const }] };
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_text',
  'Extract all visible text content from the current page. Faster and cheaper than a full snapshot when you just need to read page content.',
  {},
  async () => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/text');
      if (!res.ok) throw new Error(`Text extraction failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_pdf',
  'Generate a PDF of the current page. Returns base64-encoded PDF.',
  {},
  async () => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/pdf', { method: 'POST', body: {}, timeout: 30_000 });
      if (!res.ok) throw new Error(`PDF generation failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as Record<string, string>;
      return textResult({ success: true, base64Length: data.base64?.length ?? 0, format: data.format ?? 'pdf' });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── Element Interaction ───
// ═══════════════════════════════════════════

server.tool(
  'qa_click',
  'Click an element identified by accessibility ref from qa_snapshot',
  { ref: z.string().describe('Element ref from snapshot') },
  async ({ ref }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'click', ref } });
      const ok = res.ok;
      return textResult({ success: ok, message: ok ? undefined : await res.text() });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_click_selector',
  'Click an element by CSS selector. Use for non-focusable elements (table rows, divs with onClick) that lack accessible refs.',
  { selector: z.string().describe('CSS selector (e.g. tr[class*="cursor-pointer"], div.card, #submit-btn)') },
  async ({ selector }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'click', selector } });
      const ok = res.ok;
      return textResult({ success: ok, message: ok ? undefined : await res.text() });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_hover',
  'Hover over an element (triggers CSS :hover states, tooltips, dropdown menus)',
  {
    ref: z.string().optional().describe('Element ref from snapshot'),
    selector: z.string().optional().describe('CSS selector (alternative to ref)'),
  },
  async ({ ref, selector }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    if (!ref && !selector) return errorResult('Error: Provide either ref or selector');
    try {
      const body: Record<string, unknown> = { kind: 'hover' };
      if (ref) body.ref = ref;
      if (selector) body.selector = selector;
      const res = await pinchtabFetch('/action', { method: 'POST', body });
      return textResult({ success: res.ok });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_focus',
  'Focus an element (useful before typing, or to trigger focus-based UI)',
  {
    ref: z.string().optional().describe('Element ref from snapshot'),
    selector: z.string().optional().describe('CSS selector (alternative to ref)'),
  },
  async ({ ref, selector }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    if (!ref && !selector) return errorResult('Error: Provide either ref or selector');
    try {
      const body: Record<string, unknown> = { kind: 'focus' };
      if (ref) body.ref = ref;
      if (selector) body.selector = selector;
      const res = await pinchtabFetch('/action', { method: 'POST', body });
      return textResult({ success: res.ok });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_select_text',
  'Select text content in an element (useful for copy operations or verifying text selection)',
  {
    ref: z.string().optional().describe('Element ref from snapshot'),
    selector: z.string().optional().describe('CSS selector (alternative to ref)'),
  },
  async ({ ref, selector }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    if (!ref && !selector) return errorResult('Error: Provide either ref or selector');
    try {
      const body: Record<string, unknown> = { kind: 'select' };
      if (ref) body.ref = ref;
      if (selector) body.selector = selector;
      const res = await pinchtabFetch('/action', { method: 'POST', body });
      return textResult({ success: res.ok });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_type',
  'Type text at the currently focused element (keystroke by keystroke). Works reliably with React controlled inputs.',
  { text: z.string().describe('Text to type') },
  async ({ text }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'type', value: text } });
      if (!res.ok) {
        const errText = await res.text();
        return textResult({ success: false, error: errText });
      }
      return textResult({ success: true });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_fill',
  'Fill a form field identified by ref with a value (clears existing content first). Note: For React controlled inputs, this may not trigger onChange — use qa_click then qa_type as a workaround.',
  {
    ref: z.string().describe('Element ref from snapshot'),
    value: z.string().describe('Value to fill'),
  },
  async ({ ref, value }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'fill', ref, value } });
      if (!res.ok) {
        const errText = await res.text();
        return textResult({ success: false, error: errText });
      }
      return textResult({ success: true });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_press',
  'Press a keyboard key (Enter, Tab, Escape, ArrowDown, Backspace, etc.) or key combo (Control+a, Shift+Tab)',
  { key: z.string().describe('Key name or combo (e.g. "Enter", "Tab", "Control+a", "Shift+Tab")') },
  async ({ key }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'press', key } });
      return textResult({ success: res.ok });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
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
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const pixels = (amount ?? 300) * (direction === 'up' ? -1 : 1);
      const res = await pinchtabFetch('/action', { method: 'POST', body: { kind: 'scroll', value: String(pixels) } });
      return textResult({ success: res.ok });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── JavaScript Evaluation ───
// ═══════════════════════════════════════════

server.tool(
  'qa_evaluate',
  'Execute JavaScript in the page context and return the result. Use for: reading app state (Redux, localStorage), dispatching synthetic events on React inputs, asserting DOM state, or clicking elements programmatically. Requires security.allowEvaluate in PinchTab config.',
  { expression: z.string().describe('JS expression to evaluate (e.g. document.title, JSON.stringify(localStorage), window.__STORE__.getState())') },
  async ({ expression }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/evaluate', { method: 'POST', body: { expression } });
      if (!res.ok) {
        const errText = await res.text();
        return textResult({ success: false, error: `${res.status}: ${errText}` });
      }
      const data = await res.json();
      return textResult({ success: true, result: data });
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── Tab Management ───
// ═══════════════════════════════════════════

server.tool(
  'qa_list_tabs',
  'List all open browser tabs with their URLs and titles',
  {},
  async () => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/tabs');
      if (!res.ok) throw new Error(`List tabs failed: ${res.status}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_create_tab',
  'Create a new browser tab, optionally navigating to a URL. Use to open multiple pages side by side.',
  {
    url: z.string().optional().describe('URL to open in the new tab (default: about:blank)'),
    stealth: z.boolean().optional().describe('Enable stealth mode for the tab'),
  },
  async ({ url, stealth }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const body: Record<string, unknown> = {};
      if (url) body.url = url;
      if (stealth) body.stealth = stealth;
      const res = await pinchtabFetch('/tab/create', { method: 'POST', body });
      if (!res.ok) throw new Error(`Create tab failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_lock_tab',
  'Lock a tab for exclusive operations (prevents other agents from interacting with it)',
  {
    tab_id: z.string().describe('Tab ID from qa_list_tabs'),
    owner: z.string().describe('Lock owner identifier (e.g. "qa-agent-1")'),
    timeout_ms: z.number().optional().describe('Lock timeout in ms (default: 30000)'),
  },
  async ({ tab_id, owner, timeout_ms }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const body: Record<string, unknown> = { tabId: tab_id, owner };
      if (timeout_ms) body.timeoutMs = timeout_ms;
      const res = await pinchtabFetch('/tab/lock', { method: 'POST', body });
      if (!res.ok) throw new Error(`Lock tab failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_unlock_tab',
  'Unlock a previously locked tab',
  {
    tab_id: z.string().describe('Tab ID to unlock'),
    owner: z.string().describe('Lock owner who locked the tab'),
  },
  async ({ tab_id, owner }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/tab/unlock', { method: 'POST', body: { tabId: tab_id, owner } });
      if (!res.ok) throw new Error(`Unlock tab failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── Browser State Management ───
// ═══════════════════════════════════════════

server.tool(
  'qa_cookies',
  'Get or set cookies for a URL. Use to manage auth tokens, session cookies, or test cookie-dependent behavior.',
  {
    url: z.string().describe('URL to get/set cookies for'),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
    })).optional().describe('Cookies to set (omit to just read current cookies)'),
  },
  async ({ url, cookies }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const body: Record<string, unknown> = { url };
      if (cookies) body.cookies = cookies;
      const res = await pinchtabFetch('/cookies', { method: 'POST', body });
      if (!res.ok) throw new Error(`Cookie operation failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_storage',
  'Access browser storage (localStorage, sessionStorage) for a URL. Use to inspect or verify app state.',
  {
    url: z.string().describe('URL context for storage access'),
    type: z.enum(['localStorage', 'sessionStorage']).optional().describe('Storage type (default: localStorage)'),
  },
  async ({ url, type }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const body: Record<string, unknown> = { url };
      if (type) body.type = type;
      const res = await pinchtabFetch('/storage', { method: 'POST', body });
      if (!res.ok) throw new Error(`Storage access failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── Instance & Profile Management ───
// ═══════════════════════════════════════════

server.tool(
  'qa_health',
  'Get detailed PinchTab server health status including uptime, instance count, and version',
  {},
  async () => {
    try {
      const res = await pinchtabFetch('/health', { timeout: 5000 });
      if (!res.ok) return errorResult('PinchTab not running');
      const data = await res.json();
      return textResult(data);
    } catch {
      return errorResult('PinchTab not reachable');
    }
  },
);

server.tool(
  'qa_list_instances',
  'List all running browser instances',
  {},
  async () => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/instances');
      if (!res.ok) throw new Error(`List instances failed: ${res.status}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'qa_list_profiles',
  'List all browser profiles with their details (accounts, size, last used)',
  {},
  async () => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    try {
      const res = await pinchtabFetch('/profiles');
      if (!res.ok) throw new Error(`List profiles failed: ${res.status}`);
      const data = await res.json();
      return textResult(data);
    } catch (err) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── Observability Tools (CDP State File) ───
// ═══════════════════════════════════════════

server.tool(
  'qa_console_logs',
  'Get captured browser console output',
  {
    limit: z.number().optional().describe('Max entries to return (default all)'),
    since_last_call: z.boolean().optional().describe('Only return entries since last call'),
    level: z.enum(['log', 'warn', 'error', 'info']).optional().describe('Filter by log level'),
  },
  async ({ limit, since_last_call, level }) => {
    const state = readCdpState();
    let logs = state.console as Array<{ level: string; message: string; timestamp: number }>;
    if (since_last_call) {
      logs = logs.filter(l => l.timestamp > lastConsoleRead);
    }
    if (level) {
      logs = logs.filter(l => l.level === level);
    }
    if (limit) logs = logs.slice(-limit);
    lastConsoleRead = Date.now();
    return textResult({ logs, count: logs.length });
  },
);

server.tool(
  'qa_network_requests',
  'Get captured network requests',
  {
    limit: z.number().optional().describe('Max entries to return'),
    since_last_call: z.boolean().optional().describe('Only return entries since last call'),
    failed_only: z.boolean().optional().describe('Only show failed requests'),
    url_pattern: z.string().optional().describe('Filter by URL substring (e.g. "/api/", "graphql")'),
  },
  async ({ limit, since_last_call, failed_only, url_pattern }) => {
    const state = readCdpState();
    let requests = state.network as Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string; timestamp?: number }>;
    if (since_last_call) {
      requests = requests.filter(r => (r.timestamp ?? 0) > lastNetworkRead);
    }
    if (failed_only) {
      requests = requests.filter(r => r.failed || r.status >= 400);
    }
    if (url_pattern) {
      requests = requests.filter(r => r.url.includes(url_pattern));
    }
    if (limit) requests = requests.slice(-limit);
    lastNetworkRead = Date.now();
    return textResult({ requests, count: requests.length });
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
    return textResult({ errors, count: errors.length });
  },
);

// ═══════════════════════════════════════════
// ─── Smart Waiting Tools ───
// ═══════════════════════════════════════════

server.tool(
  'qa_wait_for_element',
  'Wait until a CSS selector matches an element on the page. Polls the accessibility snapshot. Returns the matched element or times out.',
  {
    selector: z.string().describe('CSS selector to wait for (e.g. "#results", ".loaded", "[data-testid=submit]")'),
    timeout_ms: z.number().optional().describe('Max wait time in ms (default 10000)'),
    poll_ms: z.number().optional().describe('Poll interval in ms (default 500)'),
  },
  async ({ selector, timeout_ms, poll_ms }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    const timeout = timeout_ms ?? 10_000;
    const poll = poll_ms ?? 500;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const res = await pinchtabFetch('/snapshot', { query: { selector } });
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          const nodes = data.nodes as Array<Record<string, unknown>> | undefined;
          if (nodes && nodes.length > 0) {
            return textResult({ found: true, element: nodes[0], matchCount: nodes.length, waitedMs: timeout - (deadline - Date.now()) });
          }
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, poll));
    }
    return textResult({ found: false, selector, timedOut: true, waitedMs: timeout });
  },
);

server.tool(
  'qa_wait_for_network_idle',
  'Wait until no network requests are in-flight for a specified duration. Useful after navigation or form submission.',
  {
    idle_ms: z.number().optional().describe('How long network must be idle to consider it settled (default 1000)'),
    timeout_ms: z.number().optional().describe('Max wait time in ms (default 15000)'),
  },
  async ({ idle_ms, timeout_ms }) => {
    const idleThreshold = idle_ms ?? 1000;
    const timeout = timeout_ms ?? 15_000;
    const deadline = Date.now() + timeout;
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      const state = readCdpState();
      if (state.updatedAt > lastActivityTime) {
        lastActivityTime = state.updatedAt;
      }
      const silentFor = Date.now() - lastActivityTime;
      if (silentFor >= idleThreshold) {
        return textResult({ idle: true, silentForMs: silentFor, waitedMs: timeout - (deadline - Date.now()) });
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return textResult({ idle: false, timedOut: true, waitedMs: timeout });
  },
);

// ═══════════════════════════════════════════
// ─── Compound / Power Tools ───
// ═══════════════════════════════════════════

server.tool(
  'qa_assert_element',
  'Assert that an element matching a selector exists (or does not exist) and optionally check its text content. Returns pass/fail with details.',
  {
    selector: z.string().describe('CSS selector to check'),
    should_exist: z.boolean().optional().describe('Assert element should exist (default true) or should NOT exist (false)'),
    expected_text: z.string().optional().describe('Assert element contains this text (substring match)'),
    timeout_ms: z.number().optional().describe('Wait up to this many ms for the assertion to pass (default 5000)'),
  },
  async ({ selector, should_exist, expected_text, timeout_ms }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    const expect_exists = should_exist !== false;
    const timeout = timeout_ms ?? 5000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const res = await pinchtabFetch('/snapshot', { query: { selector } });
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          const nodes = data.nodes as Array<Record<string, unknown>> | undefined;
          const found = nodes && nodes.length > 0;

          if (expect_exists && found) {
            if (expected_text) {
              const name = (nodes![0].name ?? '') as string;
              if (name.includes(expected_text)) {
                return textResult({ pass: true, assertion: 'element exists with expected text', selector, text: name });
              }
              // text doesn't match yet, keep polling
            } else {
              return textResult({ pass: true, assertion: 'element exists', selector, matchCount: nodes!.length });
            }
          } else if (!expect_exists && !found) {
            return textResult({ pass: true, assertion: 'element does not exist', selector });
          }
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 300));
    }

    // Timed out — assertion failed
    const failMsg = expect_exists
      ? `Element "${selector}" was not found within ${timeout}ms`
      : `Element "${selector}" still exists after ${timeout}ms`;
    return textResult({ pass: false, assertion: failMsg, selector, timedOut: true });
  },
);

server.tool(
  'qa_batch_actions',
  'Execute multiple browser actions in sequence. Each action is { kind, ref?, selector?, value?, key? }. Stops on first failure. Much faster than individual tool calls.',
  {
    actions: z.array(z.object({
      kind: z.enum(['click', 'fill', 'type', 'press', 'scroll', 'hover', 'focus', 'select']),
      ref: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().optional(),
      key: z.string().optional(),
      delay_ms: z.number().optional().describe('Delay after this action in ms'),
    })).describe('Array of actions to execute in order'),
  },
  async ({ actions }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;
    const results: Array<{ index: number; kind: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      try {
        const body: Record<string, unknown> = { kind: action.kind };
        if (action.ref) body.ref = action.ref;
        if (action.selector) body.selector = action.selector;
        if (action.value) body.value = action.value;
        if (action.key) body.key = action.key;

        const res = await pinchtabFetch('/action', { method: 'POST', body });
        if (!res.ok) {
          const errText = await res.text();
          results.push({ index: i, kind: action.kind, success: false, error: errText });
          break; // stop on failure
        }
        results.push({ index: i, kind: action.kind, success: true });

        if (action.delay_ms) {
          await new Promise(r => setTimeout(r, action.delay_ms));
        }
      } catch (err) {
        results.push({ index: i, kind: action.kind, success: false, error: (err as Error).message });
        break;
      }
    }

    const allPassed = results.length === actions.length && results.every(r => r.success);
    return textResult({ allPassed, completed: results.length, total: actions.length, results });
  },
);

server.tool(
  'qa_run_test_flow',
  'Run a complete test check: navigate, wait, snapshot, screenshot, collect console/network/errors. Call this after making UI changes.',
  {
    url: z.string().describe('URL to test (e.g., http://localhost:5199)'),
    wait_for_network_idle: z.boolean().optional().describe('Wait for network idle before capturing (default true)'),
  },
  async ({ url, wait_for_network_idle }) => {
    if (!(await checkPinchtab())) return NOT_RUNNING;

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

// ═══════════════════════════════════════════
// ─── QA Finish Tool (sends results to Zeus) ───
// ═══════════════════════════════════════════

function sendFinishToZeus(summary: string, status: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!QA_AGENT_ID) {
      console.error('[zeus-qa] No ZEUS_QA_AGENT_ID — cannot send finish signal');
      resolve(); // Don't block the agent
      return;
    }

    const finishWs = new WebSocket(ZEUS_WS_URL);
    const timer = setTimeout(() => {
      try { finishWs.close(); } catch { /* ignore */ }
      console.error('[zeus-qa] Timeout connecting to Zeus for qa_finish');
      resolve(); // Don't block the agent
    }, 5000);

    finishWs.on('open', () => {
      clearTimeout(timer);
      const envelope = {
        channel: 'qa',
        sessionId: '',
        auth: '',
        payload: {
          type: 'qa_agent_finish',
          qaAgentId: QA_AGENT_ID,
          summary,
          status,
        },
      };
      finishWs.send(JSON.stringify(envelope), () => {
        // Give Zeus a moment to process before closing
        setTimeout(() => {
          try { finishWs.close(); } catch { /* ignore */ }
          resolve();
        }, 200);
      });
    });

    finishWs.on('error', (err) => {
      clearTimeout(timer);
      console.error('[zeus-qa] WebSocket error sending finish:', err.message);
      resolve(); // Don't block the agent
    });
  });
}

server.tool(
  'qa_finish',
  'REQUIRED: Call this tool when you are done testing. Sends your findings back to the parent agent that spawned you. You MUST call this before ending your session — without it, the parent agent will timeout waiting for your results.',
  {
    summary: z.string().describe('Your complete test findings: what was tested, what passed, what failed, and any bugs found. Be thorough but concise.'),
    status: z.enum(['pass', 'fail', 'warning']).describe('Overall test result: pass (all good), fail (bugs found), warning (minor issues)'),
  },
  async ({ summary, status }) => {
    try {
      await sendFinishToZeus(summary, status);
      return textResult({
        success: true,
        message: 'Findings sent to parent agent. You can stop now.',
      });
    } catch (err) {
      return errorResult(`Failed to send finish signal: ${(err as Error).message}`);
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
