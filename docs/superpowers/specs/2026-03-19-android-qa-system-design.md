# Android QA System — Design Spec

**Date:** 2026-03-19
**Status:** Reviewed
**Approach:** Mirror Pattern — parallel to existing PinchTab/Web QA
**Review:** Spec-reviewed with all critical/important issues resolved (see Appendices A–D)

---

## 1. Overview

Add Android device automation to Zeus, mirroring the existing PinchTab-based Web QA system. A headless Android emulator runs on the host machine, controlled via **Maestro MCP** (native) and **ADB** (supplementary). QA agents interact with Android apps the same way they interact with web apps today — through MCP tools, with logs streamed to the UI in real time.

### Goals

- Zeus manages the full Android emulator lifecycle (start, stop, detect running)
- QA agents can be spawned as "Android QA" type, using Maestro MCP tools
- A dedicated **AndroidPanel** in the UI provides direct device control (devices, screenshot, view hierarchy, logcat)
- Reuse the existing subagent infrastructure — same WebSocket channels, same entry streaming, same SubagentPanel rendering

### Non-Goals

- iOS Simulator support (future work)
- Physical device support (future work)
- Building a custom Maestro wrapper — we use the native `maestro mcp` server directly
- Screen mirroring / live video stream (screenshots are sufficient)
- Multiple simultaneous emulators (single emulator at a time, like PinchTab's single-instance model)

---

## 2. Architecture

### 2.1 System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Main Claude Agent (or Subagent Parent)                               │
│ Calls: zeus_android_qa_run() MCP tool                                │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ WebSocket deferred-response pattern
                   ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Zeus Host (Electron Main Process)                                    │
│                                                                      │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐     │
│  │ AndroidQAService     │   │ WebSocket Server                 │     │
│  │ - Emulator lifecycle │   │ - handleAndroid() [new channel]  │     │
│  │ - ADB commands       │   │ - handleSubagent() [extended]    │     │
│  │ - Logcat streaming   │   └──────────────────────────────────┘     │
│  │ - Screenshot proxy   │                                            │
│  └─────────────────────┘                                             │
│                                                                      │
│  ┌─────────────────────┐                                             │
│  │ ClaudeSession        │ ← spawns QA subprocess with:               │
│  │ (existing, extended) │   --mcp-config maestro-mcp.json            │
│  └─────────────────────┘   --mcp-config android-qa-extras            │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ Spawns child Claude process
                   ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Android QA Claude Agent (Spawned Subprocess)                         │
│                                                                      │
│  MCP Server 1: maestro mcp (native, stdio)                           │
│  ├── list_devices, start_device, launch_app, stop_app                │
│  ├── tap_on, input_text, back                                        │
│  ├── take_screenshot, inspect_view_hierarchy                         │
│  ├── run_flow, run_flow_files, check_flow_syntax                     │
│  └── cheat_sheet, query_docs                                         │
│                                                                      │
│  MCP Server 2: android-qa-extras.ts (custom, stdio)                  │
│  ├── android_qa_logcat (read logcat logs)                             │
│  ├── android_qa_finish (signal completion, write result file)         │
│  └── android_qa_device_info (get device properties)                  │
└──────────────────────────────────────────────────────────────────────┘
                   │
                   ├──→ Maestro CLI (controls emulator via ADB internally)
                   └──→ ADB (logcat, device properties)
```

### 2.2 Component Mapping (Web QA → Android QA)

| Web QA Component | Android QA Equivalent | Notes |
|---|---|---|
| `QAService` (PinchTab lifecycle) | `AndroidQAService` (emulator + Maestro lifecycle) | New service |
| `qa-server.ts` (40+ browser tools) | `maestro mcp` (14 native tools) + `android-qa-extras.ts` | Maestro is native; extras are thin |
| `CdpClient` (console/network/errors) | `LogcatStream` (Android system logs) | ADB logcat replaces CDP |
| `BrowserPanel` (direct web control) | `AndroidPanel` (direct device control) | New UI component |
| `zeus_qa_run` (bridge tool) | `zeus_android_qa_run` (bridge tool) | New bridge tool |
| `handleQA` in WebSocket | `handleAndroid` in WebSocket | New channel handler |
| CDP state file (`/tmp/zeus-qa-cdp-state.json`) | Logcat state file (`/tmp/zeus-android-logcat-state.json`) | Same pattern |

---

## 3. New Components — Detailed Design

### 3.1 AndroidQAService (`src/main/services/android-qa.ts`)

Mirrors `QAService`. Manages the Android emulator lifecycle and provides proxy methods for direct panel control.

**Lifecycle policy:** The emulator persists after QA agent completion. Users stop it explicitly via AndroidPanel or `zeus_android_stop`. This mirrors PinchTab's behavior where the browser instance outlives individual QA agents.

```typescript
export interface AndroidDeviceInfo {
  deviceId: string;      // e.g. "emulator-5554"
  avdName: string;       // e.g. "Pixel_9"
  status: 'running' | 'offline' | 'booting';
  apiLevel?: number;     // e.g. 35
  platform: 'android';
}

export class AndroidQAService extends EventEmitter {
  private emulatorProc: ChildProcess | null = null;
  private logcatProc: ChildProcess | null = null;
  private running = false;
  private deviceId: string | null = null;
  private maestroMcpPath: string;    // path to maestro binary

  // ─── Lifecycle ───

  /**
   * Start a headless Android emulator.
   * Returns early if already running (single-instance guard, like QAService).
   * 1. Check for already-running emulators via `adb devices`
   * 2. If none running, spawn: emulator -avd <name> -no-window -no-audio
   * 3. Wait for boot: poll `adb shell getprop sys.boot_completed` until "1"
   * 4. Start logcat streaming
   */
  async start(avdName?: string): Promise<AndroidDeviceInfo>

  /**
   * Stop the emulator and logcat stream.
   * 1. Kill logcat process
   * 2. Run `adb emu kill` for managed emulators
   * 3. Clean up state
   */
  async stop(): Promise<void>

  /**
   * List all available AVDs (installed emulator images).
   * Runs: emulator -list-avds
   * Returns: string[] of AVD names
   */
  async listAvds(): Promise<string[]>

  /**
   * List all connected devices (running emulators + physical).
   * Runs: adb devices -l
   * Parses output into AndroidDeviceInfo[]
   * Merges with AVD names for display
   */
  async listDevices(): Promise<AndroidDeviceInfo[]>

  /**
   * Detect if an emulator is already running.
   * If yes, attach to it (set deviceId, start logcat) without spawning a new one.
   */
  async detectRunning(): Promise<AndroidDeviceInfo | null>

  isRunning(): boolean
  getDeviceId(): string | null

  // ─── Direct Control (for AndroidPanel) ───

  /**
   * Take a screenshot via ADB.
   * Runs: adb exec-out screencap -p
   * Returns: base64 PNG data URL
   */
  async screenshot(): Promise<string>

  /**
   * Get view hierarchy via Maestro.
   * Calls maestro's inspect_view_hierarchy through a one-shot stdio call,
   * OR uses `adb exec-out uiautomator dump` as fallback.
   * Returns: structured hierarchy data
   */
  async viewHierarchy(): Promise<AndroidViewNode[]>

  /**
   * Install an APK on the running device.
   * Runs: adb install <apkPath>
   */
  async installApk(apkPath: string): Promise<void>

  /**
   * Launch an app by package ID.
   * Runs: adb shell am start -n <packageId>/<activity>
   * Or via Maestro: maestro --device <id> launch <appId>
   */
  async launchApp(appId: string): Promise<void>

  // ─── Logcat ───

  /**
   * Start streaming logcat output.
   * Spawns: adb logcat -v threadtime
   * Parses each line into { level, tag, message, pid, timestamp }
   * Stores in ring buffer (500 entries)
   * Writes to /tmp/zeus-android-logcat-state.json (debounced 200ms)
   * Emits 'logcat' events for real-time broadcast
   */
  private startLogcat(): void

  /**
   * Get recent logcat entries.
   * Reads from ring buffer, supports filtering by level and tag.
   */
  getLogcatEntries(options?: {
    limit?: number;
    level?: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
    tag?: string;
    sinceLastCall?: boolean;
  }): LogcatEntry[]
}

export interface LogcatEntry {
  timestamp: number;
  pid: number;
  tid: number;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  message: string;
}

export interface AndroidViewNode {
  className: string;
  text?: string;
  resourceId?: string;
  contentDescription?: string;
  bounds: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  children?: AndroidViewNode[];
}
```

#### Emulator Boot Sequence

```
detectRunning()
  │
  ├─ Found running emulator? → attach (set deviceId, start logcat) → done
  │
  └─ No running emulator:
       │
       ├─ avdName provided? → use it
       │
       └─ no avdName? → listAvds() → pick first available
              │
              ├─ No AVDs installed → throw Error("No Android AVDs found")
              │
              └─ Spawn: emulator -avd <name> -no-window -no-audio -no-boot-anim
                   │
                   ├─ Poll: adb shell getprop sys.boot_completed
                   │   (500ms interval, max 240 retries = 120 seconds)
                   │
                   ├─ Boot complete → deviceId = parse from `adb devices`
                   │
                   └─ Start logcat stream
```

#### Binary Discovery

```typescript
function findEmulatorPath(): string {
  // 1. Check ANDROID_HOME / ANDROID_SDK_ROOT env vars
  // 2. Check ~/Library/Android/sdk/emulator/emulator (macOS default)
  // 3. Check PATH
  // Throw if not found with helpful error message
}

function findAdbPath(): string {
  // 1. Check ANDROID_HOME / ANDROID_SDK_ROOT env vars
  // 2. Check ~/Library/Android/sdk/platform-tools/adb (macOS default)
  // 3. Check PATH
  // Throw if not found
}

function findMaestroPath(): string {
  // 1. Check ~/.maestro/bin/maestro
  // 2. Check PATH
  // Throw if not found
}
```

### 3.2 android-qa-extras.ts (`src/main/mcp/android-qa-extras.ts`)

A small supplementary MCP server (stdio) that covers what Maestro's native MCP doesn't: logcat access and the finish/handoff protocol.

```typescript
// Environment variables (auto-injected by ClaudeSession + pre-flight block):
// ZEUS_QA_AGENT_ID — unique agent ID (auto-injected for ALL subagents by ClaudeSession)
// ZEUS_ANDROID_DEVICE_ID — ADB device ID (injected by android_qa pre-flight block)

const server = new McpServer({
  name: 'android-qa-extras',
  version: '1.0.0',
});

// ─── Tool: android_qa_logcat ───
// Read recent Android logcat entries.
// Reads from /tmp/zeus-android-logcat-state.json (written by AndroidQAService)
// Defaults to Info+ level to avoid flooding the agent with Verbose/Debug noise.
server.tool('android_qa_logcat', {
  limit: z.number().optional().default(50),
  level: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional().default('I'),  // default: Info+
  tag: z.string().optional(),
  since_last_call: z.boolean().optional().default(false),
});
// Returns: { entries: LogcatEntry[], total: number }
// Filters entries to the specified level and above (I returns I, W, E, F)
// since_last_call cursor: Track last-read index in a module-level variable.
// On each call with since_last_call=true, return only entries after the cursor, then advance it.

// ─── Tool: android_qa_device_info ───
// Get device properties (model, API level, screen size, etc.)
// Runs: adb -s <deviceId> shell getprop
server.tool('android_qa_device_info', {});
// Returns: { model, apiLevel, screenSize, androidVersion, ... }

// ─── Tool: android_qa_finish ───
// Signal QA completion. Writes result file for Zeus host to read.
// Uses the SAME file naming convention as web QA (zeus-qa-finish-{agentId}.json)
// so the existing readQaFinishFile() function works without modification.
// Reads ZEUS_QA_AGENT_ID (the standard env var, auto-injected by ClaudeSession).
server.tool('android_qa_finish', {
  summary: z.string().describe('Summary of test findings'),
  status: z.enum(['pass', 'fail', 'warning']),  // aligned with web QA status values
});
// Uses: process.env.ZEUS_QA_AGENT_ID (same as qa-server.ts)
// Writes: /tmp/zeus-qa-finish-{ZEUS_QA_AGENT_ID}.json
// Format: { summary, status, timestamp }
```

**Why only 3 tools?** Maestro's native MCP server already provides 14 tools covering all device interaction (tap, type, screenshot, view hierarchy, flow execution, etc.). We only need extras for:
1. **Logcat** — Maestro doesn't expose Android system logs
2. **Finish protocol** — Zeus-specific handoff mechanism (file-based IPC)
3. **Device info** — Convenience tool for device properties

### 3.3 MCP Config (Inline JSON — No Temp Files)

The MCP config is **not** written to a temp file. `ClaudeSession` (line 270) passes it as an inline JSON string via `--mcp-config`:

```bash
npx -y @anthropic-ai/claude-code@latest \
  --mcp-config '{"mcpServers":{"maestro":{...},"android-qa-extras":{...}}}'
```

`ClaudeSession` automatically builds this JSON from the registry's `mcpServers` array (lines 232-244), injecting `ZEUS_QA_AGENT_ID` and `ZEUS_WS_URL` into every MCP server's env. The pre-flight block (Section 3.6) additionally injects `ZEUS_ANDROID_DEVICE_ID` into the `android-qa-extras` server's env.

The resulting config at runtime looks like:

```json
{
  "mcpServers": {
    "maestro": {
      "command": "/Users/<user>/.maestro/bin/maestro",
      "args": ["mcp"]
    },
    "android-qa-extras": {
      "command": "node",
      "args": ["<appPath>/out/main/mcp-android-qa-extras.mjs"],
      "env": {
        "ZEUS_QA_AGENT_ID": "<agentId>",
        "ZEUS_WS_URL": "ws://127.0.0.1:8888",
        "ZEUS_ANDROID_DEVICE_ID": "<deviceId>"
      }
    }
  }
}
```

### 3.4 zeus-bridge.ts Extensions

Add new MCP tools to the existing zeus-bridge server for Android QA.

```typescript
// ═══════════════════════════════════════════
// ─── Android QA Tools ───
// ═══════════════════════════════════════════

// ─── zeus_android_qa_run ───
// Spawn an Android QA agent. Mirrors zeus_qa_run exactly.
server.tool(
  'zeus_android_qa_run',
  'Spawn an Android QA testing agent. The agent controls an Android emulator ' +
  'via Maestro with full device automation. Results appear in the QA panel.',
  {
    task: z.string().describe('What to test on the Android device'),
    app_id: z.string().optional().describe('Android app package ID to test (e.g. "com.example.app")'),
    avd_name: z.string().optional().describe('AVD name to boot (auto-detected if omitted)'),
    parent_session_id: z.string().optional(),
    name: z.string().optional().describe('Display name for the QA agent'),
    working_dir: z.string().optional(),
  },
  async ({ task, app_id, avd_name, parent_session_id, name, working_dir }) => {
    await connectWs();
    const sessionId = parent_session_id ?? process.env.ZEUS_SESSION_ID ?? '';
    const response = await sendAndWait('subagent', {
      type: 'start_subagent',
      subagentType: 'android_qa',        // ← new subagent type
      cli: 'claude',
      inputs: {
        task,
        appId: app_id ?? '',
        avdName: avd_name ?? '',
      },
      name: name ?? undefined,
      workingDir: working_dir ?? process.cwd(),
      parentSessionId: sessionId,
      parentSessionType: 'claude',
    }, 600_000);
    // ... return result (same pattern as zeus_qa_run)
  },
);

// ─── zeus_android_devices ───
// List available AVDs and running emulators.
server.tool(
  'zeus_android_devices',
  'List available Android AVDs and running emulator instances.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'list_devices' }, 15_000);
    return textResult(response);
  },
);

