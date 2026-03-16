import StatusIndicator from '@/components/StatusIndicator';

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

      <div className="flex items-center gap-3">
        {/* Command Palette */}
        <button
          className="text-text-muted hover:text-text-secondary text-xs [-webkit-app-region:no-drag]"
          onClick={onOpenCommandPalette}
          title="Command Palette (⌘K)"
        >
          <kbd className="bg-bg-surface border-border rounded border px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        {/* Settings */}
        <button
          className="text-text-muted hover:text-text-secondary [-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" />
          </svg>
        </button>

        {/* Right Panel Toggle (desktop only) */}
        <button
          data-testid="right-panel-toggle"
          className={`hidden text-sm [-webkit-app-region:no-drag] md:block ${
            rightPanelOpen
              ? 'text-info'
              : 'text-text-muted hover:text-text-secondary'
          } transition-colors`}
          onClick={onToggleRightPanel}
          title="Toggle Source Control Panel (⌘B)"
        >
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
