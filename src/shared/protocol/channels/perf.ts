import z from "zod";

// ─── Client → Server ───

export const PerfGetPerf = z.object({
  type: z.literal("get_perf"),
});

export const PerfSetPollInterval = z.object({
  type: z.literal("set_poll_interval"),
  intervalMs: z.number(),
});

export const PerfStartMonitoring = z.object({
  type: z.literal("start_monitoring"),
});

export const PerfStopMonitoring = z.object({
  type: z.literal("stop_monitoring"),
});

export const PerfIncoming = z.discriminatedUnion("type", [
  PerfGetPerf,
  PerfSetPollInterval,
  PerfStartMonitoring,
  PerfStopMonitoring,
]);
export type PerfIncoming = z.infer<typeof PerfIncoming>;

// ─── Server → Client ───

export const PerfUpdate = z.object({
  type: z.literal("perf_update"),
  metrics: z.unknown(),
});

export const PerfOutgoing = z.discriminatedUnion("type", [
  PerfUpdate,
]);
export type PerfOutgoing = z.infer<typeof PerfOutgoing>;
