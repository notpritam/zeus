import { useState } from 'react';
import { GitBranch, FolderOpen, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/ResizablePanel';

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

function SectionHeader({
  icon: Icon,
  label,
  collapsed,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="bg-bg-card border-border hover:bg-secondary/50 flex w-full shrink-0 items-center gap-1.5 border-b px-2 py-1 text-left transition-colors"
      onClick={onToggle}
    >
      {collapsed ? (
        <ChevronRight className="text-text-muted size-3" />
      ) : (
        <ChevronDown className="text-text-muted size-3" />
      )}
      <Icon className="text-text-muted size-3" />
      <span className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

function RightPanel() {
  const [gitCollapsed, setGitCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  const bothOpen = !gitCollapsed && !filesCollapsed;

  return (
    <div className="bg-card flex h-full flex-col overflow-hidden">
      {bothOpen ? (
        /* Both sections open — use resizable vertical split */
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel id="right-git" defaultSize="50%" minSize="60px">
            <div className="flex h-full flex-col">
              <SectionHeader
                icon={GitBranch}
                label="Source Control"
                collapsed={false}
                onToggle={() => setGitCollapsed(true)}
              />
              <div className="min-h-0 flex-1">
                <GitPanel />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className="!h-px !w-full" />

          <ResizablePanel id="right-files" defaultSize="50%" minSize="60px">
            <div className="flex h-full flex-col">
              <SectionHeader
                icon={FolderOpen}
                label="Explorer"
                collapsed={false}
                onToggle={() => setFilesCollapsed(true)}
              />
              <div className="min-h-0 flex-1">
                <FileExplorer />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        /* One or both collapsed — no resizable needed */
        <>
          {/* Source Control */}
          <SectionHeader
            icon={GitBranch}
            label="Source Control"
            collapsed={gitCollapsed}
            onToggle={() => setGitCollapsed((v) => !v)}
          />
          {!gitCollapsed && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <GitPanel />
            </div>
          )}

          {/* Explorer */}
          <SectionHeader
            icon={FolderOpen}
            label="Explorer"
            collapsed={filesCollapsed}
            onToggle={() => setFilesCollapsed((v) => !v)}
          />
          {!filesCollapsed && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileExplorer />
            </div>
          )}
        </>
      )}

      {/* Watcher status bar — shows when disconnected */}
      <WatcherStatusBar />
    </div>
  );
}

export default RightPanel;
