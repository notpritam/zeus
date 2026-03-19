# Android QA System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Android emulator QA automation to Zeus, mirroring the existing PinchTab/Web QA system, controlled via Maestro MCP + ADB.

**Architecture:** Mirror pattern — a new `AndroidQAService` manages emulator lifecycle (ADB/emulator CLI), a thin MCP extras server provides logcat/finish tools, and a new `AndroidPanel` UI component gives direct device control. Android QA agents are registered as a new subagent type (`android_qa`) and run through the existing subagent infrastructure with Maestro MCP for device interaction.

**Tech Stack:** Node `child_process` (ADB/emulator), Maestro CLI (native MCP server), `@modelcontextprotocol/sdk` (extras MCP), React/Tailwind (UI panel), Zustand (state), WebSocket (data flow).

**Spec:** `docs/superpowers/specs/2026-03-19-android-qa-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/main/services/android-qa.ts` | `AndroidQAService` — emulator lifecycle, ADB commands, logcat streaming, screenshot/view hierarchy proxy |
| `src/main/mcp/android-qa-extras.ts` | Supplementary MCP server (stdio) — `android_qa_logcat`, `android_qa_device_info`, `android_qa_finish` |
| `src/renderer/src/components/AndroidPanel.tsx` | 4-tab UI: Devices, Screenshot, View Hierarchy, Logcat |

### Modified Files

| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `'android'` to WsEnvelope channel union, `'android_qa'` to SubagentType, new interfaces (AndroidDeviceInfo, LogcatEntry, AndroidViewNode, AndroidPayload) |
| `electron.vite.config.ts` | Add `mcp-android-qa-extras` build entry point |
| `src/main/services/subagent-registry.ts` | Register `'android_qa'` subagent type with Maestro + extras MCP servers |
| `src/main/services/websocket.ts` | Add `handleAndroid()` channel handler + `'android'` case in router, add `android_qa` pre-flight block in `handleSubagent()`, extend screenshot interception in `wireSubagent()` |
| `src/main/mcp/zeus-bridge.ts` | Add `zeus_android_qa_run`, `zeus_android_devices`, `zeus_android_start`, `zeus_android_stop`, `zeus_android_screenshot` tools |
| `src/renderer/src/stores/useZeusStore.ts` | Add android state fields, actions, and WebSocket subscription for `'android'` channel |
| `src/renderer/src/components/RightPanel.tsx` | Add `'android'` to tab type union, add `Smartphone` icon in activity bar, render `AndroidPanel` |
| `src/renderer/src/components/SubagentPanel.tsx` | Add `'android_qa'` entry to `SUBAGENT_TYPES` array |

---

## Task 1: Type Definitions

**Files:**
- Modify: `src/shared/types.ts:172` (WsEnvelope channel), `src/shared/types.ts:535` (SubagentType)

All new types go in `src/shared/types.ts` as the single source of truth.

- [ ] **Step 1: Add `'android'` to WsEnvelope channel union**

In `src/shared/types.ts` line 172, extend the channel union:

```typescript
// Before:
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent';

// After:
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android';
```

- [ ] **Step 2: Add `'android_qa'` to SubagentType union**

In `src/shared/types.ts` line 535:

```typescript
// Before:
export type SubagentType = 'qa' | 'plan_reviewer';

// After:
export type SubagentType = 'qa' | 'plan_reviewer' | 'android_qa';
```

- [ ] **Step 3: Add Android-specific interfaces**

Add after the SubagentType definition (after line ~536):

```typescript
// ─── Android QA Types ───

export interface AndroidDeviceInfo {
  deviceId: string;      // e.g. "emulator-5554"
  avdName: string;       // e.g. "Pixel_9"
  status: 'running' | 'offline' | 'booting';
  apiLevel?: number;     // e.g. 35
  platform: 'android';
}

export interface LogcatEntry {
  timestamp: number;     // Unix ms — use Date.now() at parse time
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
  | { type: 'logcat_entries'; entries: LogcatEntry[] }
  | { type: 'android_error'; message: string };
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS (no errors — new types are additive, nothing references them yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(android-qa): add Android QA type definitions to shared types"
```

---

## Task 2: AndroidQAService

**Files:**
- Create: `src/main/services/android-qa.ts`

Core service that manages emulator lifecycle, ADB commands, logcat streaming, and direct panel control proxies. Mirrors `QAService` (`src/main/services/qa.ts`).

- [ ] **Step 1: Create the service file with binary discovery helpers**

Create `src/main/services/android-qa.ts`:

```typescript
import { EventEmitter } from 'events';
import { spawn, execFile, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import type { AndroidDeviceInfo, LogcatEntry, AndroidViewNode } from '../../shared/types';

// ─── Binary Discovery ───

function findOnPath(binary: string): string | null {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('which', [binary], { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

function findBinary(name: string, knownPaths: string[], binaryName: string): string {
  // 1. Check known paths via existsSync
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }
  // 2. Check system PATH via `which`
  const fromPath = findOnPath(binaryName);
  if (fromPath) return fromPath;

  throw new Error(
    `${name} not found. Checked:\n${knownPaths.map(c => `  - ${c}`).join('\n')}\n  - PATH (via which ${binaryName})\n` +
    `Set ANDROID_HOME or ANDROID_SDK_ROOT, or install Android SDK.`
  );
}

export function findEmulatorPath(): string {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const candidates: string[] = [];
  if (sdkRoot) candidates.push(path.join(sdkRoot, 'emulator', 'emulator'));
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'emulator', 'emulator'));
  return findBinary('Android Emulator', candidates, 'emulator');
}

export function findAdbPath(): string {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const candidates: string[] = [];
  if (sdkRoot) candidates.push(path.join(sdkRoot, 'platform-tools', 'adb'));
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
  return findBinary('ADB', candidates, 'adb');
}

export function findMaestroPath(): string {
  const candidates = [
    path.join(os.homedir(), '.maestro', 'bin', 'maestro'),
  ];
  return findBinary('Maestro CLI', candidates, 'maestro');
}

// ─── Logcat Parser ───

const LOGCAT_REGEX = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(\S+)\s*:\s*(.*)$/;

export function parseLogcatLine(line: string): LogcatEntry | null {
  const match = line.match(LOGCAT_REGEX);
  if (!match) return null;
  return {
    timestamp: Date.now(),
    pid: parseInt(match[2], 10),
    tid: parseInt(match[3], 10),
    level: match[4] as LogcatEntry['level'],
    tag: match[5],
    message: match[6],
  };
}

// ─── Logcat State File ───

const LOGCAT_STATE_PATH = '/tmp/zeus-android-logcat-state.json';
const LOGCAT_BUFFER_MAX = 500;
const LOGCAT_DEBOUNCE_MS = 200;
```

