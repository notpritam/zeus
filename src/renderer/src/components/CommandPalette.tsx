import { useEffect } from 'react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Settings,
  Terminal,
  Sparkles,
  Zap,
  ZapOff,
  Link,
  PanelRight,
} from 'lucide-react';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  action: () => void;
  group?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}

function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  // Cmd+K toggle
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const grouped = commands.reduce<Record<string, PaletteCommand[]>>((acc, cmd) => {
    const group = cmd.group ?? 'Actions';
    if (!acc[group]) acc[group] = [];
    acc[group].push(cmd);
    return acc;
  }, {});

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search for a command to run..."
      showCloseButton={false}
    >
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {Object.entries(grouped).map(([group, cmds], i) => (
          <div key={group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {cmds.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  onSelect={() => {
                    cmd.action();
                    onOpenChange(false);
                  }}
                >
                  {cmd.icon}
                  <span>{cmd.label}</span>
                  {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

// Default command factory
export function buildCommands({
  powerBlock,
  tunnel,
  togglePower,
  startSession,
  openNewSession,
  toggleRightPanel,
  openSettings,
}: {
  powerBlock: boolean;
  tunnel: string | null;
  togglePower: () => void;
  startSession: () => void;
  openNewSession: () => void;
  toggleRightPanel: () => void;
  openSettings: () => void;
}): PaletteCommand[] {
  return [
    {
      id: 'new-terminal',
      label: 'New Terminal Session',
      shortcut: '⌘T',
      icon: <Terminal />,
      action: startSession,
      group: 'Sessions',
    },
    {
      id: 'new-claude',
      label: 'New Claude Session',
      shortcut: '⌘N',
      icon: <Sparkles />,
      action: openNewSession,
      group: 'Sessions',
    },
    {
      id: 'toggle-power',
      label: powerBlock ? 'Disable Power Lock' : 'Enable Power Lock',
      icon: powerBlock ? <ZapOff /> : <Zap />,
      action: togglePower,
      group: 'System',
    },
    ...(tunnel
      ? [
          {
            id: 'copy-tunnel',
            label: 'Copy Tunnel URL',
            icon: <Link />,
            action: () => navigator.clipboard.writeText(tunnel),
            group: 'System',
          },
        ]
      : []),
    {
      id: 'toggle-panel',
      label: 'Toggle Side Panel',
      shortcut: '⌘B',
      icon: <PanelRight />,
      action: toggleRightPanel,
      group: 'View',
    },
    {
      id: 'settings',
      label: 'Open Settings',
      shortcut: '⌘,',
      icon: <Settings />,
      action: openSettings,
      group: 'View',
    },
  ];
}

export default CommandPalette;
