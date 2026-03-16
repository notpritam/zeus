import StatusIndicator from '@/components/StatusIndicator';

interface HeaderProps {
  connected: boolean;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
}

function Header({
  connected,
  onToggleSidebar,
  sidebarOpen,
  onToggleRightPanel,
  rightPanelOpen,
}: HeaderProps) {
  return (
    <header
      data-testid="header"
      className="bg-bg-card border-border flex h-10 shrink-0 items-center justify-between border-b px-4 pl-20 [-webkit-app-region:drag]"
    >
      {/* Hamburger (mobile only) */}
      <button
        data-testid="sidebar-toggle"
        className="text-text-muted hover:text-text-secondary mr-3 text-sm [-webkit-app-region:no-drag] md:hidden"
        onClick={onToggleSidebar}
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>

      <div className="flex-1" />

      {/* Connection Status + Right Panel Toggle */}
      <div className="flex items-center gap-3">
        {/* Right Panel Toggle (desktop only) */}
        <button
          data-testid="right-panel-toggle"
          className={`hidden text-sm [-webkit-app-region:no-drag] md:block ${
            rightPanelOpen
              ? 'text-info'
              : 'text-text-muted hover:text-text-secondary'
          } transition-colors`}
          onClick={onToggleRightPanel}
          title="Toggle Source Control Panel"
        >
          {/* Panel icon using box-drawing characters */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <rect x="1" y="2" width="14" height="12" rx="1" />
            <line x1="10" y1="2" x2="10" y2="14" />
          </svg>
        </button>

        <StatusIndicator active={connected} />
      </div>
    </header>
  );
}

export default Header;
