import z from "zod";
import { BusEvent } from "../event";

export const PerfEvents = {
  MetricsUpdated: BusEvent.define("perf.metrics_updated", z.object({ metrics: z.unknown() })),
  MonitoringStarted: BusEvent.define("perf.monitoring_started", z.object({})),
  MonitoringStopped: BusEvent.define("perf.monitoring_stopped", z.object({})),
};
