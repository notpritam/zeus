// src/main/mcp/zeus-room.ts
// MCP server for Agent Room participants — exposes room tools to spawned agents.
// Each agent process gets its own instance with role-based tool access.
// Connects to Zeus via WebSocket and proxies tool calls through the 'room' channel.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

// ─── Environment ───

const ZEUS_WS_URL = process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:8888';
const ROOM_ID = process.env.ZEUS_ROOM_ID ?? '';
const AGENT_ID = process.env.ZEUS_AGENT_ID ?? '';
const AGENT_ROLE = process.env.ZEUS_AGENT_ROLE ?? 'worker'; // 'pm' or 'worker'

if (!ROOM_ID || !AGENT_ID) {
  console.error('[zeus-room] ZEUS_ROOM_ID and ZEUS_AGENT_ID must be set');
  process.exit(1);
}

console.error(`[zeus-room] Starting: room=${ROOM_ID}, agent=${AGENT_ID}, role=${AGENT_ROLE}`);

// ─── WebSocket Client ───

let ws: WebSocket | null = null;
let wsReady = false;
let messageIdCounter = 0;
const pendingResponses = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (err: Error) => void }
>();

function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && wsReady) {
      resolve();
      return;
    }

    ws = new WebSocket(ZEUS_WS_URL);

    ws.on('open', () => {
      wsReady = true;
      console.error('[zeus-room] Connected to Zeus WebSocket');
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString());
        if (envelope.payload?.responseId) {
          const hasPending = pendingResponses.has(envelope.payload.responseId);
          console.error(
            `[zeus-room] Received response: responseId=${envelope.payload.responseId}, hasPending=${hasPending}, type=${envelope.payload?.type}`
          );
          if (hasPending) {
            const pending = pendingResponses.get(envelope.payload.responseId)!;
            pendingResponses.delete(envelope.payload.responseId);
            pending.resolve(envelope.payload);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      wsReady = false;
      ws = null;
      console.error('[zeus-room] Disconnected from Zeus WebSocket');
    });

    ws.on('error', (err) => {
      console.error('[zeus-room] WebSocket error:', err.message);
      if (!wsReady) reject(err);
    });
  });
}

function sendRoomAction(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || !wsReady) {
      reject(new Error('Not connected to Zeus WebSocket'));
      return;
    }

    const responseId = `room-${++messageIdCounter}-${Date.now()}`;
    console.error(
      `[zeus-room] sendRoomAction: tool=${toolName}, responseId=${responseId}`
    );

    const timer = setTimeout(() => {
      pendingResponses.delete(responseId);
      console.error(
        `[zeus-room] sendRoomAction TIMEOUT: responseId=${responseId}, tool=${toolName}`
      );
      reject(new Error(`Timeout waiting for Zeus response (tool: ${toolName})`));
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

    const envelope = {
      channel: 'room',
      sessionId: ROOM_ID,
      auth: '',
      payload: {
        type: toolName,
        agentId: AGENT_ID,
        roomId: ROOM_ID,
        responseId,
        ...args,
      },
    };

    ws.send(JSON.stringify(envelope));
  });
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
  };
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

// ─── MCP Server ───

const server = new McpServer({
  name: 'zeus-room',
  version: '1.0.0',
});

// ═══════════════════════════════════════════
// ─── Worker Tools (all agents) ───
// ═══════════════════════════════════════════

server.tool(
  'room_post_message',
  'Post a message to the room for other agents (and the PM) to read.',
  {
    message: z.string().describe('The message content'),
    type: z
      .enum(['directive', 'finding', 'question', 'status_update', 'error'])
      .optional()
      .describe('Message type classification'),
    to: z.string().optional().describe('Target agentId for directed messages'),
  },
  async ({ message, type, to }) => {
    try {
      await connectWs();
      const response = await sendRoomAction('room_post_message', {
        message,
        ...(type ? { messageType: type } : {}),
        ...(to ? { to } : {}),
      });
      return textResult(response);
    } catch (err) {
      return errorResult(`Failed to post message: ${(err as Error).message}`);
    }
  }
);

