import type { HandlerContext } from "../router";
import type { TerminalInputPayload, TerminalResizePayload } from "../../types";
import { writeToSession, resizeSession } from "../../services/terminal";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:terminal" });

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

export function handleTerminal(ctx: HandlerContext): void {
  const { envelope } = ctx;
  const payload = envelope.payload as { type: string };

  if (payload.type === "input") {
    const { data } = envelope.payload as TerminalInputPayload;
    try {
      writeToSession(envelope.sessionId, data);
    } catch (err) {
      sendError(ctx, (err as Error).message);
    }
  } else if (payload.type === "resize") {
    const { cols, rows } = envelope.payload as TerminalResizePayload;
    try {
      resizeSession(envelope.sessionId, cols, rows);
    } catch (err) {
      sendError(ctx, (err as Error).message);
    }
  } else {
    sendError(ctx, `Unknown terminal type: ${payload.type}`);
  }
}
