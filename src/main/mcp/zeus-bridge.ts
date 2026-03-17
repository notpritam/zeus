// src/main/mcp/zeus-bridge.ts
// Standalone MCP server — connects to Zeus WebSocket to register QA sessions
// and stream entries in real-time. Used by the Claude Code qa-tester subagent.

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

function sendToZeus(channel: string, payload: Record<string, unknown>): void {
  if (!ws || !wsReady) {
    throw new Error('Not connected to Zeus WebSocket');
  }
  const envelope = {
    channel,
    sessionId: '',
    auth: '',
    payload,
  };
  ws.send(JSON.stringify(envelope));
}

function sendAndWait(channel: string, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
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

    sendToZeus(channel, payload);
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
  version: '1.0.0',
});

// ═══════════════════════════════════════════
// ─── Session Lifecycle ───
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
  'Check connection status to Zeus',
  {},
  async () => {
    try {
      await connectWs();
      return textResult({ connected: true, url: ZEUS_WS_URL });
    } catch (err) {
      return textResult({ connected: false, error: (err as Error).message });
    }
  },
);

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
