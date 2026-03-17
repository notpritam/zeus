import { useState, useRef, useEffect, useMemo } from 'react';
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
  ChevronDown,
  ChevronUp,
  Monitor,
  RefreshCw,
  AlertCircle,
  X,
  Terminal,
  Network,
  Bug,
  Trash2,
  Bot,
  Send,
  Plus,
  Brain,
  Layers,
  List,
} from 'lucide-react';
import Markdown from '@/components/Markdown';
import { useZeusStore } from '@/stores/useZeusStore';
import type { QaAgentLogEntry } from '../../../shared/types';

type QAViewTab = 'snapshot' | 'screenshot' | 'text' | 'console' | 'network' | 'errors';

function AgentToolCall({ entry }: { entry: QaAgentLogEntry & { kind: 'tool_call' } }) {
  return (
    <div className="bg-secondary border-border border-primary/30 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full" />
        <span className="text-primary text-[10px] font-semibold">{entry.tool}</span>
        <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">{entry.args}</span>
      </div>
    </div>
  );
}

function AgentToolResult({ entry }: { entry: QaAgentLogEntry & { kind: 'tool_result' } }) {
  const [expanded, setExpanded] = useState(false);
  const dotColor = entry.success ? 'bg-green-400' : 'bg-red-400';
  const borderColor = entry.success ? '' : 'border-red-400/30';

  return (
    <div className={`bg-secondary border-border rounded-lg border px-3 py-2 ${borderColor}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block size-1.5 shrink-0 rounded-full ${dotColor}`} />
          <span className={`text-[10px] font-semibold ${entry.success ? 'text-primary' : 'text-red-400'}`}>
            {entry.tool}
          </span>
          <span className="text-muted-foreground text-[10px]">{entry.success ? 'success' : 'failed'}</span>
        </div>
        {entry.summary && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
      </div>
      {expanded && entry.summary && (
        <div className="border-border mt-2 max-h-60 overflow-auto rounded border bg-black/20 p-2">
          <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[11px]">{entry.summary}</pre>
        </div>
      )}
    </div>
  );
}

function AgentThinking({ entry }: { entry: QaAgentLogEntry & { kind: 'thinking' } }) {
  const [expanded, setExpanded] = useState(false);
  const preview = entry.content.slice(0, 120);

  return (
    <button
      className="bg-secondary border-border w-full rounded-lg border px-3 py-2 text-left"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Brain className="text-primary size-3" />
        <span className="font-medium">Thinking</span>
        <span className="text-muted-foreground/50 text-[10px]">{expanded ? 'collapse' : 'expand'}</span>
      </div>
      {expanded ? (
        <div className="text-muted-foreground mt-1 select-text text-xs">
          <Markdown content={entry.content} />
        </div>
      ) : (
        <p className="text-muted-foreground mt-1 select-text text-xs whitespace-pre-wrap">
          {preview + (entry.content.length > 120 ? '...' : '')}
        </p>
      )}
    </button>
  );
}

function AgentLogEntry({ entry }: { entry: QaAgentLogEntry }) {
  if (entry.kind === 'tool_call') {
    return <AgentToolCall entry={entry} />;
  }
  if (entry.kind === 'tool_result') {
    return <AgentToolResult entry={entry} />;
  }
  if (entry.kind === 'text') {
    return (
      <div className="flex flex-col items-start">
        <div className="bg-card border-border max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-2">
          <div className="select-text">
            <Markdown content={entry.content} />
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === 'error') {
    return (
      <div className="bg-destructive/10 border-destructive/20 text-destructive rounded-lg border px-3 py-2 text-sm">
        {entry.message}
      </div>
    );
  }
  if (entry.kind === 'user_message') {
    return (
      <div className="flex flex-col items-end">
        <div className="bg-primary/10 border-primary/20 max-w-[80%] rounded-xl rounded-br-sm border px-3 py-2">
          <p className="text-foreground select-text text-sm whitespace-pre-wrap">{entry.content}</p>
        </div>
      </div>
    );
  }
  if (entry.kind === 'thinking') {
    return <AgentThinking entry={entry} />;
  }
  if (entry.kind === 'status') {
    return (
      <div className="text-muted-foreground text-center text-xs italic">
        {entry.message}
      </div>
    );
  }
  return null;
}

// --- Compressed mode ---

type CompressedGroup =
  | { type: 'tool_pair'; call: QaAgentLogEntry & { kind: 'tool_call' }; result?: QaAgentLogEntry & { kind: 'tool_result' } }
  | { type: 'text'; entry: QaAgentLogEntry & { kind: 'text' } }
  | { type: 'user_message'; entry: QaAgentLogEntry & { kind: 'user_message' } }
  | { type: 'error'; entry: QaAgentLogEntry & { kind: 'error' } }
  | { type: 'thinking'; entries: (QaAgentLogEntry & { kind: 'thinking' })[] }
  | { type: 'status_group'; entries: (QaAgentLogEntry & { kind: 'status' })[] };

function compressEntries(entries: QaAgentLogEntry[]): CompressedGroup[] {
  const groups: CompressedGroup[] = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];

    if (e.kind === 'tool_call') {
      // Look ahead for matching tool_result
      const next = entries[i + 1];
      if (next && next.kind === 'tool_result' && next.tool === e.tool) {
        groups.push({ type: 'tool_pair', call: e, result: next as QaAgentLogEntry & { kind: 'tool_result' } });
        i += 2;
      } else {
        groups.push({ type: 'tool_pair', call: e });
        i++;
      }
    } else if (e.kind === 'thinking') {
      // Merge consecutive thinking entries
      const batch: (QaAgentLogEntry & { kind: 'thinking' })[] = [e];
      while (i + 1 < entries.length && entries[i + 1].kind === 'thinking') {
        i++;
        batch.push(entries[i] as QaAgentLogEntry & { kind: 'thinking' });
      }
      groups.push({ type: 'thinking', entries: batch });
      i++;
    } else if (e.kind === 'status') {
      // Merge consecutive status entries
      const batch: (QaAgentLogEntry & { kind: 'status' })[] = [e];
      while (i + 1 < entries.length && entries[i + 1].kind === 'status') {
        i++;
        batch.push(entries[i] as QaAgentLogEntry & { kind: 'status' });
      }
      groups.push({ type: 'status_group', entries: batch });
      i++;
    } else if (e.kind === 'text') {
      groups.push({ type: 'text', entry: e });
      i++;
    } else if (e.kind === 'user_message') {
      groups.push({ type: 'user_message', entry: e as QaAgentLogEntry & { kind: 'user_message' } });
      i++;
    } else if (e.kind === 'error') {
      groups.push({ type: 'error', entry: e as QaAgentLogEntry & { kind: 'error' } });
      i++;
    } else {
      i++;
    }
  }
  return groups;
}