- [ ] **Step 2: Implement the AndroidQAService class — lifecycle methods**

Append to `src/main/services/android-qa.ts`:

```typescript
export class AndroidQAService extends EventEmitter {
  private emulatorProc: ChildProcess | null = null;
  private logcatProc: ChildProcess | null = null;
  private running = false;
  private deviceId: string | null = null;
  private logcatBuffer: LogcatEntry[] = [];
  private logcatWriteTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ───

  async start(avdName?: string): Promise<AndroidDeviceInfo> {
    // Single-instance guard
    if (this.running && this.deviceId) {
      const devices = await this.listDevices();
      const existing = devices.find(d => d.deviceId === this.deviceId);
      if (existing) return existing;
    }

    // Check for already-running emulator
    const detected = await this.detectRunning();
    if (detected) return detected;

    // Resolve AVD name
    if (!avdName) {
      const avds = await this.listAvds();
      if (avds.length === 0) {
        throw new Error('No Android AVDs found. Create one via Android Studio AVD Manager.');
      }
      avdName = avds[0];
    }

    // Spawn emulator
    const emulatorPath = findEmulatorPath();
    console.log(`[AndroidQA] Starting emulator: ${emulatorPath} -avd ${avdName}`);
    this.emulatorProc = spawn(emulatorPath, ['-avd', avdName, '-no-window', '-no-audio', '-no-boot-anim'], {
      stdio: 'ignore',
      detached: false,
    });

    this.emulatorProc.on('exit', (code) => {
      console.log(`[AndroidQA] Emulator exited with code ${code}`);
      this.running = false;
      this.deviceId = null;
      this.emit('emulator_exit', code);
    });

    this.emulatorProc.on('error', (err) => {
      console.error(`[AndroidQA] Emulator spawn error:`, err);
      this.emit('error', err);
    });

    // Wait for boot
    const adbPath = findAdbPath();
    const maxRetries = 240;
    const pollInterval = 500;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, pollInterval));
      try {
        const result = await this.execAdb(['shell', 'getprop', 'sys.boot_completed']);
        if (result.trim() === '1') break;
      } catch {
        // Not booted yet
      }
      if (i === maxRetries - 1) {
        throw new Error(`Emulator boot timed out after ${(maxRetries * pollInterval) / 1000}s`);
      }
    }

    // Get device ID from adb devices
    const devicesOutput = await this.execAdb(['devices', '-l']);
    const lines = devicesOutput.split('\n').filter(l => l.includes('emulator'));
    const firstDevice = lines[0]?.split(/\s+/)[0];
    if (!firstDevice) throw new Error('Emulator booted but no device found in adb devices');

    this.deviceId = firstDevice;
    this.running = true;

    // Start logcat
    this.startLogcat();

    const device: AndroidDeviceInfo = {
      deviceId: this.deviceId,
      avdName: avdName ?? 'unknown',
      status: 'running',
      platform: 'android',
    };

    // Try to get API level
    try {
      const apiStr = await this.execAdb(['-s', this.deviceId, 'shell', 'getprop', 'ro.build.version.sdk']);
      device.apiLevel = parseInt(apiStr.trim(), 10) || undefined;
    } catch { /* non-critical */ }

    console.log(`[AndroidQA] Emulator ready: ${this.deviceId} (${avdName})`);
    return device;
  }

  async stop(): Promise<void> {
    // Stop logcat
    if (this.logcatProc) {
      this.logcatProc.kill('SIGTERM');
      this.logcatProc = null;
    }

    // Kill emulator
    if (this.deviceId) {
      try {
        await this.execAdb(['-s', this.deviceId, 'emu', 'kill']);
      } catch {
        // Force kill if emu kill fails
        if (this.emulatorProc) {
          this.emulatorProc.kill('SIGKILL');
        }
      }
    }

    this.emulatorProc = null;
    this.deviceId = null;
    this.running = false;
    this.logcatBuffer = [];

    if (this.logcatWriteTimer) {
      clearTimeout(this.logcatWriteTimer);
      this.logcatWriteTimer = null;
    }

    console.log('[AndroidQA] Emulator stopped');
  }

  async listAvds(): Promise<string[]> {
    const emulatorPath = findEmulatorPath();
    return new Promise((resolve, reject) => {
      execFile(emulatorPath, ['-list-avds'], (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim().split('\n').filter(Boolean));
      });
    });
  }

  async listDevices(): Promise<AndroidDeviceInfo[]> {
    try {
      const output = await this.execAdb(['devices', '-l']);
      const lines = output.split('\n').slice(1).filter(l => l.trim());
      return lines.map(line => {
        const parts = line.split(/\s+/);
        const deviceId = parts[0];
        const statusStr = parts[1];
        const avdMatch = line.match(/model:(\S+)/);
        return {
          deviceId,
          avdName: avdMatch?.[1] ?? 'unknown',
          status: (statusStr === 'device' ? 'running' : statusStr === 'offline' ? 'offline' : 'booting') as AndroidDeviceInfo['status'],
          platform: 'android' as const,
        };
      }).filter(d => d.deviceId);
    } catch {
      return [];
    }
  }

  async detectRunning(): Promise<AndroidDeviceInfo | null> {
    const devices = await this.listDevices();
    const running = devices.find(d => d.status === 'running' && d.deviceId.startsWith('emulator'));
    if (!running) return null;

    this.deviceId = running.deviceId;
    this.running = true;
    this.startLogcat();
    console.log(`[AndroidQA] Attached to running emulator: ${this.deviceId}`);
    return running;
  }

  isRunning(): boolean { return this.running; }
  getDeviceId(): string | null { return this.deviceId; }
```

- [ ] **Step 3: Implement direct control methods (screenshot, viewHierarchy, installApk, launchApp)**

Append to the class in `src/main/services/android-qa.ts`:

