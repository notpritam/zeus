import { useEffect, useMemo } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Cpu, MemoryStick, Clock, Activity, Gauge, Server, Zap } from 'lucide-react';
import type { ProcessMetric } from '@shared/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function UsageBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

// Stacked bar showing per-category memory breakdown
function MemoryBreakdownBar({ segments }: { segments: Array<{ label: string; bytes: number; color: string }> }) {
  const total = segments.reduce((sum, s) => sum + s.bytes, 0);
  if (total === 0) return null;

  return (
    <div className="bg-secondary h-3 w-full overflow-hidden rounded-full flex">
      {segments.filter(s => s.bytes > 0).map((seg) => {
        const pct = (seg.bytes / total) * 100;
        return (
          <div
            key={seg.label}
            className={`h-full ${seg.color} transition-all duration-500`}
            style={{ width: `${pct}%` }}
            title={`${seg.label}: ${formatBytes(seg.bytes)} (${pct.toFixed(1)}%)`}
          />
        );
      })}
    </div>
  );
}

const TYPE_CONFIG: Record<ProcessMetric['type'], { badge: 'default' | 'secondary' | 'outline' | 'destructive'; color: string }> = {
  electron: { badge: 'default', color: 'bg-blue-500' },
  claude: { badge: 'secondary', color: 'bg-purple-500' },
  terminal: { badge: 'outline', color: 'bg-green-500' },
  qa: { badge: 'destructive', color: 'bg-orange-500' },
  other: { badge: 'outline', color: 'bg-gray-500' },
};

const INTERVAL_OPTIONS = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
];

