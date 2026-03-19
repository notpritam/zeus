import { useState, useEffect, useRef } from 'react';
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
