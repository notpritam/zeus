import { ChevronRight, ChevronDown, RefreshCw, ChevronsDownUp } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { zeusWs } from '@/lib/ws';
import { getFileIcon, getFolderIcon } from '@/lib/file-icons';
import type { FileTreeEntry, GitFileStatus } from '../../../../shared/types';

const GIT_STATUS_DOT: Record<string, string> = {
  M: 'bg-yellow-400',
  MM: 'bg-yellow-400',
  A: 'bg-green-400',
  AM: 'bg-green-400',
  D: 'bg-red-400',
  '??': 'bg-gray-400',
  R: 'bg-blue-400',
  UU: 'bg-orange-400',
};

function getGitDotColor(
  filePath: string,
  sessionId: string,
  gitStatus: Record<string, { staged: { file: string; status: GitFileStatus }[]; unstaged: { file: string; status: GitFileStatus }[] }>,
): string | null {
  const status = gitStatus[sessionId];
  if (!status) return null;
  const match =
    status.unstaged.find((c) => c.file === filePath) ||
    status.staged.find((c) => c.file === filePath);
  if (!match) return null;
  return GIT_STATUS_DOT[match.status] || null;
}

function FileTreeNode({
  entry,
  sessionId,
  depth,
}: {
  entry: FileTreeEntry;
  sessionId: string;
  depth: number;
}) {
  const fileTree = useZeusStore((s) => s.fileTree);
  const fileTreeExpanded = useZeusStore((s) => s.fileTreeExpanded);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const toggleFileTreeDir = useZeusStore((s) => s.toggleFileTreeDir);
  const openFileTab = useZeusStore((s) => s.openFileTab);

  const isDir = entry.type === 'directory';
  const expanded = fileTreeExpanded[sessionId] || [];
  const isExpanded = expanded.includes(entry.path);
  const children = fileTree[sessionId]?.[entry.path] || [];

  // Highlight active file
  const isActive = activeDiffTabId === `${sessionId}:edit:${entry.path}`;

  if (isDir) {
    const folderIcon = getFolderIcon(isExpanded);
    const FolderIcon = folderIcon.icon;

    return (
      <div>
        <button
          className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[11px] transition-colors hover:bg-white/5 ${
            isExpanded ? 'text-text-secondary' : 'text-text-muted'
          }`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => toggleFileTreeDir(sessionId, entry.path)}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 shrink-0 text-text-ghost" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-text-ghost" />
          )}
          <FolderIcon className={`size-3.5 shrink-0 ${folderIcon.color}`} />
          <span className="truncate">{entry.name}</span>
        </button>
        {isExpanded && children.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            sessionId={sessionId}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // File
  const iconInfo = getFileIcon(entry.name);
  const FileIcon = iconInfo.icon;
  const gitDot = getGitDotColor(entry.path, sessionId, gitStatus);

  return (
    <button
      className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[11px] transition-colors ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-text-muted hover:bg-white/5 hover:text-text-secondary'
      }`}
      style={{ paddingLeft: depth * 16 + 8 + 16 }} // extra 16 to align with folder names (past chevron)
      onClick={() => openFileTab(sessionId, entry.path)}
    >
      <FileIcon className={`size-3.5 shrink-0 ${iconInfo.color}`} />
      <span className="truncate">{entry.name}</span>
      {gitDot && (
        <span className={`ml-auto size-1.5 shrink-0 rounded-full ${gitDot}`} />
      )}
    </button>
  );
}

export default function FileExplorer() {
  const claudeSessions = useZeusStore((s) => s.claudeSessions);
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const fileTree = useZeusStore((s) => s.fileTree);
  const fileTreeConnected = useZeusStore((s) => s.fileTreeConnected);
  const fileTreeExpanded = useZeusStore((s) => s.fileTreeExpanded);
  const toggleFileTreeDir = useZeusStore((s) => s.toggleFileTreeDir);

  // Find the best session: prefer activeClaudeId, then any session with a connected file tree
  const activeSession = claudeSessions.find((s) => s.id === activeClaudeId);
  const fallbackSession = !activeSession
    ? claudeSessions.find((s) => s.workingDir && fileTreeConnected[s.id])
      ?? claudeSessions.find((s) => s.workingDir)
    : null;
  const session = activeSession ?? fallbackSession;
  const sessionId = session?.id;
  const workingDir = session?.workingDir;
  const isConnected = sessionId ? fileTreeConnected[sessionId] : false;
  const rootEntries = sessionId ? fileTree[sessionId]?.[''] || [] : [];

  if (!sessionId || !workingDir) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-text-muted text-xs">No active session</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-text-muted text-xs">Connecting...</p>
      </div>
    );
  }

  // Extract short dir name for header
  const dirName = workingDir.split('/').pop() || workingDir;

  const handleRefresh = () => {
    const expanded = fileTreeExpanded[sessionId] || [];
    const dirs = ['', ...expanded];
    for (const dirPath of dirs) {
      zeusWs.send({
        channel: 'files',
        sessionId,
        payload: { type: 'list_directory', dirPath },
        auth: '',
      });
    }
  };

  const handleCollapseAll = () => {
    // Collapse all expanded directories
    const expanded = fileTreeExpanded[sessionId] || [];
    for (const dirPath of [...expanded]) {
      toggleFileTreeDir(sessionId, dirPath);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border bg-card sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b px-2 py-3">
        <span className="text-primary truncate text-sm font-bold">{dirName}</span>
        <div className="ml-auto flex gap-0.5">
          <button
            className="text-text-ghost rounded p-0.5 transition-colors hover:bg-white/5 hover:text-text-muted"
            onClick={handleCollapseAll}
            title="Collapse all"
          >
            <ChevronsDownUp className="size-3.5" />
          </button>
          <button
            className="text-text-ghost rounded p-0.5 transition-colors hover:bg-white/5 hover:text-text-muted"
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {rootEntries.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <p className="text-text-ghost text-[10px]">Empty directory</p>
          </div>
        ) : (
          rootEntries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              sessionId={sessionId}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
}
