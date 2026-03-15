import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WsEnvelope,
  TerminalInputPayload,
  TerminalResizePayload,
  StartSessionPayload,
} from '../types';
import { createSession, writeToSession, resizeSession, destroySession } from './terminal';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Track which sessions belong to which client
const clientSessions = new Map<WebSocket, Set<string>>();

function sendEnvelope(ws: WebSocket, envelope: WsEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
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

function handleControl(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'start_session') {
    const opts = envelope.payload as StartSessionPayload;
    const { sessionId, shell } = createSession(
      { cols: opts.cols, rows: opts.rows },
      (sid, data) => {
        sendEnvelope(ws, {
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'output', data },
          auth: '',
        });
      },
      (sid, code) => {
        sendEnvelope(ws, {
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'exit', code },
          auth: '',
        });
        const owned = clientSessions.get(ws);
        if (owned) owned.delete(sid);
      },
    );

    // Track ownership
    if (!clientSessions.has(ws)) clientSessions.set(ws, new Set());
    clientSessions.get(ws)!.add(sessionId);

    sendEnvelope(ws, {
      channel: 'control',
      sessionId,
      payload: { type: 'session_started', sessionId, shell },
      auth: '',
    });
  } else if (payload.type === 'stop_session') {
    const sid = envelope.sessionId;
    destroySession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
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
    case 'git':
    case 'qa':
      sendError(ws, envelope.sessionId, `Channel "${envelope.channel}" not yet implemented`);
      break;
    default:
      sendError(ws, envelope.sessionId, `Unknown channel: ${envelope.channel}`);
  }
}

function handleClose(ws: WebSocket): void {
  const owned = clientSessions.get(ws);
  if (owned) {
    for (const sid of owned) {
      destroySession(sid);
    }
    clientSessions.delete(ws);
  }
}

export async function startWebSocketServer(port = 3000): Promise<void> {
  if (server) return;

  return new Promise((resolve, reject) => {
    const httpServer = http.createServer();
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
      console.log(`[Zeus] WebSocket server listening on 127.0.0.1:${port}`);
      resolve();
    });
  });
}

export async function stopWebSocketServer(): Promise<void> {
  if (!wss || !server) return;

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
        console.log('[Zeus] WebSocket server stopped');
        resolve();
      });
    });
  });
}

export function isWebSocketRunning(): boolean {
  return server !== null && server.listening;
}