```typescript
  // ─── Direct Control ───

  async screenshot(): Promise<string> {
    if (!this.deviceId) throw new Error('No emulator running');
    return new Promise((resolve, reject) => {
      const adbPath = findAdbPath();
      const proc = spawn(adbPath, ['-s', this.deviceId!, 'exec-out', 'screencap', '-p']);
      const chunks: Buffer[] = [];
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`screencap failed with code ${code}`));
        const png = Buffer.concat(chunks);
        resolve(`data:image/png;base64,${png.toString('base64')}`);
      });
      proc.on('error', reject);
    });
  }

  async viewHierarchy(): Promise<AndroidViewNode[]> {
    if (!this.deviceId) throw new Error('No emulator running');
    // Dump view hierarchy to file on device, then read it
    await this.execAdb(['-s', this.deviceId, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']);
    const dumpOutput = await this.execAdb(['-s', this.deviceId, 'shell', 'cat', '/sdcard/window_dump.xml']);
    return parseViewHierarchyXml(dumpOutput);
  }

  async installApk(apkPath: string): Promise<void> {
    if (!this.deviceId) throw new Error('No emulator running');
    await this.execAdb(['-s', this.deviceId, 'install', '-r', apkPath]);
    console.log(`[AndroidQA] Installed APK: ${apkPath}`);
  }

  async launchApp(appId: string): Promise<void> {
    if (!this.deviceId) throw new Error('No emulator running');
    // Use monkey to launch the main activity
    await this.execAdb(['-s', this.deviceId, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
    console.log(`[AndroidQA] Launched app: ${appId}`);
  }
```

- [ ] **Step 4: Implement logcat streaming and ADB exec helper**

Append to the class in `src/main/services/android-qa.ts`:

```typescript
  // ─── Logcat ───

  private startLogcat(): void {
    if (this.logcatProc) {
      this.logcatProc.kill('SIGTERM');
      this.logcatProc = null;
    }
    if (!this.deviceId) return;

    const adbPath = findAdbPath();
    this.logcatProc = spawn(adbPath, ['-s', this.deviceId, 'logcat', '-v', 'threadtime'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let partial = '';
    this.logcatProc.stdout!.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';

      const newEntries: LogcatEntry[] = [];
      for (const line of lines) {
        const entry = parseLogcatLine(line);
        if (entry) newEntries.push(entry);
      }

      if (newEntries.length > 0) {
        this.logcatBuffer.push(...newEntries);
        if (this.logcatBuffer.length > LOGCAT_BUFFER_MAX) {
          this.logcatBuffer = this.logcatBuffer.slice(-LOGCAT_BUFFER_MAX);
        }
        this.emit('logcat', newEntries);
        this.debouncedWriteLogcatState();
      }
    });

    this.logcatProc.on('exit', () => {
      console.log('[AndroidQA] Logcat process exited');
      this.logcatProc = null;
    });
  }

  getLogcatEntries(options?: {
    limit?: number;
    level?: LogcatEntry['level'];
    tag?: string;
    sinceIndex?: number;
  }): { entries: LogcatEntry[]; nextIndex: number } {
    const levelOrder: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };
    let entries = this.logcatBuffer;

    if (options?.sinceIndex !== undefined) {
      entries = entries.slice(options.sinceIndex);
    }
    if (options?.level) {
      const minLevel = levelOrder[options.level] ?? 0;
      entries = entries.filter(e => (levelOrder[e.level] ?? 0) >= minLevel);
    }
    if (options?.tag) {
      entries = entries.filter(e => e.tag === options.tag);
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return { entries, nextIndex: this.logcatBuffer.length };
  }

  private debouncedWriteLogcatState(): void {
    if (this.logcatWriteTimer) return;
    this.logcatWriteTimer = setTimeout(async () => {
      this.logcatWriteTimer = null;
      try {
        await writeFile(LOGCAT_STATE_PATH, JSON.stringify({
          entries: this.logcatBuffer.slice(-LOGCAT_BUFFER_MAX),
          updatedAt: Date.now(),
        }));
      } catch { /* non-critical */ }
    }, LOGCAT_DEBOUNCE_MS);
  }

  // ─── ADB Helper ───

  private execAdb(args: string[]): Promise<string> {
    const adbPath = findAdbPath();
    return new Promise((resolve, reject) => {
      execFile(adbPath, args, { timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`adb ${args.join(' ')} failed: ${stderr || err.message}`));
        resolve(stdout);
      });
    });
  }
}
```

- [ ] **Step 5: Add view hierarchy XML parser**

Append after the class in `src/main/services/android-qa.ts`:

```typescript
// ─── View Hierarchy XML Parser ───

function parseViewHierarchyXml(xml: string): AndroidViewNode[] {
  // Simple regex-based parser for uiautomator dump XML
  // Format: <node index="0" text="" resource-id="" class="..." bounds="[0,0][1080,120]" ... >
  const nodes: AndroidViewNode[] = [];
  const nodeStack: AndroidViewNode[][] = [nodes];

  const nodeRegex = /<node\s+([^>]*)\/?>|<\/node>/g;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    if (match[0] === '</node>') {
      if (nodeStack.length > 1) nodeStack.pop();
      continue;
    }

    const attrs = match[1];
    const getAttr = (name: string): string => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return m?.[1] ?? '';
    };

    const boundsStr = getAttr('bounds');
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    const x1 = boundsMatch ? parseInt(boundsMatch[1]) : 0;
    const y1 = boundsMatch ? parseInt(boundsMatch[2]) : 0;
    const x2 = boundsMatch ? parseInt(boundsMatch[3]) : 0;
    const y2 = boundsMatch ? parseInt(boundsMatch[4]) : 0;

    const node: AndroidViewNode = {
      className: getAttr('class'),
      text: getAttr('text') || undefined,
      resourceId: getAttr('resource-id') || undefined,
      contentDescription: getAttr('content-desc') || undefined,
      bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      clickable: getAttr('clickable') === 'true',
      enabled: getAttr('enabled') === 'true',
      checked: getAttr('checked') === 'true',
      focused: getAttr('focused') === 'true',
      children: [],
    };

    const current = nodeStack[nodeStack.length - 1];
    current.push(node);

    // If self-closing, don't push to stack
    if (!match[0].endsWith('/>')) {
      nodeStack.push(node.children!);
    }
  }

  return nodes;
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/android-qa.ts
git commit -m "feat(android-qa): add AndroidQAService with emulator lifecycle, ADB, and logcat"
```

---

## Task 3: MCP Extras Server

**Files:**
- Create: `src/main/mcp/android-qa-extras.ts`
- Modify: `electron.vite.config.ts:16-19` (add build entry)

Thin MCP server providing logcat access, device info, and finish protocol — the 3 things Maestro's native MCP doesn't cover.

- [ ] **Step 1: Create the MCP server file**

