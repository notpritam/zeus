import type { HandlerContext } from "../router";
import type { FilesPayload } from "../../../shared/types";
import { FileTreeServiceManager } from "../../services/file-tree";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:files" });

// File tree manager — singleton shared across all WebSocket clients
const fileTreeManager = new FileTreeServiceManager();

export function getFileTreeManager(): FileTreeServiceManager {
  return fileTreeManager;
}

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

export async function handleFiles(ctx: HandlerContext): Promise<void> {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as FilesPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === "start_watching") {
    try {
      const { service, isNew } = await fileTreeManager.startWatching(
        sessionId,
        payload.workingDir,
      );

      if (isNew) {
        service.on("connected", () => {
          ctx.broadcast({
            channel: "files",
            sessionId,
            payload: { type: "files_connected" },
            auth: "",
          });
        });

        service.on("files_changed", (data: { directories: string[] }) => {
          ctx.broadcast({
            channel: "files",
            sessionId,
            payload: { type: "files_changed", directories: data.directories },
            auth: "",
          });
        });

        service.on("error", (err: Error) => {
          ctx.broadcast({
            channel: "files",
            sessionId,
            payload: { type: "files_error", message: err.message },
            auth: "",
          });
        });
      }

      // Always send current state (whether new or existing service)
      ctx.broadcast({
        channel: "files",
        sessionId,
        payload: { type: "files_connected" },
        auth: "",
      });
      try {
        const entries = await service.listDirectory("");
        ctx.broadcast({
          channel: "files",
          sessionId,
          payload: { type: "directory_listing", dirPath: "", entries },
          auth: "",
        });
      } catch {
        /* root listing will be retried by the client */
      }
    } catch (err) {
      sendError(ctx, `Failed to start file watcher: ${(err as Error).message}`);
    }
  } else if (payload.type === "stop_watching") {
    await fileTreeManager.stopWatching(sessionId);
  } else if (payload.type === "list_directory") {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const entries = await service.listDirectory(payload.dirPath);
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "directory_listing", dirPath: payload.dirPath, entries },
          auth: "",
        });
      } catch (err) {
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "files_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "read_file") {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const result = await service.readFile(payload.filePath);
        ctx.send({
          channel: "files",
          sessionId,
          payload: {
            type: "read_file_result",
            filePath: payload.filePath,
            content: result.content,
            language: result.language,
          },
          auth: "",
        });
      } catch (err) {
        ctx.send({
          channel: "files",
          sessionId,
          payload: {
            type: "read_file_error",
            filePath: payload.filePath,
            error: (err as Error).message,
          },
          auth: "",
        });
      }
    }
  } else if (payload.type === "search_files") {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const results = await service.searchFiles(payload.query);
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "search_files_result", query: payload.query, results },
          auth: "",
        });
      } catch (err) {
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "files_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "scan_by_extension") {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const results = await service.scanByExtension(payload.ext);
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "scan_by_extension_result", ext: payload.ext, results },
          auth: "",
        });
      } catch (err) {
        ctx.send({
          channel: "files",
          sessionId,
          payload: { type: "files_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "save_file") {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      const result = await service.saveFile(payload.filePath, payload.content);
      ctx.send({
        channel: "files",
        sessionId,
        payload: {
          type: "save_file_result",
          filePath: payload.filePath,
          success: result.success,
          error: result.error,
        },
        auth: "",
      });
    }
  } else {
    sendError(ctx, `Unknown files type: ${(payload as { type: string }).type}`);
  }
}