// ─── zeus_android_start ───
// Start an Android emulator.
server.tool(
  'zeus_android_start',
  'Start a headless Android emulator.',
  {
    avd_name: z.string().optional().describe('AVD name (e.g. "Pixel_9"). Auto-picks if omitted.'),
  },
  async ({ avd_name }) => {
    await connectWs();
    const response = await sendAndWait('android', {
      type: 'start_emulator',
      avdName: avd_name,
    }, 120_000);  // 2 min timeout for boot
    return textResult(response);
  },
);

// ─── zeus_android_stop ───
// Stop the running emulator. Uses sendAndWait (not fire-and-forget)
// because emulator shutdown involves killing processes and takes seconds.
server.tool(
  'zeus_android_stop',
  'Stop the running Android emulator.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'stop_emulator' }, 15_000);
    return textResult({ success: true, message: 'Android emulator stopped.' });
  },
);

// ─── zeus_android_screenshot ───
// Take a screenshot of the emulator.
server.tool(
  'zeus_android_screenshot',
  'Take a screenshot of the running Android emulator.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'screenshot' }, 15_000);
    return textResult(response);
  },
);
```

### 3.5 WebSocket Channel: `android`

New channel handler in `websocket.ts`, parallel to `handleQA`.

**Important:** The `WsEnvelope.channel` union in `types.ts` must be extended to include `'android'`:

```typescript
// In WsEnvelope (types.ts line ~170):
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android';
```

The message router switch in `websocket.ts` must also add `case 'android': handleAndroid(ws, envelope); break;`.

```typescript
// ─── Types ───

