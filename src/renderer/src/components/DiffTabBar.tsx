import { X, MessageSquare, TerminalSquare, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useZeusStore } from '@/stores/useZeusStore';
import { getFileIcon } from '@/lib/file-icons';
import type { GitFileStatus } from '../../../../shared/types';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warn' },
  MM: { label: 'M', color: 'text-warn' },
  A: { label: 'A', color: 'text-accent' },
  AM: { label: 'A', color: 'text-accent' },
  D: { label: 'D', color: 'text-destructive' },
  '??': { label: 'U', color: 'text-text-muted' },
  R: { label: 'R', color: 'text-info' },
};

function getFileStatus(
  file: string,
  sessionId: string,
  gitStatus: Record<string, { staged: { file: string; status: GitFileStatus }[]; unstaged: { file: string; status: GitFileStatus }[] }>,
): { label: string; color: string } {
  const status = gitStatus[sessionId];
  if (!status) return STATUS_STYLES['M'];
  const match =
    status.staged.find((c) => c.file === file) ||
    status.unstaged.find((c) => c.file === file);
  if (!match) return STATUS_STYLES['M'];
  return STATUS_STYLES[match.status] || STATUS_STYLES['M'];
}

export default function DiffTabBar() {
  const openDiffTabs = useZeusStore((s) => s.openDiffTabs);
  const activeDiffTabId = useZeusStore((s) => s.activeDiffTabId);
  const previousViewMode = useZeusStore((s) => s.previousViewMode);
  const viewMode = useZeusStore((s) => s.viewMode);
  const gitStatus = useZeusStore((s) => s.gitStatus);
  const closeDiffTab = useZeusStore((s) => s.closeDiffTab);
  const setActiveDiffTab = useZeusStore((s) => s.setActiveDiffTab);
  const returnToHome = useZeusStore((s) => s.returnToHome);
  const saveDiffFile = useZeusStore((s) => s.saveDiffFile);

  if (openDiffTabs.length === 0) return null;

  const activeTab = openDiffTabs.find((t) => t.id === activeDiffTabId);
  const isHomeActive = viewMode !== 'diff';

  return (
    <div className="bg-bg-card border-border flex shrink-0 items-center border-b">
      {/* Home tab */}
      <button
        className={`border-border flex items-center gap-1.5 border-r px-3 py-1.5 text-[11px] transition-colors ${
          isHomeActive
            ? 'bg-bg border-t-2 border-t-primary text-primary'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        onClick={returnToHome}
      >
        {previousViewMode === 'claude' ? (
          <>
            <MessageSquare className="size-3" />
            Claude
          </>
        ) : (
          <>
            <TerminalSquare className="size-3" />
            Terminal
          </>
        )}
      </button>

      {/* Diff / Edit tabs */}
      {openDiffTabs.map((tab) => {
        const isActive = viewMode === 'diff' && tab.id === activeDiffTabId;
        const fileName = tab.file.split('/').pop() || tab.file;
        const isEdit = tab.mode === 'edit';

        // For edit mode: show file icon; for diff mode: show git status badge
        let badge: React.ReactNode;
        if (isEdit) {
          const iconInfo = getFileIcon(fileName);
          const IconComp = iconInfo.icon;
          badge = <IconComp className={`size-3 ${iconInfo.color}`} />;
        } else {
          const style = getFileStatus(tab.file, tab.sessionId, gitStatus);
          badge = <span className={`${style.color} text-[10px] font-bold`}>{style.label}</span>;
        }

        return (
          <div
            key={tab.id}
            className={`border-border group flex items-center gap-1 border-r px-2 py-1.5 text-[11px] ${
              isActive
                ? 'bg-bg border-t-2 border-t-primary text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <button
              className="flex items-center gap-1 truncate"
              onClick={() => setActiveDiffTab(tab.id)}
            >
              {badge}
              <span className="max-w-[120px] truncate">{fileName}</span>
              {tab.isDirty && (
                <span className="bg-primary ml-0.5 inline-block size-1.5 rounded-full" />
              )}
            </button>
            <button
              className="text-text-ghost ml-1 opacity-0 transition-opacity hover:text-text-muted group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeDiffTab(tab.id);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}

      {/* Save button */}
      {activeTab && viewMode === 'diff' && (
        <div className="ml-auto pr-2">
          <Button
            variant="default"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            disabled={!activeTab.isDirty}
            onClick={() => saveDiffFile(activeTab.id)}
          >
            <Save className="size-3" />
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
