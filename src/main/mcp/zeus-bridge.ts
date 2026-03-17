// src/main/mcp/zeus-bridge.ts
// Standalone MCP server — connects to Zeus WebSocket to register QA sessions,
// manage Claude sessions, and control PinchTab in real-time.
// Used by the Claude Code qa-tester subagent.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

const ZEUS_WS_URL = process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:3000';

// ─── WebSocket Client ───

let ws: WebSocket | null = null;
let wsReady = false;
let messageIdCounter = 0;
const pendingResponses = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && wsReady) {
      resolve();
      return;
    }

    ws = new WebSocket(ZEUS_WS_URL);

    ws.on('open', () => {
      wsReady = true;
      console.error('[zeus-bridge] Connected to Zeus WebSocket');
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString());
        // Check if this is a response to one of our requests
        if (envelope.payload?.responseId && pendingResponses.has(envelope.payload.responseId)) {
          const pending = pendingResponses.get(envelope.payload.responseId)!;
          pendingResponses.delete(envelope.payload.responseId);
          pending.resolve(envelope.payload);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      wsReady = false;
      ws = null;
      console.error('[zeus-bridge] Disconnected from Zeus WebSocket');
    });

    ws.on('error', (err) => {
      console.error('[zeus-bridge] WebSocket error:', err.message);
      if (!wsReady) reject(err);
    });
  });
}

function sendToZeus(channel: string, payload: Record<string, unknown>, sessionId = ''): void {
  if (!ws || !wsReady) {
    throw new Error('Not connected to Zeus WebSocket');
  }
  const envelope = {
    channel,
    sessionId,
    auth: '',
    payload,
  };
  ws.send(JSON.stringify(envelope));
}

function sendAndWait(channel: string, payload: Record<string, unknown>, timeoutMs = 10_000, sessionId = ''): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const responseId = `bridge-${++messageIdCounter}-${Date.now()}`;
    payload.responseId = responseId;

    const timer = setTimeout(() => {
      pendingResponses.delete(responseId);
      reject(new Error('Timeout waiting for Zeus response'));
    }, timeoutMs);

    pendingResponses.set(responseId, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    sendToZeus(channel, payload, sessionId);
  });
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

// ─── MCP Server ───

const server = new McpServer({
  name: 'zeus-bridge',
  version: '2.0.0',
});

// ═══════════════════════════════════════════
// ─── Claude Session Lifecycle ───
// ═══════════════════════════════════════════

