import fs from "fs";
import path from "path";
import { stat as fsStat } from "fs/promises";
import { app, Notification as ElectronNotification } from "electron";
import { WebSocket } from "ws";
import type { HandlerContext } from "../router";
import type {
  ClaudeStartPayload,
  ClaudeResumePayload,
  ClaudeSendMessagePayload,
  ClaudeInjectMessagePayload,
  ClaudeApproveToolPayload,
  ClaudeDenyToolPayload,
  NormalizedEntry,
} from "../../types";
import type { ClaudeSessionInfo, SessionIconName } from "../../../shared/types";
import { SESSION_ICON_NAMES } from "../../../shared/types";
import type { PermissionRule } from "../../../shared/permission-types";
import type { WsEnvelope } from "../../../shared/protocol/envelope";
import { ClaudeSessionManager, ClaudeSession } from "../../services/claude-session";
import type { ContentBlock } from "../../services/claude-types";
import {
  insertClaudeSession,
  updateClaudeSessionId,
  updateClaudeSessionStatus,
  updateClaudeSessionMeta,
  upsertClaudeEntry,
  getAllClaudeSessions,
  getClaudeEntries,
  getClaudeEntriesPaginated,
  deleteClaudeSession,
  restoreClaudeSession,
  getDeletedClaudeSessions,
  archiveClaudeSession,
  finalizeCreatedToolEntries,
  copyClaudeEntriesForResume,
  updateClaudeSessionQaTargetUrl,
  deleteClaudeEntriesForSession,
} from "../../db/queries/claude";
import { countSubagentsByParent } from "../../db/queries/subagent";
import { getPermissionRules } from "../../db/queries/permissions";
import * as mcpRegistry from "../../services/mcp-registry";
import { detectDevServerUrlDetailed } from "../../services/detect-dev-server";
import { QAService } from "../../services/qa";
import { getMainWindow } from "../../index";
import { Log } from "../../log/log";
import { getClientClaudeSessions } from "../server";
import { getQaService, setQaService } from "./qa";
import { getGitManager } from "./git";
import { getFileTreeManager } from "./files";
import { stopSubagentsByParent } from "./subagent";

const log = Log.create({ service: "handler:claude" });

// Claude session manager (shared across all WebSocket clients)
const claudeManager = new ClaudeSessionManager();

export function getClaudeManager(): ClaudeSessionManager {
  return claudeManager;
}

/**
 * Request OS-level attention: flash taskbar (Windows/Linux), bounce dock (macOS),
 * and show a native notification if the window is not focused.
 */
