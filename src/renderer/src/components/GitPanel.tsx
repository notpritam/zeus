import { useState, useEffect, Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitBranch, RefreshCw, ChevronDown, ChevronRight, Plus, Minus, Undo2, Loader2, CheckCircle2, FolderGit2, AlertTriangle } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { GitFileChange } from '../../../shared/types';

// ─── Status badge styles ───

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-destructive' },
  R: { label: 'R', color: 'text-primary' },
  '??': { label: 'U', color: 'text-muted-foreground' },
  UU: { label: 'C', color: 'text-destructive' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { label: status, color: 'text-muted-foreground' };
}

function getFileName(filePath: string): { name: string; dir: string } {
  const parts = filePath.split('/');
  const name = parts.pop() ?? filePath;
  const dir = parts.join('/');
  return { name, dir };
}

// ─── File entry with action buttons ───

function FileEntry({
  change,
  variant,
  sessionId,
}: {
  change: GitFileChange;
  variant: 'staged' | 'unstaged';
  sessionId: string;
}) {
  const stageFiles = useZeusStore((s) => s.stageFiles);
  const unstageFiles = useZeusStore((s) => s.unstageFiles);
  const discardFiles = useZeusStore((s) => s.discardFiles);
  const openDiffTab = useZeusStore((s) => s.openDiffTab);

  const style = getStatusStyle(change.status);
  const { name, dir } = getFileName(change.file);

  return (
    <div className="group hover:bg-secondary flex items-center gap-1 px-3 py-0.5">
      <span className={`w-4 shrink-0 text-center text-[10px] font-bold ${style.color}`}>
        {style.label}
      </span>
      <button
        className="text-foreground min-w-0 flex-1 truncate text-left text-xs hover:underline"
        onClick={() => openDiffTab(sessionId, change.file, variant === 'staged')}
        title={`View diff: ${change.file}`}
      >
        {name}
        {dir && <span className="text-muted-foreground/50 ml-1 text-[10px]">{dir}</span>}
      </button>

      {/* Action buttons — visible on hover */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {variant === 'unstaged' && change.status !== 'D' && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive size-5"
            onClick={() => discardFiles(sessionId, [change.file])}
            title="Discard changes"
          >
            <Undo2 className="size-3" />
          </Button>
        )}
        {variant === 'unstaged' ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-accent size-5"
            onClick={() => stageFiles(sessionId, [change.file])}
            title="Stage file"
          >
            <Plus className="size-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-warn size-5"
            onClick={() => unstageFiles(sessionId, [change.file])}
            title="Unstage file"
          >
            <Minus className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Error Boundary ───

class GitPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
          <AlertTriangle className="text-warn size-6" />
          <p className="text-foreground text-xs font-medium">Source Control Error</p>
          <p className="text-muted-foreground text-center text-[10px]">
            {this.state.error?.message || 'Something went wrong'}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main GitPanel ───

function GitPanelInner() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const activeSession = useZeusStore((s) =>
    s.claudeSessions.find((cs) => cs.id === s.activeClaudeId),
  );
  const gitStatus = useZeusStore((s) => (activeClaudeId ? s.gitStatus[activeClaudeId] : undefined));
  const gitError = useZeusStore((s) => (activeClaudeId ? s.gitErrors[activeClaudeId] : undefined));
  const isNotARepo = useZeusStore((s) =>
    activeClaudeId ? s.gitNotARepo[activeClaudeId] === true : false,
  );
  const isConnected = useZeusStore((s) =>
    activeClaudeId ? s.gitWatcherConnected[activeClaudeId] === true : false,
  );
  const refreshGitStatus = useZeusStore((s) => s.refreshGitStatus);
  const initGitRepo = useZeusStore((s) => s.initGitRepo);
  const stageAll = useZeusStore((s) => s.stageAll);
  const unstageAll = useZeusStore((s) => s.unstageAll);
  const commitChanges = useZeusStore((s) => s.commitChanges);

  const [commitMessage, setCommitMessage] = useState('');
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);

  // Reset initializing state when repo status changes
  useEffect(() => {
    if (!isNotARepo) setIsInitializing(false);
  }, [isNotARepo]);

  const stagedChanges = gitStatus?.staged ?? [];
  const unstagedChanges = gitStatus?.unstaged ?? [];
  const totalChanges = stagedChanges.length + unstagedChanges.length;
  const hasStagedChanges = stagedChanges.length > 0;
  const canCommit = commitMessage.trim() && hasStagedChanges;

  const handleCommit = () => {
    if (!canCommit || !activeClaudeId) return;
    commitChanges(activeClaudeId, commitMessage.trim());
    setCommitMessage('');
  };

  // No active Claude session
  if (!activeClaudeId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <GitBranch className="text-muted-foreground size-6" />
        <p className="text-muted-foreground text-xs">No active session</p>
        <p className="text-muted-foreground/60 text-center text-[10px]">
          Start a Claude session to enable source control
        </p>
      </div>
    );
  }

  // Git watcher disabled for this session
  if (activeSession && activeSession.enableGitWatcher === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <GitBranch className="text-muted-foreground size-6" />
        <p className="text-muted-foreground text-xs">Git watcher disabled</p>
        <p className="text-muted-foreground/60 text-center text-[10px]">
          Enable git watcher when starting a session
        </p>
      </div>
    );
  }

  // Watcher connecting (no status received yet)
  if (!gitStatus && !gitError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <Loader2 className="text-primary size-5 animate-spin" />
        <p className="text-muted-foreground text-xs">Connecting to git...</p>
      </div>
    );
  }

  // Not a git repository — offer to initialize
  if (isNotARepo) {
    const dirName = activeSession?.workingDir?.split('/').pop() || 'this directory';

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="bg-muted/30 flex size-14 items-center justify-center rounded-xl border border-dashed border-white/10">
          <FolderGit2 className="text-muted-foreground size-7" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-foreground text-xs font-medium">No Git Repository</p>
          <p className="text-muted-foreground/60 text-[10px] leading-relaxed">
            The directory <span className="text-muted-foreground font-medium">{dirName}</span> is not
            tracked by Git. Initialize a repository to enable source control.
          </p>
          {activeSession?.workingDir && (
            <p className="text-muted-foreground/40 truncate text-[9px]" title={activeSession.workingDir}>
              {activeSession.workingDir}
            </p>
          )}
        </div>

        {gitError && (
          <div className="bg-destructive/10 border-destructive/20 w-full rounded-md border px-3 py-2">
            <p className="text-destructive text-[10px]">{gitError}</p>
          </div>
        )}

        <Button
          size="sm"
          disabled={isInitializing}
          onClick={() => {
            if (activeClaudeId && activeSession?.workingDir) {
              setIsInitializing(true);
              initGitRepo(activeClaudeId, activeSession.workingDir);
              // Reset after a timeout in case the response doesn't come
              setTimeout(() => setIsInitializing(false), 5000);
            }
          }}
          className="mt-1 w-full max-w-[200px]"
        >
          {isInitializing ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Initializing...
            </>
          ) : (
            <>
              <FolderGit2 className="mr-1.5 size-3.5" />
              Initialize Repository
            </>
          )}
        </Button>
      </div>
    );
  }

  // Error only (non-repo errors), no status data
  if (!gitStatus && gitError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <GitBranch className="text-destructive size-6" />
        <p className="text-destructive text-xs">{gitError}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-xs font-semibold">Source Control</span>
          {/* Connection indicator */}
          <span className="relative flex h-1.5 w-1.5">
            {isConnected && (
              <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-accent' : 'bg-muted-foreground/30'}`}
            />
          </span>
          {totalChanges > 0 && (
            <Badge variant="secondary" className="text-primary text-[10px] font-bold">
              {totalChanges}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => activeClaudeId && refreshGitStatus(activeClaudeId)}
          title="Refresh"
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>

      {/* Branch info */}
      <div className="border-border shrink-0 border-b px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <GitBranch className="text-muted-foreground size-3" />
          <span className="text-foreground text-[11px] font-medium">{gitStatus!.branch}</span>
          {(gitStatus!.ahead > 0 || gitStatus!.behind > 0) && (
            <span className="text-muted-foreground text-[10px]">
              {gitStatus!.ahead > 0 && `↑${gitStatus!.ahead}`}
              {gitStatus!.behind > 0 && ` ↓${gitStatus!.behind}`}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {gitError && (
        <div className="bg-destructive/10 border-destructive/20 shrink-0 border-b px-3 py-1.5">
          <p className="text-destructive text-[10px]">{gitError}</p>
        </div>
      )}

      {/* Clean working tree */}
      {totalChanges === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
          <CheckCircle2 className="text-accent size-5" />
          <p className="text-foreground text-xs font-medium">Working tree clean</p>
          <p className="text-muted-foreground text-center text-[10px]">
            No pending changes on {gitStatus!.branch}
          </p>
        </div>
      ) : (
        <>
          {/* Commit area */}
          <div className="border-border shrink-0 border-b p-3">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
                  e.preventDefault();
                  handleCommit();
                }
              }}
              placeholder={hasStagedChanges ? 'Commit message (⌘↵ to commit)' : 'Stage changes to commit'}
              rows={2}
              className="border-input bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border px-2 py-1.5 text-xs shadow-xs outline-none transition-shadow focus-visible:ring-[3px]"
            />
            <Button
              disabled={!canCommit}
              onClick={handleCommit}
              size="sm"
              className="mt-2 w-full"
            >
              Commit{hasStagedChanges ? ` (${stagedChanges.length})` : ''}
            </Button>
          </div>

          {/* Changes lists */}
          <ScrollArea className="min-h-0 flex-1">
            {/* Staged Changes */}
            <div>
              <div className="hover:bg-secondary flex items-center justify-between px-3 py-1.5">
                <button
                  onClick={() => setStagedOpen(!stagedOpen)}
                  className="flex items-center gap-1.5 text-left"
                >
                  {stagedOpen ? (
                    <ChevronDown className="text-muted-foreground size-3" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-3" />
                  )}
                  <span className="text-foreground text-[11px] font-semibold">Staged Changes</span>
                  <span className="text-muted-foreground text-[10px]">{stagedChanges.length}</span>
                </button>
                {hasStagedChanges && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-warn size-5"
                    onClick={() => unstageAll(activeClaudeId)}
                    title="Unstage all"
                  >
                    <Minus className="size-3" />
                  </Button>
                )}
              </div>

              {stagedOpen && (
                <div>
                  {stagedChanges.map((change, i) => (
                    <FileEntry
                      key={`staged-${change.file}-${i}`}
                      change={change}
                      variant="staged"
                      sessionId={activeClaudeId}
                    />
                  ))}
                  {!hasStagedChanges && (
                    <div className="px-3 py-1.5">
                      <p className="text-muted-foreground text-[10px]">No staged changes</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Unstaged Changes */}
            <div>
              <div className="hover:bg-secondary flex items-center justify-between px-3 py-1.5">
                <button
                  onClick={() => setUnstagedOpen(!unstagedOpen)}
                  className="flex items-center gap-1.5 text-left"
                >
                  {unstagedOpen ? (
                    <ChevronDown className="text-muted-foreground size-3" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-3" />
                  )}
                  <span className="text-foreground text-[11px] font-semibold">Changes</span>
                  <span className="text-muted-foreground text-[10px]">{unstagedChanges.length}</span>
                </button>
                {unstagedChanges.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-accent size-5"
                    onClick={() => stageAll(activeClaudeId)}
                    title="Stage all"
                  >
                    <Plus className="size-3" />
                  </Button>
                )}
              </div>

              {unstagedOpen && (
                <div>
                  {unstagedChanges.map((change, i) => (
                    <FileEntry
                      key={`unstaged-${change.file}-${i}`}
                      change={change}
                      variant="unstaged"
                      sessionId={activeClaudeId}
                    />
                  ))}
                  {unstagedChanges.length === 0 && (
                    <div className="px-3 py-1.5">
                      <p className="text-muted-foreground text-[10px]">No changes</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

function GitPanel() {
  return (
    <GitPanelErrorBoundary>
      <GitPanelInner />
    </GitPanelErrorBoundary>
  );
}

export default GitPanel;
