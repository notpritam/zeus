import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';

function RightPanel() {
  const rightPanelTab = useZeusStore((s) => s.rightPanelTab);
  const setRightPanelTab = useZeusStore((s) => s.setRightPanelTab);

  return (
    <div className="bg-bg-card flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="border-border flex shrink-0 border-b">
        <button
          className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
            rightPanelTab === 'source-control'
              ? 'text-info border-info border-b-2'
              : 'text-text-muted hover:text-text-secondary border-b-2 border-transparent'
          }`}
          onClick={() => setRightPanelTab('source-control')}
        >
          Source Control
        </button>
        <button
          className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
            rightPanelTab === 'file-explorer'
              ? 'text-info border-info border-b-2'
              : 'text-text-muted hover:text-text-secondary border-b-2 border-transparent'
          }`}
          onClick={() => setRightPanelTab('file-explorer')}
        >
          Files
        </button>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {rightPanelTab === 'source-control' ? <GitPanel /> : <FileExplorer />}
      </div>
    </div>
  );
}

export default RightPanel;