function requestAttention(title: string, body: string): void {
  const win = getMainWindow();

  if (win && !win.isFocused()) {
    // Flash the taskbar icon (Windows/Linux)
    win.flashFrame(true);

    // Bounce the dock icon (macOS)
    if (process.platform === "darwin") {
      app.dock?.bounce("informational");
    }

    // Show native OS notification
    if (ElectronNotification.isSupported()) {
      const notif = new ElectronNotification({ title, body, silent: true });
      notif.on("click", () => {
        win.show();
        win.focus();
      });
      notif.show();
    }
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

/** Auto-adopt a Claude session if the client doesn't own it yet (e.g. after reconnect) */
function adoptClaudeSession(ws: WebSocket, sessionId: string): void {
  const clientClaudeSessions = getClientClaudeSessions();
  if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
  const owned = clientClaudeSessions.get(ws)!;
  if (!owned.has(sessionId)) {
    owned.add(sessionId);
  }
}

/**
 * Wire a ClaudeSession's events to broadcast/persist.
 * Exported so tasks handler can reuse it.
 */
export function wireClaudeSession(
  ctx: HandlerContext,
  session: ClaudeSession,
  envelope: WsEnvelope,
): void {
  let qaService = getQaService();

  // Forward normalized entries to all clients + persist to DB
  session.on("entry", async (entry: NormalizedEntry) => {
    upsertClaudeEntry(envelope.sessionId, entry);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "entry", entry },
      auth: "",
    });

    // Sync QA Preview when Claude calls qa_* or pinchtab_* tools
    const qaMethodName =
      entry.entryType.type === "tool_use"
        ? entry.entryType.actionType?.action === "mcp_tool"
          ? entry.entryType.actionType.method
          : entry.entryType.toolName
        : "";
    if (entry.entryType.type === "tool_use" && /^(qa_|pinchtab_)/i.test(qaMethodName)) {
      const { status } = entry.entryType;
      const toolName = qaMethodName;
      qaService = getQaService();

      if (status === "success" && qaService?.isRunning()) {
        try {
          if (/navigate/i.test(toolName)) {
            let navUrl: string | undefined;
            try {
              if (
                entry.entryType.type === "tool_use" &&
                entry.entryType.actionType?.action === "mcp_tool"
              ) {
                const input =
                  typeof entry.entryType.actionType.input === "string"
                    ? JSON.parse(entry.entryType.actionType.input)
                    : entry.entryType.actionType.input;
                navUrl = input?.url;
              }
              if (!navUrl) {
                const parsed = JSON.parse(entry.content);
                navUrl = parsed.url;
              }
            } catch {
              /* ignore parse errors */
            }
            ctx.broadcast({
              channel: "qa",
              sessionId: "",
              auth: "",
              payload: { type: "navigate_result", url: navUrl ?? "", title: "" },
            });
            const snap = await qaService.snapshot("interactive");
            ctx.broadcast({
              channel: "qa",
              sessionId: "",
              auth: "",
              payload: { type: "snapshot_result", nodes: snap.nodes, raw: snap.raw },
            });
          } else if (/screenshot/i.test(toolName)) {
            const dataUrl = await qaService.screenshot();
            ctx.broadcast({
              channel: "qa",
              sessionId: "",
              auth: "",
              payload: { type: "screenshot_result", dataUrl },
            });
          } else if (/snapshot/i.test(toolName)) {
            const snap = await qaService.snapshot("interactive");
            ctx.broadcast({
              channel: "qa",
              sessionId: "",
              auth: "",
              payload: { type: "snapshot_result", nodes: snap.nodes, raw: snap.raw },
            });
          } else if (
            /click|fill|type|press|scroll|hover|focus|select|batch|run_test_flow/i.test(
              toolName,
            )
          ) {
            const snap = await qaService.snapshot("interactive");
            ctx.broadcast({
              channel: "qa",
              sessionId: "",
              auth: "",
              payload: { type: "snapshot_result", nodes: snap.nodes, raw: snap.raw },
            });
          }
        } catch (err) {
          console.warn(
            `[Zeus] QA preview sync failed for ${toolName}:`,
            (err as Error).message,
          );
        }
      }
    }
  });

  // Forward activity state changes
  session.on("activity", (activity) => {
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "session_activity", activity },
      auth: "",
    });
  });

  // Forward approval requests + request OS attention
  session.on("approval_needed", (approval) => {
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "approval_needed", ...approval },
      auth: "",
    });
    requestAttention(
      "Approval Needed",
      `"${approval.toolName}" needs your approval to continue.`,
    );
  });

  // Forward session ID once extracted from stream + persist to DB
  session.on("session_id", (id) => {
    updateClaudeSessionId(envelope.sessionId, id);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "claude_session_id", claudeSessionId: id },
      auth: "",
    });
  });

  // Forward turn completion (token usage) — session stays alive
  session.on("turn_complete", (result) => {
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "turn_complete", result },
      auth: "",
    });
  });

  // Forward session end (process exited) + persist status + request attention
  session.on("done", () => {
    finalizeCreatedToolEntries(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, "done", Date.now());
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "done" },
      auth: "",
    });
    requestAttention("Task Complete", "Claude session finished successfully.");
  });

  // Forward errors + persist status + request attention
  session.on("error", (err) => {
    finalizeCreatedToolEntries(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, "error", Date.now());
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "error", message: err.message },
      auth: "",
    });
    requestAttention(
      "Task Failed",
      `Claude session encountered an error: ${err.message}`,
    );
  });

  // Forward queue state changes to frontend
  session.on("queue_updated", (queue: Array<{ id: string; content: string }>) => {
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "queue_updated", queue },
      auth: "",
    });
  });

  // Persist drained message as user entry + notify frontend
  session.on("queue_drained", ({ id, content }: { id: string; content: string | unknown }) => {
    const textContent = typeof content === "string" ? content : "[multi-part content]";
    upsertClaudeEntry(envelope.sessionId, {
      id: `user-${Date.now()}`,
      entryType: { type: "user_message" },
      content: textContent,
    });
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "queue_drained", msgId: id },
      auth: "",
    });
  });
}

