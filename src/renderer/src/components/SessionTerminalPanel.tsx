import { useRef, useCallback } from 'react';
import { Plus, Minus, X } from 'lucide-react';
import { useTerminal } from '@/hooks/useTerminal';
import { useZeusStore } from '@/stores/useZeusStore';

interface TerminalTabInstanceProps {
  tabId: string;
  terminalSessionId: string;
  claudeSessionId: string;
  isActive: boolean;
  exited: boolean;
  exitCode?: number;
  cwd: string;
}

function TerminalTabInstance({
  tabId,
  terminalSessionId,
  claudeSessionId,
  isActive,
  exited,
  exitCode,
  cwd,
}: TerminalTabInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setExited = useZeusStore((s) => s.setSessionTerminalExited);
  const restart = useZeusStore((s) => s.restartSessionTerminal);

  const onExit = useCallback(
    (code: number) => setExited(claudeSessionId, tabId, code),
    [claudeSessionId, tabId, setExited],
  );

  useTerminal(terminalSessionId || null, containerRef, onExit);

  return (
    <div
      className="absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden p-1"
      />
      {exited && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2">
            <p className="text-muted-foreground text-xs">
              Process exited with code {exitCode ?? '?'}
            </p>
            <button
              onClick={() => restart(claudeSessionId, tabId, cwd)}
              className="text-primary hover:text-primary/80 text-xs underline"
            >
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionTerminalPanelProps {
  claudeSessionId: string;
  cwd: string;
}

export default function SessionTerminalPanel({
  claudeSessionId,
  cwd,
}: SessionTerminalPanelProps) {
  const st = useZeusStore((s) => s.sessionTerminals[claudeSessionId]);
  const createTab = useZeusStore((s) => s.createSessionTerminal);
  const closeTab = useZeusStore((s) => s.closeSessionTerminal);
  const switchTab = useZeusStore((s) => s.switchSessionTerminal);
  const togglePanel = useZeusStore((s) => s.toggleSessionTerminalPanel);

  if (!st) return null;

  const { tabs, activeTabId } = st;
  const canAddTab = tabs.length < 5;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border-dim bg-bg-card px-2 py-1">
        {tabs.map((tab) => (
          <button
            key={tab.tabId}
            onClick={() => switchTab(claudeSessionId, tab.tabId)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              tab.tabId === activeTabId
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            } ${tab.exited ? 'opacity-60' : ''}`}
          >
            <span className="max-w-[100px] truncate">{tab.label}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(claudeSessionId, tab.tabId);
              }}
              className="text-muted-foreground hover:text-destructive ml-0.5 rounded p-0.5"
            >
              <X className="size-3" />
            </span>
          </button>
        ))}
        <button
          onClick={() => createTab(claudeSessionId, cwd)}
          disabled={!canAddTab}
          className="text-muted-foreground hover:text-foreground rounded p-1 disabled:cursor-not-allowed disabled:opacity-30"
          title="New terminal tab"
        >
          <Plus className="size-3.5" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => togglePanel(claudeSessionId)}
          className="text-muted-foreground hover:text-foreground rounded p-1"
          title="Minimize terminal"
        >
          <Minus className="size-3.5" />
        </button>
      </div>

      {/* Terminal instances — all mounted, inactive hidden via display:none */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalTabInstance
            key={tab.tabId}
            tabId={tab.tabId}
            terminalSessionId={tab.terminalSessionId}
            claudeSessionId={claudeSessionId}
            isActive={tab.tabId === activeTabId}
            exited={tab.exited}
            exitCode={tab.exitCode}
            cwd={cwd}
          />
        ))}
      </div>
    </div>
  );
}
