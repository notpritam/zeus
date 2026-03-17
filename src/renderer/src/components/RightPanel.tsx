import { GitBranch, FolderOpen, Eye, RefreshCw, Info, Settings } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';
import QAPanel from '@/components/QAPanel';
import SessionInfoPanel from '@/components/SessionInfoPanel';
import SessionSettingsPanel from '@/components/SessionSettingsPanel';
import ThemePicker from '@/components/ThemePicker';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

function WatcherStatusBar() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const claudeSessions = useZeusStore((s) => s.claudeSessions);
  const gitWatcherConnected = useZeusStore((s) => s.gitWatcherConnected);
  const fileTreeConnected = useZeusStore((s) => s.fileTreeConnected);
  const reconnectGitWatcher = useZeusStore((s) => s.reconnectGitWatcher);
  const reconnectFileWatcher = useZeusStore((s) => s.reconnectFileWatcher);

  // Find relevant session
  const session = claudeSessions.find((s) => s.id === activeClaudeId)
    ?? claudeSessions.find((s) => s.workingDir);
  if (!session?.workingDir) return null;

  const gitConnected = gitWatcherConnected[session.id] === true;
  const filesConnected = fileTreeConnected[session.id] === true;

  // Don't show bar if both connected
  if (gitConnected && filesConnected) return null;

  return (
    <div className="border-border bg-bg-card flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
      {!gitConnected && (
        <div className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-yellow-500" />
          <span className="text-text-muted text-[10px]">Git</span>
          <button
            className="text-text-ghost hover:text-primary flex items-center gap-0.5 text-[10px] transition-colors"
            onClick={reconnectGitWatcher}
            title="Reconnect git watcher"
          >
            <RefreshCw className="size-2.5" />
          </button>
        </div>
      )}
      {!filesConnected && (
        <div className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-yellow-500" />
          <span className="text-text-muted text-[10px]">Files</span>
          <button
            className="text-text-ghost hover:text-primary flex items-center gap-0.5 text-[10px] transition-colors"
            onClick={reconnectFileWatcher}
            title="Reconnect file watcher"
          >
            <RefreshCw className="size-2.5" />
          </button>
        </div>
      )}
      {!gitConnected && !filesConnected && (
        <button
          className="text-text-ghost hover:text-primary ml-auto text-[10px] transition-colors"
          onClick={() => { reconnectGitWatcher(); reconnectFileWatcher(); }}
        >
          Reconnect All
        </button>
      )}
    </div>
  );
}

function ActivityBarIcon({
  icon: Icon,
  tab,
  tooltip,
  badge,
  count,
  pulse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tab: 'source-control' | 'explorer' | 'qa' | 'info' | 'settings';
  tooltip: string;
  badge?: number;   // red error badge (top-right)
  count?: number;   // themed count badge (top-right, lower priority than badge)
  pulse?: boolean;  // green pulsing dot (bottom-right, for active state)
}) {
  const activeRightTab = useZeusStore((s) => s.activeRightTab);
  const setActiveRightTab = useZeusStore((s) => s.setActiveRightTab);

  const isActive = activeRightTab === tab;

  const handleClick = () => {
    if (isActive) {
      setActiveRightTab(null);
    } else {
      setActiveRightTab(tab);
    }
  };

  // badge (red) takes priority over count (themed) for the top-right slot
  const showBadge = badge !== undefined && badge > 0;
  const showCount = !showBadge && count !== undefined && count > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          aria-label={tooltip}
          className={`relative flex w-full items-center justify-center py-1.5 transition-colors ${
            isActive
              ? 'border-primary bg-primary/10 text-foreground border-l-2'
              : 'text-muted-foreground/60 hover:text-foreground border-l-2 border-transparent'
          }`}
        >
          <Icon className="size-5" />
          {showBadge && (
            <span className="absolute top-0.5 right-1 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold leading-none text-white">
              {badge! > 9 ? '!' : badge}
            </span>
          )}
          {showCount && (
            <span className="absolute top-0.5 right-0.5 flex min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold leading-none text-primary-foreground">
              {count! > 99 ? '99+' : count}
            </span>
          )}
          {pulse && (
            <span className="absolute bottom-0.5 right-1.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-400" />
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={4}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function RightPanel() {
  const activeRightTab = useZeusStore((s) => s.activeRightTab);
  const qaJsErrorCount = useZeusStore((s) => s.qaJsErrors.length);

  // Git changes count for active session
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const claudeSessions = useZeusStore((s) => s.claudeSessions);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const session = claudeSessions.find((s) => s.id === activeClaudeId)
    ?? claudeSessions.find((s) => s.workingDir);
  const sessionGit = session ? gitStatus[session.id] : undefined;
  const gitChangeCount = sessionGit
    ? sessionGit.staged.length + sessionGit.unstaged.length
    : 0;

  // QA running agents count (across all parent sessions)
  const qaAgents = useZeusStore((s) => s.qaAgents);
  const runningQaAgentCount = Object.values(qaAgents)
    .flat()
    .filter((a) => a.info.status === 'running')
    .length;

  // Pending approvals count
  const pendingApprovals = useZeusStore((s) => s.pendingApprovals);
  const pendingCount = pendingApprovals.length;

  // Running claude sessions count
  const runningClaudeCount = claudeSessions.filter((s) => s.status === 'running').length;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {/* Panel content - only when a tab is active */}
        {activeRightTab && (
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeRightTab === 'source-control' ? <GitPanel /> : activeRightTab === 'explorer' ? <FileExplorer /> : activeRightTab === 'info' ? <SessionInfoPanel /> : activeRightTab === 'settings' ? (
                <div className="flex h-full flex-col overflow-y-auto">
                  <SessionSettingsPanel />
                  <ThemePicker />
                </div>
              ) : <QAPanel />}
            </div>
            <WatcherStatusBar />
          </div>
        )}

        {/* Activity Bar - always visible */}
        <div className="bg-bg border-border w-10 shrink-0 flex flex-col items-center border-l pt-2 gap-3">
          <ActivityBarIcon
            icon={Info}
            tab="info"
            tooltip={
              pendingCount > 0
                ? `Session Info (${pendingCount} pending approval${pendingCount > 1 ? 's' : ''})`
                : runningClaudeCount > 0
                  ? `Session Info (${runningClaudeCount} running)`
                  : 'Session Info'
            }
            badge={pendingCount}
            pulse={runningClaudeCount > 0 && pendingCount === 0}
          />
          <ActivityBarIcon
            icon={GitBranch}
            tab="source-control"
            tooltip={gitChangeCount > 0 ? `Source Control (${gitChangeCount} changes)` : 'Source Control'}
            count={gitChangeCount}
          />
          <ActivityBarIcon icon={FolderOpen} tab="explorer" tooltip="Explorer" />
          <ActivityBarIcon
            icon={Eye}
            tab="qa"
            tooltip={
              runningQaAgentCount > 0 && qaJsErrorCount > 0
                ? `QA Preview (${runningQaAgentCount} running, ${qaJsErrorCount} errors)`
                : runningQaAgentCount > 0
                  ? `QA Preview (${runningQaAgentCount} agent${runningQaAgentCount > 1 ? 's' : ''} running)`
                  : qaJsErrorCount > 0
                    ? `QA Preview (${qaJsErrorCount} JS errors)`
                    : 'QA Preview'
            }
            badge={qaJsErrorCount}
            pulse={runningQaAgentCount > 0}
          />
          <div className="mt-auto pb-2">
            <ActivityBarIcon icon={Settings} tab="settings" tooltip="Session Settings" />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default RightPanel;
