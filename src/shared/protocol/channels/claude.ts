import z from "zod";

// ─── Client → Server ───

export const ClaudeStartClaude = z.object({
  type: z.literal("start_claude"),
  prompt: z.string(),
  workingDir: z.string().optional(),
  permissionMode: z.string().optional(),
  model: z.string().optional(),
  enableQA: z.boolean().optional(),
  qaTargetUrl: z.string().optional(),
  sessionName: z.string().optional(),
  notificationSound: z.boolean().optional(),
  mcpProfileId: z.string().optional(),
  mcpServerIds: z.array(z.string()).optional(),
  mcpExcludeIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
});

export const ClaudeResumeClaude = z.object({
  type: z.literal("resume_claude"),
  claudeSessionId: z.string(),
  prompt: z.string(),
  workingDir: z.string().optional(),
  name: z.string().optional(),
  color: z.string().optional(),
});

export const ClaudeSendMessage = z.object({
  type: z.literal("send_message"),
  content: z.string(),
  files: z.array(z.string()).optional(),
  images: z.array(z.unknown()).optional(),
});

export const ClaudeQueueMessage = z.object({
  type: z.literal("queue_message"),
  id: z.string(),
  content: z.string(),
});

export const ClaudeEditQueuedMessage = z.object({
  type: z.literal("edit_queued_message"),
  msgId: z.string(),
  content: z.string(),
});

export const ClaudeRemoveQueuedMessage = z.object({
  type: z.literal("remove_queued_message"),
  msgId: z.string(),
});

export const ClaudeApproveTool = z.object({
  type: z.literal("approve_tool"),
  approvalId: z.string(),
  updatedInput: z.unknown().optional(),
});

export const ClaudeDenyTool = z.object({
  type: z.literal("deny_tool"),
  approvalId: z.string(),
  reason: z.string().optional(),
});

export const ClaudeInterrupt = z.object({
  type: z.literal("interrupt"),
});

export const ClaudeStopClaude = z.object({
  type: z.literal("stop_claude"),
});

export const ClaudeListClaudeSessions = z.object({
  type: z.literal("list_claude_sessions"),
});

export const ClaudeGetClaudeHistory = z.object({
  type: z.literal("get_claude_history"),
  limit: z.number().optional(),
  beforeSeq: z.number().optional(),
});

export const ClaudeClearHistory = z.object({
  type: z.literal("clear_history"),
});

export const ClaudeUpdateClaudeSession = z.object({
  type: z.literal("update_claude_session"),
  name: z.string().optional(),
  color: z.string().nullable().optional(),
});

export const ClaudeUpdateQaTargetUrl = z.object({
  type: z.literal("update_qa_target_url"),
  qaTargetUrl: z.string(),
});

export const ClaudeDetectQaTargetUrl = z.object({
  type: z.literal("detect_qa_target_url"),
});

export const ClaudeDeleteClaudeSession = z.object({
  type: z.literal("delete_claude_session"),
});

export const ClaudeRestoreClaudeSession = z.object({
  type: z.literal("restore_claude_session"),
});

export const ClaudeListDeletedSessions = z.object({
  type: z.literal("list_deleted_sessions"),
});

export const ClaudeArchiveClaudeSession = z.object({
  type: z.literal("archive_claude_session"),
});

export const ClaudeRegisterExternalSession = z.object({
  type: z.literal("register_external_session"),
  prompt: z.string().optional(),
  name: z.string().optional(),
  workingDir: z.string().optional(),
  responseId: z.string().optional(),
});

export const ClaudeExternalSessionEntry = z.object({
  type: z.literal("external_session_entry"),
  sessionId: z.string(),
  entry: z.unknown(),
});

export const ClaudeExternalSessionActivity = z.object({
  type: z.literal("external_session_activity"),
  sessionId: z.string(),
  activity: z.unknown(),
});

export const ClaudeExternalSessionDone = z.object({
  type: z.literal("external_session_done"),
  sessionId: z.string(),
  status: z.string(),
});

