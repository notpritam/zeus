import fs from "fs";
import type { HandlerContext } from "../router";
import type { SettingsPayload } from "../../types";
import {
  getSettings,
  addProject,
  removeProject,
  updateDefaults,
  setLastUsedProject,
  setActiveTheme,
  setAutoTunnel,
} from "../../services/settings";
import { getThemeById, refreshThemes, getThemesDir } from "../../services/themes";
import { shell } from "electron";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:settings" });

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

export function handleSettings(ctx: HandlerContext): void {
  const { envelope } = ctx;
  const payload = envelope.payload as SettingsPayload;

  if (payload.type === "get_settings") {
    const settings = getSettings();
    ctx.send({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings },
      auth: "",
    });
    // Send active theme colors immediately to prevent FOUC
    const activeTheme = getThemeById(settings.activeThemeId);
    if (activeTheme) {
      ctx.send({
        channel: "settings",
        sessionId: "",
        payload: { type: "theme_colors", theme: activeTheme },
        auth: "",
      });
    }
  } else if (payload.type === "add_project") {
    if (payload.createDir && !fs.existsSync(payload.path)) {
      try {
        fs.mkdirSync(payload.path, { recursive: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.send({
          channel: "settings",
          sessionId: "",
          payload: { type: "settings_error", message: `Failed to create directory: ${msg}` },
          auth: "",
        });
        return;
      }
    }
    if (!fs.existsSync(payload.path)) {
      ctx.send({
        channel: "settings",
        sessionId: "",
        payload: { type: "settings_error", message: `Directory does not exist: ${payload.path}` },
        auth: "",
      });
      return;
    }
    addProject(payload.name, payload.path);
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
  } else if (payload.type === "remove_project") {
    removeProject(payload.id);
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
  } else if (payload.type === "update_defaults") {
    updateDefaults(payload.defaults);
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
  } else if (payload.type === "set_last_used_project") {
    setLastUsedProject(payload.id);
  } else if (payload.type === "set_theme") {
    const theme = getThemeById(payload.themeId);
    if (!theme) {
      ctx.send({
        channel: "settings",
        sessionId: "",
        payload: { type: "settings_error", message: `Theme not found: ${payload.themeId}` },
        auth: "",
      });
      return;
    }
    setActiveTheme(payload.themeId);
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "theme_colors", theme },
      auth: "",
    });
  } else if (payload.type === "get_theme_colors") {
    const theme = getThemeById(payload.themeId);
    if (theme) {
      ctx.send({
        channel: "settings",
        sessionId: "",
        payload: { type: "theme_colors", theme },
        auth: "",
      });
    } else {
      ctx.send({
        channel: "settings",
        sessionId: "",
        payload: { type: "settings_error", message: `Theme not found: ${payload.themeId}` },
        auth: "",
      });
    }
  } else if (payload.type === "refresh_themes") {
    refreshThemes();
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
  } else if (payload.type === "open_themes_folder") {
    shell.openPath(getThemesDir());
  } else if (payload.type === "set_auto_tunnel") {
    setAutoTunnel(payload.enabled);
    ctx.broadcast({
      channel: "settings",
      sessionId: "",
      payload: { type: "settings_update", settings: getSettings() },
      auth: "",
    });
  } else {
    sendError(ctx, `Unknown settings type: ${(payload as { type: string }).type}`);
  }
}
