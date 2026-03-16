import { Button } from '@/components/ui/button';
import { GitBranch, FolderOpen } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import GitPanel from '@/components/GitPanel';
import FileExplorer from '@/components/FileExplorer';

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
    </div>
  );
}

export default RightPanel;
