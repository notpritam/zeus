import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import {
  Wifi,
  WifiOff,
  Link,
  Zap,
  Activity,
  Keyboard,
  Settings,
  Palette,
  RefreshCw,
  Info,
} from 'lucide-react';
import PerformanceTab from './PerformanceTab';
import ThemePicker from './ThemePicker';

interface SettingsViewProps {
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
  autoTunnel: boolean;
  onTogglePower: () => void;
  onToggleTunnel: () => void;
  onSetAutoTunnel: (enabled: boolean) => void;
}

const shortcuts = [
  ['⌘K', 'Command Palette'],
  ['⌘,', 'Settings'],
  ['⌘T', 'New Terminal'],
  ['⌘N', 'New Claude Session'],
  ['⌘B', 'Toggle Side Panel'],
] as const;

type SettingsTab = 'general' | 'appearance' | 'performance' | 'shortcuts' | 'about';

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
];

const APP_VERSION = __APP_VERSION__;

function SettingsView({
  powerBlock,
  websocket,
  tunnel,
  autoTunnel,
  onTogglePower,
  onToggleTunnel,
  onSetAutoTunnel,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Mobile tab bar — horizontal */}
      <div className="md:hidden shrink-0 border-b bg-background">
        <nav className="flex gap-1 px-4 py-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tab nav — vertical on desktop */}
        <nav className="hidden md:flex md:w-48 md:shrink-0 md:flex-col md:border-r md:bg-secondary/20 md:py-3 md:px-2.5 md:space-y-0.5 md:overflow-y-auto">
          <div className="px-2.5 pb-3">
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
            <p className="text-muted-foreground text-[11px] mt-0.5">Configure Zeus</p>
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}

          {/* Version at bottom of sidebar */}
          <div className="mt-auto pt-4 px-2.5">
            <p className="text-muted-foreground/60 text-[10px]">Zeus v{APP_VERSION}</p>
          </div>
        </nav>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            {/* General tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">General</h3>
                  <p className="text-muted-foreground text-xs mb-4">System status and core settings</p>
                </div>

                <div>
                  <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider mb-3">
                    System Status
                  </h4>
                  <div className="space-y-3">
                    {/* Power Lock */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Zap className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <Label htmlFor="power-lock" className="text-sm font-medium">
                            Power Lock
                          </Label>
                          <p className="text-muted-foreground text-[11px]">Prevent system sleep</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={powerBlock ? 'default' : 'secondary'}>
                          {powerBlock ? 'Active' : 'Off'}
                        </Badge>
                        <Switch id="power-lock" checked={powerBlock} onCheckedChange={onTogglePower} />
                      </div>
                    </div>

                    {/* WebSocket */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          {websocket ? (
                            <Wifi className="size-4 text-muted-foreground" />
                          ) : (
                            <WifiOff className="size-4 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <span className="text-sm font-medium">WebSocket</span>
                          <p className="text-muted-foreground text-[11px]">Real-time connection</p>
                        </div>
                      </div>
                      <Badge variant={websocket ? 'default' : 'destructive'}>
                        {websocket ? 'Connected' : 'Offline'}
                      </Badge>
                    </div>

                    {/* Tunnel */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Link className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <span className="text-sm font-medium">Tunnel</span>
                          <p className="text-muted-foreground text-[11px]">Remote access via ngrok</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={tunnel ? 'default' : 'secondary'}>
                          {tunnel ? 'Active' : 'Off'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-6"
                          onClick={onToggleTunnel}
                          title={tunnel ? 'Restart tunnel' : 'Start tunnel'}
                        >
                          <RefreshCw className="size-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Auto Tunnel */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                          <Link className="size-4 text-muted-foreground" />
                        </div>
                        <div>
                          <Label htmlFor="auto-tunnel" className="text-sm font-medium">
                            Auto Tunnel
                          </Label>
                          <p className="text-muted-foreground text-[11px]">Start tunnel automatically on launch</p>
                        </div>
                      </div>
                      <Switch id="auto-tunnel" checked={autoTunnel} onCheckedChange={onSetAutoTunnel} />
                    </div>
                  </div>
                </div>

                {tunnel && (
                  <div>
                    <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider mb-2">
                      Tunnel URL
                    </h4>
                    <button
                      className="text-primary hover:text-primary/80 w-full truncate rounded-md border px-3 py-2 text-left text-xs transition-colors"
                      title={tunnel}
                      onClick={() => navigator.clipboard.writeText(tunnel)}
                    >
                      {tunnel.replace(/^https?:\/\//, '')} — click to copy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Appearance tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Appearance</h3>
                  <p className="text-muted-foreground text-xs mb-4">Customize the look and feel</p>
                </div>
                <ThemePicker />
              </div>
            )}

            {/* Performance tab */}
            {activeTab === 'performance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Performance</h3>
                  <p className="text-muted-foreground text-xs mb-4">System resource monitoring</p>
                </div>
                <PerformanceTab />
              </div>
            )}

            {/* Shortcuts tab */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Keyboard Shortcuts</h3>
                  <p className="text-muted-foreground text-xs mb-4">Quick actions and navigation</p>
                </div>
                <div className="space-y-1">
                  {shortcuts.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                      <span className="text-muted-foreground text-xs">{label}</span>
                      <Kbd>{key}</Kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* About tab */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">About Zeus</h3>
                  <p className="text-muted-foreground text-xs mb-4">
                    Remote orchestration tool for AI-powered development
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">Version</span>
                    <span className="text-foreground text-xs font-mono">{APP_VERSION}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">Platform</span>
                    <span className="text-foreground text-xs font-mono">{navigator.platform}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <span className="text-muted-foreground text-xs">User Agent</span>
                    <span className="text-foreground text-xs font-mono truncate max-w-xs" title={navigator.userAgent}>
                      {navigator.userAgent.split(' ').slice(-3).join(' ')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
