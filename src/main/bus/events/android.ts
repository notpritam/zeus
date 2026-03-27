import z from "zod";
import { BusEvent } from "../event";

export const AndroidEvents = {
  Started: BusEvent.define("android.started", z.object({})),
  Stopped: BusEvent.define("android.stopped", z.object({})),
  DeviceList: BusEvent.define("android.device_list", z.object({ devices: z.unknown(), avds: z.unknown() })),
  Screenshot: BusEvent.define("android.screenshot", z.object({ dataUrl: z.string() })),
  ViewHierarchy: BusEvent.define("android.view_hierarchy", z.object({ nodes: z.unknown() })),
  Logcat: BusEvent.define("android.logcat", z.object({ entries: z.unknown() })),
  Error: BusEvent.define("android.error", z.object({ message: z.string() })),
  AppInstalled: BusEvent.define("android.app_installed", z.object({ success: z.boolean() })),
  AppLaunched: BusEvent.define("android.app_launched", z.object({ success: z.boolean() })),
};
