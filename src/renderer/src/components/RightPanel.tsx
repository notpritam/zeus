import { GitBranch, FolderOpen, Eye, RefreshCw } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';
import QAPanel from '@/components/QAPanel';
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  tab: 'source-control' | 'explorer' | 'qa';
  tooltip: string;
}) {
  const activeRightTab = useZeusStore((s) => s.activeRightTab);
  const setActiveRightTab = useZeusStore((s) => s.setActiveRightTab);

  const isActive = activeRightTab === tab;

  const handleClick = () => {
    if (isActive) {
      // Clicking active tab collapses the panel
      setActiveRightTab(null);
    } else {
      setActiveRightTab(tab);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={`flex w-full items-center justify-center py-1.5 transition-colors ${
            isActive
              ? 'border-primary bg-primary/10 text-foreground border-l-2'
              : 'text-muted-foreground/60 hover:text-foreground border-l-2 border-transparent'
          }`}
        >
          <Icon className="size-5" />
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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {/* Panel content - only when a tab is active */}
        {activeRightTab && (
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeRightTab === 'source-control' ? <GitPanel /> : activeRightTab === 'explorer' ? <FileExplorer /> : <QAPanel />}
            </div>
            <WatcherStatusBar />
          </div>
        )}

        {/* Activity Bar - always visible */}
        <div className="bg-bg border-border w-10 shrink-0 flex flex-col items-center border-l pt-2 gap-3">
          <ActivityBarIcon icon={GitBranch} tab="source-control" tooltip="Source Control" />
          <ActivityBarIcon icon={FolderOpen} tab="explorer" tooltip="Explorer" />
          <ActivityBarIcon icon={Eye} tab="qa" tooltip="QA Preview" />
        </div>
      </div>
    </TooltipProvider>
  );
}

export default RightPanel;
