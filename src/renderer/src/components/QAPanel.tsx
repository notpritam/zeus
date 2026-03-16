import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Eye,
  Play,
  Square,
  Globe,
  Camera,
  FileText,
  MousePointer,
  Loader2,
  ChevronRight,
  Monitor,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';

type QAViewTab = 'snapshot' | 'screenshot' | 'text';

function QAPanel() {
  const qaRunning = useZeusStore((s) => s.qaRunning);
  const qaInstances = useZeusStore((s) => s.qaInstances);
  const qaSnapshot = useZeusStore((s) => s.qaSnapshot);
  const qaSnapshotRaw = useZeusStore((s) => s.qaSnapshotRaw);
  const qaScreenshot = useZeusStore((s) => s.qaScreenshot);
  const qaText = useZeusStore((s) => s.qaText);
  const qaError = useZeusStore((s) => s.qaError);
  const qaLoading = useZeusStore((s) => s.qaLoading);

  const startQA = useZeusStore((s) => s.startQA);
  const stopQA = useZeusStore((s) => s.stopQA);
  const launchQAInstance = useZeusStore((s) => s.launchQAInstance);
  const stopQAInstance = useZeusStore((s) => s.stopQAInstance);
  const navigateQA = useZeusStore((s) => s.navigateQA);
  const takeSnapshot = useZeusStore((s) => s.takeSnapshot);
  const takeScreenshot = useZeusStore((s) => s.takeScreenshot);
  const performQAAction = useZeusStore((s) => s.performQAAction);
  const extractQAText = useZeusStore((s) => s.extractQAText);
  const clearQAError = useZeusStore((s) => s.clearQAError);

  const [viewTab, setViewTab] = useState<QAViewTab>('snapshot');
  const [url, setUrl] = useState('http://localhost:5173');
  const [actionKind, setActionKind] = useState('click');
  const [actionRef, setActionRef] = useState('');
  const [actionValue, setActionValue] = useState('');

  // ─── Not running state ───
  if (!qaRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <Eye className="text-muted-foreground/40 size-10" />
        <p className="text-muted-foreground text-xs">QA service not running</p>
        <Button
          size="sm"
          onClick={startQA}
          disabled={qaLoading}
          className="gap-1.5"
        >
          {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Start PinchTab
        </Button>
        {qaError && (
          <p className="text-destructive mt-1 text-[10px]">{qaError}</p>
        )}
      </div>
    );
  }

  // ─── Running state ───
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="size-2 shrink-0 rounded-full bg-green-500" />
        <span className="text-foreground flex-1 text-xs font-medium">QA Preview</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive size-5"
          onClick={stopQA}
          title="Stop PinchTab"
        >
          <Square className="size-3" />
        </Button>
      </div>

      {/* Error banner */}
      {qaError && (
        <div className="bg-destructive/10 border-destructive/20 flex items-start gap-2 border-b px-3 py-1.5">
          <AlertCircle className="text-destructive mt-0.5 size-3 shrink-0" />
          <span className="text-destructive flex-1 text-[10px]">{qaError}</span>
          <button onClick={clearQAError} className="text-destructive/60 hover:text-destructive">
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Instance controls */}
      {qaInstances.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-4">
          <Monitor className="text-muted-foreground/40 size-6" />
          <p className="text-muted-foreground text-[10px]">No browser instances</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => launchQAInstance(false)}
            disabled={qaLoading}
            className="gap-1.5 text-xs"
          >
            {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Launch Browser
          </Button>
        </div>
      ) : (
        <>
          {/* Instance bar */}
          <div className="border-border flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
            <Monitor className="text-muted-foreground size-3" />
            <span className="text-muted-foreground flex-1 truncate text-[10px]">
              {qaInstances.length} instance{qaInstances.length > 1 ? 's' : ''}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5"
              onClick={() => launchQAInstance(false)}
              title="Launch another instance"
            >
              <Play className="size-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive size-5"
              onClick={() => stopQAInstance(qaInstances[0].instanceId)}
              title="Stop instance"
            >
              <Square className="size-2.5" />
            </Button>
          </div>

          {/* URL bar */}
          <div className="border-border flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
            <Globe className="text-muted-foreground size-3 shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigateQA(url);
              }}
              className="bg-secondary text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded px-2 py-0.5 text-[11px] outline-none"
              placeholder="http://localhost:5173"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 shrink-0"
              onClick={() => navigateQA(url)}
              disabled={qaLoading}
              title="Navigate"
            >
              {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
            </Button>
          </div>

          {/* View tabs */}
          <div className="border-border flex shrink-0 border-b">
            {(['snapshot', 'screenshot', 'text'] as QAViewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setViewTab(tab);
                  if (tab === 'snapshot') takeSnapshot('interactive');
                  if (tab === 'screenshot') takeScreenshot();
                  if (tab === 'text') extractQAText();
                }}
                className={`flex-1 py-1.5 text-[10px] font-medium capitalize transition-colors ${
                  viewTab === tab
                    ? 'border-primary text-foreground border-b-2'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* View content */}
          <ScrollArea className="min-h-0 flex-1">
            {viewTab === 'snapshot' && (
              <div className="p-2">
                <div className="mb-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    onClick={() => takeSnapshot('interactive')}
                    disabled={qaLoading}
                    title="Refresh snapshot"
                  >
                    {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  </Button>
                  <span className="text-muted-foreground text-[10px]">
                    {qaSnapshot ? `${qaSnapshot.length} elements` : 'No snapshot'}
                  </span>
                </div>
                {qaSnapshot && qaSnapshot.length > 0 ? (
                  <div className="space-y-0.5">
                    {qaSnapshot.map((node) => (
                      <button
                        key={node.ref}
                        onClick={() => setActionRef(node.ref)}
                        className={`hover:bg-secondary flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left ${
                          actionRef === node.ref ? 'bg-primary/10 ring-primary/30 ring-1' : ''
                        }`}
                      >
                        <span className="text-primary shrink-0 font-mono text-[10px]">{node.ref}</span>
                        <span className="text-muted-foreground shrink-0 text-[9px]">{node.role}</span>
                        <span className="text-foreground min-w-0 flex-1 truncate text-[10px]">{node.name}</span>
                      </button>
                    ))}
                  </div>
                ) : qaSnapshotRaw ? (
                  <pre className="text-muted-foreground whitespace-pre-wrap text-[10px] leading-relaxed">
                    {qaSnapshotRaw}
                  </pre>
                ) : !qaLoading ? (
                  <p className="text-muted-foreground py-4 text-center text-[10px]">
                    Navigate to a page, then take a snapshot
                  </p>
                ) : null}
              </div>
            )}

            {viewTab === 'screenshot' && (
              <div className="p-2">
                <div className="mb-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    onClick={takeScreenshot}
                    disabled={qaLoading}
                    title="Refresh screenshot"
                  >
                    {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
                  </Button>
                  <span className="text-muted-foreground text-[10px]">Screenshot</span>
                </div>
                {qaScreenshot ? (
                  <img
                    src={qaScreenshot}
                    alt="Page screenshot"
                    className="border-border w-full rounded border"
                  />
                ) : !qaLoading ? (
                  <p className="text-muted-foreground py-4 text-center text-[10px]">
                    No screenshot yet
                  </p>
                ) : null}
              </div>
            )}

            {viewTab === 'text' && (
              <div className="p-2">
                <div className="mb-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    onClick={extractQAText}
                    disabled={qaLoading}
                    title="Refresh text"
                  >
                    {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />}
                  </Button>
                  <span className="text-muted-foreground text-[10px]">Page Text</span>
                </div>
                {qaText ? (
                  <pre className="bg-secondary text-foreground whitespace-pre-wrap rounded p-2 text-[10px] leading-relaxed">
                    {qaText}
                  </pre>
                ) : !qaLoading ? (
                  <p className="text-muted-foreground py-4 text-center text-[10px]">
                    No text extracted yet
                  </p>
                ) : null}
              </div>
            )}
          </ScrollArea>

          {/* Action bar */}
          <div className="border-border shrink-0 space-y-1.5 border-t px-2 py-2">
            <div className="flex items-center gap-1">
              <select
                value={actionKind}
                onChange={(e) => setActionKind(e.target.value)}
                className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] outline-none"
              >
                <option value="click">click</option>
                <option value="type">type</option>
                <option value="fill">fill</option>
                <option value="press">press</option>
                <option value="scroll">scroll</option>
                <option value="hover">hover</option>
                <option value="select">select</option>
              </select>
              <input
                type="text"
                value={actionRef}
                onChange={(e) => setActionRef(e.target.value)}
                className="bg-secondary text-foreground placeholder:text-muted-foreground w-14 rounded px-1.5 py-0.5 text-[10px] outline-none"
                placeholder="ref"
              />
              {(actionKind === 'type' || actionKind === 'fill' || actionKind === 'press' || actionKind === 'select') && (
                <input
                  type="text"
                  value={actionValue}
                  onChange={(e) => setActionValue(e.target.value)}
                  className="bg-secondary text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded px-1.5 py-0.5 text-[10px] outline-none"
                  placeholder="value"
                />
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5 shrink-0"
                onClick={() => performQAAction(actionKind, actionRef || undefined, actionValue || undefined)}
                disabled={qaLoading || !actionRef}
                title="Execute action"
              >
                {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <MousePointer className="size-3" />}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default QAPanel;