export const ClaudeIncoming = z.discriminatedUnion("type", [
  ClaudeStartClaude,
  ClaudeResumeClaude,
  ClaudeSendMessage,
  ClaudeQueueMessage,
  ClaudeEditQueuedMessage,
  ClaudeRemoveQueuedMessage,
  ClaudeApproveTool,
  ClaudeDenyTool,
  ClaudeInterrupt,
  ClaudeStopClaude,
  ClaudeListClaudeSessions,
  ClaudeGetClaudeHistory,
  ClaudeClearHistory,
  ClaudeUpdateClaudeSession,
  ClaudeUpdateQaTargetUrl,
  ClaudeDetectQaTargetUrl,
  ClaudeDeleteClaudeSession,
  ClaudeRestoreClaudeSession,
  ClaudeListDeletedSessions,
  ClaudeArchiveClaudeSession,
  ClaudeRegisterExternalSession,
  ClaudeExternalSessionEntry,
  ClaudeExternalSessionActivity,
  ClaudeExternalSessionDone,
]);
export type ClaudeIncoming = z.infer<typeof ClaudeIncoming>;

// ─── Server → Client ───

export const ClaudeStarted = z.object({
  type: z.literal("claude_started"),
});

export const ClaudeEntry = z.object({
  type: z.literal("claude_entry"),
  entry: z.unknown(),
});

export const ClaudeQueueUpdated = z.object({
  type: z.literal("queue_updated"),
  queue: z.unknown(),
});

export const ClaudeDone = z.object({
  type: z.literal("done"),
  message: z.string().optional(),
});

export const ClaudeError = z.object({
  type: z.literal("error"),
  message: z.string().optional(),
});

export const ClaudeSessionList = z.object({
  type: z.literal("claude_session_list"),
  sessions: z.unknown(),
});

export const ClaudeHistory = z.object({
  type: z.literal("claude_history"),
  entries: z.unknown(),
  totalCount: z.number().optional(),
  oldestSeq: z.number().optional(),
  isPaginated: z.boolean().optional(),
});

export const ClaudeSessionUpdated = z.object({
  type: z.literal("claude_session_updated"),
  sessionId: z.string(),
  name: z.string().optional(),
  color: z.string().nullable().optional(),
});

export const ClaudeQaTargetUrlUpdated = z.object({
  type: z.literal("qa_target_url_updated"),
  sessionId: z.string(),
  qaTargetUrl: z.string(),
});

export const ClaudeQaTargetUrlDetected = z.object({
  type: z.literal("qa_target_url_detected"),
  sessionId: z.string(),
  qaTargetUrl: z.string().nullable(),
  source: z.string(),
  detail: z.string(),
  port: z.number().nullable(),
  framework: z.string().nullable(),
  verification: z.unknown().nullable(),
});

export const ClaudeSessionDeleted = z.object({
  type: z.literal("claude_session_deleted"),
  deletedId: z.string(),
});

export const ClaudeSessionRestored = z.object({
  type: z.literal("claude_session_restored"),
  sessionId: z.string(),
});

export const ClaudeDeletedSessionsList = z.object({
  type: z.literal("deleted_sessions_list"),
  sessions: z.unknown(),
});

export const ClaudeSessionArchived = z.object({
  type: z.literal("claude_session_archived"),
  archivedId: z.string(),
});

export const ClaudeRegisterExternalSessionResponse = z.object({
  type: z.literal("register_external_session_response"),
  responseId: z.string().optional(),
  sessionId: z.string(),
});

export const ClaudeSessionActivity = z.object({
  type: z.literal("session_activity"),
  activity: z.unknown(),
});

export const ClaudePermissionRequest = z.object({
  type: z.literal("permission_request"),
  approvalId: z.string(),
  toolName: z.string(),
  toolInput: z.unknown(),
  sessionId: z.string().optional(),
});

export const ClaudeOutgoing = z.discriminatedUnion("type", [
  ClaudeStarted,
  ClaudeEntry,
  ClaudeQueueUpdated,
  ClaudeDone,
  ClaudeError,
  ClaudeSessionList,
  ClaudeHistory,
  ClaudeSessionUpdated,
  ClaudeQaTargetUrlUpdated,
  ClaudeQaTargetUrlDetected,
  ClaudeSessionDeleted,
  ClaudeSessionRestored,
  ClaudeDeletedSessionsList,
  ClaudeSessionArchived,
  ClaudeRegisterExternalSessionResponse,
  ClaudeSessionActivity,
  ClaudePermissionRequest,
]);
export type ClaudeOutgoing = z.infer<typeof ClaudeOutgoing>;