export type AndroidPayload =
  // Client → Server
  | { type: 'start_emulator'; avdName?: string }
  | { type: 'stop_emulator' }
  | { type: 'list_devices' }
  | { type: 'get_android_status' }
  | { type: 'screenshot' }
  | { type: 'view_hierarchy' }
  | { type: 'install_apk'; apkPath: string }
  | { type: 'launch_app'; appId: string }
  // Server → Client
  | { type: 'android_status'; running: boolean; devices: AndroidDeviceInfo[] }
  | { type: 'emulator_started'; device: AndroidDeviceInfo }
  | { type: 'emulator_stopped' }
  | { type: 'devices_list'; devices: AndroidDeviceInfo[]; avds: string[] }
  | { type: 'screenshot_result'; dataUrl: string }
  | { type: 'view_hierarchy_result'; nodes: AndroidViewNode[]; raw?: string }
  | { type: 'app_launched'; appId: string }
  | { type: 'apk_installed'; apkPath: string }
  // Server → Client (Logcat observability — mirrors CDP events)
  | { type: 'logcat_entries'; entries: LogcatEntry[] }
  | { type: 'android_error'; message: string };
```

#### Singleton Instantiation

```typescript
// Module-level singleton in websocket.ts (mirrors qaService pattern):
let androidQAService: AndroidQAService | null = null;

