import z from "zod";

// ─── Client → Server ───

export const SubagentStartSubagent = z.object({
  type: z.literal("start_subagent"),
  subagentType: z.string().optional(),
  cli: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  workingDir: z.string(),
  parentSessionId: z.string(),
  parentSessionType: z.string().optional(),
  name: z.string().optional(),
  responseId: z.string().optional(),
});

export const SubagentStopSubagent = z.object({
  type: z.literal("stop_subagent"),
  subagentId: z.string(),
});

export const SubagentDeleteSubagent = z.object({
  type: z.literal("delete_subagent"),
  subagentId: z.string(),
  parentSessionId: z.string().optional(),
});

export const SubagentListSubagents = z.object({
  type: z.literal("list_subagents"),
  parentSessionId: z.string(),
});

export const SubagentMessage = z.object({
  type: z.literal("subagent_message"),
  subagentId: z.string(),
  text: z.string(),
});

export const SubagentClearSubagentEntries = z.object({
  type: z.literal("clear_subagent_entries"),
  subagentId: z.string(),
});

export const SubagentGetSubagentEntries = z.object({
  type: z.literal("get_subagent_entries"),
  subagentId: z.string(),
});

export const SubagentRegisterExternalSubagent = z.object({
  type: z.literal("register_external_subagent"),
  parentSessionId: z.string().optional(),
  parentSessionType: z.string().optional(),
  subagentType: z.string().optional(),
  task: z.string().optional(),
  targetUrl: z.string().optional(),
  name: z.string().optional(),
  responseId: z.string().optional(),
});

export const SubagentExternalSubagentEntry = z.object({
  type: z.literal("external_subagent_entry"),
  subagentId: z.string(),
  entry: z.unknown(),
});

export const SubagentExternalSubagentDone = z.object({
  type: z.literal("external_subagent_done"),
  subagentId: z.string(),
  status: z.string(),
});

export const SubagentIncoming = z.discriminatedUnion("type", [
  SubagentStartSubagent,
  SubagentStopSubagent,
  SubagentDeleteSubagent,
  SubagentListSubagents,
  SubagentMessage,
  SubagentClearSubagentEntries,
  SubagentGetSubagentEntries,
  SubagentRegisterExternalSubagent,
  SubagentExternalSubagentEntry,
  SubagentExternalSubagentDone,
]);
export type SubagentIncoming = z.infer<typeof SubagentIncoming>;

// ─── Server → Client ───

export const SubagentStarted = z.object({
  type: z.literal("subagent_started"),
  subagentId: z.string(),
  subagentType: z.string(),
  cli: z.string(),
  parentSessionId: z.string(),
  parentSessionType: z.string().optional(),
  name: z.string().optional(),
  task: z.string().optional(),
  targetUrl: z.string().optional(),
});

export const SubagentStopped = z.object({
  type: z.literal("subagent_stopped"),
  subagentId: z.string(),
  parentSessionId: z.string(),
});

export const SubagentDeleted = z.object({
  type: z.literal("subagent_deleted"),
  subagentId: z.string(),
  parentSessionId: z.string().optional(),
});

export const SubagentEntry = z.object({
  type: z.literal("subagent_entry"),
  subagentId: z.string(),
  parentSessionId: z.string(),
  entry: z.unknown(),
});

export const SubagentList = z.object({
  type: z.literal("subagent_list"),
  parentSessionId: z.string(),
  agents: z.unknown(),
});

export const SubagentEntries = z.object({
  type: z.literal("subagent_entries"),
  subagentId: z.string(),
  entries: z.unknown(),
});

export const SubagentResult = z.object({
  type: z.literal("subagent_result"),
  subagentId: z.string(),
  parentSessionId: z.string(),
  result: z.unknown(),
  responseId: z.string().optional(),
});

export const SubagentError = z.object({
  type: z.literal("subagent_error"),
  message: z.string(),
  subagentId: z.string().optional(),
});

export const SubagentRegisterExternalSubagentResponse = z.object({
  type: z.literal("register_external_subagent_response"),
  subagentId: z.string(),
  responseId: z.string().optional(),
});

export const SubagentOutgoing = z.discriminatedUnion("type", [
  SubagentStarted,
  SubagentStopped,
  SubagentDeleted,
  SubagentEntry,
  SubagentList,
  SubagentEntries,
  SubagentResult,
  SubagentError,
  SubagentRegisterExternalSubagentResponse,
]);
export type SubagentOutgoing = z.infer<typeof SubagentOutgoing>;
