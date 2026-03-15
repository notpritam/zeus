import StatusIndicator from '@/components/StatusIndicator';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

function Header({ connected, onToggleSidebar, sidebarOpen }: HeaderProps) {
  return (
    <header
      data-testid="header"
      className="bg-bg-card border-border flex h-10 shrink-0 items-center justify-between border-b px-4"
    >
      {/* Hamburger (mobile only) */}
      <button
        data-testid="sidebar-toggle"
        className="text-text-muted hover:text-text-secondary mr-3 text-sm [-webkit-app-region:no-drag] md:hidden"
        onClick={onToggleSidebar}
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>

      {/* Brand */}
      <div className="flex items-center gap-2">
        <span className="text-text-primary text-sm font-bold tracking-tight">Zeus</span>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2">
        <StatusIndicator active={connected} />
        <span className="text-text-dim text-[10px]">{connected ? 'Connected' : 'Offline'}</span>
      </div>
    </header>
  );
}

export default Header;
