import { EventEmitter } from 'events';
import { spawn, execFile, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
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
