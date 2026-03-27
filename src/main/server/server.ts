import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import sirv from "sirv";
import type { WsEnvelope } from "../../shared/protocol/envelope";
import { validateToken } from "../services/auth";
import { isPowerBlocked } from "../services/power";
import { Log } from "../log/log";
import { route } from "./router";
import { getAuthenticatedTunnelUrl } from "./handlers/status";
import { getClaudeManager } from "./handlers/claude";
import { getGitManager } from "./handlers/git";
import { getFileTreeManager } from "./handlers/files";
import { getQaService, setQaService } from "./handlers/qa";
import { getSystemMonitor, registerPidSources } from "./handlers/perf";
import { getSessionPids, destroySession } from "../services/terminal";
import { markKilled, getSession } from "../services/sessions";
import { updateTerminalSession } from "../db/queries/terminal";
import type { PerfPayload } from "../types";

const log = Log.create({ service: "server" });

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort = 8888;

// Track which sessions belong to which client
const clientSessions = new Map<WebSocket, Set<string>>();

// Track which Claude session is bound to which WS client
const clientClaudeSessions = new Map<WebSocket, Set<string>>();

// Track authenticated clients
const authenticatedClients = new WeakSet<WebSocket>();

export function getClientSessions(): Map<WebSocket, Set<string>> {
  return clientSessions;
}

export function getClientClaudeSessions(): Map<WebSocket, Set<string>> {
  return clientClaudeSessions;
}

export function getServerPort(): number {
  return serverPort;
}

export function isWebSocketRunning(): boolean {
  return server !== null && server.listening;
}

function sendEnvelope(ws: WebSocket, envelope: WsEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  } else {
    console.error(
      `[Zeus] sendEnvelope DROPPED: ws.readyState=${ws.readyState} (expected ${WebSocket.OPEN}), channel=${envelope.channel}, type=${(envelope.payload as Record<string, unknown>)?.type}`,
    );
  }
}

export function broadcastEnvelope(envelope: WsEnvelope): void {
  if (!wss) return;
  for (const client of wss.clients) {
    sendEnvelope(client, envelope);
  }
}

export function notifyTunnelStatus(): void {
  broadcastEnvelope({
    channel: "status",
    sessionId: "",
    payload: {
      type: "status_update",
      powerBlock: isPowerBlocked(),
      websocket: true,
      tunnel: getAuthenticatedTunnelUrl(),
    },
    auth: "",
  });
}

function broadcastSessionUpdated(sessionId: string): void {
  const record = getSession(sessionId);
  if (!record) return;
  broadcastEnvelope({
    channel: "control",
    sessionId,
    payload: { type: "session_updated", session: record },
    auth: "",
  });
}

function handleClose(ws: WebSocket): void {
  // Clean up terminal sessions
  const owned = clientSessions.get(ws);
  if (owned) {
    for (const sid of owned) {
      markKilled(sid);
      updateTerminalSession(sid, { status: "killed", endedAt: Date.now() });
      destroySession(sid);
      broadcastSessionUpdated(sid);
    }
    clientSessions.delete(ws);
  }

  // Claude sessions: just clear ownership, keep processes + git watchers alive
  clientClaudeSessions.delete(ws);
}

/**
 * Initialize PID sources for the system monitor.
 * Called once during server startup after all singletons are available.
 */
function initSystemMonitor(): void {
  const claudeManager = getClaudeManager();
  const qaServiceGetter = getQaService;

  registerPidSources([
    // Terminal PIDs
    () =>
      getSessionPids().map((s) => ({
        ...s,
        type: "terminal" as const,
        name: `Terminal ${s.sessionId.slice(0, 8)}`,
      })),
    // Claude PIDs
    () =>
      claudeManager.getSessionPids().map((s) => ({
        ...s,
        type: "claude" as const,
        name: `Claude ${s.sessionId.slice(0, 8)}`,
      })),
    // QA/PinchTab PID
    () => {
      const qaService = qaServiceGetter();
      if (!qaService?.isRunning()) return [];
      const pid = qaService.getPid();
      if (!pid) return [];
      return [
        { sessionId: "qa", pid, type: "qa" as const, name: "PinchTab Server" },
      ];
    },
  ]);

  // Broadcast metrics to all clients when polled
  const systemMonitor = getSystemMonitor();
  systemMonitor.setOnMetrics((metrics) => {
    broadcastEnvelope({
      channel: "perf",
      sessionId: "",
      payload: { type: "perf_update", metrics } satisfies PerfPayload,
      auth: "",
    });
  });
}

export async function startWebSocketServer(port = 8888): Promise<void> {
  if (server) return;
  serverPort = port;

  return new Promise((resolve, reject) => {
    // Serve built renderer files (gracefully skip if dir doesn't exist)
    const clientDir = path.join(__dirname, "../renderer");
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

    wsServer.on("connection", (ws, req) => {
      const remoteAddr = req.socket.remoteAddress ?? "";
      const isLocal =
        remoteAddr === "127.0.0.1" ||
        remoteAddr === "::1" ||
        remoteAddr === "::ffff:127.0.0.1";

      if (isLocal) {
        authenticatedClients.add(ws);
        console.log("[Zeus] WebSocket client connected (local — auto-authenticated)");
      } else {
        const url = new URL(req.url ?? "/", "http://localhost");
        const token = url.searchParams.get("token");

        if (!token || !validateToken(token)) {
          console.warn(
            `[Zeus] Unauthorized WebSocket connection from ${remoteAddr}`,
          );
          ws.close(4401, "Unauthorized");
          return;
        }

        authenticatedClients.add(ws);
        console.log(
          `[Zeus] WebSocket client connected (remote — authenticated: ${remoteAddr})`,
        );
      }

      ws.on("message", (data) => {
        const raw = data.toString();
        route(
          ws,
          raw,
          (env) => broadcastEnvelope(env),
          (env) => sendEnvelope(ws, env),
        );
      });
      ws.on("close", () => {
        console.log("[Zeus] WebSocket client disconnected");
        handleClose(ws);
      });
    });

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[Zeus] Port ${port} already in use. Is another Zeus instance running on this port?`,
        );
        console.error(
          `[Zeus] Tip: Set ZEUS_WS_PORT=<port> or use ZEUS_ENV=development for port 8889.`,
        );
      }
      reject(err);
    });

    httpServer.listen(port, "0.0.0.0", () => {
      server = httpServer;
      wss = wsServer;

      // Initialize system monitor PID sources now that everything is wired
      initSystemMonitor();

      console.log(`[Zeus] Server listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

export async function stopWebSocketServer(): Promise<void> {
  if (!wss || !server) return;

  // Kill all Claude sessions, git watchers, file tree watchers, and QA service
  const claudeManager = getClaudeManager();
  const gitManager = getGitManager();
  const fileTreeManager = getFileTreeManager();
  const qaService = getQaService();

  claudeManager.killAll();
  await gitManager.stopAll();
  await fileTreeManager.stopAll();
  if (qaService) {
    await qaService.stop();
    setQaService(null);
  }

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
        console.log("[Zeus] Server stopped");
        resolve();
      });
    });
  });
}
