import type { HandlerContext } from "../router";
import type { PerfPayload, ProcessMetric } from "../../types";
import { SystemMonitorService } from "../../services/system-monitor";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:perf" });

// System monitor service — singleton for this handler
const systemMonitor = new SystemMonitorService();

/** Expose the monitor so server.ts can wire broadcastEnvelope for polling updates. */
export function getSystemMonitor(): SystemMonitorService {
  return systemMonitor;
}

type PidSourceEntry = { sessionId: string; pid: number; type: ProcessMetric["type"]; name: string };

/**
 * Register external PID sources (called once during server bootstrap).
 * This is separated from handler logic because it needs references to other managers.
 */
export function registerPidSources(sources: Array<() => PidSourceEntry[]>): void {
  for (const source of sources) {
    systemMonitor.registerPidSource(source);
  }
}

export async function handlePerf(ctx: HandlerContext): Promise<void> {
  const { envelope } = ctx;
  const payload = envelope.payload as PerfPayload;

  if (payload.type === "get_perf") {
    const metrics = await systemMonitor.collect();
    ctx.send({
      channel: "perf",
      sessionId: "",
      payload: { type: "perf_update", metrics } satisfies PerfPayload,
      auth: "",
    });
  } else if (payload.type === "set_poll_interval") {
    systemMonitor.setPollInterval(payload.intervalMs);
  } else if (payload.type === "start_monitoring") {
    systemMonitor.start();
  } else if (payload.type === "stop_monitoring") {
    systemMonitor.stop();
  }
}
