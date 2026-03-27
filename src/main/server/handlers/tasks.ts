import type { HandlerContext } from "../router";
import type { TaskPayload, GitPayload, GitStatusData } from "../../../shared/types";
import { SESSION_ICON_NAMES } from "../../../shared/types";
import type { SessionIconName } from "../../../shared/types";
import { TaskManager } from "../../services/task-manager";
import {
  insertClaudeSession,
  upsertClaudeEntry,
} from "../../db/queries/claude";
import { getTask } from "../../db/queries/tasks";
import * as mcpRegistry from "../../services/mcp-registry";
import { getClaudeManager, wireClaudeSession } from "./claude";
import { getGitManager } from "./git";
import { getClientClaudeSessions } from "../server";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:tasks" });

export async function handleTasks(ctx: HandlerContext): Promise<void> {
  const { ws, envelope } = ctx;
  const payload = envelope.payload as TaskPayload;

  if (payload.type === "create_task") {
    try {
      const { task, worktreePath } = await TaskManager.createTask({
        name: payload.name,
        prompt: payload.prompt,
        projectPath: payload.projectPath,
        baseBranch: payload.baseBranch,
        permissionMode: payload.permissionMode,
        model: payload.model,
      });

      // Now start a Claude session in the worktree directory
      const sessionId = `task-${task.id}-${Date.now()}`;
      const resolvedMcps = mcpRegistry.resolveSessionMcps({});
      const mcpServersForSession = resolvedMcps.map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
      }));

      const claudeManager = getClaudeManager();
      const session = await claudeManager.createSession(sessionId, payload.prompt, {
        workingDir: worktreePath,
        permissionMode: payload.permissionMode ?? "bypassPermissions",
        model: payload.model,
        zeusSessionId: sessionId,
        mcpServers: mcpServersForSession.length > 0 ? mcpServersForSession : undefined,
      });

      // Persist Claude session
      const randomIcon = SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: sessionId,
        claudeSessionId: null,
        status: "running",
        prompt: payload.prompt,
        name: payload.name,
        icon: randomIcon,
        color: null,
        notificationSound: true,
        workingDir: worktreePath,
        qaTargetUrl: null,
        permissionMode: payload.permissionMode ?? "bypassPermissions",
        model: payload.model ?? null,
        startedAt: Date.now(),
        endedAt: null,
        deletedAt: null,
      });

      // Link task to session
      const updatedTask = TaskManager.markRunning(task.id, sessionId);

      // Persist initial user message
      upsertClaudeEntry(sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: "user_message" },
        content: payload.prompt,
      });

      // Wire Claude session events
      wireClaudeSession(ctx, session, { ...envelope, sessionId });

      // Listen for session end to mark task completed
      const markTaskDone = async (): Promise<void> => {
        const completed = await TaskManager.markCompleted(task.id);
        if (completed) {
          ctx.broadcast({
            channel: "tasks",
            sessionId: "",
            auth: "",
            payload: { type: "task_updated", task: completed },
          });
        }
      };
      session.on("done", markTaskDone);
      session.on("error", async () => {
        const errored = TaskManager.markError(task.id);
        if (errored) {
          ctx.broadcast({
            channel: "tasks",
            sessionId: "",
            auth: "",
            payload: { type: "task_updated", task: errored },
          });
        }
      });

      // Start git watcher for the worktree directory
      const gitManager = getGitManager();
      const { watcher, isNew } = await gitManager.startWatching(sessionId, worktreePath);
      if (isNew) {
        watcher.on("status", (data: GitStatusData) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            auth: "",
            payload: { type: "git_status", data } as GitPayload,
          });
        });
        watcher.on("error", (err: Error) => {
          ctx.broadcast({
            channel: "git",
            sessionId,
            auth: "",
            payload: { type: "git_error", message: err.message } as GitPayload,
          });
        });
      }

      // Track ownership
      const clientClaudeSessions = getClientClaudeSessions();
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(sessionId);

      ctx.broadcast({
        channel: "claude",
        sessionId,
        auth: "",
        payload: { type: "claude_started" },
      });

      ctx.broadcast({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_created", task: updatedTask ?? task },
      });
    } catch (err) {
      ctx.send({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_error", message: (err as Error).message },
      });
    }
  } else if (payload.type === "list_tasks") {
    const tasks = TaskManager.listTasks();
    ctx.send({
      channel: "tasks",
      sessionId: "",
      auth: "",
      payload: { type: "task_list", tasks },
    });
  } else if (payload.type === "merge_task") {
    try {
      const { task, error } = await TaskManager.mergeTask(payload.taskId);
      if (error) {
        ctx.send({
          channel: "tasks",
          sessionId: "",
          auth: "",
          payload: { type: "task_error", message: error, taskId: payload.taskId },
        });
      } else if (task) {
        ctx.broadcast({
          channel: "tasks",
          sessionId: "",
          auth: "",
          payload: { type: "task_updated", task },
        });
      }
    } catch (err) {
      ctx.send({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_error", message: (err as Error).message, taskId: payload.taskId },
      });
    }
  } else if (payload.type === "create_pr") {
    try {
      const { task, prUrl, error } = await TaskManager.createPR(
        payload.taskId,
        payload.title,
        payload.body,
      );
      if (error) {
        ctx.send({
          channel: "tasks",
          sessionId: "",
          auth: "",
          payload: { type: "task_error", message: error, taskId: payload.taskId },
        });
      } else if (task) {
        ctx.broadcast({
          channel: "tasks",
          sessionId: "",
          auth: "",
          payload: { type: "task_updated", task },
        });
      }
    } catch (err) {
      ctx.send({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_error", message: (err as Error).message, taskId: payload.taskId },
      });
    }
  } else if (payload.type === "archive_task") {
    const task = await TaskManager.archiveTask(payload.taskId);
    if (task) {
      ctx.broadcast({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_updated", task },
      });
    }
  } else if (payload.type === "unarchive_task") {
    const task = await TaskManager.unarchiveTask(payload.taskId);
    if (task) {
      ctx.broadcast({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_updated", task },
      });
    }
  } else if (payload.type === "discard_task") {
    await TaskManager.discardTask(payload.taskId);
    ctx.broadcast({
      channel: "tasks",
      sessionId: "",
      auth: "",
      payload: { type: "task_deleted", taskId: payload.taskId },
    });
  } else if (payload.type === "get_task_diff") {
    const result = await TaskManager.getTaskDiff(payload.taskId);
    if (result) {
      ctx.send({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: {
          type: "task_diff",
          taskId: payload.taskId,
          diff: result.diff,
          summary: result.summary,
        },
      });
    }
  } else if (payload.type === "continue_task") {
    try {
      const task = getTask(payload.taskId);
      if (!task) throw new Error("Task not found");
      if (!task.worktreeDir) throw new Error("Task has no worktree");

      // Start a new Claude session in the same worktree
      const sessionId = `task-${task.id}-${Date.now()}`;
      const claudeManager = getClaudeManager();
      const session = await claudeManager.createSession(sessionId, payload.prompt, {
        workingDir: task.worktreeDir,
        permissionMode: "bypassPermissions",
        zeusSessionId: sessionId,
      });

      const randomIcon =
        SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: sessionId,
        claudeSessionId: null,
        status: "running",
        prompt: payload.prompt,
        name: `${task.name} (continued)`,
        icon: randomIcon,
        color: null,
        notificationSound: true,
        workingDir: task.worktreeDir,
        qaTargetUrl: null,
        permissionMode: "bypassPermissions",
        model: null,
        startedAt: Date.now(),
        endedAt: null,
        deletedAt: null,
      });

      const updatedTask = TaskManager.markRunning(task.id, sessionId);

      upsertClaudeEntry(sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: "user_message" },
        content: payload.prompt,
      });

      wireClaudeSession(ctx, session, { ...envelope, sessionId });

      // ClaudeSession emits 'done' and 'error', NOT 'exit'
      session.on("done", async () => {
        const completed = await TaskManager.markCompleted(task.id);
        if (completed) {
          ctx.broadcast({
            channel: "tasks",
            sessionId: "",
            auth: "",
            payload: { type: "task_updated", task: completed },
          });
        }
      });
      session.on("error", async () => {
        const errored = TaskManager.markError(task.id);
        if (errored) {
          ctx.broadcast({
            channel: "tasks",
            sessionId: "",
            auth: "",
            payload: { type: "task_updated", task: errored },
          });
        }
      });

      const clientClaudeSessions = getClientClaudeSessions();
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(sessionId);

      ctx.broadcast({
        channel: "claude",
        sessionId,
        auth: "",
        payload: { type: "claude_started" },
      });

      if (updatedTask) {
        ctx.broadcast({
          channel: "tasks",
          sessionId: "",
          auth: "",
          payload: { type: "task_updated", task: updatedTask },
        });
      }
    } catch (err) {
      ctx.send({
        channel: "tasks",
        sessionId: "",
        auth: "",
        payload: { type: "task_error", message: (err as Error).message, taskId: payload.taskId },
      });
    }
  }
}
