import { Button } from '@/components/ui/button';
import { GitBranch, FolderOpen, RefreshCw } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';

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

function RightPanel() {
  const rightPanelTab = useZeusStore((s) => s.rightPanelTab);
  const setRightPanelTab = useZeusStore((s) => s.setRightPanelTab);

  return (
    <div className="bg-card flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="border-border flex shrink-0 border-b">
        <Button
          variant="ghost"
          size="sm"
          className={`rounded-none border-b-2 ${
            rightPanelTab === 'source-control'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          }`}
          onClick={() => setRightPanelTab('source-control')}
        >
          <GitBranch className="size-3" />
          Source Control
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`rounded-none border-b-2 ${
            rightPanelTab === 'file-explorer'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          }`}
          onClick={() => setRightPanelTab('file-explorer')}
        >
          <FolderOpen className="size-3" />
          Files
        </Button>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {rightPanelTab === 'source-control' ? <GitPanel /> : <FileExplorer />}
      </div>

      {/* Watcher status bar — shows when disconnected */}
      <WatcherStatusBar />
    </div>
  );
}

export default RightPanel;