Create `src/main/mcp/android-qa-extras.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { execFile } from 'child_process';

const LOGCAT_STATE_PATH = '/tmp/zeus-android-logcat-state.json';
const LEVEL_ORDER: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };

// Cursor tracking for since_last_call
let lastReadIndex = 0;

const server = new McpServer({
  name: 'android-qa-extras',
  version: '1.0.0',
});

// ─── Tool: android_qa_logcat ───

server.tool(
  'android_qa_logcat',
  'Read recent Android logcat entries from the emulator. Defaults to Info+ level.',
  {
    limit: z.number().optional().default(50).describe('Max entries to return'),
    level: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional().default('I').describe('Minimum log level'),
    tag: z.string().optional().describe('Filter by tag name'),
    since_last_call: z.boolean().optional().default(false).describe('Only return entries since last call'),
  },
  async ({ limit, level, tag, since_last_call }) => {
    try {
      const raw = await readFile(LOGCAT_STATE_PATH, 'utf-8');
      const state = JSON.parse(raw) as { entries: Array<{ timestamp: number; pid: number; tid: number; level: string; tag: string; message: string }>; updatedAt: number };
      let entries = state.entries;

      // Cursor-based filtering
      if (since_last_call) {
        entries = entries.slice(lastReadIndex);
      }

      // Level filtering
      const minLevel = LEVEL_ORDER[level] ?? 2;
      entries = entries.filter(e => (LEVEL_ORDER[e.level] ?? 0) >= minLevel);

      // Tag filtering
      if (tag) {
        entries = entries.filter(e => e.tag === tag);
      }

      // Limit
      entries = entries.slice(-limit);

      // Update cursor
      lastReadIndex = state.entries.length;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ entries, total: entries.length }) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ entries: [], total: 0, error: 'No logcat data available yet' }) }],
      };
    }
  }
);

// ─── Tool: android_qa_device_info ───

server.tool(
  'android_qa_device_info',
  'Get device properties (model, API level, screen size, Android version).',
  {},
  async () => {
    const deviceId = process.env.ZEUS_ANDROID_DEVICE_ID;
    if (!deviceId) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No device ID set' }) }] };
    }

    const getprop = (prop: string): Promise<string> => {
      return new Promise((resolve) => {
        execFile('adb', ['-s', deviceId, 'shell', 'getprop', prop], { timeout: 5000 }, (err, stdout) => {
          resolve(err ? '' : stdout.trim());
        });
      });
    };

    const [model, apiLevel, androidVersion, screenDensity] = await Promise.all([
      getprop('ro.product.model'),
      getprop('ro.build.version.sdk'),
      getprop('ro.build.version.release'),
      getprop('ro.sf.lcd_density'),
    ]);

    // Get screen size via wm size
    const screenSize = await new Promise<string>((resolve) => {
      execFile('adb', ['-s', deviceId, 'shell', 'wm', 'size'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : stdout.trim().replace('Physical size: ', ''));
      });
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        deviceId,
        model,
        apiLevel: parseInt(apiLevel, 10) || null,
        androidVersion,
        screenSize,
        screenDensity: parseInt(screenDensity, 10) || null,
      }) }],
    };
  }
);

// ─── Tool: android_qa_finish ───

server.tool(
  'android_qa_finish',
  'Signal QA completion. MUST be called when testing is done.',
  {
    summary: z.string().describe('Summary of test findings'),
    status: z.enum(['pass', 'fail', 'warning']).describe('Overall test status'),
  },
  async ({ summary, status }) => {
    const agentId = process.env.ZEUS_QA_AGENT_ID;
    if (!agentId) {
      return { content: [{ type: 'text' as const, text: 'Error: ZEUS_QA_AGENT_ID not set' }], isError: true };
    }

    const finishPath = `/tmp/zeus-qa-finish-${agentId}.json`;
    await writeFile(finishPath, JSON.stringify({ summary, status, timestamp: Date.now() }));

    return {
      content: [{ type: 'text' as const, text: `QA finished: ${status}. Summary saved to ${finishPath}` }],
    };
  }
);

// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[android-qa-extras] MCP server running on stdio');
}

main().catch(console.error);
```

- [ ] **Step 2: Add build entry point to electron.vite.config.ts**

In `electron.vite.config.ts` line 16-19, add the new MCP server entry:

```typescript
// Before:
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'mcp-qa-server': resolve(__dirname, 'src/main/mcp/qa-server.ts'),
  'mcp-zeus-bridge': resolve(__dirname, 'src/main/mcp/zeus-bridge.ts'),
},

// After:
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'mcp-qa-server': resolve(__dirname, 'src/main/mcp/qa-server.ts'),
  'mcp-zeus-bridge': resolve(__dirname, 'src/main/mcp/zeus-bridge.ts'),
  'mcp-android-qa-extras': resolve(__dirname, 'src/main/mcp/android-qa-extras.ts'),
},
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/android-qa-extras.ts electron.vite.config.ts
git commit -m "feat(android-qa): add android-qa-extras MCP server and build entry"
```

---

## Task 4: Subagent Registry

**Files:**
- Modify: `src/main/services/subagent-registry.ts:132` (after plan_reviewer registration)

Register `android_qa` as a new subagent type.

- [ ] **Step 1: Add the android_qa registration**

After the `plan_reviewer` registration (line 169) in `src/main/services/subagent-registry.ts`, add:

```typescript
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
  buildPrompt: (inputs) => {
    return [
      'You are a QA testing agent for an Android application.',
      inputs.deviceId ? `Device: ${inputs.deviceId}` : '',
      inputs.appId ? `App under test: ${inputs.appId}` : '',
      '',
      'Use Maestro MCP tools to interact with the device:',
      '- list_devices: see available devices',
      '- start_device: start a device if needed',
      '- inspect_view_hierarchy: see what\'s on screen before tapping',
      '- tap_on: tap elements by text or ID',
      '- input_text: type into focused fields',
      '- take_screenshot: capture the screen',
      '- run_flow: execute multi-step YAML flows',
      '- run_flow_files: execute flow files',
      '- check_flow_syntax: validate YAML flows',
      '- back: press the back button',
      '- launch_app: launch an app',
      '- stop_app: stop an app',
      '- cheat_sheet: get quick reference for Maestro commands',
      '- query_docs: search Maestro documentation',
      '',
      'Use android_qa_extras tools for:',
      '- android_qa_logcat: read Android system logs (defaults to Info+ level)',
      '- android_qa_device_info: get device properties',
      '- android_qa_finish: MUST call this when done with summary and status',
      '',
      'CRITICAL: You MUST call android_qa_finish() when you are done testing.',
      'Without it, the parent agent will timeout waiting for your response.',
      '',
      '---',
      '',
      `Task: ${inputs.task}`,
    ].filter(Boolean).join('\n');
  },
  permissionMode: 'bypassPermissions',
  mcpServers: [
    {
      name: 'maestro',
      command: 'maestro', // placeholder — resolved at spawn time by pre-flight block
      args: ['mcp'],
    },
    {
      name: 'android-qa-extras',
      command: 'node',
      args: [path.resolve(app.getAppPath(), 'out/main/mcp-android-qa-extras.mjs')],
    },
  ],
  cli: 'claude',
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/subagent-registry.ts
git commit -m "feat(android-qa): register android_qa subagent type in registry"
```