function CompressedToolPair({ group }: { group: CompressedGroup & { type: 'tool_pair' } }) {
  const [expanded, setExpanded] = useState(false);
  const success = group.result ? group.result.success : undefined;
  const dotColor = success === undefined ? 'bg-primary animate-pulse' : success ? 'bg-green-400' : 'bg-red-400';

  return (
    <button
      className="bg-secondary border-border hover:bg-secondary/80 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <span className={`inline-block size-1.5 shrink-0 rounded-full ${dotColor}`} />
      <span className="text-primary text-[10px] font-semibold">{group.call.tool}</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[10px]">{group.call.args}</span>
      {success !== undefined && (
        <span className={`text-[9px] ${success ? 'text-green-400' : 'text-red-400'}`}>
          {success ? 'OK' : 'FAIL'}
        </span>
      )}
      {expanded && group.result?.summary && (
        <div className="border-border mt-1 w-full rounded border bg-black/20 p-1.5" onClick={(e) => e.stopPropagation()}>
          <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[10px]">
            {group.result.summary.slice(0, 300)}
          </pre>
        </div>
      )}
    </button>
  );
}

function CompressedThinkingGroup({ group }: { group: CompressedGroup & { type: 'thinking' } }) {
  const [expanded, setExpanded] = useState(false);
  const last = group.entries[group.entries.length - 1];

  return (
    <button
      className="bg-secondary border-border hover:bg-secondary/80 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <Brain className="text-primary size-3 shrink-0" />
      <span className="text-muted-foreground text-[10px]">
        Thinking ({group.entries.length} block{group.entries.length > 1 ? 's' : ''})
      </span>
      {expanded && (
        <div className="text-muted-foreground mt-1 w-full text-[10px]" onClick={(e) => e.stopPropagation()}>
          <Markdown content={last.content} />
        </div>
      )}
    </button>
  );
}

