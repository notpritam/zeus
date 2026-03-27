import z from "zod";

// ─── Client → Server ───

export const TasksCreateTask = z.object({
  type: z.literal("create_task"),
  name: z.string(),
  prompt: z.string(),
  projectPath: z.string(),
  baseBranch: z.string().optional(),
  permissionMode: z.string().optional(),
  model: z.string().optional(),
});

export const TasksListTasks = z.object({
  type: z.literal("list_tasks"),
});

export const TasksMergeTask = z.object({
  type: z.literal("merge_task"),
  taskId: z.string(),
});

export const TasksCreatePr = z.object({
  type: z.literal("create_pr"),
  taskId: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
});

export const TasksArchiveTask = z.object({
  type: z.literal("archive_task"),
  taskId: z.string(),
});

export const TasksUnarchiveTask = z.object({
  type: z.literal("unarchive_task"),
  taskId: z.string(),
});

export const TasksDiscardTask = z.object({
  type: z.literal("discard_task"),
  taskId: z.string(),
});

export const TasksGetTaskDiff = z.object({
  type: z.literal("get_task_diff"),
  taskId: z.string(),
});

export const TasksContinueTask = z.object({
  type: z.literal("continue_task"),
  taskId: z.string(),
  prompt: z.string(),
});

export const TasksIncoming = z.discriminatedUnion("type", [
  TasksCreateTask,
  TasksListTasks,
  TasksMergeTask,
  TasksCreatePr,
  TasksArchiveTask,
  TasksUnarchiveTask,
  TasksDiscardTask,
  TasksGetTaskDiff,
  TasksContinueTask,
]);
export type TasksIncoming = z.infer<typeof TasksIncoming>;

// ─── Server → Client ───

export const TasksTaskCreated = z.object({
  type: z.literal("task_created"),
  task: z.unknown(),
});

export const TasksTaskUpdated = z.object({
  type: z.literal("task_updated"),
  task: z.unknown(),
});

export const TasksTaskDeleted = z.object({
  type: z.literal("task_deleted"),
  taskId: z.string(),
});

export const TasksTaskList = z.object({
  type: z.literal("task_list"),
  tasks: z.unknown(),
});

export const TasksTaskDiff = z.object({
  type: z.literal("task_diff"),
  taskId: z.string(),
  diff: z.string(),
  summary: z.unknown().optional(),
});

export const TasksTaskError = z.object({
  type: z.literal("task_error"),
  message: z.string(),
  taskId: z.string().optional(),
});

export const TasksOutgoing = z.discriminatedUnion("type", [
  TasksTaskCreated,
  TasksTaskUpdated,
  TasksTaskDeleted,
  TasksTaskList,
  TasksTaskDiff,
  TasksTaskError,
]);
export type TasksOutgoing = z.infer<typeof TasksOutgoing>;
