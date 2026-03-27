import z from "zod";

// ─── Client → Server ───

export const QaStartQa = z.object({
  type: z.literal("start_qa"),
  responseId: z.string().optional(),
});

export const QaStopQa = z.object({
  type: z.literal("stop_qa"),
});

export const QaGetQaStatus = z.object({
  type: z.literal("get_qa_status"),
  responseId: z.string().optional(),
});

export const QaLaunchInstance = z.object({
  type: z.literal("launch_instance"),
  headless: z.boolean(),
  responseId: z.string().optional(),
});

export const QaStopInstance = z.object({
  type: z.literal("stop_instance"),
  instanceId: z.string(),
});

export const QaNavigate = z.object({
  type: z.literal("navigate"),
  url: z.string(),
});

export const QaSnapshot = z.object({
  type: z.literal("snapshot"),
  filter: z.unknown().optional(),
});

export const QaScreenshot = z.object({
  type: z.literal("screenshot"),
});

export const QaAction = z.object({
  type: z.literal("action"),
  kind: z.string(),
  ref: z.unknown().optional(),
  value: z.unknown().optional(),
  key: z.unknown().optional(),
});

export const QaText = z.object({
  type: z.literal("text"),
});

export const QaListTabs = z.object({
  type: z.literal("list_tabs"),
});

export const QaListQaFlows = z.object({
  type: z.literal("list_qa_flows"),
});

export const QaIncoming = z.discriminatedUnion("type", [
  QaStartQa,
  QaStopQa,
  QaGetQaStatus,
  QaLaunchInstance,
  QaStopInstance,
  QaNavigate,
  QaSnapshot,
  QaScreenshot,
  QaAction,
  QaText,
  QaListTabs,
  QaListQaFlows,
]);
export type QaIncoming = z.infer<typeof QaIncoming>;

// ─── Server → Client ───

export const QaStarted = z.object({
  type: z.literal("qa_started"),
  responseId: z.string().optional(),
});

export const QaStopped = z.object({
  type: z.literal("qa_stopped"),
});

export const QaStatus = z.object({
  type: z.literal("qa_status"),
  running: z.boolean(),
  instances: z.unknown(),
  responseId: z.string().optional(),
});

export const QaInstanceLaunched = z.object({
  type: z.literal("instance_launched"),
  instance: z.unknown(),
  responseId: z.string().optional(),
});

export const QaInstanceStopped = z.object({
  type: z.literal("instance_stopped"),
  instanceId: z.string(),
});

export const QaNavigateResult = z.object({
  type: z.literal("navigate_result"),
  url: z.string(),
  title: z.string(),
});

export const QaSnapshotResult = z.object({
  type: z.literal("snapshot_result"),
  nodes: z.unknown(),
  raw: z.unknown(),
});

export const QaScreenshotResult = z.object({
  type: z.literal("screenshot_result"),
  dataUrl: z.string(),
});

export const QaActionResult = z.object({
  type: z.literal("action_result"),
  success: z.boolean(),
  message: z.string().optional(),
});

export const QaTextResult = z.object({
  type: z.literal("text_result"),
  text: z.string(),
});

export const QaTabsList = z.object({
  type: z.literal("tabs_list"),
  tabs: z.unknown(),
});

export const QaFlowsList = z.object({
  type: z.literal("qa_flows_list"),
  flows: z.unknown(),
});

export const QaError = z.object({
  type: z.literal("qa_error"),
  message: z.string(),
  responseId: z.string().optional(),
});

export const QaCdpConsole = z.object({
  type: z.literal("cdp_console"),
  logs: z.unknown(),
});

export const QaCdpNetwork = z.object({
  type: z.literal("cdp_network"),
  requests: z.unknown(),
});

export const QaCdpError = z.object({
  type: z.literal("cdp_error"),
  errors: z.unknown(),
});

export const QaOutgoing = z.discriminatedUnion("type", [
  QaStarted,
  QaStopped,
  QaStatus,
  QaInstanceLaunched,
  QaInstanceStopped,
  QaNavigateResult,
  QaSnapshotResult,
  QaScreenshotResult,
  QaActionResult,
  QaTextResult,
  QaTabsList,
  QaFlowsList,
  QaError,
  QaCdpConsole,
  QaCdpNetwork,
  QaCdpError,
]);
export type QaOutgoing = z.infer<typeof QaOutgoing>;