export async function handleClaude(ctx: HandlerContext): Promise<void> {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as { type: string; [key: string]: unknown };

  if (payload.type === "start_claude") {
    const opts = envelope.payload as ClaudeStartPayload;
    const workingDir = opts.workingDir || process.env.HOME || "/";

    // Ensure working directory exists — auto-create if missing
    if (!fs.existsSync(workingDir)) {
      try {
        fs.mkdirSync(workingDir, { recursive: true });
        console.log(`[Zeus] Created working directory: ${workingDir}`);
      } catch (mkdirErr: unknown) {
        const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
        sendError(
          ctx,
          `Working directory does not exist and could not be created: ${workingDir} — ${msg}`,
        );
        return;
      }
    }

    // Validate it's actually a directory, not a file
    try {
      const stat = fs.statSync(workingDir);
      if (!stat.isDirectory()) {
        sendError(ctx, `Path exists but is not a directory: ${workingDir}`);
        return;
      }
    } catch {
      sendError(ctx, `Cannot access working directory: ${workingDir}`);
      return;
    }

    try {
      // Resolve MCP servers from registry profile + overrides
      const resolvedMcps = mcpRegistry.resolveSessionMcps({
        profileId: opts.mcpProfileId,
        serverIds: opts.mcpServerIds,
        excludeIds: opts.mcpExcludeIds,
      });

      // Convert to session options format
      const mcpServersForSession = resolvedMcps.map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
      }));

      // Load permission rules for the project
      const projectId = (envelope.payload as ClaudeStartPayload).projectId;
      let permissionRules: PermissionRule[] = [];
      if (projectId) {
        permissionRules = getPermissionRules(projectId);
      }

      const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
        workingDir,
        permissionMode: opts.permissionMode ?? "bypassPermissions",
        model: opts.model,
        enableQA: opts.enableQA,
        qaTargetUrl: opts.qaTargetUrl,
        zeusSessionId: envelope.sessionId,
        mcpServers: mcpServersForSession.length > 0 ? mcpServersForSession : undefined,
        permissionRules,
        projectId: projectId ?? undefined,
      });

      // Track attached MCPs in session_mcps table
      if (resolvedMcps.length > 0) {
        mcpRegistry.attachSessionMcps(
          envelope.sessionId,
          resolvedMcps.map((s) => s.id),
        );
      }

      // Persist to DB — assign a random icon
      const randomIcon =
        SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: envelope.sessionId,
        claudeSessionId: null,
        status: "running",
        prompt: opts.prompt,
        name: opts.sessionName ?? null,
        icon: randomIcon,
        color: null,
        notificationSound: opts.notificationSound ?? true,
        workingDir,
        qaTargetUrl: null,
        permissionMode: opts.permissionMode ?? "bypassPermissions",
        model: opts.model ?? null,
        startedAt: Date.now(),
        endedAt: null,
        deletedAt: null,
      });

      // Persist initial user message
      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: "user_message" },
        content: opts.prompt,
      });

      // Track ownership
      const clientClaudeSessions = getClientClaudeSessions();
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ctx, session, envelope);

      // Auto-detect QA target URL for this session's working directory
      detectDevServerUrlDetailed(workingDir)
        .then((result) => {
          console.log(
            `[QA URL] Auto-detect for new session ${envelope.sessionId}:`,
            result.detail,
          );
          if (result.url) {
            updateClaudeSessionQaTargetUrl(envelope.sessionId, result.url);
          }
          ctx.broadcast({
            channel: "claude",
            sessionId: envelope.sessionId,
            payload: {
              type: "qa_target_url_detected",
              sessionId: envelope.sessionId,
              qaTargetUrl: result.url,
              source: result.source,
              detail: result.detail,
              port: result.port ?? null,
              framework: result.framework ?? null,
              verification: result.verification ?? null,
            },
            auth: "",
          });
        })
        .catch((err) => {
          console.error(
            `[QA URL] Auto-detect failed for session ${envelope.sessionId}:`,
            err,
          );
        });

      ctx.broadcast({
        channel: "claude",
        sessionId: envelope.sessionId,
        payload: { type: "claude_started" },
        auth: "",
      });

      // Auto-start QA if enabled
      if (opts.enableQA) {
        try {
          let qaService = getQaService();
          if (!qaService?.isRunning()) {
            qaService = new QAService();
            setQaService(qaService);
            await qaService.start();
          }
          const instance = await qaService.launchInstance(true);
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "qa_started" },
            auth: "",
          });
          ctx.broadcast({
            channel: "qa",
            sessionId: "",
            payload: { type: "instance_launched", instance },
            auth: "",
          });

          // Wire CDP events to frontend
          const cdp = qaService.getCdpClient();
          if (cdp) {
            cdp.on("console", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                payload: { type: "cdp_console", logs: [entry] },
                auth: "",
              });
            });
            cdp.on("network", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                payload: { type: "cdp_network", requests: [entry] },
                auth: "",
              });
            });
            cdp.on("js_error", (entry) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                payload: { type: "cdp_error", errors: [entry] },
                auth: "",
              });
            });
            cdp.on("navigated", ({ url, title }: { url: string; title: string }) => {
              ctx.broadcast({
                channel: "qa",
                sessionId: "",
                payload: { type: "navigate_result", url, title },
                auth: "",
              });
            });
          }
        } catch (err) {
          console.warn("[Zeus] QA auto-start failed (non-fatal):", (err as Error).message);
        }
      }
    } catch (err) {
      sendError(ctx, `Failed to start Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === "resume_claude") {
    const opts = envelope.payload as ClaudeResumePayload;
    const workingDir = opts.workingDir || process.env.HOME || "/";

    // Ensure working directory exists for resumed sessions too
    if (!fs.existsSync(workingDir)) {
      try {
        fs.mkdirSync(workingDir, { recursive: true });
        console.log(`[Zeus] Created working directory for resume: ${workingDir}`);
      } catch (mkdirErr: unknown) {
        const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
        sendError(
          ctx,
          `Working directory does not exist and could not be created: ${workingDir} — ${msg}`,
        );
        return;
      }
    }

    try {
      const session = await claudeManager.resumeSession(
        envelope.sessionId,
        opts.claudeSessionId,
        opts.prompt,
        { workingDir, zeusSessionId: envelope.sessionId },
      );

      // Persist resumed session to DB
      insertClaudeSession({
        id: envelope.sessionId,
        claudeSessionId: opts.claudeSessionId,
        status: "running",
        prompt: opts.prompt,
        name: opts.name ?? null,
        icon: SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)],
        color: opts.color ?? null,
        notificationSound: true,
        workingDir,
        qaTargetUrl: null,
        permissionMode: "bypassPermissions",
        model: null,
        startedAt: Date.now(),
        endedAt: null,
        deletedAt: null,
      });

      // Copy history entries from previous sessions sharing the same Claude session ID
      copyClaudeEntriesForResume(opts.claudeSessionId, envelope.sessionId);

      const clientClaudeSessions = getClientClaudeSessions();
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ctx, session, envelope);

      ctx.broadcast({
        channel: "claude",
        sessionId: envelope.sessionId,
        payload: { type: "claude_started" },
        auth: "",
      });
    } catch (err) {
      sendError(ctx, `Failed to resume Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === "send_message") {
    const { content, files, images } = envelope.payload as ClaudeSendMessagePayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);

      // Build metadata for DB persistence
      const meta: Record<string, unknown> = {};
      if (files && files.length > 0) meta.files = files;
      if (images && images.length > 0)
        meta.images = images.map((img) => ({
          filename: img.filename,
          mediaType: img.mediaType,
        }));

      // Persist user message to DB (original content, not enhanced)
      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: "user_message" },
        content,
        metadata: Object.keys(meta).length > 0 ? meta : undefined,
      });

      // Build enhanced message with file contents if files attached
      let enhancedText = content;
      if (files && files.length > 0) {
        const fileTreeManager = getFileTreeManager();
        const fileService = fileTreeManager.getService(envelope.sessionId);
        if (fileService) {
          const fileBlocks: string[] = [];
          for (const filePath of files) {
            try {
              const resolved = path.resolve(fileService.getWorkingDir(), filePath);
              const stats = await fsStat(resolved);
              if (stats.isDirectory()) {
                const dirFiles = await fileService.readDirectoryRecursive(filePath);
                for (const f of dirFiles) {
                  fileBlocks.push(`<file path="${f.path}">\n${f.content}\n</file>`);
                }
              } else {
                const fileContent = await fileService.readFileContent(filePath);
                if (fileContent !== null) {
                  fileBlocks.push(`<file path="${filePath}">\n${fileContent}\n</file>`);
                } else {
                  fileBlocks.push(
                    `<file path="${filePath}">\n[Binary or too large to include]\n</file>`,
                  );
                }
              }
            } catch {
              fileBlocks.push(`<file path="${filePath}">\n[Could not read file]\n</file>`);
            }
          }
          if (fileBlocks.length > 0) {
            enhancedText = `<attached_files>\n${fileBlocks.join("\n")}\n</attached_files>\n\n${content}`;
          }
        }
      }

      // If images attached, send as multi-part content blocks
      if (images && images.length > 0) {
        const blocks: ContentBlock[] = [];

        // Add image blocks
        for (const img of images) {
          const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType,
              data: base64,
            },
          });
        }

        // Add text block
        if (enhancedText) {
          blocks.push({ type: "text", text: enhancedText });
        }

        await session.sendMessage(blocks);
      } else {
        await session.sendMessage(enhancedText);
      }
    } else {
      sendError(ctx, "No active Claude session for this ID");
    }
  } else if (payload.type === "inject_message") {
    const { content, files, images } = envelope.payload as ClaudeInjectMessagePayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);

      // Persist user message to DB
      const meta: Record<string, unknown> = {};
      if (files && files.length > 0) meta.files = files;
      if (images && images.length > 0)
        meta.images = images.map((img) => ({
          filename: img.filename,
          mediaType: img.mediaType,
        }));

      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: "user_message" },
        content,
        metadata: Object.keys(meta).length > 0 ? meta : undefined,
      });

      // Build enhanced message with file contents if files attached
      let enhancedText = content;
      if (files && files.length > 0) {
        const fileTreeManager = getFileTreeManager();
        const fileService = fileTreeManager.getService(envelope.sessionId);
        if (fileService) {
          const fileBlocks: string[] = [];
          for (const filePath of files) {
            try {
              const resolved = path.resolve(fileService.getWorkingDir(), filePath);
              const stats = await fsStat(resolved);
              if (stats.isDirectory()) {
                const dirFiles = await fileService.readDirectoryRecursive(filePath);
                for (const f of dirFiles) {
                  fileBlocks.push(`<file path="${f.path}">\n${f.content}\n</file>`);
                }
              } else {
                const fileContent = await fileService.readFileContent(filePath);
                if (fileContent !== null) {
                  fileBlocks.push(`<file path="${filePath}">\n${fileContent}\n</file>`);
                } else {
                  fileBlocks.push(
                    `<file path="${filePath}">\n[Binary or too large to include]\n</file>`,
                  );
                }
              }
            } catch {
              fileBlocks.push(`<file path="${filePath}">\n[Could not read file]\n</file>`);
            }
          }
          if (fileBlocks.length > 0) {
            enhancedText = `<attached_files>\n${fileBlocks.join("\n")}\n</attached_files>\n\n${content}`;
          }
        }
      }

      // Send as inject (interrupt + send)
      if (images && images.length > 0) {
        const blocks: ContentBlock[] = [];
        for (const img of images) {
          const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType,
              data: base64,
            },
          });
        }
        if (enhancedText) {
          blocks.push({ type: "text", text: enhancedText });
        }
        await session.injectMessage(blocks);
      } else {
        await session.injectMessage(enhancedText);
      }
    } else {
      sendError(ctx, "No active Claude session for this ID");
    }
  } else if (payload.type === "queue_message") {
    const { id, content } = envelope.payload as { id: string; content: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      session.sendMessage(content, { id }).catch((err) => {
        console.warn("[WS] queue_message failed:", (err as Error).message);
      });
    } else {
      sendError(ctx, "No active Claude session for this ID");
    }
  } else if (payload.type === "edit_queued_message") {
    const { msgId, content } = envelope.payload as { msgId: string; content: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      session.editQueuedMessage(msgId, content);
    }
  } else if (payload.type === "remove_queued_message") {
    const { msgId } = envelope.payload as { msgId: string };
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      session.removeQueuedMessage(msgId);
    }
  } else if (payload.type === "approve_tool") {
    const { approvalId, updatedInput } = envelope.payload as ClaudeApproveToolPayload;
    console.log("[WS] approve_tool", approvalId, "hasUpdatedInput:", !!updatedInput);
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.approveTool(approvalId, updatedInput);
    }
  } else if (payload.type === "deny_tool") {
    const { approvalId, reason } = envelope.payload as ClaudeDenyToolPayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.denyTool(approvalId, reason);
    }
  } else if (payload.type === "interrupt") {
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.interrupt();
    }
  } else if (payload.type === "stop_claude") {
    adoptClaudeSession(ws, envelope.sessionId);
    claudeManager.killSession(envelope.sessionId);
    stopSubagentsByParent(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, "done", Date.now());
    const clientClaudeSessions = getClientClaudeSessions();
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
  } else if (payload.type === "list_claude_sessions") {
    const dbSessions = getAllClaudeSessions().filter((s) => s.status !== "archived");
    const sessions: ClaudeSessionInfo[] = dbSessions.map((s) => {
      const live = claudeManager.getSession(s.id);
      const status = live?.isRunning
        ? "running"
        : (s.status as ClaudeSessionInfo["status"]);
      return {
        id: s.id,
        claudeSessionId: s.claudeSessionId,
        status,
        prompt: s.prompt,
        name: s.name ?? undefined,
        icon: (s.icon as SessionIconName) ?? undefined,
        color: s.color ?? undefined,
        notificationSound: s.notificationSound,
        workingDir: s.workingDir ?? undefined,
        qaTargetUrl: s.qaTargetUrl ?? undefined,
        startedAt: s.startedAt,
        subagentCount: countSubagentsByParent(s.id),
      };
    });
    ctx.send({
      channel: "claude",
      sessionId: "",
      payload: { type: "claude_session_list", sessions },
      auth: "",
    });
  } else if (payload.type === "get_claude_history") {
    const limit = (payload as Record<string, unknown>).limit as number | undefined;
    const beforeSeq = (payload as Record<string, unknown>).beforeSeq as number | undefined;
    if (typeof limit === "number") {
      const result = getClaudeEntriesPaginated(envelope.sessionId, limit, beforeSeq);
      ctx.send({
        channel: "claude",
        sessionId: envelope.sessionId,
        payload: {
          type: "claude_history",
          entries: result.entries,
          totalCount: result.totalCount,
          oldestSeq: result.oldestSeq,
          isPaginated: true,
        },
        auth: "",
      });
    } else {
      const entries = getClaudeEntries(envelope.sessionId);
      ctx.send({
        channel: "claude",
        sessionId: envelope.sessionId,
        payload: { type: "claude_history", entries },
        auth: "",
      });
    }
  } else if (payload.type === "clear_history") {
    deleteClaudeEntriesForSession(envelope.sessionId);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "claude_history", entries: [] },
      auth: "",
    });
  } else if (payload.type === "update_claude_session") {
    const updates: { name?: string; color?: string | null } = {};
    if (payload.name !== undefined) updates.name = payload.name as string;
    if (payload.color !== undefined) updates.color = payload.color as string | null;
    updateClaudeSessionMeta(envelope.sessionId, updates);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: {
        type: "claude_session_updated",
        sessionId: envelope.sessionId,
        ...updates,
      },
      auth: "",
    });
  } else if (payload.type === "update_qa_target_url") {
    const newUrl = (payload as Record<string, unknown>).qaTargetUrl as string;
    if (newUrl) {
      updateClaudeSessionQaTargetUrl(envelope.sessionId, newUrl);
      ctx.broadcast({
        channel: "claude",
        sessionId: envelope.sessionId,
        payload: {
          type: "qa_target_url_updated",
          sessionId: envelope.sessionId,
          qaTargetUrl: newUrl,
        },
        auth: "",
      });
    }
  } else if (payload.type === "detect_qa_target_url") {
    const dbSessions = getAllClaudeSessions();
    const sessionRow = dbSessions.find((s) => s.id === envelope.sessionId);
    const workDir = sessionRow?.workingDir || process.env.HOME || "/";
    console.log(
      `[QA URL] Detecting dev server for session ${envelope.sessionId} in ${workDir}`,
    );
    detectDevServerUrlDetailed(workDir)
      .then((result) => {
        console.log(`[QA URL] Detection result:`, result);
        if (result.url) {
          updateClaudeSessionQaTargetUrl(envelope.sessionId, result.url);
        }
        ctx.broadcast({
          channel: "claude",
          sessionId: envelope.sessionId,
          payload: {
            type: "qa_target_url_detected",
            sessionId: envelope.sessionId,
            qaTargetUrl: result.url,
            source: result.source,
            detail: result.detail,
            port: result.port ?? null,
            framework: result.framework ?? null,
            verification: result.verification ?? null,
          },
          auth: "",
        });
      })
      .catch((err) => {
        console.error(`[QA URL] Detection failed:`, err);
        ctx.send({
          channel: "claude",
          sessionId: envelope.sessionId,
          payload: {
            type: "qa_target_url_detected",
            sessionId: envelope.sessionId,
            qaTargetUrl: null,
            source: "none",
            detail: `Detection failed: ${(err as Error).message}`,
            port: null,
            framework: null,
            verification: null,
          },
          auth: "",
        });
      });
  } else if (payload.type === "delete_claude_session") {
    claudeManager.killSession(envelope.sessionId);
    const gitManager = getGitManager();
    gitManager.stopWatching(envelope.sessionId);
    stopSubagentsByParent(envelope.sessionId);
    deleteClaudeSession(envelope.sessionId);
    const clientClaudeSessions = getClientClaudeSessions();
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "claude_session_deleted", deletedId: envelope.sessionId },
      auth: "",
    });
  } else if (payload.type === "restore_claude_session") {
    restoreClaudeSession(envelope.sessionId);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "claude_session_restored", sessionId: envelope.sessionId },
      auth: "",
    });
  } else if (payload.type === "list_deleted_sessions") {
    const deletedRows = getDeletedClaudeSessions();
    const sessions: ClaudeSessionInfo[] = deletedRows.map((s) => ({
      id: s.id,
      claudeSessionId: s.claudeSessionId,
      status: s.status as ClaudeSessionInfo["status"],
      prompt: s.prompt,
      name: s.name ?? undefined,
      icon: (s.icon as SessionIconName) ?? undefined,
      color: s.color ?? undefined,
      notificationSound: s.notificationSound,
      workingDir: s.workingDir ?? undefined,
      qaTargetUrl: s.qaTargetUrl ?? undefined,
      startedAt: s.startedAt,
      deletedAt: s.deletedAt ?? undefined,
    }));
    ctx.send({
      channel: "claude",
      sessionId: "",
      payload: { type: "deleted_sessions_list", sessions },
      auth: "",
    });
  } else if (payload.type === "archive_claude_session") {
    claudeManager.killSession(envelope.sessionId);
    const gitManager = getGitManager();
    gitManager.stopWatching(envelope.sessionId);
    archiveClaudeSession(envelope.sessionId);
    const clientClaudeSessions = getClientClaudeSessions();
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
    ctx.broadcast({
      channel: "claude",
      sessionId: envelope.sessionId,
      payload: { type: "claude_session_archived", archivedId: envelope.sessionId },
      auth: "",
    });
  } else if (payload.type === "register_external_session") {
    const sessionId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    insertClaudeSession({
      id: sessionId,
      claudeSessionId: null,
      status: "running",
      prompt: (payload.prompt as string) || "External session",
      name: (payload.name as string) || null,
      icon: SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)],
      color: null,
      notificationSound: true,
      workingDir: (payload.workingDir as string) || process.env.HOME || "/",
      qaTargetUrl: null,
      permissionMode: "bypassPermissions",
      model: null,
      startedAt: now,
      endedAt: null,
      deletedAt: null,
    });

    upsertClaudeEntry(sessionId, {
      id: `user-${now}`,
      entryType: { type: "user_message" },
      content: (payload.prompt as string) || "External session",
    });

    ctx.broadcast({
      channel: "claude",
      sessionId,
      payload: { type: "claude_started" },
      auth: "",
    });

    ctx.send({
      channel: "claude",
      sessionId,
      payload: {
        type: "register_external_session_response",
        responseId: payload.responseId,
        sessionId,
      },
      auth: "",
    });

    console.log(`[Claude] External session registered: ${sessionId} — ${payload.name}`);
  } else if (payload.type === "external_session_entry") {
    const extPayload = envelope.payload as { sessionId: string; entry: NormalizedEntry };
    const extSessionId = extPayload.sessionId;
    const entry = extPayload.entry;
    if (!extSessionId || !entry) return;

    upsertClaudeEntry(extSessionId, entry);
    ctx.broadcast({
      channel: "claude",
      sessionId: extSessionId,
      payload: { type: "entry", entry },
      auth: "",
    });
  } else if (payload.type === "external_session_activity") {
    const extPayload = envelope.payload as { sessionId: string; activity: unknown };
    const extSessionId = extPayload.sessionId;
    const activity = extPayload.activity;
    if (!extSessionId || !activity) return;

    ctx.broadcast({
      channel: "claude",
      sessionId: extSessionId,
      payload: { type: "session_activity", activity },
      auth: "",
    });
  } else if (payload.type === "external_session_done") {
    const extPayload = envelope.payload as { sessionId: string; status: string };
    const extSessionId = extPayload.sessionId;
    const status = extPayload.status;
    if (!extSessionId) return;

    const finalStatus = status === "error" ? "error" : "done";
    finalizeCreatedToolEntries(extSessionId);
    updateClaudeSessionStatus(extSessionId, finalStatus, Date.now());

    ctx.broadcast({
      channel: "claude",
      sessionId: extSessionId,
      payload: {
        type: finalStatus === "error" ? "error" : "done",
        message: finalStatus === "error" ? "External session errored" : undefined,
      },
      auth: "",
    });

    console.log(`[Claude] External session ended: ${extSessionId} (${finalStatus})`);
  } else {
    sendError(ctx, `Unknown claude type: ${payload.type}`);
  }
}
