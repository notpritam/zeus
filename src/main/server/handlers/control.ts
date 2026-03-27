import type { HandlerContext } from "../router";
import type { StartSessionPayload } from "../../types";
import {
  createSession,
  writeToSession,
  resizeSession,
  destroySession,
} from "../../services/terminal";
import {
  registerSession,
  markExited,
  markKilled,
  getSession,
  getAllSessions,
} from "../../services/sessions";
import {
  insertTerminalSession,
  updateTerminalSession,
  getAllTerminalSessions,
  deleteTerminalSession,
  restoreTerminalSession,
  archiveTerminalSession,
} from "../../db/queries/terminal";
import { Log } from "../../log/log";
import { getClientSessions } from "../server";
import { stopSubagentsByParent } from "./subagent";

const log = Log.create({ service: "handler:control" });

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

function broadcastSessionUpdated(ctx: HandlerContext, sessionId: string): void {
  const record = getSession(sessionId);
  if (!record) return;
  ctx.broadcast({
    channel: "control",
    sessionId,
    payload: { type: "session_updated", session: record },
    auth: "",
  });
}

export function handleControl(ctx: HandlerContext): void {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as { type: string };

  if (payload.type === "start_session") {
    const opts = envelope.payload as StartSessionPayload;
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const cwd = opts.cwd || process.env.HOME || "/";

    const { sessionId, shell } = createSession(
      { cols, rows, cwd },
      (sid, data) => {
        // Broadcast terminal output to ALL clients (not just owner)
        ctx.broadcast({
          channel: "terminal",
          sessionId: sid,
          payload: { type: "output", data },
          auth: "",
        });
      },
      (sid, code) => {
        markExited(sid, code);
        updateTerminalSession(sid, { status: "exited", endedAt: Date.now(), exitCode: code });
        ctx.broadcast({
          channel: "terminal",
          sessionId: sid,
          payload: { type: "exit", code },
          auth: "",
        });
        broadcastSessionUpdated(ctx, sid);
        const owned = getClientSessions().get(ws);
        if (owned) owned.delete(sid);
      },
    );

    // Register in session registry
    const record = registerSession(sessionId, shell, cols, rows, cwd);

    // Persist to DB
    insertTerminalSession(record);

    // Track ownership
    const clientSessionMap = getClientSessions();
    if (!clientSessionMap.has(ws)) clientSessionMap.set(ws, new Set());
    clientSessionMap.get(ws)!.add(sessionId);

    // Broadcast session_started with correlationId echoed back
    ctx.broadcast({
      channel: "control",
      sessionId,
      payload: {
        type: "session_started",
        sessionId,
        shell,
        correlationId: opts.correlationId,
      },
      auth: "",
    });

    broadcastSessionUpdated(ctx, sessionId);
  } else if (payload.type === "stop_session") {
    const sid = envelope.sessionId;
    markKilled(sid);
    updateTerminalSession(sid, { status: "killed", endedAt: Date.now() });
    destroySession(sid);
    const owned = getClientSessions().get(ws);
    if (owned) owned.delete(sid);
    broadcastSessionUpdated(ctx, sid);
  } else if (payload.type === "list_sessions") {
    // Merge in-memory (active) with DB (historical), dedup by id (in-memory wins)
    const inMemory = getAllSessions();
    const inMemoryIds = new Set(inMemory.map((s) => s.id));
    const fromDb = getAllTerminalSessions().filter(
      (s) => !inMemoryIds.has(s.id) && s.status !== "archived",
    );
    ctx.send({
      channel: "control",
      sessionId: "",
      payload: { type: "session_list", sessions: [...inMemory, ...fromDb] },
      auth: "",
    });
  } else if (payload.type === "delete_terminal_session") {
    const sid = envelope.sessionId;
    destroySession(sid);
    markKilled(sid);
    stopSubagentsByParent(sid);
    deleteTerminalSession(sid);
    const owned = getClientSessions().get(ws);
    if (owned) owned.delete(sid);
    ctx.broadcast({
      channel: "control",
      sessionId: sid,
      payload: { type: "terminal_session_deleted", deletedId: sid },
      auth: "",
    });
  } else if (payload.type === "restore_terminal_session") {
    const sid = envelope.sessionId;
    restoreTerminalSession(sid);
    ctx.broadcast({
      channel: "control",
      sessionId: sid,
      payload: { type: "terminal_session_restored", sessionId: sid },
      auth: "",
    });
  } else if (payload.type === "archive_terminal_session") {
    const sid = envelope.sessionId;
    destroySession(sid);
    markKilled(sid);
    archiveTerminalSession(sid);
    const owned = getClientSessions().get(ws);
    if (owned) owned.delete(sid);
    ctx.broadcast({
      channel: "control",
      sessionId: sid,
      payload: { type: "terminal_session_archived", archivedId: sid },
      auth: "",
    });
  } else {
    sendError(ctx, `Unknown control type: ${payload.type}`);
  }
}
