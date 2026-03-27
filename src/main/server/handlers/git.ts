import type { HandlerContext } from "../router";
import type { GitPayload } from "../../../shared/types";
import { GitWatcherManager, initGitRepo } from "../../services/git";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:git" });

// Git watcher manager — singleton shared across all WebSocket clients
const gitManager = new GitWatcherManager();

export function getGitManager(): GitWatcherManager {
  return gitManager;
}

function sendError(ctx: HandlerContext, message: string): void {
  ctx.send({
    channel: "control",
    sessionId: ctx.envelope.sessionId,
    payload: { type: "error", message },
    auth: "",
  });
}

export async function handleGit(ctx: HandlerContext): Promise<void> {
  const { envelope } = ctx;
  const payload = envelope.payload as GitPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === "start_watching") {
    try {
      const { watcher, isNew } = await gitManager.startWatching(sessionId, payload.workingDir);

      if (isNew) {
        watcher.on("connected", () => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_connected" },
            auth: "",
          });
        });

        watcher.on("heartbeat", () => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_heartbeat" },
            auth: "",
          });
        });

        watcher.on("status", (data) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_status", data },
            auth: "",
          });
        });

        watcher.on("not_a_repo", () => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "not_a_repo" },
            auth: "",
          });
        });

        watcher.on("error", (err: Error) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_error", message: err.message },
            auth: "",
          });
        });
      }

      // Only send connected + refresh if this is actually a git repo
      if (watcher.isRepo) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_connected" },
          auth: "",
        });
        await watcher.refresh();
      }
    } catch (err) {
      sendError(ctx, `Failed to start git watcher: ${(err as Error).message}`);
    }
  } else if (payload.type === "stop_watching") {
    await gitManager.stopWatching(sessionId);
    ctx.broadcast({
      channel: "git",
      sessionId,
      payload: { type: "git_disconnected" },
      auth: "",
    });
  } else if (payload.type === "refresh") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      await watcher.refresh();
    }
  } else if (payload.type === "git_stage") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.stageFiles(payload.files);
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_unstage") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.unstageFiles(payload.files);
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_stage_all") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.stageAll();
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_unstage_all") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.unstageAll();
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_discard") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.discardFiles(payload.files);
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_file_contents") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const result = await watcher.getFileContents(payload.file, payload.staged);
        ctx.send({
          channel: "git",
          sessionId,
          payload: {
            type: "git_file_contents_result",
            file: payload.file,
            staged: payload.staged,
            original: result.original,
            modified: result.modified,
            language: result.language,
          },
          auth: "",
        });
      } catch (err) {
        ctx.send({
          channel: "git",
          sessionId,
          payload: {
            type: "git_file_contents_error",
            file: payload.file,
            error: (err as Error).message,
          },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_save_file") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.saveFile(payload.file, payload.content);
      ctx.send({
        channel: "git",
        sessionId,
        payload: {
          type: "git_save_file_result",
          file: payload.file,
          success: result.success,
          error: result.error,
        },
        auth: "",
      });
    }
  } else if (payload.type === "git_commit") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.commit(payload.message);
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_commit_result", ...result },
        auth: "",
      });
    } else {
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_error", message: "No active git watcher for this session" },
        auth: "",
      });
    }
  } else if (payload.type === "git_list_branches") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const branches = await watcher.listBranches();
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_branches_result", branches },
          auth: "",
        });
      } catch (err) {
        ctx.broadcast({
          channel: "git",
          sessionId,
          payload: { type: "git_error", message: (err as Error).message },
          auth: "",
        });
      }
    }
  } else if (payload.type === "git_checkout") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.checkoutBranch(payload.branch);
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: {
          type: "git_checkout_result",
          ...result,
          branch: result.success ? payload.branch : undefined,
        },
        auth: "",
      });
    }
  } else if (payload.type === "git_create_branch") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.createBranch(payload.branch, payload.checkout ?? true);
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: {
          type: "git_create_branch_result",
          ...result,
          branch: result.success ? payload.branch : undefined,
        },
        auth: "",
      });
    }
  } else if (payload.type === "git_delete_branch") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.deleteBranch(payload.branch, payload.force ?? false);
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_delete_branch_result", ...result },
        auth: "",
      });
    }
  } else if (payload.type === "git_push") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.push(payload.force ?? false);
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_push_result", ...result },
        auth: "",
      });
    }
  } else if (payload.type === "git_pull") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.pull();
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_pull_result", ...result },
        auth: "",
      });
    }
  } else if (payload.type === "git_fetch") {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.fetch();
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_fetch_result", ...result },
        auth: "",
      });
    }
  } else if (payload.type === "git_init") {
    const result = await initGitRepo(payload.workingDir);
    ctx.broadcast({
      channel: "git",
      sessionId,
      payload: { type: "git_init_result", ...result },
      auth: "",
    });
    // If init succeeded, auto-start watching
    if (result.success) {
      const { watcher, isNew } = await gitManager.startWatching(sessionId, payload.workingDir);
      if (isNew) {
        watcher.on("connected", () => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_connected" },
            auth: "",
          });
        });
        watcher.on("heartbeat", () => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_heartbeat" },
            auth: "",
          });
        });
        watcher.on("status", (data) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_status", data },
            auth: "",
          });
        });
        watcher.on("error", (err: Error) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            payload: { type: "git_error", message: err.message },
            auth: "",
          });
        });
      }
      ctx.broadcast({
        channel: "git",
        sessionId,
        payload: { type: "git_connected" },
        auth: "",
      });
      await watcher.refresh();
    }
  } else {
    sendError(ctx, `Unknown git type: ${(payload as { type: string }).type}`);
  }
}
