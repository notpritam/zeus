import { WebSocket } from "ws";
import { WsEnvelopeSchema } from "../../shared/protocol/envelope";
import type { WsEnvelope } from "../../shared/protocol/envelope";
import { Log } from "../log/log";
import { handleControl } from "./handlers/control";
import { handleTerminal } from "./handlers/terminal";
import { handleStatus } from "./handlers/status";
import { handleClaude } from "./handlers/claude";
import { handleGit } from "./handlers/git";
import { handleFiles } from "./handlers/files";
import { handleQa } from "./handlers/qa";
import { handleSubagent } from "./handlers/subagent";
import { handleSettings } from "./handlers/settings";
import { handleMcp } from "./handlers/mcp";
import { handleTasks } from "./handlers/tasks";
import { handlePermissions } from "./handlers/permissions";
import { handleAndroid } from "./handlers/android";
import { handlePerf } from "./handlers/perf";

const log = Log.create({ service: "router" });

export interface HandlerContext {
  ws: WebSocket;
  envelope: WsEnvelope;
  broadcast: (envelope: WsEnvelope) => void;
  send: (envelope: WsEnvelope) => void;
}

export type ChannelHandler = (ctx: HandlerContext) => void | Promise<void>;

const handlers: Record<string, ChannelHandler> = {
  control: handleControl,
  terminal: handleTerminal,
  status: handleStatus,
  claude: handleClaude,
  git: handleGit,
  files: handleFiles,
  qa: handleQa,
  subagent: handleSubagent,
  settings: handleSettings,
  mcp: handleMcp,
  tasks: handleTasks,
  permissions: handlePermissions,
  android: handleAndroid,
  perf: handlePerf,
};

export function route(
  ws: WebSocket,
  raw: string,
  broadcast: (env: WsEnvelope) => void,
  send: (env: WsEnvelope) => void,
): void {
  let envelope: WsEnvelope;
  try {
    envelope = WsEnvelopeSchema.parse(JSON.parse(raw));
  } catch (err) {
    log.warn("invalid envelope", { error: String(err), raw: raw.slice(0, 200) });
    return;
  }

  const handler = handlers[envelope.channel];
  if (!handler) {
    log.warn("unknown channel", { channel: envelope.channel });
    send({
      channel: "control",
      sessionId: envelope.sessionId,
      payload: { type: "error", message: `Unknown channel: ${envelope.channel}` },
      auth: "",
    });
    return;
  }

  try {
    const result = handler({ ws, envelope, broadcast, send });
    if (result instanceof Promise) {
      result.catch((err) => {
        log.error("handler error", { channel: envelope.channel, error: String(err) });
      });
    }
  } catch (err) {
    log.error("handler error", { channel: envelope.channel, error: String(err) });
  }
}
