import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, Link, Zap, Activity, Keyboard, Settings, Palette, RefreshCw, X } from 'lucide-react';
import PerformanceTab from './PerformanceTab';
import ThemePicker from './ThemePicker';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
  onTogglePower: () => void;
  onToggleTunnel: () => void;
}

const shortcuts = [
  ['⌘K', 'Command Palette'],
  ['⌘,', 'Settings'],
  ['⌘T', 'New Terminal'],
  ['⌘N', 'New Claude Session'],
  ['⌘B', 'Toggle Side Panel'],
] as const;

type SettingsTab = 'general' | 'appearance' | 'performance' | 'shortcuts';

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
];

function SettingsModal({
  open,
  onOpenChange,
  powerBlock,
  websocket,
  tunnel,
  onTogglePower,
  onToggleTunnel,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] max-md:inset-0 max-md:top-0 max-md:left-0 max-md:translate-x-0 max-md:translate-y-0 max-md:max-w-none max-md:w-full max-md:h-full max-md:rounded-none sm:max-w-2xl sm:h-[480px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>System settings, performance, and keyboard shortcuts</DialogDescription>
        </DialogHeader>

        <div className="flex h-full flex-col overflow-hidden">
          {/* Top header — full width */}
          <div className="flex shrink-0 items-center justify-between border-b bg-secondary/30 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Settings</h2>
              <p className="text-muted-foreground text-[11px] mt-0.5">Configure Zeus</p>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden"
            >
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>

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
            {/* Tab nav — vertical on desktop only */}
            <nav className="hidden md:flex md:w-44 md:shrink-0 md:flex-col md:border-r md:bg-secondary/20 md:py-2 md:px-2 md:space-y-0.5 md:overflow-y-auto">
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
            </nav>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* General tab */}
              {activeTab === 'general' && (
                <div className="space-y-5">
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
                            <Label htmlFor="power-lock" className="text-sm font-medium">Power Lock</Label>
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
                          <Badge variant={tunnel ? 'default' : 'secondary'}>{tunnel ? 'Active' : 'Off'}</Badge>
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
              {activeTab === 'appearance' && <ThemePicker />}

              {/* Performance tab */}
              {activeTab === 'performance' && <PerformanceTab />}

              {/* Shortcuts tab */}
              {activeTab === 'shortcuts' && (
                <div className="space-y-3">
                  <h4 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                    Keyboard Shortcuts
                  </h4>
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsModal;