function CompressedStatusGroup({ group }: { group: CompressedGroup & { type: 'status_group' } }) {
  const last = group.entries[group.entries.length - 1];
  return (
    <div className="text-muted-foreground text-center text-[9px] italic">
      {last.message}
    </div>
  );
}

function CompressedLogEntry({ group }: { group: CompressedGroup }) {
  switch (group.type) {
    case 'tool_pair':
      return <CompressedToolPair group={group} />;
    case 'thinking':
      return <CompressedThinkingGroup group={group} />;
    case 'status_group':
      return <CompressedStatusGroup group={group} />;
    case 'text':
      return (
        <div className="bg-card border-border max-w-[85%] rounded-lg border px-2.5 py-1.5">
          <div className="select-text text-[11px]">
            <Markdown content={group.entry.content} />
          </div>
        </div>
      );
    case 'user_message':
      return (
        <div className="flex justify-end">
          <div className="bg-primary/10 border-primary/20 max-w-[80%] rounded-lg border px-2.5 py-1.5">
            <p className="text-foreground select-text text-[11px] whitespace-pre-wrap">{group.entry.content}</p>
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="bg-destructive/10 border-destructive/20 text-destructive rounded-md border px-2.5 py-1.5 text-[11px]">
          {group.entry.message}
        </div>
      );
    default:
      return null;
  }
}

function useCurrentSessionContext() {
  const viewMode = useZeusStore((s) => s.viewMode);
  const activeSessionId = useZeusStore((s) => s.activeSessionId);
  const activeClaudeId = useZeusStore((s) => s.activeClaudeId);
  const claudeSessions = useZeusStore((s) => s.claudeSessions);
  const sessions = useZeusStore((s) => s.sessions);

  // Prefer the session matching the current view mode
  if (viewMode === 'claude' && activeClaudeId) {
    const cs = claudeSessions.find((s) => s.id === activeClaudeId);
    return {
      parentSessionId: activeClaudeId,
      parentSessionType: 'claude' as const,
      workingDir: cs?.workingDir || '/',
    };
  }
  if (activeSessionId) {
    const ts = sessions.find((s) => s.id === activeSessionId);
    return {
      parentSessionId: activeSessionId,
      parentSessionType: 'terminal' as const,
      workingDir: ts?.cwd || '/',
    };
  }
  // Fallback: pick whatever session exists
  if (activeClaudeId) {
    const cs = claudeSessions.find((s) => s.id === activeClaudeId);
    return {
      parentSessionId: activeClaudeId,
      parentSessionType: 'claude' as const,
      workingDir: cs?.workingDir || '/',
    };
  }
  if (sessions.length > 0) {
    const ts = sessions[0];
    return {
      parentSessionId: ts.id,
      parentSessionType: 'terminal' as const,
      workingDir: ts.cwd || '/',
    };
  }
  return null;
}

