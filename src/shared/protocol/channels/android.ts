import z from "zod";

// ─── Client → Server ───

export const AndroidStartEmulator = z.object({
  type: z.literal("start_emulator"),
  avdName: z.string().optional(),
  responseId: z.string().optional(),
});

export const AndroidStopEmulator = z.object({
  type: z.literal("stop_emulator"),
  responseId: z.string().optional(),
});

export const AndroidListDevices = z.object({
  type: z.literal("list_devices"),
  responseId: z.string().optional(),
});

export const AndroidGetAndroidStatus = z.object({
  type: z.literal("get_android_status"),
  responseId: z.string().optional(),
});

export const AndroidScreenshot = z.object({
  type: z.literal("screenshot"),
  responseId: z.string().optional(),
});

export const AndroidViewHierarchy = z.object({
  type: z.literal("view_hierarchy"),
  responseId: z.string().optional(),
});

export const AndroidInstallApk = z.object({
  type: z.literal("install_apk"),
  apkPath: z.string(),
  responseId: z.string().optional(),
});

export const AndroidLaunchApp = z.object({
  type: z.literal("launch_app"),
  appId: z.string(),
  responseId: z.string().optional(),
});

export const AndroidIncoming = z.discriminatedUnion("type", [
  AndroidStartEmulator,
  AndroidStopEmulator,
  AndroidListDevices,
  AndroidGetAndroidStatus,
  AndroidScreenshot,
  AndroidViewHierarchy,
  AndroidInstallApk,
  AndroidLaunchApp,
]);
export type AndroidIncoming = z.infer<typeof AndroidIncoming>;

// ─── Server → Client ───

export const AndroidEmulatorStarted = z.object({
  type: z.literal("emulator_started"),
  device: z.unknown(),
  responseId: z.string().optional(),
});

export const AndroidEmulatorStopped = z.object({
  type: z.literal("emulator_stopped"),
  responseId: z.string().optional(),
});

export const AndroidDevicesList = z.object({
  type: z.literal("devices_list"),
  devices: z.unknown(),
  avds: z.unknown(),
  responseId: z.string().optional(),
});

export const AndroidStatus = z.object({
  type: z.literal("android_status"),
  running: z.boolean(),
  devices: z.unknown(),
  responseId: z.string().optional(),
});

export const AndroidScreenshotResult = z.object({
  type: z.literal("screenshot_result"),
  dataUrl: z.string(),
  responseId: z.string().optional(),
});

export const AndroidViewHierarchyResult = z.object({
  type: z.literal("view_hierarchy_result"),
  nodes: z.unknown(),
  responseId: z.string().optional(),
});

export const AndroidApkInstalled = z.object({
  type: z.literal("apk_installed"),
  apkPath: z.string(),
  responseId: z.string().optional(),
});

export const AndroidAppLaunched = z.object({
  type: z.literal("app_launched"),
  appId: z.string(),
  responseId: z.string().optional(),
});

export const AndroidLogcatEntries = z.object({
  type: z.literal("logcat_entries"),
  entries: z.unknown(),
});

export const AndroidError = z.object({
  type: z.literal("android_error"),
  message: z.string(),
  responseId: z.string().optional(),
});

export const AndroidOutgoing = z.discriminatedUnion("type", [
  AndroidEmulatorStarted,
  AndroidEmulatorStopped,
  AndroidDevicesList,
  AndroidStatus,
  AndroidScreenshotResult,
  AndroidViewHierarchyResult,
  AndroidApkInstalled,
  AndroidAppLaunched,
  AndroidLogcatEntries,
  AndroidError,
]);
export type AndroidOutgoing = z.infer<typeof AndroidOutgoing>;
