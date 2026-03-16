import { useState } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { GitFileChange } from '../../../shared/types';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-danger' },
  R: { label: 'R', color: 'text-info' },
  '??': { label: 'U', color: 'text-text-muted' },
  UU: { label: 'C', color: 'text-danger' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { label: status, color: 'text-text-muted' };
}

function getFileName(filePath: string): { name: string; dir: string } {
  const parts = filePath.split('/');
  const name = parts.pop() ?? filePath;
  const dir = parts.join('/');
  return { name, dir };
}

function FileEntry({ change }: { change: GitFileChange }) {
  const style = getStatusStyle(change.status);
  const { name, dir } = getFileName(change.file);

  return (
    <div className="group flex items-center gap-2 px-3 py-1 hover:bg-bg-surface">
      <span className={`w-4 text-center text-[10px] font-bold ${style.color}`}>{style.label}</span>
      <span className="text-text-secondary truncate text-xs">{name}</span>
      {dir && <span className="text-text-ghost truncate text-[10px]">{dir}</span>}
    </div>
  );
}

function GitPanel() {
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const gitStatus = useZeusStore((s) => (activeClaudeId ? s.gitStatus[activeClaudeId] : undefined));
  const gitError = useZeusStore((s) => (activeClaudeId ? s.gitErrors[activeClaudeId] : undefined));
  const refreshGitStatus = useZeusStore((s) => s.refreshGitStatus);
  const commitChanges = useZeusStore((s) => s.commitChanges);

  const [commitMessage, setCommitMessage] = useState('');
  const [changesOpen, setChangesOpen] = useState(true);

  const changes = gitStatus?.changes ?? [];
  const hasChanges = changes.length > 0;
  const canCommit = commitMessage.trim() && hasChanges;

  const handleCommit = () => {
    if (!canCommit || !activeClaudeId) return;
    commitChanges(activeClaudeId, commitMessage.trim());
    setCommitMessage('');
  };

  if (!activeClaudeId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-text-ghost text-xs">No active session</p>
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-text-ghost text-xs">No git watcher active</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-xs font-semibold">Source Control</span>
          {hasChanges && (
            <span className="bg-info/20 text-info rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {changes.length}
            </span>
          )}
        </div>
        <button
          onClick={() => activeClaudeId && refreshGitStatus(activeClaudeId)}
          className="text-text-muted hover:text-text-secondary text-xs transition-colors"
          title="Refresh"
        >
          &#x21bb;
        </button>
      </div>

      {/* Branch info */}
      <div className="border-border shrink-0 border-b px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-[10px]">&#9671;</span>
          <span className="text-text-secondary text-[11px] font-medium">{gitStatus.branch}</span>
          {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <span className="text-text-faint text-[10px]">
              {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
              {gitStatus.behind > 0 && ` ↓${gitStatus.behind}`}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {gitError && (
        <div className="bg-danger-bg border-danger-border shrink-0 border-b px-3 py-1.5">
          <p className="text-danger text-[10px]">{gitError}</p>
        </div>
      )}

      {/* Commit area */}
      <div className="border-border shrink-0 border-b p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCommit) handleCommit();
            }}
            placeholder="Commit message"
            className="bg-bg-surface border-border text-text-secondary placeholder:text-text-ghost focus:border-info min-w-0 flex-1 rounded-md border px-2 py-1 text-xs outline-none"
          />
          <button
            disabled={!canCommit}
            onClick={handleCommit}
            className="bg-info hover:bg-info/90 shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-40"
          >
            Commit
          </button>
        </div>
      </div>

      {/* Changes list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          onClick={() => setChangesOpen(!changesOpen)}
          className="hover:bg-bg-surface flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
        >
          <span className="text-text-muted text-[10px]">{changesOpen ? '▾' : '▸'}</span>
          <span className="text-text-secondary text-[11px] font-semibold">Changes</span>
          <span className="text-text-faint text-[10px]">{changes.length}</span>
        </button>

        {changesOpen && (
          <div>
            {changes.map((change, i) => (
              <FileEntry key={`${change.file}-${i}`} change={change} />
            ))}
            {!hasChanges && (
              <div className="px-3 py-2">
                <p className="text-text-ghost text-[10px]">No changes</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default GitPanel;
