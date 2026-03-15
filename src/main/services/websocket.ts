import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import type {
  WsEnvelope,
  TerminalInputPayload,
  TerminalResizePayload,
  StartSessionPayload,
  StatusPayload,
  ClaudeStartPayload,
  ClaudeResumePayload,
  ClaudeSendMessagePayload,
  ClaudeApproveToolPayload,
  ClaudeDenyToolPayload,
} from '../types';
import { createSession, writeToSession, resizeSession, destroySession } from './terminal';
import { registerSession, markExited, markKilled, getSession, getAllSessions } from './sessions';
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from './power';
import { ClaudeSessionManager, ClaudeSession } from './claude-session';
import type { NormalizedEntry } from './claude-types';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Track which sessions belong to which client
const clientSessions = new Map<WebSocket, Set<string>>();

// Claude session manager (shared across all WebSocket clients)
const claudeManager = new ClaudeSessionManager();

// Track which Claude session is bound to which WS client
const clientClaudeSessions = new Map<WebSocket, Set<string>>();

function sendEnvelope(ws: WebSocket, envelope: WsEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

function broadcastEnvelope(envelope: WsEnvelope): void {
  if (!wss) return;
  for (const client of wss.clients) {
    sendEnvelope(client, envelope);
  }
}

function sendError(ws: WebSocket, sessionId: string, message: string): void {
  sendEnvelope(ws, {
    channel: 'control',
    sessionId,
    payload: { type: 'error', message },
    auth: '',
  });
}

function broadcastSessionUpdated(sessionId: string): void {
  const record = getSession(sessionId);
  if (!record) return;
  broadcastEnvelope({
    channel: 'control',
    sessionId,
    payload: { type: 'session_updated', session: record },
    auth: '',
  });
}

function handleControl(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'start_session') {
    const opts = envelope.payload as StartSessionPayload;
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    const { sessionId, shell } = createSession(
      { cols, rows },
      (sid, data) => {
        // Broadcast terminal output to ALL clients (not just owner)
        broadcastEnvelope({
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'output', data },
          auth: '',
        });
      },
      (sid, code) => {
        markExited(sid, code);
        broadcastEnvelope({
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'exit', code },
          auth: '',
        });
        broadcastSessionUpdated(sid);
        const owned = clientSessions.get(ws);
        if (owned) owned.delete(sid);
      },
    );

    // Register in session registry
    const cwd = process.env.HOME ?? '/';
    registerSession(sessionId, shell, cols, rows, cwd);

    // Track ownership
    if (!clientSessions.has(ws)) clientSessions.set(ws, new Set());
    clientSessions.get(ws)!.add(sessionId);

    // Broadcast session_started to all clients
    broadcastEnvelope({
      channel: 'control',
      sessionId,
      payload: { type: 'session_started', sessionId, shell },
      auth: '',
    });

    broadcastSessionUpdated(sessionId);
  } else if (payload.type === 'stop_session') {
    const sid = envelope.sessionId;
    markKilled(sid);
    destroySession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
    broadcastSessionUpdated(sid);
  } else if (payload.type === 'list_sessions') {
    sendEnvelope(ws, {
      channel: 'control',
      sessionId: '',
      payload: { type: 'session_list', sessions: getAllSessions() },
      auth: '',
    });
  } else {
    sendError(ws, envelope.sessionId, `Unknown control type: ${payload.type}`);
  }
}

function handleTerminal(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'input') {
    const { data } = envelope.payload as TerminalInputPayload;
    try {
      writeToSession(envelope.sessionId, data);
    } catch (err) {
      sendError(ws, envelope.sessionId, (err as Error).message);
    }
  } else if (payload.type === 'resize') {
    const { cols, rows } = envelope.payload as TerminalResizePayload;
    try {
      resizeSession(envelope.sessionId, cols, rows);
    } catch (err) {
      sendError(ws, envelope.sessionId, (err as Error).message);
    }
  } else {
    sendError(ws, envelope.sessionId, `Unknown terminal type: ${payload.type}`);
  }
}

function handleStatus(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as StatusPayload;

  if (payload.type === 'get_status') {
    sendEnvelope(ws, {
      channel: 'status',
      sessionId: '',
      payload: {
        type: 'status_update',
        powerBlock: isPowerBlocked(),
        websocket: true,
        tunnel: null,
      },
      auth: '',
    });
  } else if (payload.type === 'toggle_power') {
    if (isPowerBlocked()) {
      stopPowerBlock();
    } else {
      startPowerBlock();
    }
    // Broadcast new status to all clients
    broadcastEnvelope({
      channel: 'status',
      sessionId: '',
      payload: {
        type: 'status_update',
        powerBlock: isPowerBlocked(),
        websocket: true,
        tunnel: null,
      },
      auth: '',
    });
  } else {
    sendError(ws, '', `Unknown status type: ${payload.type}`);
  }
}

