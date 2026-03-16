import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Menu, X, Settings, PanelRight } from 'lucide-react';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
}

function Header({
  connected,
  onToggleSidebar,
  sidebarOpen,
  onToggleRightPanel,
  rightPanelOpen,
  onOpenSettings,
  onOpenCommandPalette,
}: HeaderProps) {
  return (
    <header
      data-testid="header"
      className="bg-card border-border flex h-10 shrink-0 items-center justify-between border-b px-4 pl-20 [-webkit-app-region:drag]"
    >
      {/* Hamburger (mobile only) */}
      <Button
        data-testid="sidebar-toggle"
        variant="ghost"
        size="icon-xs"
        className="[-webkit-app-region:no-drag] md:hidden"
        onClick={onToggleSidebar}
      >
        {sidebarOpen ? <X /> : <Menu />}
      </Button>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {/* Command Palette */}
        <Button
          variant="ghost"
          size="xs"
          className="[-webkit-app-region:no-drag]"
          onClick={onOpenCommandPalette}
          title="Command Palette (⌘K)"
        >
          <Kbd>⌘K</Kbd>
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="[-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
        >
          <Settings />
        </Button>

        {/* Right Panel Toggle (desktop only) */}
        <Button
          data-testid="right-panel-toggle"
          variant="ghost"
          size="icon-xs"
          className={`hidden [-webkit-app-region:no-drag] md:inline-flex ${rightPanelOpen ? 'text-primary' : ''}`}
          onClick={onToggleRightPanel}
          title="Toggle Source Control Panel (⌘B)"
        >
          <PanelRight />
        </Button>

        {/* Connection indicator */}
        <span className="relative flex h-2 w-2">
          {connected && (
            <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-muted-foreground/30'}`}
          />
        </span>
      </div>
    </header>
  );
}

export default Header;