server.tool(
  'room_read_messages',
  'Read new messages from the room. Returns messages since the given timestamp.',
  {
    since: z
      .number()
      .optional()
      .describe('Unix timestamp (ms) — only return messages after this time'),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of messages to return (default: 50)'),
  },
  async ({ since, limit }) => {
    try {
      await connectWs();
      const response = await sendRoomAction('room_read_messages', {
        ...(since !== undefined ? { since } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return textResult(response);
    } catch (err) {
      return errorResult(`Failed to read messages: ${(err as Error).message}`);
    }
  }
);

server.tool(
  'room_list_agents',
  'List all agents in this room with their current statuses.',
  {},
  async () => {
    try {
      await connectWs();
      const response = await sendRoomAction('room_list_agents', {});
      return textResult(response);
    } catch (err) {
      return errorResult(`Failed to list agents: ${(err as Error).message}`);
    }
  }
);

server.tool(
  'room_get_agent_state',
  'Get detailed state for a specific agent in this room.',
  {
    agentId: z.string().describe('The agent ID to query'),
  },
  async ({ agentId: targetAgentId }) => {
    try {
      await connectWs();
      const response = await sendRoomAction('room_get_agent_state', {
        targetAgentId,
      });
      return textResult(response);
    } catch (err) {
      return errorResult(`Failed to get agent state: ${(err as Error).message}`);
    }
  }
);

server.tool(
  'room_signal_done',
  'Signal that this agent has completed its assigned task.',
  {
    summary: z.string().describe('Summary of what was accomplished'),
  },
  async ({ summary }) => {
    try {
      await connectWs();
      const response = await sendRoomAction('room_signal_done', { summary });
      return textResult(response);
    } catch (err) {
      return errorResult(`Failed to signal done: ${(err as Error).message}`);
    }
  }
);

// ═══════════════════════════════════════════
// ─── PM-Only Tools ───
// ═══════════════════════════════════════════

if (AGENT_ROLE === 'pm') {
  server.tool(
    'room_spawn_agent',
    'Spawn a new worker agent in this room.',
    {
      role: z.string().describe('Role for the new agent (e.g. "worker", "reviewer")'),
      prompt: z.string().describe('The task prompt / instructions for the agent'),
      model: z.string().optional().describe('Model to use (e.g. "claude-sonnet-4-20250514")'),
      roomAware: z
        .boolean()
        .optional()
        .describe('Whether the agent gets room MCP tools (default: true)'),
      permissionMode: z
        .string()
        .optional()
        .describe('Permission mode for the agent CLI'),
      workingDir: z
        .string()
        .optional()
        .describe('Working directory for the agent'),
    },
    async ({ role, prompt, model, roomAware, permissionMode, workingDir }) => {
      try {
        await connectWs();
        const response = await sendRoomAction(
          'room_spawn_agent',
          {
            role,
            prompt,
            ...(model ? { model } : {}),
            ...(roomAware !== undefined ? { roomAware } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(workingDir ? { workingDir } : {}),
          },
          60_000
        );
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to spawn agent: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_dismiss_agent',
    'Dismiss (terminate) an agent in this room.',
    {
      agentId: z.string().describe('The agent ID to dismiss'),
    },
    async ({ agentId: targetAgentId }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_dismiss_agent', {
          targetAgentId,
        });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to dismiss agent: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_pause_agent',
    'Pause an agent in this room.',
    {
      agentId: z.string().describe('The agent ID to pause'),
    },
    async ({ agentId: targetAgentId }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_pause_agent', {
          targetAgentId,
        });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to pause agent: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_resume_agent',
    'Resume a paused agent in this room.',
    {
      agentId: z.string().describe('The agent ID to resume'),
    },
    async ({ agentId: targetAgentId }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_resume_agent', {
          targetAgentId,
        });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to resume agent: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_get_agent_log',
    'Get the conversation log of an agent in this room.',
    {
      agentId: z.string().describe('The agent ID whose log to retrieve'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of log entries to return'),
    },
    async ({ agentId: targetAgentId, limit }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_get_agent_log', {
          targetAgentId,
          ...(limit !== undefined ? { limit } : {}),
        });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to get agent log: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_replace_pm',
    'Replace this PM session with a new one (e.g. different model or prompt).',
    {
      newModel: z.string().optional().describe('New model to use for the PM'),
      newPrompt: z.string().optional().describe('New prompt / instructions for the PM'),
    },
    async ({ newModel, newPrompt }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_replace_pm', {
          ...(newModel ? { newModel } : {}),
          ...(newPrompt ? { newPrompt } : {}),
        });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to replace PM: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    'room_complete',
    'Mark this room as complete. All agents will be dismissed.',
    {
      summary: z.string().describe('Final summary of what the room accomplished'),
    },
    async ({ summary }) => {
      try {
        await connectWs();
        const response = await sendRoomAction('room_complete', { summary });
        return textResult(response);
      } catch (err) {
        return errorResult(`Failed to complete room: ${(err as Error).message}`);
      }
    }
  );
}

// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[zeus-room] MCP server started on stdio (room=${ROOM_ID}, agent=${AGENT_ID}, role=${AGENT_ROLE})`
  );
}

main().catch((err) => {
  console.error('[zeus-room] Fatal error:', err);
  process.exit(1);
});
