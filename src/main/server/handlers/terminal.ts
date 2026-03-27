import type { HandlerContext } from "../router";
import type { TerminalInputPayload, TerminalResizePayload } from "../../types";
import { writeToSession, resizeSession, getSessionBuffer } from "../../services/terminal";
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

  switch (payload.type) {
    case "input": {
      const { data } = envelope.payload as TerminalInputPayload;
      try {
        writeToSession(envelope.sessionId, data);
      } catch (err) {
        sendError(ctx, (err as Error).message);
      }
      break;
    }
    case "resize": {
      const { cols, rows } = envelope.payload as TerminalResizePayload;
      try {
        resizeSession(envelope.sessionId, cols, rows);
      } catch (err) {
        sendError(ctx, (err as Error).message);
      }
      break;
    }
    case "attach": {
      const clientCursor = (payload as { type: string; cursor?: number }).cursor ?? 0;
      const sessionId = envelope.sessionId;
      const buf = getSessionBuffer(sessionId);
      if (buf && clientCursor < buf.cursor) {
        const missedStart = buf.data.length - (buf.cursor - clientCursor);
        const missed = missedStart >= 0 ? buf.data.slice(missedStart) : buf.data;
        ctx.send({
          channel: "terminal",
          sessionId,
          payload: { type: "replay", data: missed, cursor: buf.cursor },
          auth: "",
        });
      }
      break;
    }
    default:
      sendError(ctx, `Unknown terminal type: ${payload.type}`);
  }
}