server.tool(
  'zeus_session_start',
  'Create a new Claude session in Zeus that appears in the sidebar with real-time updates. Call this FIRST before doing any work. Returns a sessionId.',
  {
    name: z.string().describe('Display name for this session (e.g. "QA: Login Flow")'),
    prompt: z.string().describe('The task description / initial prompt'),
    working_dir: z.string().optional().describe('Working directory path'),
  },
  async ({ name, prompt, working_dir }) => {
    try {
      await connectWs();
      const response = await sendAndWait('claude', {
        type: 'register_external_session',
        name,
        prompt,
        workingDir: working_dir ?? process.cwd(),
      });
      const data = response as Record<string, unknown>;
      return textResult({
        success: true,
        sessionId: data.sessionId,
        message: 'Session created in Zeus UI. Use this sessionId in all subsequent zeus_session_* calls.',
      });
    } catch (err) {
      return errorResult(`Failed to create session: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_session_entry',
  'Add an entry to a Zeus session. Entries appear in the chat view in real-time.',
  {
    session_id: z.string().describe('The sessionId from zeus_session_start'),
    type: z.enum(['assistant_message', 'tool_use', 'thinking', 'system_message', 'error_message']).describe('Entry type'),
    content: z.string().describe('Entry content text'),
    tool_name: z.string().optional().describe('Tool name (for tool_use entries)'),
    tool_status: z.enum(['created', 'success', 'failed']).optional().describe('Tool status (for tool_use entries)'),
    action_type: z.string().optional().describe('Action type: file_read, file_edit, command_run, search, web_fetch, other'),
    action_detail: z.string().optional().describe('Action detail (path, command, query, etc.)'),
  },
  async ({ session_id, type, content, tool_name, tool_status, action_type, action_detail }) => {
    try {
      await connectWs();
      const entryId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timestamp = new Date().toISOString();

      let entryType: Record<string, unknown>;
      switch (type) {
        case 'assistant_message':
          entryType = { type: 'assistant_message' };
          break;
        case 'tool_use': {
          const actionObj = buildActionType(action_type ?? 'other', action_detail ?? tool_name ?? '');
          entryType = {
            type: 'tool_use',
            toolName: tool_name ?? 'unknown',
            actionType: actionObj,
            status: tool_status ?? 'success',
          };
          break;
        }
        case 'thinking':
          entryType = { type: 'thinking' };
          break;
        case 'system_message':
          entryType = { type: 'system_message' };
          break;
        case 'error_message':
          entryType = { type: 'error_message', errorType: 'other' };
          break;
        default:
          entryType = { type: 'assistant_message' };
      }

      sendToZeus('claude', {
        type: 'external_session_entry',
        sessionId: session_id,
        entry: { id: entryId, timestamp, entryType, content },
      }, session_id);

      return textResult({ success: true, entryId });
    } catch (err) {
      return errorResult(`Failed to add entry: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_session_activity',
  'Update the activity state of a Zeus session (shown as live indicator in the UI).',
  {
    session_id: z.string().describe('The sessionId from zeus_session_start'),
    state: z.enum(['idle', 'thinking', 'streaming', 'tool_running', 'starting']).describe('Activity state'),
    tool_name: z.string().optional().describe('Tool name (required for tool_running)'),
    description: z.string().optional().describe('Description (for tool_running)'),
  },
  async ({ session_id, state, tool_name, description }) => {
    try {
      await connectWs();

      let activity: Record<string, unknown>;
      if (state === 'tool_running') {
        activity = { state, toolName: tool_name ?? 'unknown', description: description ?? tool_name ?? '' };
      } else {
        activity = { state };
      }

      sendToZeus('claude', {
        type: 'external_session_activity',
        sessionId: session_id,
        activity,
      }, session_id);

      return textResult({ success: true });
    } catch (err) {
      return errorResult(`Failed to update activity: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_session_end',
  'End a Zeus session. Marks it as done or error in the UI.',
  {
    session_id: z.string().describe('The sessionId from zeus_session_start'),
    status: z.enum(['done', 'error']).optional().describe('Final status (default: done)'),
    summary: z.string().optional().describe('Final summary message to add before closing'),
  },
  async ({ session_id, status, summary }) => {
    try {
      await connectWs();

      // Add final summary as assistant message if provided
      if (summary) {
        const entryId = `ext-summary-${Date.now()}`;
        sendToZeus('claude', {
          type: 'external_session_entry',
          sessionId: session_id,
          entry: {
            id: entryId,
            timestamp: new Date().toISOString(),
            entryType: { type: 'assistant_message' },
            content: summary,
          },
        }, session_id);
      }

      sendToZeus('claude', {
        type: 'external_session_done',
        sessionId: session_id,
        status: status ?? 'done',
      }, session_id);

      return textResult({ success: true, message: `Session ended with status: ${status ?? 'done'}` });
    } catch (err) {
      return errorResult(`Failed to end session: ${(err as Error).message}`);
    }
  },
);

// ═══════════════════════════════════════════
// ─── QA Agent Lifecycle ───
// ═══════════════════════════════════════════

server.tool(
  'zeus_qa_start',
  'Register a new QA testing session with Zeus. Call this FIRST before any testing. Returns a qaAgentId that you must pass to all subsequent zeus_qa_* calls.',
  {
    task: z.string().describe('Description of what you are testing'),
    target_url: z.string().optional().describe('URL being tested (default: http://localhost:5173)'),
    parent_session_id: z.string().optional().describe('Parent claude session ID if known'),
    name: z.string().optional().describe('Display name for this QA session'),
  },
  async ({ task, target_url, parent_session_id, name }) => {
    try {
      await connectWs();
      const response = await sendAndWait('qa', {
        type: 'register_external_qa',
        task,
        targetUrl: target_url ?? 'http://localhost:5173',
        parentSessionId: parent_session_id ?? 'external',
        parentSessionType: 'claude',
        name: name ?? undefined,
      });
      const data = response as Record<string, unknown>;
      return textResult({
        success: true,
        qaAgentId: data.qaAgentId,
        message: 'QA session registered. Use this qaAgentId in all subsequent zeus_qa_* calls.',
      });
    } catch (err) {
      return errorResult(`Failed to register QA session: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_qa_log',
  'Log a QA entry to Zeus for real-time UI display. Call this after each significant action (tool call, finding, observation).',
  {
    qa_agent_id: z.string().describe('The qaAgentId from zeus_qa_start'),
    kind: z.enum(['text', 'thinking', 'tool_call', 'tool_result', 'error', 'status']).describe('Entry type'),
    content: z.string().optional().describe('Text content (for text/thinking/error/status entries)'),
    tool: z.string().optional().describe('Tool name (for tool_call/tool_result entries)'),
    args: z.string().optional().describe('Tool arguments summary (for tool_call entries)'),
    summary: z.string().optional().describe('Tool result summary (for tool_result entries)'),
    success: z.boolean().optional().describe('Whether the tool call succeeded (for tool_result entries)'),
  },
  async ({ qa_agent_id, kind, content, tool, args, summary, success }) => {
    try {
      await connectWs();

      let entry: Record<string, unknown>;
      const timestamp = Date.now();

      switch (kind) {
        case 'text':
          entry = { kind: 'text', content: content ?? '', timestamp };
          break;
        case 'thinking':
          entry = { kind: 'thinking', content: (content ?? '').slice(0, 300), timestamp };
          break;
        case 'tool_call':
          entry = { kind: 'tool_call', tool: tool ?? 'unknown', args: args ?? '', timestamp };
          break;
        case 'tool_result':
          entry = { kind: 'tool_result', tool: tool ?? 'unknown', summary: summary ?? '', success: success ?? true, timestamp };
          break;
        case 'error':
          entry = { kind: 'error', message: content ?? 'Unknown error', timestamp };
          break;
        case 'status':
          entry = { kind: 'status', message: content ?? '', timestamp };
          break;
        default:
          entry = { kind: 'text', content: content ?? '', timestamp };
      }

      sendToZeus('qa', {
        type: 'external_qa_entry',
        qaAgentId: qa_agent_id,
        entry,
      });

      return textResult({ success: true });
    } catch (err) {
      return errorResult(`Failed to log entry: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_qa_end',
  'End a QA session. Call this when testing is complete.',
  {
    qa_agent_id: z.string().describe('The qaAgentId from zeus_qa_start'),
    status: z.enum(['stopped', 'done', 'error']).optional().describe('Final status (default: stopped)'),
    summary: z.string().optional().describe('Final test summary/report'),
  },
  async ({ qa_agent_id, status, summary }) => {
    try {
      await connectWs();

      // Log final summary if provided
      if (summary) {
        sendToZeus('qa', {
          type: 'external_qa_entry',
          qaAgentId: qa_agent_id,
          entry: { kind: 'text', content: summary, timestamp: Date.now() },
        });
      }

      sendToZeus('qa', {
        type: 'external_qa_done',
        qaAgentId: qa_agent_id,
        status: status ?? 'stopped',
      });

      return textResult({ success: true, message: `QA session ${qa_agent_id} ended with status: ${status ?? 'stopped'}` });
    } catch (err) {
      return errorResult(`Failed to end QA session: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_qa_status',
  'Check connection status to Zeus and PinchTab',
  {},
  async () => {
    try {
      await connectWs();
      const response = await sendAndWait('qa', { type: 'get_qa_status' });
      const data = response as Record<string, unknown>;
      return textResult({
        connected: true,
        url: ZEUS_WS_URL,
        pinchtab: {
          running: data.running ?? false,
          instances: data.instances ?? [],
        },
      });
    } catch (err) {
      return textResult({ connected: false, error: (err as Error).message });
    }
  },
);

// ═══════════════════════════════════════════
// ─── PinchTab Control ───
// ═══════════════════════════════════════════

server.tool(
  'zeus_pinchtab_start',
  'Start the PinchTab server (browser automation engine). Must be running before any QA testing.',
  {},
  async () => {
    try {
      await connectWs();
      const response = await sendAndWait('qa', { type: 'start_qa' }, 15_000);
      const data = response as Record<string, unknown>;
      return textResult({
        success: true,
        running: true,
        message: data.error ? `PinchTab start issue: ${data.error}` : 'PinchTab server started successfully.',
      });
    } catch (err) {
      return errorResult(`Failed to start PinchTab: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_pinchtab_stop',
  'Stop the PinchTab server.',
  {},
  async () => {
    try {
      await connectWs();
      sendToZeus('qa', { type: 'stop_qa' });
      return textResult({ success: true, message: 'PinchTab server stopped.' });
    } catch (err) {
      return errorResult(`Failed to stop PinchTab: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_pinchtab_launch',
  'Launch a new browser instance in PinchTab.',
  {
    headless: z.boolean().optional().describe('Launch headless (default: true)'),
  },
  async ({ headless }) => {
    try {
      await connectWs();
      const response = await sendAndWait('qa', {
        type: 'launch_instance',
        headless: headless ?? true,
      }, 30_000);
      const data = response as Record<string, unknown>;
      return textResult({
        success: true,
        instance: data.instance ?? data,
        message: 'Browser instance launched.',
      });
    } catch (err) {
      return errorResult(`Failed to launch instance: ${(err as Error).message}`);
    }
  },
);

server.tool(
  'zeus_pinchtab_instances',
  'List running PinchTab browser instances.',
  {},
  async () => {
    try {
      await connectWs();
      const response = await sendAndWait('qa', { type: 'get_qa_status' });
      const data = response as Record<string, unknown>;
      return textResult({
        running: data.running ?? false,
        instances: data.instances ?? [],
      });
    } catch (err) {
      return errorResult(`Failed to list instances: ${(err as Error).message}`);
    }
  },
);

// ─── Helpers ───

function buildActionType(action: string, detail: string): Record<string, unknown> {
  switch (action) {
    case 'file_read':
      return { action: 'file_read', path: detail };
    case 'file_edit':
      return { action: 'file_edit', path: detail };
    case 'command_run':
      return { action: 'command_run', command: detail };
    case 'search':
      return { action: 'search', query: detail };
    case 'web_fetch':
      return { action: 'web_fetch', url: detail };
    case 'task_create':
      return { action: 'task_create', description: detail };
    default:
      return { action: 'other', description: detail };
  }
}

// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[zeus-bridge] MCP server started on stdio');
}

main().catch((err) => {
  console.error('[zeus-bridge] Fatal error:', err);
  process.exit(1);
});