---

## Task 5: WebSocket — handleAndroid + Router

**Files:**
- Modify: `src/main/services/websocket.ts`

Add the `handleAndroid()` channel handler and wire it into the message router.

- [ ] **Step 1: Add AndroidQAService import and singleton**

Near the top of `websocket.ts`, alongside existing imports and the `qaService` singleton (around line ~117), add:

```typescript
import { AndroidQAService } from './android-qa';
import type { AndroidPayload } from '../../shared/types';

// Module-level singleton (mirrors qaService pattern)
let androidQAService: AndroidQAService | null = null;

function getAndroidQAService(): AndroidQAService {
  if (!androidQAService) {
    androidQAService = new AndroidQAService();
  }
  return androidQAService;
}
```

- [ ] **Step 2: Implement handleAndroid function**

Add the `handleAndroid` function in `websocket.ts` (near `handleQA`):

```typescript
// Helper to send a response with responseId forwarding (matches handleQA pattern)
function sendAndroidResponse(ws: WebSocket, envelope: WsEnvelope, responsePayload: Record<string, unknown>): void {
  const inPayload = envelope.payload as Record<string, unknown>;
  sendEnvelope(ws, {
    channel: 'android', sessionId: '', auth: '',
    payload: { ...responsePayload, responseId: inPayload.responseId },
  });
}

async function handleAndroid(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as AndroidPayload;
  const service = getAndroidQAService();

  switch (payload.type) {
    case 'start_emulator': {
      try {
        const device = await service.start(payload.avdName);
        service.removeAllListeners('logcat');
        service.on('logcat', (entries) => {
          broadcastEnvelope({
            channel: 'android', sessionId: '', auth: '',
            payload: { type: 'logcat_entries', entries },
          });
        });
        sendAndroidResponse(ws, envelope, { type: 'emulator_started', device });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'stop_emulator': {
      try {
        await service.stop();
        sendAndroidResponse(ws, envelope, { type: 'emulator_stopped' });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'list_devices': {
      try {
        const devices = await service.listDevices();
        const avds = await service.listAvds();
        sendAndroidResponse(ws, envelope, { type: 'devices_list', devices, avds });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'get_android_status': {
      try {
        const devices = await service.listDevices();
        sendAndroidResponse(ws, envelope, {
          type: 'android_status',
          running: service.isRunning(),
          devices,
        });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'screenshot': {
      try {
        const dataUrl = await service.screenshot();
        sendAndroidResponse(ws, envelope, { type: 'screenshot_result', dataUrl });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'view_hierarchy': {
      try {
        const nodes = await service.viewHierarchy();
        sendAndroidResponse(ws, envelope, { type: 'view_hierarchy_result', nodes });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'install_apk': {
      try {
        await service.installApk(payload.apkPath);
        sendAndroidResponse(ws, envelope, { type: 'apk_installed', apkPath: payload.apkPath });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'launch_app': {
      try {
        await service.launchApp(payload.appId);
        sendAndroidResponse(ws, envelope, { type: 'app_launched', appId: payload.appId });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }
  }
}
```

**Note:** `sendAndroidResponse` is a local helper that wraps `sendEnvelope` with `responseId` forwarding — this matches how `handleQA` works (see websocket.ts:2075).

- [ ] **Step 3: Add `'android'` case to message router**

In `websocket.ts` at line ~3028 (after the `'subagent'` case, before `'perf'`), add:

```typescript
    case 'android':
      handleAndroid(ws, envelope).catch((err) => {
        console.error('[Android] Unhandled error in handleAndroid:', err);
        sendEnvelope(ws, {
          channel: 'android', sessionId: '', auth: '',
          payload: { type: 'android_error', message: `Android error: ${(err as Error).message}` },
        });
      });
      break;
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(android-qa): add handleAndroid WebSocket channel handler"
```

---

## Task 6: WebSocket — Pre-flight & Screenshot Interception

**Files:**
- Modify: `src/main/services/websocket.ts:2224` (handleSubagent), `src/main/services/websocket.ts:738-751` (wireSubagent)

Add the `android_qa` pre-flight block and extend screenshot interception.

- [ ] **Step 1: Add android_qa pre-flight block in handleSubagent**

In `handleSubagent()`, after the QA-specific setup block (after line ~2256, the closing `}` of `if (subagentType === 'qa')`), add:

```typescript
      // Android QA-specific setup: ensure emulator is running
      if (subagentType === 'android_qa') {
        const androidService = getAndroidQAService();

        // 1. Ensure emulator is running (detect existing or boot new)
        let device = await androidService.detectRunning();
        if (!device) {
          device = await androidService.start(inputs.avdName);
        }

        // 2. Wire logcat streaming
        androidService.removeAllListeners('logcat');
        androidService.on('logcat', (entries) => {
          broadcastEnvelope({
            channel: 'android', sessionId: '', auth: '',
            payload: { type: 'logcat_entries', entries },
          });
        });

        // 3. Launch app if appId provided
        if (inputs.appId) {
          await androidService.launchApp(inputs.appId);
        }

        // 4. Inject deviceId into inputs so buildPrompt can reference it
        inputs.deviceId = device.deviceId;
      }
```

- [ ] **Step 2: Add MCP server resolution for android_qa before wireSubagent**

In the "Free-form / non-QA fallback" path (after line ~2406), before `const session = new ClaudeSession(sessionOpts)`, add the MCP server cloning and resolution for android_qa:

```typescript
      // Android QA: clone registry mcpServers and resolve maestro path at spawn time
      if (subagentType === 'android_qa' && definition?.mcpServers?.length) {
        const { findMaestroPath } = await import('./android-qa');
        const clonedServers = definition.mcpServers.map(s => ({
          ...s,
          args: s.args ? [...s.args] : undefined,
          env: s.env ? { ...s.env } : undefined,
        }));

        // Resolve maestro binary path (deferred from module load)
        const maestroServer = clonedServers.find(s => s.name === 'maestro');
        if (maestroServer) {
          maestroServer.command = findMaestroPath();
        }

        // Inject device ID into extras server env
        const extrasServer = clonedServers.find(s => s.name === 'android-qa-extras');
        if (extrasServer) {
          extrasServer.env = {
            ...(extrasServer.env ?? {}),
            ZEUS_ANDROID_DEVICE_ID: inputs.deviceId ?? '',
          };
        }

        sessionOpts.mcpServers = clonedServers;
      }
```

- [ ] **Step 3: Extend screenshot interception in wireSubagent**

In `wireSubagent()` at line ~741, extend the screenshot block:

```typescript
    // Before (existing code, line 741):
    if (isScreenshot && status === 'success' && qaService?.isRunning()) {

    // After (replace the block at lines 741-750):
    if (isScreenshot && status === 'success') {
      // PinchTab QA screenshot (existing behavior, unchanged)
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
      // Android QA screenshot
      else if (record.subagentType === 'android_qa' && androidQAService?.isRunning()) {
        try {
          const imageData = await androidQAService.screenshot();
          if (imageData) {
            const meta = (entry.metadata ?? {}) as Record<string, unknown>;
            meta.images = [imageData];
            entry = { ...entry, metadata: meta };
          }
        } catch { /* non-critical */ }
      }
    }
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(android-qa): add pre-flight block and screenshot interception for android_qa"
```

---

## Task 7: zeus-bridge Tools

**Files:**
- Modify: `src/main/mcp/zeus-bridge.ts`

Add Android QA bridge tools for the main Claude agent.

- [ ] **Step 1: Add Android QA tools to zeus-bridge.ts**

At the end of the tool registrations (before the `main()` function), add:

```typescript
// ═══════════════════════════════════════════
// ─── Android QA Tools ───
// ═══════════════════════════════════════════

server.tool(
  'zeus_android_qa_run',
  'Spawn an Android QA testing agent. The agent controls an Android emulator via Maestro with full device automation. Results appear in the QA panel.',
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
      subagentType: 'android_qa',
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(response) }],
    };
  }
);

server.tool(
  'zeus_android_devices',
  'List available Android AVDs and running emulator instances.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'list_devices' }, 15_000);
    return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] };
  }
);

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
    }, 120_000);
    return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] };
  }
);

server.tool(
  'zeus_android_stop',
  'Stop the running Android emulator.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'stop_emulator' }, 15_000);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, message: 'Android emulator stopped.' }) }] };
  }
);

server.tool(
  'zeus_android_screenshot',
  'Take a screenshot of the running Android emulator.',
  {},
  async () => {
    await connectWs();
    const response = await sendAndWait('android', { type: 'screenshot' }, 15_000);
    return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] };
  }
);
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp/zeus-bridge.ts
git commit -m "feat(android-qa): add Android QA bridge tools to zeus-bridge"
```

---

## Task 8: Store Extensions

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

Add Android state fields, actions, and WebSocket subscription.

- [ ] **Step 1: Add Android type imports**

Add to the imports from `@shared/types`:

```typescript
import type { AndroidDeviceInfo, LogcatEntry, AndroidViewNode } from '@shared/types';
```

- [ ] **Step 2: Add Android state fields to the store interface**

After the QA state fields (around line ~123), add:

```typescript
  // Android QA
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
  installAndroidApk: (apkPath: string) => void;
  launchAndroidApp: (appId: string) => void;
  clearAndroidLogcat: () => void;
```

- [ ] **Step 3: Extend the activeRightTab type**

At line 139, extend the union:

```typescript
// Before:
activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | null;

// After:
activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | null;
```

- [ ] **Step 4: Add initial state values in create()**

In the `create()` call, add initial values for the Android state:

```typescript
  androidRunning: false,
  androidDevices: [],
  androidAvds: [],
  androidScreenshot: null,
  androidViewHierarchy: null,
  androidLogcat: [],
```

- [ ] **Step 5: Add Android actions**

Add action methods to the store:

```typescript
  startAndroidEmulator: (avdName?: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'start_emulator', avdName },
    });
  },
  stopAndroidEmulator: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'stop_emulator' },
    });
  },
  listAndroidDevices: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'list_devices' },
    });
  },
  takeAndroidScreenshot: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'screenshot' },
    });
  },
  getAndroidViewHierarchy: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'view_hierarchy' },
    });
  },
  installAndroidApk: (apkPath: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'install_apk', apkPath },
    });
  },
  launchAndroidApp: (appId: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'launch_app', appId },
    });
  },
  clearAndroidLogcat: () => {
    set({ androidLogcat: [] });
  },
```

- [ ] **Step 6: Add WebSocket subscription for `'android'` channel**

In the WebSocket subscription block (where other channels like `'qa'` are subscribed), add:

```typescript
  // Add after the last `const unsub*` (e.g., after `const unsubPerf = ...`):
  const unsubAndroid = zeusWs.on('android', (envelope: WsEnvelope) => {
    const payload = envelope.payload as AndroidPayload;
    switch (payload.type) {
      case 'emulator_started':
        set({ androidRunning: true, androidDevices: [...get().androidDevices, payload.device] });
        break;
      case 'emulator_stopped':
        set({ androidRunning: false, androidDevices: [], androidLogcat: [] });
        break;
      case 'devices_list':
        set({ androidDevices: payload.devices, androidAvds: payload.avds });
        break;
      case 'android_status':
        set({ androidRunning: payload.running, androidDevices: payload.devices });
        break;
      case 'screenshot_result':
        set({ androidScreenshot: payload.dataUrl });
        break;
      case 'view_hierarchy_result':
        set({ androidViewHierarchy: payload.nodes });
        break;
      case 'logcat_entries':
        set({ androidLogcat: [...get().androidLogcat, ...payload.entries].slice(-500) });
        break;
      case 'android_error':
        console.error('[AndroidQA]', payload.message);
        break;
    }
  });

  // And in the cleanup return block (line ~1482), add before zeusWs.disconnect():
  //   unsubAndroid();
```

Add the import for `AndroidPayload`:

```typescript
import type { AndroidPayload } from '@shared/types';
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(android-qa): add Android QA state and actions to Zustand store"
```

---

## Task 9: AndroidPanel UI Component

**Files:**
- Create: `src/renderer/src/components/AndroidPanel.tsx`

4-tab panel: Devices, Screenshot, View Hierarchy, Logcat. Mirrors BrowserPanel structure.

- [ ] **Step 1: Create AndroidPanel.tsx**

Create `src/renderer/src/components/AndroidPanel.tsx` with the full component. This is the largest new file — it contains 4 tab views and uses the store actions from Task 8.

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import {
  Smartphone,
  Play,
  Square,
  Camera,
  RefreshCw,
  Trash2,
  ChevronRight,
  ChevronDown,
  Monitor,
  ScrollText,
  Network,
  Layers,
} from 'lucide-react';
import type { AndroidViewNode, LogcatEntry } from '@shared/types';

type AndroidTab = 'devices' | 'screenshot' | 'hierarchy' | 'logcat';

// ─── Logcat Level Colors ───

const LEVEL_COLORS: Record<string, string> = {
  V: 'text-muted-foreground',
  D: 'text-blue-400',
  I: 'text-green-400',
  W: 'text-yellow-400',
  E: 'text-red-400',
  F: 'text-red-500 font-bold',
};

// ─── View Hierarchy Tree Node ───