function wireClaudeSession(ws: WebSocket, session: ClaudeSession, envelope: WsEnvelope): void {
  // Forward normalized entries to all clients
  session.on('entry', (entry: NormalizedEntry) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'entry', entry },
      auth: '',
    });
  });

  // Forward approval requests
  session.on('approval_needed', (approval) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'approval_needed', ...approval },
      auth: '',
    });
  });

  // Forward session ID once extracted from stream
  session.on('session_id', (id) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_id', claudeSessionId: id },
      auth: '',
    });
  });

  // Forward completion
  session.on('done', (result) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'done', result },
      auth: '',
    });
  });

  // Forward errors
  session.on('error', (err) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'error', message: err.message },
      auth: '',
    });
  });
}

async function handleClaude(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'start_claude') {
    const opts = envelope.payload as ClaudeStartPayload;
    const workingDir = opts.workingDir || process.env.HOME || '/';

    try {
      const session = await claudeManager.createSession(opts.prompt, {
        workingDir,
        permissionMode: opts.permissionMode ?? 'bypassPermissions',
        model: opts.model,
      });

      // Track ownership
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ws, session, envelope);

      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_started' },
        auth: '',
      });
    } catch (err) {
      sendError(ws, envelope.sessionId, `Failed to start Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === 'resume_claude') {
    const opts = envelope.payload as ClaudeResumePayload;
    const workingDir = opts.workingDir || process.env.HOME || '/';

    try {
      const session = await claudeManager.resumeSession(opts.claudeSessionId, opts.prompt, {
        workingDir,
      });

      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ws, session, envelope);

      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_started' },
        auth: '',
      });
    } catch (err) {
      sendError(ws, envelope.sessionId, `Failed to resume Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === 'send_message') {
    const { content } = envelope.payload as ClaudeSendMessagePayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      await session.sendMessage(content);
    } else {
      sendError(ws, envelope.sessionId, 'No active Claude session for this ID');
    }
  } else if (payload.type === 'approve_tool') {
    const { approvalId } = envelope.payload as ClaudeApproveToolPayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      await session.approveTool(approvalId);
    }
  } else if (payload.type === 'deny_tool') {
    const { approvalId, reason } = envelope.payload as ClaudeDenyToolPayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      await session.denyTool(approvalId, reason);
    }
  } else if (payload.type === 'interrupt') {
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      await session.interrupt();
    }
  } else if (payload.type === 'stop_claude') {
    claudeManager.killSession(envelope.sessionId);
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
  } else {
    sendError(ws, envelope.sessionId, `Unknown claude type: ${payload.type}`);
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  let envelope: WsEnvelope;
  try {
    envelope = JSON.parse(raw) as WsEnvelope;
  } catch {
    sendError(ws, '', 'Invalid JSON');
    return;
  }

  switch (envelope.channel) {
    case 'control':
      handleControl(ws, envelope);
      break;
    case 'terminal':
      handleTerminal(ws, envelope);
      break;
    case 'status':
      handleStatus(ws, envelope);
      break;
    case 'claude':
      handleClaude(ws, envelope);
      break;
    case 'git':
    case 'qa':
      sendError(ws, envelope.sessionId, `Channel "${envelope.channel}" not yet implemented`);
      break;
    default:
      sendError(ws, envelope.sessionId, `Unknown channel: ${envelope.channel}`);
  }
}

function handleClose(ws: WebSocket): void {
  // Clean up terminal sessions
  const owned = clientSessions.get(ws);
  if (owned) {
    for (const sid of owned) {
      markKilled(sid);
      destroySession(sid);
      broadcastSessionUpdated(sid);
    }
    clientSessions.delete(ws);
  }

  // Clean up Claude sessions
  const claudeOwned = clientClaudeSessions.get(ws);
  if (claudeOwned) {
    for (const sid of claudeOwned) {
      claudeManager.killSession(sid);
    }
    clientClaudeSessions.delete(ws);
  }
}

export async function startWebSocketServer(port = 3000): Promise<void> {
  if (server) return;

  return new Promise((resolve, reject) => {
    // Serve built renderer files (gracefully skip if dir doesn't exist — e.g. in tests)
    const clientDir = path.join(__dirname, '../renderer');
    const dirExists = fs.existsSync(clientDir);
    const serve = dirExists ? sirv(clientDir, { single: true }) : null;

    const httpServer = http.createServer((req, res) => {
      if (serve) {
        serve(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const wsServer = new WebSocketServer({ server: httpServer });

    wsServer.on('connection', (ws) => {
      console.log('[Zeus] WebSocket client connected');

      ws.on('message', (data) => handleMessage(ws, data.toString()));
      ws.on('close', () => {
        console.log('[Zeus] WebSocket client disconnected');
        handleClose(ws);
      });
    });

    httpServer.on('error', reject);

    httpServer.listen(port, '127.0.0.1', () => {
      server = httpServer;
      wss = wsServer;
      console.log(`[Zeus] Server listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

export async function stopWebSocketServer(): Promise<void> {
  if (!wss || !server) return;

  // Kill all Claude sessions
  claudeManager.killAll();

  // Close all client connections
  for (const ws of wss.clients) {
    handleClose(ws);
    ws.close();
  }

  return new Promise((resolve) => {
    wss!.close(() => {
      server!.close(() => {
        server = null;
        wss = null;
        console.log('[Zeus] Server stopped');
        resolve();
      });
    });
  });
}

export function isWebSocketRunning(): boolean {
  return server !== null && server.listening;
}
