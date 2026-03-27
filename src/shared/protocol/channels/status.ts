import z from "zod";

// ─── Client → Server ───

export const StatusGetStatus = z.object({
  type: z.literal("get_status"),
});

export const StatusTogglePower = z.object({
  type: z.literal("toggle_power"),
});

export const StatusStopTunnel = z.object({
  type: z.literal("stop_tunnel"),
});

export const StatusToggleTunnel = z.object({
  type: z.literal("toggle_tunnel"),
});

export const StatusIncoming = z.discriminatedUnion("type", [
  StatusGetStatus,
  StatusTogglePower,
  StatusStopTunnel,
  StatusToggleTunnel,
]);
export type StatusIncoming = z.infer<typeof StatusIncoming>;

// ─── Server → Client ───

export const StatusUpdate = z.object({
  type: z.literal("status_update"),
  powerBlock: z.boolean(),
  websocket: z.boolean(),
  tunnel: z.string().nullable().optional(),
});

export const StatusOutgoing = z.discriminatedUnion("type", [
  StatusUpdate,
]);
export type StatusOutgoing = z.infer<typeof StatusOutgoing>;