function getAndroidQAService(): AndroidQAService {
  if (!androidQAService) {
    androidQAService = new AndroidQAService();
  }
  return androidQAService;
}
```

#### handleAndroid Implementation

```typescript
async function handleAndroid(ws: WebSocket, envelope: Envelope): Promise<void> {
  const payload = envelope.payload as AndroidPayload;
  const service = getAndroidQAService();

  switch (payload.type) {
    case 'start_emulator': {
      try {
        const device = await service.start(payload.avdName);
        // Wire logcat streaming to UI — remove previous listeners first to prevent leaks
        service.removeAllListeners('logcat');
        service.on('logcat', (entries: LogcatEntry[]) => {
          broadcast({ channel: 'android', payload: { type: 'logcat_entries', entries } });
        });
        respond(ws, envelope, { type: 'emulator_started', device });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'stop_emulator': {
      try {
        await service.stop();
        respond(ws, envelope, { type: 'emulator_stopped' });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'list_devices': {
      try {
        const devices = await service.listDevices();
        const avds = await service.listAvds();
        respond(ws, envelope, { type: 'devices_list', devices, avds });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'screenshot': {
      try {
        const dataUrl = await service.screenshot();
        respond(ws, envelope, { type: 'screenshot_result', dataUrl });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'view_hierarchy': {
      try {
        const nodes = await service.viewHierarchy();
        respond(ws, envelope, { type: 'view_hierarchy_result', nodes });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'install_apk': {
      try {
        await service.installApk(payload.apkPath);
        respond(ws, envelope, { type: 'apk_installed', apkPath: payload.apkPath });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'launch_app': {
      try {
        await service.launchApp(payload.appId);
        respond(ws, envelope, { type: 'app_launched', appId: payload.appId });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'get_android_status': {
      try {
        const devices = await service.listDevices();
        respond(ws, envelope, {
          type: 'android_status',
          running: service.isRunning(),
          devices,
        });
      } catch (err) {
        respond(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }
  }
}
```

### 3.6 Subagent Registry Integration

**Instead of forking `handleSubagent`**, register `'android_qa'` in the existing subagent registry (`subagent-registry.ts`). This ensures Android QA agents get the full subagent infrastructure for free: `wireSubagent()`, DB persistence, deferred responses, entry streaming, and screenshot interception.

#### Registry Entry

```typescript
// In subagent-registry.ts — register alongside 'qa' and 'plan_reviewer'.
// Uses SubagentTypeDefinition interface with all required fields.

registerSubagentType({
  type: 'android_qa',
  name: 'Android QA Tester',
  icon: 'Smartphone',
  description: 'Android device QA testing with Maestro automation',
  inputFields: [
    { key: 'task', label: 'Task', type: 'textarea', required: true, placeholder: 'What to test on the Android device...' },
    { key: 'appId', label: 'App ID', type: 'text', required: false, placeholder: 'com.example.app (optional)' },
    { key: 'avdName', label: 'AVD Name', type: 'text', required: false, placeholder: 'Auto-detected if omitted' },
  ],

  // buildPrompt receives Record<string, string> — deviceId is injected
  // by the pre-flight block in handleSubagent (see Section 3.6)
  buildPrompt: (inputs: Record<string, string>, context: SubagentContext) => {
    return [
      `You are a QA testing agent for an Android application.`,
      inputs.deviceId ? `Device: ${inputs.deviceId}` : '',
      inputs.appId ? `App under test: ${inputs.appId}` : '',
      ``,
      `Use Maestro MCP tools to interact with the device:`,
      `- inspect_view_hierarchy: see what's on screen before tapping`,
      `- tap_on: tap elements by text or ID`,
      `- input_text: type into focused fields`,
      `- take_screenshot: capture the screen`,
      `- run_flow: execute multi-step YAML flows`,
      `- back: press the back button`,
      ``,
      `Use android_qa_extras tools for:`,
      `- android_qa_logcat: read Android system logs (defaults to Info+ level)`,
      `- android_qa_device_info: get device properties`,
      `- android_qa_finish: call this when done with summary and status`,
      ``,
      `IMPORTANT: Always call android_qa_finish() when you are done testing.`,
      ``,
      `---`,
      ``,
      `Task: ${inputs.task}`,
    ].filter(Boolean).join('\n');
  },

  permissionMode: 'bypassPermissions',

  // mcpServers is a SubagentMcpConfig[] array (not an object/function).
  // Env vars like ZEUS_QA_AGENT_ID and ZEUS_WS_URL are injected automatically
  // by ClaudeSession (claude-session.ts lines 232-244) for all subagents.
  // ZEUS_ANDROID_DEVICE_ID is injected by the pre-flight block.
  //
  // IMPORTANT: Do NOT call findMaestroPath() here — this runs at module load
  // (app startup). If Maestro isn't installed, Zeus would crash entirely.
  // Use a placeholder; the pre-flight block resolves the actual path at spawn time.
  mcpServers: [
    {
      name: 'maestro',
      command: 'maestro',  // placeholder — resolved by pre-flight block
      args: ['mcp'],
    },
    {
      name: 'android-qa-extras',
      command: 'node',
      args: [path.resolve(app.getAppPath(), 'out/main/mcp-android-qa-extras.mjs')],
      // Note: ZEUS_QA_AGENT_ID is auto-injected by ClaudeSession for all subagents.
      // ZEUS_ANDROID_DEVICE_ID is injected by the pre-flight block (see Section 3.6).
    },
  ],

  cli: 'claude',
});
```

**Key differences from the original spec:**
- Uses `SubagentTypeDefinition` interface with all required fields (`type`, `name`, `icon`, `description`, `inputFields`, `cli`)
- `mcpServers` is a `SubagentMcpConfig[]` array, not a function — matches `qa` and `plan_reviewer` registrations
- `buildPrompt` takes `(inputs: Record<string, string>, context: SubagentContext)` — matching the actual signature
- Dynamic values (`deviceId`) are injected into `inputs` by the pre-flight block, not the registry

#### Pre-Flight Block in handleSubagent

The only custom code needed in `handleSubagent` is the emulator lifecycle setup, added as a pre-flight block before the existing `wireSubagent` call:

```typescript
// Inside handleSubagent(), before wireSubagent():

if (subagentType === 'android_qa') {
  const service = getAndroidQAService();

  // 1. Ensure emulator is running (detect existing or boot new)
  let device = await service.detectRunning();
  if (!device) {
    device = await service.start(inputs.avdName);
  }

  // 2. Wire logcat streaming (remove old listeners to prevent leaks)
  service.removeAllListeners('logcat');
  service.on('logcat', (entries) => {
    broadcast({ channel: 'android', payload: { type: 'logcat_entries', entries } });
  });

  // 3. If appId provided, launch the app
  if (inputs.appId) {
    await service.launchApp(inputs.appId);
  }

  // 4. Inject deviceId into inputs so buildPrompt() can reference it
  inputs.deviceId = device.deviceId;

  // 5. Clone mcpServers from registry to avoid mutating the shared definition.
  //    getSubagentType() returns the live Map entry — mutating it would
  //    permanently alter the registry for all future spawns.
  //    Then: resolve the maestro path (deferred from registration time)
  //    and inject ZEUS_ANDROID_DEVICE_ID into the extras server env.
  const def = getSubagentType('android_qa');
  const clonedMcpServers = def.mcpServers.map(s => ({
    ...s,
    args: s.args ? [...s.args] : undefined,
    env: s.env ? { ...s.env } : undefined,
  }));

  // Resolve maestro path at spawn time (not module load — avoids crash if not installed)
  const maestroServer = clonedMcpServers.find(s => s.name === 'maestro');
  if (maestroServer) {
    maestroServer.command = findMaestroPath();
  }

  // Inject device ID into extras server
  const extrasServer = clonedMcpServers.find(s => s.name === 'android-qa-extras');
  if (extrasServer) {
    extrasServer.env = {
      ...(extrasServer.env ?? {}),
      ZEUS_ANDROID_DEVICE_ID: device.deviceId,
    };
  }

  // Override the session's mcpServers with the cloned + resolved copy
  sessionOptions.mcpServers = clonedMcpServers;
}

// enableQA is intentionally NOT set for android_qa subagents.
// enableQA controls PinchTab/web QA setup in ClaudeSession. Android QA
// uses Maestro MCP instead, so enableQA: false (the default) is correct.

// ... existing wireSubagent() handles the rest:
// - spawns ClaudeSession with MCP config from registry (passed as inline JSON
//   via --mcp-config flag, NOT temp files — see claude-session.ts line 270)
// - wires entry streaming
// - handles deferred response via readQaFinishFile()
// - broadcasts subagent_started / subagent_stopped
```

#### Screenshot Interception

The existing `wireSubagent` function intercepts screenshot tool results and re-fetches the image. The current code does **not** check `subagentType` — it checks whether `qaService` is running and re-fetches from PinchTab. For Android QA, we add an additional check:

```typescript
// In wireSubagent(), where screenshot tool results are intercepted (websocket.ts:738-751):
// The existing code uses entry.entryType.type === 'tool_use' and /screenshot/i.test(toolName).
// We extend the existing block with an else-if for android_qa:

if (entry.entryType.type === 'tool_use') {
  const { toolName, status } = entry.entryType;
  const isScreenshot = /screenshot/i.test(toolName);
  if (isScreenshot && status === 'success') {
    // Existing behavior: if PinchTab is running, re-fetch from it (unchanged)
    if (qaService?.isRunning()) {
      try {
        const imageData = await qaService.screenshot();
        if (imageData) {
          const meta = (entry.metadata ?? {}) as Record<string, unknown>;
          meta.images = [imageData];
          entry = { ...entry, metadata: meta };
        }
      } catch { /* non-critical */ }
    }
    // New: if this is an android_qa agent and emulator is running, re-fetch via ADB
    else if (record.subagentType === 'android_qa' && getAndroidQAService()?.isRunning()) {
      try {
        const imageData = await getAndroidQAService().screenshot();
        if (imageData) {
          const meta = (entry.metadata ?? {}) as Record<string, unknown>;
          meta.images = [imageData];
          entry = { ...entry, metadata: meta };
        }
      } catch { /* non-critical */ }
    }
  }
}
```

Note: The `else if` ensures we don't break existing behavior — PinchTab check comes first (unchanged), Android only fires when PinchTab isn't running. The field path (`entry.entryType.type === 'tool_use'` + `toolName`) matches the existing wireSubagent code exactly.

#### Finish File Convention

The `android_qa_finish` tool writes to `zeus-qa-finish-{agentId}.json` — the **same naming convention** as web QA. Since the agentId is unique (e.g., `qa-agent-3-1710000000`), there is no collision. This means the existing `readQaFinishFile()` function works for Android QA agents without modification.

### 3.7 Type Extensions (`src/shared/types.ts`)

All types live in `src/shared/types.ts` as the single source of truth (per project convention). The service file (`android-qa.ts`) imports from here.

```typescript
// ─── Extend WsEnvelope.channel union ───
// Line ~170 of types.ts:
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude'
       | 'settings' | 'files' | 'perf' | 'subagent' | 'android';  // ← add 'android'

// ─── Extend SubagentType ───
export type SubagentType = 'qa' | 'android_qa' | 'plan_reviewer';

// ─── New Android-specific types ───

export interface AndroidDeviceInfo {
  deviceId: string;      // e.g. "emulator-5554"
  avdName: string;       // e.g. "Pixel_9"
  status: 'running' | 'offline' | 'booting';
  apiLevel?: number;     // e.g. 35
  platform: 'android';
}

export interface AndroidViewNode {
  className: string;
  text?: string;
  resourceId?: string;
  contentDescription?: string;
  bounds: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  children?: AndroidViewNode[];
}

export interface LogcatEntry {
  timestamp: number;     // Unix ms — use Date.now() at parse time (logcat only has MM-DD, no year)
  pid: number;
  tid: number;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  message: string;
}

// AndroidPayload — full definition (see section 3.5)
```

### 3.8 SubagentPanel & RightPanel Updates

**SubagentPanel.tsx:** Has a manually-synced `SUBAGENT_TYPES` array (lines 28-49) used for the agent type dropdown. Must add `'android_qa'` with label `'Android QA Tester'` and icon `Smartphone` (import from `lucide-react`).

**RightPanel.tsx:** Three changes required:

1. **Activity bar icon** (lines 199-241): Add a new `ActivityBarIcon` after the Globe (browser) icon and before Settings:
   ```tsx
   <ActivityBarIcon
     icon={Smartphone}
     tab="android"
     tooltip="Android"
   />
   ```
   Import `Smartphone` from `lucide-react`.

2. **Tab type union** (line 85): Extend `tab` type to include `'android'`.

3. **Tab rendering** (line 190): Add `activeRightTab === 'android' ? <AndroidPanel />` to the ternary chain before the final `<SubagentPanel />` fallback.

### 3.9 AndroidPanel (`src/renderer/src/components/AndroidPanel.tsx`)

New UI component with 4 tabs, mirroring BrowserPanel's structure.

#### Tab 1: Devices

```
┌─────────────────────────────────────────────────┐
│ Android Devices                    [Start] [Stop]│
├─────────────────────────────────────────────────┤
│                                                  │
│  AVDs Available:                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ ● Pixel_9           API 35    [Launch]     │  │
│  │ ○ Medium_Phone      API 36                 │  │
│  │ ○ Pixel_4           API 33                 │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Running:                                        │
│  ┌────────────────────────────────────────────┐  │
│  │ ✓ emulator-5554  Pixel_9  Running          │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

- Lists installed AVDs from `listAvds()`
- Shows running emulators from `listDevices()`
- Start/stop buttons trigger `start_emulator` / `stop_emulator` via WebSocket
- Auto-refreshes on `emulator_started` / `emulator_stopped` events

#### Tab 2: Screenshot

```
┌─────────────────────────────────────────────────┐
│ Screenshot                      [📷 Capture]     │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │        [Emulator Screenshot Image]         │  │
│  │                                            │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Captured: 2026-03-19 14:02:15                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

- Capture button sends `screenshot` via WebSocket `android` channel
- Displays the returned base64 PNG
- Shows timestamp of last capture

#### Tab 3: View Hierarchy

```
┌─────────────────────────────────────────────────┐
│ View Hierarchy                  [🔄 Refresh]     │
├─────────────────────────────────────────────────┤
│                                                  │
│  ▼ FrameLayout                                   │
│    ▼ LinearLayout                                │
│      ▼ TextView                                  │
│        text: "Settings"                          │
│        bounds: 0,0,1080,120                      │
│        clickable: false                          │
│      ▼ RecyclerView                              │
│        ▼ LinearLayout                            │
│          ▼ TextView                              │
│            text: "Display & touch"               │
│            resourceId: "title"                   │
│            clickable: true                       │
│                                                  │
└─────────────────────────────────────────────────┘
```

- Refresh button sends `view_hierarchy` via WebSocket
- Renders as a collapsible tree (similar to BrowserPanel's snapshot tab)
- Shows element properties: text, resourceId, bounds, clickable/enabled states

#### Tab 4: Logcat

```
┌─────────────────────────────────────────────────┐
│ Logcat              [Filter: ▾ All] [🔄 Clear]   │
├─────────────────────────────────────────────────┤
│                                                  │
│  14:02:15.123  I  ActivityManager  Displayed...  │
│  14:02:15.456  D  ViewRootImpl    Surface...     │
│  14:02:15.789  W  NetworkMonitor  Network...     │
│  14:02:16.012  E  CrashReporter   NPE at...     │
│  14:02:16.345  I  System.out     App started     │
│                                                  │
└─────────────────────────────────────────────────┘
```

- Real-time logcat entries via `logcat_entries` WebSocket events
- Filter dropdown: All, Verbose, Debug, Info, Warn, Error, Fatal
- Color-coded by level (V=gray, D=blue, I=green, W=yellow, E=red, F=red bold)
- Ring buffer: keeps last 500 entries in store
- Clear button resets the buffer

### 3.10 Store Extensions (`useZeusStore.ts`)

```typescript
// Extend activeRightTab type union to include 'android':
// (existing: 'terminal' | 'browser' | 'files' | 'git' | 'subagent' | ...)
activeRightTab: '...' | 'android';

// New state fields
interface ZeusState {
  // ... existing fields ...

  // Android QA state
  androidRunning: boolean;
  androidDevices: AndroidDeviceInfo[];
  androidAvds: string[];
  androidScreenshot: string | null;
  androidViewHierarchy: AndroidViewNode[] | null;
  androidLogcat: LogcatEntry[];

  // Android QA actions
  startAndroidEmulator: (avdName?: string) => void;
  stopAndroidEmulator: () => void;
  listAndroidDevices: () => void;
  takeAndroidScreenshot: () => void;
  getAndroidViewHierarchy: () => void;
  clearAndroidLogcat: () => void;
}

// WebSocket subscription for 'android' channel
zeusWs.on('android', (envelope) => {
  const payload = envelope.payload;

  switch (payload.type) {
    case 'emulator_started':
      set({ androidRunning: true, androidDevices: [...get().androidDevices, payload.device] });
      break;
    case 'emulator_stopped':
      // Only clear emulator devices (not physical devices if future support added)
      set({ androidRunning: false, androidDevices: [], androidLogcat: [] });
      break;
    case 'devices_list':
      set({ androidDevices: payload.devices, androidAvds: payload.avds });
      break;
    case 'screenshot_result':
      set({ androidScreenshot: payload.dataUrl });
      break;
    case 'view_hierarchy_result':
      set({ androidViewHierarchy: payload.nodes });
      break;
    case 'logcat_entries':
      set({
        androidLogcat: [...get().androidLogcat, ...payload.entries].slice(-500),
      });
      break;
    case 'android_status':
      set({ androidRunning: payload.running, androidDevices: payload.devices });
      break;
  }
});
```

---

## 4. Data Flow — Complete Lifecycle

### 4.1 Direct Panel Control (User interacts with AndroidPanel)

```
User clicks "Start" in AndroidPanel
  → useZeusStore.startAndroidEmulator('Pixel_9')
  → WebSocket send: { channel: 'android', payload: { type: 'start_emulator', avdName: 'Pixel_9' } }
  → handleAndroid() in websocket.ts
  → androidQAService.start('Pixel_9')
    → Spawn: emulator -avd Pixel_9 -no-window -no-audio -no-boot-anim
    → Poll boot_completed
    → Start logcat stream
  → respond: { type: 'emulator_started', device: { deviceId: 'emulator-5554', ... } }
  → Store updates: androidRunning = true, androidDevices = [...]
  → AndroidPanel re-renders showing running device

Logcat stream (continuous):
  → androidQAService emits 'logcat' events
  → broadcast: { channel: 'android', payload: { type: 'logcat_entries', entries: [...] } }
  → Store: androidLogcat appends, slices to 500
  → AndroidPanel Logcat tab updates in real-time
```

### 4.2 Agent-Driven QA (Claude spawns Android QA agent)

```
Main Claude Agent:
  zeus_android_qa_run(task="Test Settings app navigation", app_id="com.android.settings")

zeus-bridge.ts:
  → sendAndWait('subagent', { type: 'start_subagent', subagentType: 'android_qa', ... })
  → Promise blocks (up to 10 minutes)

websocket.ts handleSubagent():
  → subagentType === 'android_qa' pre-flight block:
    → Ensure emulator running (detect or start)
    → Wire logcat streaming
    → Launch app if appId provided
    → Clone registry mcpServers, resolve maestro path, inject deviceId
  → wireSubagent() handles the rest:
    → Build MCP config from cloned servers (passed as inline JSON via --mcp-config)
    → Spawn ClaudeSession
    → Wire entry streaming (identical to web QA)
    → Broadcast: subagent_started

Android QA Agent (subprocess):
  → inspect_view_hierarchy (Maestro MCP)     → sees UI elements
  → tap_on "Display & touch" (Maestro MCP)   → taps element
  → take_screenshot (Maestro MCP)            → captures screen
  → android_qa_logcat (extras MCP)           → reads system logs
  → run_flow (Maestro MCP)                   → executes YAML flow
  → android_qa_finish(summary, status)       → writes finish file
  → Process exits

websocket.ts (on 'done'):
  → Read /tmp/zeus-qa-finish-<agentId>.json (same naming as web QA)
  → Extract { summary, status }
  → Send deferred response to zeus-bridge
  → Broadcast: subagent_stopped
  → Clean up temp config

zeus-bridge.ts:
  → Promise resolves with { subagentId, status, summary }
  → Returns to main Claude agent

Throughout execution:
  → Every NormalizedEntry streamed via subagent channel
  → SubagentPanel renders agent logs in real-time
  → AndroidPanel shows logcat in real-time
```

---

## 5. File Structure

### New Files

```
src/main/services/android-qa.ts          # AndroidQAService
src/main/mcp/android-qa-extras.ts        # Supplementary MCP server (logcat, finish, device info)
src/renderer/src/components/AndroidPanel.tsx  # Android device control UI
```

### Modified Files

```
src/shared/types.ts                      # Add 'android' to WsEnvelope.channel, add AndroidDeviceInfo,
                                         # AndroidViewNode, LogcatEntry, AndroidPayload, extend SubagentType
src/main/services/websocket.ts           # Add handleAndroid() + 'android' case in message router,
                                         # add android_qa pre-flight block in handleSubagent(),
                                         # extend wireSubagent screenshot interception for android_qa
src/main/mcp/zeus-bridge.ts              # Add zeus_android_qa_run, zeus_android_devices,
                                         # zeus_android_start, zeus_android_stop, zeus_android_screenshot
src/main/services/subagent-registry.ts   # Register 'android_qa' subagent type with MCP config + prompt
src/renderer/src/stores/useZeusStore.ts  # Add android state/actions/WebSocket subscription,
                                         # extend activeRightTab type to include 'android'
src/renderer/src/components/RightPanel.tsx  # Add 'android' tab + render AndroidPanel (line ~190)
src/renderer/src/components/SubagentPanel.tsx  # Add 'android_qa' to SUBAGENT_TYPES array
```

---

## 6. Logcat State File Protocol

Mirrors the CDP state file pattern.

**File:** `/tmp/zeus-android-logcat-state.json`

```json
{
  "entries": [
    {
      "timestamp": 1710000000,
      "pid": 1234,
      "tid": 1234,
      "level": "I",
      "tag": "ActivityManager",
      "message": "Displayed com.android.settings/.Settings: +350ms"
    },
    {
      "timestamp": 1710000001,
      "pid": 5678,
      "tid": 5678,
      "level": "E",
      "tag": "CrashReporter",
      "message": "NullPointerException at MainFragment.java:42"
    }
  ],
  "updatedAt": 1710000001
}
```

**Writer:** `AndroidQAService.startLogcat()` — debounced 200ms writes
**Reader:** `android-qa-extras.ts` `android_qa_logcat` tool
**Ring buffer:** 500 entries max (matches CDP state file pattern)

---

## 7. Logcat Parsing

ADB logcat `-v threadtime` format:

```
03-19 14:02:15.123  1234  1234 I ActivityManager: Displayed com.android.settings
03-19 14:02:15.456  5678  5678 E CrashReporter: NPE at MainFragment.java:42
```

Regex parser:

```typescript
const LOGCAT_REGEX = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(\S+)\s*:\s*(.*)$/;

function parseLogcatLine(line: string): LogcatEntry | null {
  const match = line.match(LOGCAT_REGEX);
  if (!match) return null;
  return {
    timestamp: Date.now(),  // Use current time — logcat format only has MM-DD, no year
    pid: parseInt(match[2], 10),
    tid: parseInt(match[3], 10),
    level: match[4] as LogcatEntry['level'],
    tag: match[5],
    message: match[6],
  };
}
```

---

## 8. Error Handling

| Scenario | Handling |
|---|---|
| No Android SDK installed | `AndroidQAService.start()` throws with helpful message: "Android SDK not found. Install Android Studio or set ANDROID_HOME." |
| No AVDs configured | `listAvds()` returns empty → error message: "No Android AVDs found. Create one via Android Studio AVD Manager." |
| Emulator fails to boot (timeout) | 120-second timeout → throw with logcat output from stderr |
| Maestro not installed | `findMaestroPath()` throws: "Maestro not found. Install: curl -Ls https://get.maestro.mobile.dev \| bash" |
| ADB not found | `findAdbPath()` throws: "ADB not found. Install Android SDK platform-tools." |
| Emulator crashes mid-test | `emulatorProc.on('exit')` → emit 'error', QA agent gets notified via MCP error |
| Maestro MCP tool fails | Maestro returns error → QA agent sees tool error, can retry or finish with 'error' status |
| Logcat parse failure | Skip unparseable lines, log warning |

---

## 9. Prerequisites & Dependencies

### System Requirements (User's Machine)

- **Android SDK** with `emulator` and `platform-tools` (ADB) — typically via Android Studio
- **At least one AVD** configured (e.g., Pixel_9)
- **Maestro CLI** v2.x installed (`~/.maestro/bin/maestro`)
- **Java 11+** (required by Maestro)

### No New npm Dependencies

All functionality uses:
- `child_process.spawn` for emulator, ADB, and logcat processes
- Maestro's native MCP server (invoked as subprocess)
- Existing MCP SDK (`@modelcontextprotocol/sdk`) for android-qa-extras
- Existing project dependencies (ws, zod, etc.)

---

## 10. Testing Strategy

### Unit Tests

- `AndroidQAService`: mock `child_process.spawn`, test lifecycle methods
- Logcat parser: test regex against real logcat output samples
- MCP config generation: verify correct paths and env vars

### Integration Tests

- Boot emulator → take screenshot → verify PNG returned
- Boot emulator → get view hierarchy → verify node structure
- Spawn Android QA agent → verify entry streaming → verify finish file read

### Manual QA

- AndroidPanel: start/stop emulator, verify UI updates
- AndroidPanel: take screenshot, verify image display
- AndroidPanel: view hierarchy, verify tree rendering
- AndroidPanel: logcat tab, verify real-time streaming
- Spawn Android QA agent from SubagentPanel, verify logs appear
- Run `zeus_android_qa_run` from Claude, verify end-to-end flow

---

## 11. Future Considerations (Out of Scope)

- **iOS Simulator support** — same pattern, `xcrun simctl` instead of ADB, different MCP server
- **Physical device support** — ADB works with physical devices, minimal changes needed
- **App installation from URL** — download APK + `adb install`
- **Screen recording** — `adb shell screenrecord`
- **Multi-device testing** — run tests across multiple emulators simultaneously
- **Maestro Cloud integration** — run flows on Maestro's cloud infrastructure

---

## Appendix A: Review Issues Resolved

All issues from spec review have been addressed:

**Critical (3/3 resolved):**
- C1: Added `'android'` to `WsEnvelope.channel` union (Section 3.5, 3.7)
- C2: Aligned finish status values to `'pass' | 'fail' | 'warning'` matching web QA (Section 3.2)
- C3: Uses subagent registry instead of forking handleSubagent (Section 3.6)

**Important (6/6 resolved):**
- I1: Added singleton instantiation pattern for `androidQAService` (Section 3.5)
- I2: Added `removeAllListeners('logcat')` before re-registering (Section 3.5, 3.6)
- I3: Added `install_apk` handler in handleAndroid switch (Section 3.5)
- I4: Uses same finish file naming convention `zeus-qa-finish-{agentId}.json` (Section 3.2, 3.6)
- I5: Changed `zeus_android_stop` to use `sendAndWait` with 15s timeout (Section 3.4)
- I6: Added screenshot interception for android_qa in wireSubagent (Section 3.6)

**Minor (5/5 resolved):**
- M1: Use `Date.now()` for logcat timestamps instead of parsing incomplete date (Section 7)
- M2: Clear logcat on emulator_stopped, added comment about device scope (Section 3.9)
- M3: Removed `--working-dir` from maestro mcp args pending verification (Section 3.3, 3.6)
- M4: Clarified canonical type location is `types.ts`, service imports (Section 3.7)
- M5: Added single-instance guard note to `start()` method (Section 3.1)

## Appendix B: User Review Fixes (Round 1)

Fixes from first user review — correcting codebase API mismatches:

**Critical (3/3 resolved):**
- C1: Registry entry now uses `SubagentTypeDefinition` interface with all required fields (`type`, `name`, `icon`, `description`, `inputFields`, `cli`) and `SubagentMcpConfig[]` array (Section 3.6)
- C2: Dynamic `deviceId` is injected in the pre-flight block (not registry). Uses existing `ZEUS_QA_AGENT_ID` env var auto-injected by `ClaudeSession` for all subagents (Section 3.2, 3.3, 3.6)
- C3: Removed temp file approach — MCP config is passed as inline JSON string via `--mcp-config` flag by `ClaudeSession` (Section 3.3)

**Important (4/4 resolved):**
- I1: Screenshot metadata field corrected to `images` (array) instead of `imageData` (Section 3.6)
- I2: `buildPrompt` signature corrected to `(inputs: Record<string, string>, context: SubagentContext)` (Section 3.6)
- I3: Documented `enableQA: false` as intentional for Android QA — `enableQA` controls PinchTab/web QA setup, not needed for Maestro-based Android QA (Section 3.6)
- I4: Default logcat level set to Info+ (`'I'`) to avoid flooding agent with Verbose/Debug noise (Section 3.2)

## Appendix C: User Review Fixes (Round 2)

Fixes from second user review — runtime safety and UI integration gaps:

**Critical (3/3 resolved):**
- C1: `findMaestroPath()` deferred from registration time to spawn time in pre-flight block. Registry uses placeholder `'maestro'` — resolved at spawn to prevent app crash if Maestro not installed (Section 3.6)
- C2: Added `RightPanel.tsx` and `SubagentPanel.tsx` to Modified Files — these are where the tab and agent type dropdown actually live (Section 5, 3.8)
- C3: Pre-flight block now clones `mcpServers` from registry before mutating. `getSubagentType()` returns the live Map entry — mutating it would permanently alter the shared definition for all future spawns (Section 3.6)

**Important (4/4 resolved):**
- I1: `activeRightTab` type union in useZeusStore extended to include `'android'` (Section 3.10)
- I2: `SubagentPanel.tsx` `SUBAGENT_TYPES` array documented — must add `'android_qa'` entry (Section 3.8)
- I3: Screenshot interception preserves existing behavior — PinchTab check comes first (unchanged), Android branch uses `else if` to avoid breaking current logic (Section 3.6)
- I4: Section 4.2 data flow updated — removed temp file references, now reflects inline JSON via `--mcp-config` and pre-flight clone pattern (Section 4.2)

## Appendix D: Code-Validated Review (Round 3)

Fixes from third review — validated all spec claims against actual codebase code.

**Critical (3/3 resolved):**
- C1: Screenshot interception field path corrected from `entry.entryType.action === 'mcp_tool'` to match actual code pattern: `entry.entryType.type === 'tool_use'` + `/screenshot/i.test(toolName)` (Section 3.6, websocket.ts:738-751)
- C2: Added try-catch error handling to every case in `handleAndroid()` — all async service calls can throw (no SDK, no AVD, boot timeout). Responds with `{ type: 'android_error', message }` on failure (Section 3.5)
- C3: Added explicit `ActivityBarIcon` component documentation for RightPanel.tsx — without it, there's no sidebar button to navigate to the Android tab (Section 3.8)

**Important (4/4 resolved):**
- I1: Emulator boot timeout increased from 60s to 120s (240 retries × 500ms). Cold boot on slower machines can exceed 60s (Section 3.1, Section 8)
- I2: `since_last_call` cursor tracking documented — uses module-level variable to track last-read index in `android-qa-extras.ts` (Section 3.2)
- I3: Emulator lifecycle policy documented — emulator persists after agent completion, stopped explicitly by user via AndroidPanel or `zeus_android_stop` (Section 3.1)
- I4: Build entry point verified — `electron.vite.config.ts` auto-compiles files in `src/main/`, so `android-qa-extras.ts` → `out/main/mcp-android-qa-extras.mjs` requires no config changes

**Validated against code (all confirmed matching):**
- `SubagentTypeDefinition` interface shape (subagent-registry.ts:32-42) ✓
- `SubagentMcpConfig` shape (subagent-registry.ts:16-21) ✓
- `buildPrompt` signature `(Record<string, string>, SubagentContext)` ✓
- MCP env injection: `ZEUS_QA_AGENT_ID` + `ZEUS_WS_URL` auto-injected (claude-session.ts:232-244) ✓
- MCP config serialization via `JSON.stringify({ mcpServers })` (claude-session.ts:270) ✓
- Screenshot metadata field `images` array (websocket.ts:746) ✓
- `readQaFinishFile()` supports generic agentId lookup (websocket.ts:656-677) ✓
- QA singleton pattern: module-level `let qaService` (websocket.ts:117) ✓
- `activeRightTab` type union + null (useZeusStore.ts:139) ✓
- `WsEnvelope.channel` 10-member union (types.ts:172) ✓
- `SubagentType` union (types.ts:535) ✓
- `SUBAGENT_TYPES` manual array (SubagentPanel.tsx:28-49) ✓