function PerformanceTab() {
  const metrics = useZeusStore((s) => s.perfMetrics);
  const monitoring = useZeusStore((s) => s.perfMonitoring);
  const startMonitoring = useZeusStore((s) => s.startPerfMonitoring);
  const stopMonitoring = useZeusStore((s) => s.stopPerfMonitoring);
  const setInterval = useZeusStore((s) => s.setPerfPollInterval);

  // Auto-start monitoring when this tab is mounted
  useEffect(() => {
    if (!monitoring) startMonitoring();
    return () => {
      // Don't auto-stop — let user control it
    };
  }, []);

  // Aggregate per-category memory/cpu stats
  const breakdown = useMemo(() => {
    if (!metrics) return null;

    const categories: Record<string, { memory: number; cpu: number; count: number }> = {};
    for (const proc of metrics.processes) {
      const cat = proc.type;
      if (!categories[cat]) categories[cat] = { memory: 0, cpu: 0, count: 0 };
      categories[cat].memory += proc.memory;
      categories[cat].cpu += proc.cpu;
      categories[cat].count += 1;
    }

    const totalZeusMemory = metrics.processes.reduce((sum, p) => sum + p.memory, 0);
    const totalZeusCpu = metrics.processes.reduce((sum, p) => sum + p.cpu, 0);
    const zeusMemPct = metrics.memory.total > 0 ? (totalZeusMemory / metrics.memory.total) * 100 : 0;

    return { categories, totalZeusMemory, totalZeusCpu, zeusMemPct };
  }, [metrics]);

  if (!metrics) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-xs">
        <Activity className="size-3.5 animate-pulse" />
        Waiting for metrics...
      </div>
    );
  }

  const segments = breakdown
    ? Object.entries(breakdown.categories).map(([type, data]) => ({
        label: type.charAt(0).toUpperCase() + type.slice(1),
        bytes: data.memory,
        color: TYPE_CONFIG[type as ProcessMetric['type']]?.color ?? 'bg-gray-500',
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Zeus Total — aggregate of all tracked processes */}
      {breakdown && breakdown.totalZeusMemory > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="text-yellow-500 size-4" />
              <Label className="text-sm font-semibold">Zeus Total</Label>
            </div>
            <span className="text-sm font-mono tabular-nums font-semibold">
              {formatBytes(breakdown.totalZeusMemory)}
            </span>
          </div>
          <MemoryBreakdownBar segments={segments} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            {segments.filter(s => s.bytes > 0).map((seg) => (
              <div key={seg.label} className="flex items-center gap-1">
                <div className={`size-2 rounded-full ${seg.color}`} />
                <span className="text-muted-foreground">{seg.label}</span>
                <span className="font-mono">{formatBytes(seg.bytes)}</span>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground flex justify-between text-[10px]">
            <span>{breakdown.zeusMemPct.toFixed(1)}% of system RAM</span>
            <span>CPU: {breakdown.totalZeusCpu.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {breakdown && breakdown.totalZeusMemory > 0 && <Separator />}

      {/* CPU */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="text-muted-foreground size-4" />
            <Label className="text-sm">CPU</Label>
          </div>
          <span className="text-sm font-mono tabular-nums">
            {metrics.cpu.usage.toFixed(1)}%
          </span>
        </div>
        <UsageBar
          value={metrics.cpu.usage}
          color={metrics.cpu.usage > 80 ? 'bg-red-500' : metrics.cpu.usage > 50 ? 'bg-yellow-500' : 'bg-green-500'}
        />
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>{metrics.cpu.cores} cores</span>
          <span>Load: {metrics.loadAvg.map((l) => l.toFixed(2)).join(' / ')}</span>
        </div>
      </div>

      {/* Memory */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MemoryStick className="text-muted-foreground size-4" />
            <Label className="text-sm">System Memory</Label>
          </div>
          <span className="text-sm font-mono tabular-nums">
            {metrics.memory.usage.toFixed(1)}%
          </span>
        </div>
        <UsageBar
          value={metrics.memory.usage}
          color={metrics.memory.usage > 85 ? 'bg-red-500' : metrics.memory.usage > 60 ? 'bg-yellow-500' : 'bg-blue-500'}
        />
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>{formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}</span>
          <span>{formatBytes(metrics.memory.free)} free</span>
        </div>
      </div>

      <Separator />

      {/* Processes */}
      {metrics.processes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Server className="text-muted-foreground size-4" />
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Processes ({metrics.processes.length})
            </Label>
          </div>
          <div className="space-y-1.5">
            {metrics.processes
              .sort((a, b) => b.memory - a.memory)
              .map((proc) => (
              <div key={proc.pid} className="bg-secondary/50 flex items-center justify-between rounded px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={TYPE_CONFIG[proc.type]?.badge ?? 'outline'}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {proc.type}
                  </Badge>
                  <span className="text-xs truncate max-w-[120px]">{proc.name}</span>
                </div>
                <div className="text-muted-foreground flex gap-3 text-[10px] font-mono">
                  <span>{proc.cpu.toFixed(1)}%</span>
                  <span>{formatBytes(proc.memory)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Session Snapshots */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="text-muted-foreground size-4" />
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Session Snapshot
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary/50 rounded px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">Peak CPU</div>
            <div className="text-sm font-mono">{metrics.snapshot.peakCpu.toFixed(1)}%</div>
          </div>
          <div className="bg-secondary/50 rounded px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">Peak Memory</div>
            <div className="text-sm font-mono">{metrics.snapshot.peakMemory.toFixed(1)}%</div>
          </div>
          <div className="bg-secondary/50 rounded px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">Monitoring Since</div>
            <div className="text-sm font-mono">
              {formatUptime((Date.now() - metrics.snapshot.monitoringSince) / 1000)}
            </div>
          </div>
          <div className="bg-secondary/50 rounded px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">Processes Spawned</div>
            <div className="text-sm font-mono">{metrics.snapshot.totalProcessesSpawned}</div>
          </div>
        </div>
      </div>

      <Separator />

      {/* System Uptime */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="text-muted-foreground size-4" />
          <span className="text-sm">System Uptime</span>
        </div>
        <span className="text-muted-foreground text-sm font-mono">{formatUptime(metrics.uptime)}</span>
      </div>

      <Separator />

      {/* Poll Interval Control */}
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Refresh Interval
        </Label>
        <div className="flex gap-1.5">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setInterval(opt.value)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                metrics.pollInterval === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Monitoring toggle */}
      <button
        onClick={monitoring ? stopMonitoring : startMonitoring}
        className={`w-full rounded px-3 py-1.5 text-xs transition-colors ${
          monitoring
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : 'bg-primary/10 text-primary hover:bg-primary/20'
        }`}
      >
        {monitoring ? 'Stop Monitoring' : 'Start Monitoring'}
      </button>
    </div>
  );
}

export default PerformanceTab;
