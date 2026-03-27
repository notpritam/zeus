import z from "zod";

export const ChannelName = z.enum([
  "control",
  "terminal",
  "claude",
  "git",
  "files",
  "qa",
  "status",
  "settings",
  "subagent",
  "mcp",
  "permissions",
  "tasks",
  "android",
  "perf",
]);
export type ChannelName = z.infer<typeof ChannelName>;

export const WsEnvelopeSchema = z.object({
  channel: ChannelName,
  sessionId: z.string(),
  payload: z.unknown(),
  auth: z.string(),
});
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;
