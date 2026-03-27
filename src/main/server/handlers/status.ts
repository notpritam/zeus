import type { HandlerContext } from "../router";
import type { StatusPayload } from "../../types";
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from "../../services/power";
import { getTunnelUrl, isTunnelActive, startTunnel, stopTunnel, stopRemoteTunnel } from "../../services/tunnel";
import { getAuthToken } from "../../services/auth";
import { zeusEnv } from "../../services/env";
import { Log } from "../../log/log";
import { getServerPort } from "../server";

const log = Log.create({ service: "handler:status" });

/** Return tunnel URL with auth token appended so remote clients can authenticate. */
function getAuthenticatedTunnelUrl(): string | null {
  const url = getTunnelUrl();
  if (!url) return null;
  try {
    const token = getAuthToken();
    return `${url}?token=${token}`;
  } catch {
    return url;
  }
}

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

function buildStatusPayload(): {
  type: "status_update";
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
} {
  return {
    type: "status_update",
    powerBlock: isPowerBlocked(),
    websocket: true,
    tunnel: getAuthenticatedTunnelUrl(),
  };
}

export { getAuthenticatedTunnelUrl };

export function handleStatus(ctx: HandlerContext): void {
  const { envelope } = ctx;
  const payload = envelope.payload as StatusPayload;

  if (payload.type === "get_status") {
    ctx.send({
      channel: "status",
      sessionId: "",
      payload: buildStatusPayload(),
      auth: "",
    });
  } else if (payload.type === "toggle_power") {
    if (isPowerBlocked()) {
      stopPowerBlock();
    } else {
      startPowerBlock();
    }
    // Broadcast new status to all clients
    ctx.broadcast({
      channel: "status",
      sessionId: "",
      payload: buildStatusPayload(),
      auth: "",
    });
  } else if (payload.type === "stop_tunnel") {
    // Used by dev instance to remotely stop prod's tunnel + ngrok session
    (async () => {
      try {
        // Always stop — kills listener + ngrok agent session to free the slot
        await stopTunnel();
        console.log("[Zeus] Tunnel + ngrok session killed via remote request");
        // Broadcast to all local clients so prod UI updates
        ctx.broadcast({
          channel: "status",
          sessionId: "",
          payload: buildStatusPayload(),
          auth: "",
        });
      } catch (err) {
        console.error("[Zeus] Remote tunnel stop error:", (err as Error).message);
      }
    })();
  } else if (payload.type === "toggle_tunnel") {
    (async () => {
      try {
        if (isTunnelActive()) {
          await stopTunnel();
        } else {
          // In dev mode, stop prod's tunnel first to reclaim the ngrok domain
          if (zeusEnv.isDev) {
            const prodPort = 8888;
            console.log("[Zeus DEV] Checking for prod tunnel on port", prodPort);
            await stopRemoteTunnel(prodPort);
            // Wait for ngrok's backend to fully release the session slot
            await new Promise((r) => setTimeout(r, 3000));
          }
          // Retry up to 3 times — ngrok backend can be slow to free the slot
          let tunnelStarted = false;
          const serverPort = getServerPort();
          for (let attempt = 1; attempt <= 3; attempt++) {
            const url = await startTunnel(serverPort);
            if (url) {
              tunnelStarted = true;
              break;
            }
            if (attempt < 3) {
              console.log(
                `[Zeus DEV] Tunnel start attempt ${attempt} failed, retrying in 3s...`,
              );
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (!tunnelStarted) {
            sendError(
              ctx,
              "Failed to start tunnel after 3 attempts — prod ngrok session may still be active",
            );
            return;
          }
        }
        ctx.broadcast({
          channel: "status",
          sessionId: "",
          payload: buildStatusPayload(),
          auth: "",
        });
      } catch (err) {
        console.error("[Zeus] Tunnel toggle error:", (err as Error).message);
        sendError(ctx, `Tunnel error: ${(err as Error).message}`);
      }
    })();
  } else {
    sendError(ctx, `Unknown status type: ${payload.type}`);
  }
}
