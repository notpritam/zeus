import os from 'os';
import pidusage from 'pidusage';
import type { SystemMetrics, ProcessMetric } from '../../shared/types';

const DEFAULT_INTERVAL = 15_000; // 15 seconds
const MIN_INTERVAL = 5_000;
const MAX_INTERVAL = 60_000;

type PidSource = () => Array<{
  sessionId: string;
  pid: number;
  type: ProcessMetric['type'];
  name: string;
}>;

export class SystemMonitorService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _pollInterval = DEFAULT_INTERVAL;
  private _monitoring = false;

  // Snapshot accumulators
  private _peakCpu = 0;
  private _peakMemory = 0;
  private _monitoringSince = 0;
  private _totalProcessesSpawned = 0;
  private _lastProcessCount = 0;

  // External PID sources (terminal, claude)
  private pidSources: PidSource[] = [];

  // Callback for broadcasting metrics
  private onMetrics: ((metrics: SystemMetrics) => void) | null = null;

  registerPidSource(source: PidSource): void {
    this.pidSources.push(source);
  }

  setOnMetrics(cb: (metrics: SystemMetrics) => void): void {
    this.onMetrics = cb;
  }

  get pollInterval(): number {
    return this._pollInterval;
  }

  get isMonitoring(): boolean {
    return this._monitoring;
  }

  setPollInterval(ms: number): void {
    this._pollInterval = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, ms));
    if (this._monitoring) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (this._monitoring) return;
    this._monitoring = true;
    this._monitoringSince = Date.now();
    this._peakCpu = 0;
    this._peakMemory = 0;
    this._totalProcessesSpawned = 0;
    this._lastProcessCount = 0;
    this.poll(); // immediate first poll
    this.timer = setInterval(() => this.poll(), this._pollInterval);
  }

  stop(): void {
    this._monitoring = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<SystemMetrics | null> {
    if (!this._monitoring) return null;

    try {
      const metrics = await this.collect();
      this.onMetrics?.(metrics);
      return metrics;
    } catch (err) {
      console.error('[SystemMonitor] poll error:', err);
      return null;
    }
  }

  async collect(): Promise<SystemMetrics> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const loadAvg = os.loadavg() as [number, number, number];

    // Calculate CPU usage from os.cpus()
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }
    const cpuUsage = totalTick > 0 ? ((1 - totalIdle / totalTick) * 100) : 0;

    // Gather PIDs to monitor
    const pidEntries: Array<{
      sessionId: string;
      pid: number;
      type: ProcessMetric['type'];
      name: string;
    }> = [];

    // Always include Electron main process
    pidEntries.push({
      sessionId: 'main',
      pid: process.pid,
      type: 'electron',
      name: 'Zeus (Electron)',
    });

    for (const source of this.pidSources) {
      try {
        pidEntries.push(...source());
      } catch {
        // skip failed sources
      }
    }

    // Track spawned processes
    const currentCount = pidEntries.length;
    if (currentCount > this._lastProcessCount) {
      this._totalProcessesSpawned += currentCount - this._lastProcessCount;
    }
    this._lastProcessCount = currentCount;

    // Get per-process stats
    const processes: ProcessMetric[] = [];
    if (pidEntries.length > 0) {
      const pids = pidEntries.map((e) => e.pid);
      try {
        const stats = await pidusage(pids);
        for (const entry of pidEntries) {
          const stat = stats[entry.pid];
          if (stat) {
            processes.push({
              pid: entry.pid,
              name: entry.name,
              cpu: Math.round(stat.cpu * 100) / 100,
              memory: stat.memory,
              type: entry.type,
              sessionId: entry.sessionId,
            });
          }
        }
      } catch {
        // pidusage can fail for dead processes
      }
    }

    // Update peaks
    if (cpuUsage > this._peakCpu) this._peakCpu = cpuUsage;
    const memUsage = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
    if (memUsage > this._peakMemory) this._peakMemory = memUsage;

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usage: Math.round(memUsage * 100) / 100,
      },
      uptime: os.uptime(),
      loadAvg,
      processes,
      snapshot: {
        peakCpu: Math.round(this._peakCpu * 100) / 100,
        peakMemory: Math.round(this._peakMemory * 100) / 100,
        monitoringSince: this._monitoringSince,
        totalProcessesSpawned: this._totalProcessesSpawned,
      },
      pollInterval: this._pollInterval,
    };
  }
}
