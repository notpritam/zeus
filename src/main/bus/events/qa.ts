import z from "zod";
import { BusEvent } from "../event";

export const QaEvents = {
  Started: BusEvent.define("qa.started", z.object({})),
  Stopped: BusEvent.define("qa.stopped", z.object({})),
  InstanceList: BusEvent.define("qa.instance_list", z.object({ instances: z.unknown() })),
  SnapshotResult: BusEvent.define("qa.snapshot_result", z.object({ nodes: z.unknown(), raw: z.string().nullable() })),
  ScreenshotResult: BusEvent.define("qa.screenshot_result", z.object({ dataUrl: z.string() })),
  TextResult: BusEvent.define("qa.text_result", z.object({ text: z.string() })),
  NavigateResult: BusEvent.define("qa.navigate_result", z.object({ url: z.string(), title: z.string() })),
  ActionResult: BusEvent.define("qa.action_result", z.object({ success: z.boolean(), message: z.string().optional() })),
  TabsList: BusEvent.define("qa.tabs_list", z.object({ tabs: z.unknown() })),
  Error: BusEvent.define("qa.error", z.object({ message: z.string() })),
  ConsoleLogs: BusEvent.define("qa.console_logs", z.object({ logs: z.unknown() })),
  NetworkRequests: BusEvent.define("qa.network_requests", z.object({ requests: z.unknown() })),
  JsErrors: BusEvent.define("qa.js_errors", z.object({ errors: z.unknown() })),
  UrlDetectionResult: BusEvent.define("qa.url_detection_result", z.object({
    sessionId: z.string(), qaTargetUrl: z.string().nullable(), source: z.string(),
    detail: z.string(), framework: z.string().optional(), verification: z.string().optional(),
  })),
};