function QAPanel() {
  const qaRunning = useZeusStore((s) => s.qaRunning);
  const qaInstances = useZeusStore((s) => s.qaInstances);
  const qaSnapshot = useZeusStore((s) => s.qaSnapshot);
  const qaSnapshotRaw = useZeusStore((s) => s.qaSnapshotRaw);
  const qaScreenshot = useZeusStore((s) => s.qaScreenshot);
  const qaText = useZeusStore((s) => s.qaText);
  const qaError = useZeusStore((s) => s.qaError);
  const qaLoading = useZeusStore((s) => s.qaLoading);
  const qaConsoleLogs = useZeusStore((s) => s.qaConsoleLogs);
  const qaNetworkRequests = useZeusStore((s) => s.qaNetworkRequests);
  const qaJsErrors = useZeusStore((s) => s.qaJsErrors);

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

  const qaAgents = useZeusStore((s) => s.qaAgents);
  const activeQaAgentId = useZeusStore((s) => s.activeQaAgentId);
  const startQAAgent = useZeusStore((s) => s.startQAAgent);
  const stopQAAgent = useZeusStore((s) => s.stopQAAgent);
  const deleteQAAgent = useZeusStore((s) => s.deleteQAAgent);
  const sendQAAgentMessage = useZeusStore((s) => s.sendQAAgentMessage);
  const clearQAAgentEntries = useZeusStore((s) => s.clearQAAgentEntries);
  const selectQaAgent = useZeusStore((s) => s.selectQaAgent);
  const fetchQaAgents = useZeusStore((s) => s.fetchQaAgents);
  const fetchQaAgentEntries = useZeusStore((s) => s.fetchQaAgentEntries);

  const sessionCtx = useCurrentSessionContext();

  const [viewTab, setViewTab] = useState<QAViewTab>('snapshot');
  const [url, setUrl] = useState('http://localhost:5173');
  const [actionKind, setActionKind] = useState('click');
  const [actionRef, setActionRef] = useState('');
  const [actionValue, setActionValue] = useState('');

  const [qaMode, setQaMode] = useState<'browser' | 'agent'>('browser');
  const [agentTask, setAgentTask] = useState('');
  const [agentFollowUp, setAgentFollowUp] = useState('');
  const [compressedLog, setCompressedLog] = useState(true);
  const [agentTargetUrl, setAgentTargetUrl] = useState('http://localhost:5173');
  const [agentName, setAgentName] = useState('');
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const agentLogRef = useRef<HTMLDivElement>(null);

  // Session-scoped agents
  const parentSessionId = sessionCtx?.parentSessionId ?? '';
  const parentSessionType = sessionCtx?.parentSessionType ?? 'terminal';
  const sessionAgents = useMemo(
    () => qaAgents[parentSessionId] ?? [],
    [qaAgents, parentSessionId],
  );
  const selectedAgentId = activeQaAgentId[parentSessionId] ?? null;
  const selectedAgent = sessionAgents.find((a) => a.info.qaAgentId === selectedAgentId) ?? null;
  const hasRunningAgent = sessionAgents.some((a) => a.info.status === 'running');
  const hasAnyAgent = sessionAgents.length > 0;

  useEffect(() => {
    requestAnimationFrame(() => {
      if (agentLogRef.current) {
        agentLogRef.current.scrollTop = agentLogRef.current.scrollHeight;
      }
    });
  }, [selectedAgent?.entries.length]);

  // Fetch agents from DB on mount and when parent session changes
  useEffect(() => {
    if (!parentSessionId) return;
    fetchQaAgents(parentSessionId);
  }, [parentSessionId]);

  // Auto-select first running agent when switching sessions
  useEffect(() => {
    if (!parentSessionId) return;
    if (selectedAgentId && sessionAgents.find((a) => a.info.qaAgentId === selectedAgentId)) return;
    const running = sessionAgents.find((a) => a.info.status === 'running');
    if (running) {
      selectQaAgent(parentSessionId, running.info.qaAgentId);
    } else if (sessionAgents.length > 0) {
      selectQaAgent(parentSessionId, sessionAgents[sessionAgents.length - 1].info.qaAgentId);
    }
  }, [parentSessionId, sessionAgents.length]);

  // Auto-fetch entries from DB when selecting a completed agent with no entries loaded
  useEffect(() => {
    if (!selectedAgent) return;
    if (selectedAgent.info.status !== 'running' && selectedAgent.entries.length === 0) {
      fetchQaAgentEntries(selectedAgent.info.qaAgentId);
    }
  }, [selectedAgentId]);

  const handleStartAgent = () => {
    console.log('[QAPanel] handleStartAgent called', { agentTask, parentSessionId, parentSessionType, sessionCtx });
    if (!agentTask.trim() || !parentSessionId) {
      console.warn('[QAPanel] Blocked: agentTask empty or no parentSessionId', { agentTask: agentTask.trim(), parentSessionId });
      return;
    }
    startQAAgent(agentTask.trim(), sessionCtx?.workingDir || '/', parentSessionId, parentSessionType, agentTargetUrl, agentName.trim() || undefined);
    setAgentTask('');
    setAgentName('');
    setShowNewAgentForm(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className={`size-2 shrink-0 rounded-full ${qaRunning ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
        <span className="text-foreground flex-1 text-xs font-medium">QA Preview</span>
        {sessionCtx && (
          <span className="text-muted-foreground truncate text-[9px]">
            {parentSessionType === 'claude' ? 'Claude' : 'Term'}: {parentSessionId.slice(0, 8)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive size-5"
          onClick={stopQA}
          disabled={hasRunningAgent}
          title={hasRunningAgent ? 'Stop agents first' : 'Stop PinchTab'}
        >
          <Square className="size-3" />
        </Button>
      </div>

      {/* No session selected */}
      {!sessionCtx && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <AlertCircle className="text-muted-foreground/40 size-6" />
          <p className="text-muted-foreground text-[10px]">Select a terminal or Claude session first</p>
        </div>
      )}

      {sessionCtx && (
        <>
          {/* Mode toggle */}
          <div className="border-border flex shrink-0 border-b">
            <button
              onClick={() => setQaMode('browser')}
              className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
                qaMode === 'browser'
                  ? 'border-primary text-foreground border-b-2'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Browser
            </button>
            <button
              onClick={() => setQaMode('agent')}
              className={`relative flex-1 py-1.5 text-[10px] font-medium transition-colors ${
                qaMode === 'agent'
                  ? 'border-primary text-foreground border-b-2'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Agent
              {hasRunningAgent && (
                <span className="ml-1 inline-block size-1.5 rounded-full bg-green-500" />
              )}
              {sessionAgents.length > 0 && (
                <span className="bg-muted-foreground/40 ml-1 inline-block min-w-[14px] rounded-full px-1 text-[8px] font-bold leading-[14px] text-white">
                  {sessionAgents.length}
                </span>
              )}
            </button>
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

          {/* Browser mode — not running */}
          {qaMode === 'browser' && !qaRunning && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
              <Eye className="text-muted-foreground/40 size-10" />
              <p className="text-muted-foreground text-xs">QA service not running</p>
              <Button size="sm" onClick={startQA} disabled={qaLoading} className="gap-1.5">
                {qaLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                Start PinchTab
              </Button>
            </div>
          )}

          {/* Browser mode — running */}
          {qaMode === 'browser' && qaRunning && (
            <>
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
                  <div className="border-border flex shrink-0 flex-wrap border-b">
                    {(['snapshot', 'screenshot', 'text', 'console', 'network', 'errors'] as QAViewTab[]).map((tab) => {
                      const badge = tab === 'console' ? qaConsoleLogs.length
                        : tab === 'network' ? qaNetworkRequests.length
                        : tab === 'errors' ? qaJsErrors.length
                        : 0;
                      return (
                        <button
                          key={tab}
                          onClick={() => {
                            setViewTab(tab);
                            if (tab === 'snapshot') takeSnapshot('interactive');
                            if (tab === 'screenshot') takeScreenshot();
                            if (tab === 'text') extractQAText();
                          }}
                          className={`relative flex-1 py-1.5 text-[10px] font-medium capitalize transition-colors ${
                            viewTab === tab
                              ? 'border-primary text-foreground border-b-2'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {tab}
                          {badge > 0 && (
                            <span className={`ml-0.5 inline-block min-w-[14px] rounded-full px-1 text-[8px] font-bold leading-[14px] text-white ${
                              tab === 'errors' ? 'bg-red-500' : 'bg-muted-foreground/60'
                            }`}>
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
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

                    {viewTab === 'console' && (
                      <div className="p-2">
                        <div className="mb-2 flex items-center gap-1">
                          <Terminal className="text-muted-foreground size-3" />
                          <span className="text-muted-foreground flex-1 text-[10px]">
                            {qaConsoleLogs.length} log{qaConsoleLogs.length !== 1 ? 's' : ''}
                          </span>
                          {qaConsoleLogs.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-5"
                              onClick={() => useZeusStore.setState({ qaConsoleLogs: [] })}
                              title="Clear logs"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                        {qaConsoleLogs.length > 0 ? (
                          <div className="space-y-0.5">
                            {qaConsoleLogs.slice(-200).map((log, i) => (
                              <div
                                key={i}
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                  log.level === 'error'
                                    ? 'bg-red-500/10 text-red-400'
                                    : log.level === 'warning'
                                      ? 'bg-yellow-500/10 text-yellow-400'
                                      : 'bg-secondary text-foreground'
                                }`}
                              >
                                <span className="text-muted-foreground mr-1 text-[9px]">
                                  {new Date(log.timestamp).toLocaleTimeString()}
                                </span>
                                {log.message}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground py-4 text-center text-[10px]">
                            No console logs captured
                          </p>
                        )}
                      </div>
                    )}

                    {viewTab === 'network' && (
                      <div className="p-2">
                        <div className="mb-2 flex items-center gap-1">
                          <Network className="text-muted-foreground size-3" />
                          <span className="text-muted-foreground flex-1 text-[10px]">
                            {qaNetworkRequests.length} request{qaNetworkRequests.length !== 1 ? 's' : ''}
                          </span>
                          {qaNetworkRequests.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-5"
                              onClick={() => useZeusStore.setState({ qaNetworkRequests: [] })}
                              title="Clear requests"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                        {qaNetworkRequests.length > 0 ? (
                          <div className="space-y-0.5">
                            {qaNetworkRequests.slice(-200).map((req, i) => (
                              <div
                                key={i}
                                className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                  req.failed
                                    ? 'bg-red-500/10 text-red-400'
                                    : req.status >= 400
                                      ? 'bg-yellow-500/10 text-yellow-400'
                                      : 'bg-secondary text-foreground'
                                }`}
                              >
                                <span className="text-muted-foreground shrink-0 text-[9px] uppercase">{req.method}</span>
                                <span className={`shrink-0 text-[9px] font-bold ${
                                  req.failed ? 'text-red-400' : req.status >= 400 ? 'text-yellow-400' : 'text-green-400'
                                }`}>
                                  {req.failed ? 'ERR' : req.status}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{req.url}</span>
                                {req.duration > 0 && (
                                  <span className="text-muted-foreground shrink-0 text-[9px]">{req.duration}ms</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground py-4 text-center text-[10px]">
                            No network requests captured
                          </p>
                        )}
                      </div>
                    )}

                    {viewTab === 'errors' && (
                      <div className="p-2">
                        <div className="mb-2 flex items-center gap-1">
                          <Bug className="text-muted-foreground size-3" />
                          <span className="text-muted-foreground flex-1 text-[10px]">
                            {qaJsErrors.length} error{qaJsErrors.length !== 1 ? 's' : ''}
                          </span>
                          {qaJsErrors.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-5"
                              onClick={() => useZeusStore.setState({ qaJsErrors: [] })}
                              title="Clear errors"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                        {qaJsErrors.length > 0 ? (
                          <div className="space-y-1">
                            {qaJsErrors.slice(-100).map((err, i) => (
                              <div key={i} className="rounded bg-red-500/10 px-1.5 py-1 font-mono text-[10px] text-red-400">
                                <div className="font-bold">{err.message}</div>
                                {err.stack && (
                                  <pre className="mt-0.5 whitespace-pre-wrap text-[9px] text-red-400/70">
                                    {err.stack}
                                  </pre>
                                )}
                                <span className="text-red-400/50 text-[9px]">
                                  {new Date(err.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground py-4 text-center text-[10px]">
                            No JavaScript errors captured
                          </p>
                        )}
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
            </>
          )}

          {/* Agent mode */}
          {qaMode === 'agent' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Agent list bar — shows when there are agents for this session */}
              {hasAnyAgent && !showNewAgentForm && (
                <>
                  <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
                    <Bot className="text-muted-foreground size-3 shrink-0" />
                    <select
                      value={selectedAgentId ?? ''}
                      onChange={(e) => selectQaAgent(parentSessionId, e.target.value || null)}
                      className="bg-secondary text-foreground min-w-0 flex-1 rounded px-1.5 py-0.5 text-[10px] outline-none"
                    >
                      {sessionAgents.map((a) => {
                        const label = a.info.name || a.info.task;
                        return (
                          <option key={a.info.qaAgentId} value={a.info.qaAgentId}>
                            {a.info.status === 'running' ? '\u25CF ' : '\u25CB '}
                            {label.slice(0, 50)}{label.length > 50 ? '...' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 shrink-0"
                      onClick={() => setShowNewAgentForm(true)}
                      title="New agent"
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>

                  {/* Selected agent view */}
                  {selectedAgent && (
                    <>
                      <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
                        <span className={`size-2 shrink-0 rounded-full ${
                          selectedAgent.info.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
                        }`} />
                        <span className="text-foreground flex-1 truncate text-[10px] font-medium">
                          {selectedAgent.info.name || (selectedAgent.info.status === 'running' ? 'Agent running' : 'Agent stopped')}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className={`size-5 ${compressedLog ? 'text-primary' : 'text-muted-foreground'}`}
                          onClick={() => setCompressedLog(!compressedLog)}
                          title={compressedLog ? 'Verbose log' : 'Compressed log'}
                        >
                          {compressedLog ? <Layers className="size-3" /> : <List className="size-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-5"
                          onClick={() => clearQAAgentEntries(selectedAgent.info.qaAgentId)}
                          title="Clear log"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                        {selectedAgent.info.status === 'running' ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive size-5"
                            onClick={() => stopQAAgent(selectedAgent.info.qaAgentId)}
                            title="Stop agent"
                          >
                            <Square className="size-3" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive size-5"
                            onClick={() => deleteQAAgent(selectedAgent.info.qaAgentId, parentSessionId)}
                            title="Delete agent"
                          >
                            <X className="size-3" />
                          </Button>
                        )}
                      </div>
                      <div ref={agentLogRef} className={`min-h-0 flex-1 overflow-y-auto p-4 ${compressedLog ? 'space-y-1.5' : 'space-y-3'}`}>
                        {selectedAgent.entries.length === 0 ? (
                          <p className="text-muted-foreground py-4 text-center text-xs">
                            {selectedAgent.info.status === 'running' ? 'Waiting for agent output...' : 'No log entries'}
                          </p>
                        ) : compressedLog ? (
                          compressEntries(selectedAgent.entries).map((group, i) => (
                            <CompressedLogEntry key={i} group={group} />
                          ))
                        ) : (
                          selectedAgent.entries.map((entry, i) => (
                            <AgentLogEntry key={i} entry={entry} />
                          ))
                        )}
                      </div>
                      {selectedAgent.info.status === 'running' && (
                        <div className="border-border flex shrink-0 items-center gap-1.5 border-t px-2 py-1.5">
                          <input
                            type="text"
                            value={agentFollowUp}
                            onChange={(e) => setAgentFollowUp(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && agentFollowUp.trim()) {
                                sendQAAgentMessage(selectedAgent.info.qaAgentId, agentFollowUp.trim());
                                setAgentFollowUp('');
                              }
                            }}
                            className="bg-secondary text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded px-2 py-1 text-[10px] outline-none"
                            placeholder="Follow-up instruction..."
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0"
                            onClick={() => {
                              if (agentFollowUp.trim()) {
                                sendQAAgentMessage(selectedAgent.info.qaAgentId, agentFollowUp.trim());
                                setAgentFollowUp('');
                              }
                            }}
                            title="Send"
                          >
                            <Send className="size-3" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* New agent form — shown when no agents exist or user clicked + */}
              {(!hasAnyAgent || showNewAgentForm) && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
                  {showNewAgentForm && (
                    <button
                      onClick={() => setShowNewAgentForm(false)}
                      className="text-muted-foreground hover:text-foreground self-start text-[10px]"
                    >
                      &larr; Back to agents
                    </button>
                  )}
                  <Bot className="text-muted-foreground/40 size-8" />
                  <p className="text-muted-foreground text-[10px]">Describe a task for the QA agent</p>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="bg-secondary text-foreground placeholder:text-muted-foreground w-full rounded px-2 py-1 text-[10px] outline-none"
                    placeholder="Agent name (optional)"
                  />
                  <input
                    type="text"
                    value={agentTargetUrl}
                    onChange={(e) => setAgentTargetUrl(e.target.value)}
                    className="bg-secondary text-foreground placeholder:text-muted-foreground w-full rounded px-2 py-1 text-[10px] outline-none"
                    placeholder="Target URL"
                  />
                  <textarea
                    value={agentTask}
                    onChange={(e) => setAgentTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && agentTask.trim()) {
                        e.preventDefault();
                        handleStartAgent();
                      }
                    }}
                    className="bg-secondary text-foreground placeholder:text-muted-foreground h-20 w-full resize-none rounded px-2 py-1.5 text-[10px] outline-none"
                    placeholder="e.g. Test the login flow with valid and invalid credentials..."
                  />
                  <Button
                    size="sm"
                    onClick={handleStartAgent}
                    disabled={!agentTask.trim()}
                    className="gap-1.5"
                  >
                    <Play className="size-3" />
                    Start Agent
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default QAPanel;
