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
import { Separator } from '@/components/ui/separator';
import { Kbd } from '@/components/ui/kbd';
import { Wifi, WifiOff, Link, Zap } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
  onTogglePower: () => void;
}

const shortcuts = [
  ['⌘K', 'Command Palette'],
  ['⌘,', 'Settings'],
  ['⌘T', 'New Terminal'],
  ['⌘N', 'New Claude Session'],
  ['⌘B', 'Toggle Side Panel'],
] as const;

function SettingsModal({
  open,
  onOpenChange,
  powerBlock,
  websocket,
  tunnel,
  onTogglePower,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>System settings and keyboard shortcuts</DialogDescription>
      </DialogHeader>
      <DialogContent className="sm:max-w-md">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Settings</h2>
          <p className="text-muted-foreground text-xs">System status and keyboard shortcuts.</p>
        </div>

        <Separator />

        {/* System Status */}
        <div className="space-y-4">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            System Status
          </h3>

          {/* Power Lock */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="text-muted-foreground size-4" />
              <Label htmlFor="power-lock" className="text-sm">
                Power Lock
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={powerBlock ? 'default' : 'secondary'}>
                {powerBlock ? 'Active' : 'Off'}
              </Badge>
              <Switch id="power-lock" checked={powerBlock} onCheckedChange={onTogglePower} />
            </div>
          </div>

          {/* WebSocket */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {websocket ? (
                <Wifi className="text-muted-foreground size-4" />
              ) : (
                <WifiOff className="text-muted-foreground size-4" />
              )}
              <span className="text-sm">WebSocket</span>
            </div>
            <Badge variant={websocket ? 'default' : 'destructive'}>
              {websocket ? 'Connected' : 'Offline'}
            </Badge>
          </div>

          {/* Tunnel */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link className="text-muted-foreground size-4" />
              <span className="text-sm">Tunnel</span>
            </div>
            <Badge variant={tunnel ? 'default' : 'secondary'}>{tunnel ? 'Active' : 'Off'}</Badge>
          </div>

          {tunnel && (
            <button
              className="text-primary hover:text-primary/80 w-full truncate text-left text-xs transition-colors"
              title={tunnel}
              onClick={() => navigator.clipboard.writeText(tunnel)}
            >
              {tunnel.replace(/^https?:\/\//, '')} — click to copy
            </button>
          )}
        </div>

        <Separator />

        {/* Keyboard Shortcuts */}
        <div className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Keyboard Shortcuts
          </h3>
          <div className="space-y-2">
            {shortcuts.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">{label}</span>
                <Kbd>{key}</Kbd>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsModal;