function ViewNodeItem({ node, depth = 0 }: { node: AndroidViewNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 py-0.5 text-left text-xs hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <span className="text-primary font-mono">{node.className.split('.').pop()}</span>
        {node.text && <span className="text-muted-foreground truncate ml-1">"{node.text}"</span>}
        {node.resourceId && <span className="text-blue-400 truncate ml-1">#{node.resourceId.split('/').pop()}</span>}
        {node.clickable && <span className="text-yellow-400 ml-1 text-[10px]">click</span>}
      </button>
      {expanded && hasChildren && node.children!.map((child, i) => (
        <ViewNodeItem key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── Main Panel ───

export default function AndroidPanel() {
  const [activeTab, setActiveTab] = useState<AndroidTab>('devices');
  const [logcatFilter, setLogcatFilter] = useState<LogcatEntry['level'] | 'all'>('all');

  const androidRunning = useZeusStore(s => s.androidRunning);
  const androidDevices = useZeusStore(s => s.androidDevices);
  const androidAvds = useZeusStore(s => s.androidAvds);
  const androidScreenshot = useZeusStore(s => s.androidScreenshot);
  const androidViewHierarchy = useZeusStore(s => s.androidViewHierarchy);
  const androidLogcat = useZeusStore(s => s.androidLogcat);
  const startEmulator = useZeusStore(s => s.startAndroidEmulator);
  const stopEmulator = useZeusStore(s => s.stopAndroidEmulator);
  const listDevices = useZeusStore(s => s.listAndroidDevices);
  const takeScreenshot = useZeusStore(s => s.takeAndroidScreenshot);
  const getViewHierarchy = useZeusStore(s => s.getAndroidViewHierarchy);
  const clearLogcat = useZeusStore(s => s.clearAndroidLogcat);

  const logcatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logcat
  useEffect(() => {
    if (activeTab === 'logcat' && logcatEndRef.current) {
      logcatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [androidLogcat, activeTab]);

  // Fetch devices on mount
  useEffect(() => { listDevices(); }, []);

  // Filter logcat entries
  const LEVEL_ORDER: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };
  const filteredLogcat = logcatFilter === 'all'
    ? androidLogcat
    : androidLogcat.filter(e => (LEVEL_ORDER[e.level] ?? 0) >= (LEVEL_ORDER[logcatFilter] ?? 0));

  const tabs: { id: AndroidTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'devices', label: 'Devices', icon: Smartphone },
    { id: 'screenshot', label: 'Screenshot', icon: Camera },
    { id: 'hierarchy', label: 'Hierarchy', icon: Layers },
    { id: 'logcat', label: 'Logcat', icon: ScrollText },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Tab Bar */}
      <div className="border-border flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              activeTab === tab.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`size-2 rounded-full ${androidRunning ? 'bg-green-400' : 'bg-muted-foreground/40'}`} />
          <span className="text-muted-foreground">{androidRunning ? 'Running' : 'Stopped'}</span>
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeTab === 'devices' && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => startEmulator()} disabled={androidRunning}>
                <Play className="mr-1 size-3" /> Start
              </Button>
              <Button size="sm" variant="outline" onClick={stopEmulator} disabled={!androidRunning}>
                <Square className="mr-1 size-3" /> Stop
              </Button>
              <Button size="sm" variant="ghost" onClick={listDevices}>
                <RefreshCw className="size-3" />
              </Button>
            </div>

            {/* AVDs */}
            {androidAvds.length > 0 && (
              <div>
                <h3 className="text-xs font-medium mb-1.5 text-muted-foreground">Available AVDs</h3>
                <div className="space-y-1">
                  {androidAvds.map(avd => (
                    <div key={avd} className="border-border flex items-center justify-between rounded border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Monitor className="text-muted-foreground size-4" />
                        <span className="text-sm">{avd}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => startEmulator(avd)} disabled={androidRunning}>
                        <Play className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Running Devices */}
            {androidDevices.length > 0 && (
              <div>
                <h3 className="text-xs font-medium mb-1.5 text-muted-foreground">Running Devices</h3>
                <div className="space-y-1">
                  {androidDevices.map(device => (
                    <div key={device.deviceId} className="border-border flex items-center justify-between rounded border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${device.status === 'running' ? 'bg-green-400' : device.status === 'booting' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                        <span className="text-sm font-mono">{device.deviceId}</span>
                        <span className="text-xs text-muted-foreground">{device.avdName}</span>
                        {device.apiLevel && <span className="text-xs text-muted-foreground">API {device.apiLevel}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {androidAvds.length === 0 && androidDevices.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No AVDs found. Install Android Studio and create an AVD.
              </p>
            )}
          </div>
        )}

        {activeTab === 'screenshot' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={takeScreenshot} disabled={!androidRunning}>
                <Camera className="mr-1 size-3" /> Capture
              </Button>
            </div>
            {androidScreenshot ? (
              <div className="flex justify-center">
                <img
                  src={androidScreenshot}
                  alt="Android screenshot"
                  className="max-h-[500px] rounded border border-border object-contain"
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                {androidRunning ? 'Click Capture to take a screenshot' : 'Start an emulator first'}
              </p>
            )}
          </div>
        )}

        {activeTab === 'hierarchy' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={getViewHierarchy} disabled={!androidRunning}>
                <RefreshCw className="mr-1 size-3" /> Refresh
              </Button>
            </div>
            {androidViewHierarchy && androidViewHierarchy.length > 0 ? (
              <div className="font-mono text-xs overflow-auto">
                {androidViewHierarchy.map((node, i) => (
                  <ViewNodeItem key={i} node={node} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                {androidRunning ? 'Click Refresh to load view hierarchy' : 'Start an emulator first'}
              </p>
            )}
          </div>
        )}

        {activeTab === 'logcat' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <select
                className="bg-background border-border rounded border px-2 py-1 text-xs"
                value={logcatFilter}
                onChange={e => setLogcatFilter(e.target.value as typeof logcatFilter)}
              >
                <option value="all">All Levels</option>
                <option value="V">Verbose+</option>
                <option value="D">Debug+</option>
                <option value="I">Info+</option>
                <option value="W">Warn+</option>
                <option value="E">Error+</option>
                <option value="F">Fatal</option>
              </select>
              <Button size="sm" variant="ghost" onClick={clearLogcat}>
                <Trash2 className="size-3" />
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">{filteredLogcat.length} entries</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] space-y-px">
              {filteredLogcat.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {androidRunning ? 'Waiting for logcat entries...' : 'Start an emulator to see logs'}
                </p>
              ) : (
                filteredLogcat.map((entry, i) => (
                  <div key={i} className="flex gap-2 px-1 py-px hover:bg-muted/30">
                    <span className="text-muted-foreground shrink-0 w-20">
                      {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })}
                    </span>
                    <span className={`shrink-0 w-4 text-center font-bold ${LEVEL_COLORS[entry.level] ?? ''}`}>
                      {entry.level}
                    </span>
                    <span className="text-blue-400 shrink-0 w-24 truncate">{entry.tag}</span>
                    <span className="text-foreground break-all">{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={logcatEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AndroidPanel.tsx
git commit -m "feat(android-qa): add AndroidPanel UI with 4 tabs (devices, screenshot, hierarchy, logcat)"
```

---

## Task 10: RightPanel + SubagentPanel Wiring

**Files:**
- Modify: `src/renderer/src/components/RightPanel.tsx`
- Modify: `src/renderer/src/components/SubagentPanel.tsx:28-49`

Wire the AndroidPanel into the activity bar and add android_qa to the subagent dropdown.

- [ ] **Step 1: Update RightPanel.tsx — import and render**

In `src/renderer/src/components/RightPanel.tsx`:

1. Add imports (line 1):
```typescript
import { GitBranch, FolderOpen, Bot, Globe, RefreshCw, Info, Settings, Smartphone } from 'lucide-react';
```

2. Add import for AndroidPanel (after BrowserPanel import, line 7):
```typescript
import AndroidPanel from '@/components/AndroidPanel';
```

3. Extend the `tab` type union (line 85):
```typescript
// Before:
tab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings';

// After:
tab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android';
```

4. Update the rendering ternary (line 190):
```typescript
// Before:
{activeRightTab === 'source-control' ? <GitPanel /> : activeRightTab === 'explorer' ? <FileExplorer /> : activeRightTab === 'info' ? <SessionInfoPanel /> : activeRightTab === 'settings' ? <SessionSettingsPanel /> : activeRightTab === 'browser' ? <BrowserPanel /> : <SubagentPanel />}

// After:
{activeRightTab === 'source-control' ? <GitPanel /> : activeRightTab === 'explorer' ? <FileExplorer /> : activeRightTab === 'info' ? <SessionInfoPanel /> : activeRightTab === 'settings' ? <SessionSettingsPanel /> : activeRightTab === 'browser' ? <BrowserPanel /> : activeRightTab === 'android' ? <AndroidPanel /> : <SubagentPanel />}
```

5. Add Smartphone icon to activity bar (after the Globe/browser icon, line ~239, before the Settings mt-auto div):
```tsx
          <ActivityBarIcon
            icon={Smartphone}
            tab="android"
            tooltip="Android"
          />
```

- [ ] **Step 2: Update SubagentPanel.tsx — add android_qa to SUBAGENT_TYPES**

In `src/renderer/src/components/SubagentPanel.tsx`, add import for `Smartphone` icon (line 1-22) and add the new entry to the `SUBAGENT_TYPES` array after the `plan_reviewer` entry (line 48):

```typescript
// Add to lucide-react imports:
import { ..., Smartphone } from 'lucide-react';

// Add to SUBAGENT_TYPES array (after plan_reviewer, before the closing bracket):
  {
    type: 'android_qa' as SubagentType,
    name: 'Android QA Tester',
    icon: Smartphone,
    description: 'Android device QA testing with Maestro automation',
    inputFields: [
      { key: 'task', label: 'Task', type: 'textarea' as const, required: true, placeholder: 'What to test on the Android device...' },
      { key: 'appId', label: 'App ID', type: 'text' as const, required: false, placeholder: 'com.example.app (optional)' },
      { key: 'avdName', label: 'AVD Name', type: 'text' as const, required: false, placeholder: 'Auto-detected if omitted' },
    ],
  },
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npm run build`
Expected: PASS — full build completes without errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RightPanel.tsx src/renderer/src/components/SubagentPanel.tsx
git commit -m "feat(android-qa): wire AndroidPanel into RightPanel and add android_qa to SubagentPanel"
```

---

## Task 11: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npm run build`
Expected: PASS — confirms all new files compile and the MCP server entry point is built

- [ ] **Step 3: Verify build outputs**

Run: `ls -la /Users/notpritamm/Documents/Projects/zeus/out/main/mcp-android-qa-extras.mjs`
Expected: File exists (confirming the build entry was processed)

- [ ] **Step 4: Run existing tests**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npm run validate`
Expected: PASS — all 67+ existing tests still pass (no regressions)

- [ ] **Step 5: Visual verification — dev mode**

Run: `cd /Users/notpritamm/Documents/Projects/zeus && npm run dev`

Verify:
1. App launches without errors
2. Activity bar shows Smartphone icon between Browser and Settings
3. Clicking Smartphone icon opens AndroidPanel
4. Devices tab shows "No AVDs found" message (if no Android SDK) or lists available AVDs
5. SubagentPanel dropdown includes "Android QA Tester" option
6. No console errors in dev tools

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "feat(android-qa): complete Android QA system implementation"
```
