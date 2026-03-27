import type { HandlerContext } from "../router";
import type { AndroidPayload } from "../../../shared/types";
import type { WsEnvelope } from "../../../shared/protocol/envelope";
import { AndroidQAService } from "../../services/android-qa";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:android" });

// Module-level singleton (mirrors qaService pattern)
let androidQAService: AndroidQAService | null = null;

export function getAndroidQAService(): AndroidQAService {
  if (!androidQAService) {
    androidQAService = new AndroidQAService();
  }
  return androidQAService;
}

// Helper to send a response with responseId forwarding
function sendAndroidResponse(
  ctx: HandlerContext,
  responsePayload: Record<string, unknown>,
): void {
  const inPayload = ctx.envelope.payload as Record<string, unknown>;
  ctx.send({
    channel: "android",
    sessionId: "",
    auth: "",
    payload: { ...responsePayload, responseId: inPayload.responseId },
  });
}

export async function handleAndroid(ctx: HandlerContext): Promise<void> {
  const { envelope } = ctx;
  const payload = envelope.payload as AndroidPayload;
  const service = getAndroidQAService();

  switch (payload.type) {
    case "start_emulator": {
      try {
        const device = await service.start(payload.avdName);
        service.removeAllListeners("logcat");
        service.on("logcat", (entries) => {
          ctx.broadcast({
            channel: "android",
            sessionId: "",
            auth: "",
            payload: { type: "logcat_entries", entries },
          });
        });
        sendAndroidResponse(ctx, { type: "emulator_started", device });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "stop_emulator": {
      try {
        await service.stop();
        sendAndroidResponse(ctx, { type: "emulator_stopped" });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "list_devices": {
      try {
        const devices = await service.listDevices();
        const avds = await service.listAvds();
        sendAndroidResponse(ctx, { type: "devices_list", devices, avds });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "get_android_status": {
      try {
        const devices = await service.listDevices();
        sendAndroidResponse(ctx, {
          type: "android_status",
          running: service.isRunning(),
          devices,
        });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "screenshot": {
      try {
        const dataUrl = await service.screenshot();
        sendAndroidResponse(ctx, { type: "screenshot_result", dataUrl });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "view_hierarchy": {
      try {
        const nodes = await service.viewHierarchy();
        sendAndroidResponse(ctx, { type: "view_hierarchy_result", nodes });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "install_apk": {
      try {
        await service.installApk(payload.apkPath);
        sendAndroidResponse(ctx, { type: "apk_installed", apkPath: payload.apkPath });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }

    case "launch_app": {
      try {
        await service.launchApp(payload.appId);
        sendAndroidResponse(ctx, { type: "app_launched", appId: payload.appId });
      } catch (err) {
        sendAndroidResponse(ctx, { type: "android_error", message: String(err) });
      }
      break;
    }
  }
}
