import z from "zod";

// ─── Client → Server ───

export const ControlStartSession = z.object({
  type: z.literal("start_session"),
  cols: z.number().optional(),
  rows: z.number().optional(),
  cwd: z.string().optional(),
  correlationId: z.string().optional(),
});

export const ControlStopSession = z.object({
  type: z.literal("stop_session"),
});

export const ControlListSessions = z.object({
  type: z.literal("list_sessions"),
});

export const ControlDeleteTerminalSession = z.object({
  type: z.literal("delete_terminal_session"),
});

export const ControlRestoreTerminalSession = z.object({
  type: z.literal("restore_terminal_session"),
});

export const ControlArchiveTerminalSession = z.object({
  type: z.literal("archive_terminal_session"),
});

export const ControlIncoming = z.discriminatedUnion("type", [
  ControlStartSession,
  ControlStopSession,
  ControlListSessions,
  ControlDeleteTerminalSession,
  ControlRestoreTerminalSession,
  ControlArchiveTerminalSession,
]);
export type ControlIncoming = z.infer<typeof ControlIncoming>;

// ─── Server → Client ───

export const ControlSessionStarted = z.object({
  type: z.literal("session_started"),
  sessionId: z.string(),
  shell: z.string(),
  correlationId: z.string().optional(),
});

export const ControlSessionList = z.object({
  type: z.literal("session_list"),
  sessions: z.unknown(),
});

export const ControlTerminalSessionDeleted = z.object({
  type: z.literal("terminal_session_deleted"),
  deletedId: z.string(),
});

export const ControlTerminalSessionRestored = z.object({
  type: z.literal("terminal_session_restored"),
  sessionId: z.string(),
});

export const ControlTerminalSessionArchived = z.object({
  type: z.literal("terminal_session_archived"),
  archivedId: z.string(),
});

export const ControlOutgoing = z.discriminatedUnion("type", [
  ControlSessionStarted,
  ControlSessionList,
  ControlTerminalSessionDeleted,
  ControlTerminalSessionRestored,
  ControlTerminalSessionArchived,
]);
export type ControlOutgoing = z.infer<typeof ControlOutgoing>;
