import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Eye,
  Play,
  Square,
  Globe,
  Camera,
  FileText,
  FileSearch,
  MousePointer,
  Loader2,
  ChevronRight,
  ChevronLeft,
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
  Minimize2,
  Maximize2,
  ArrowDown,
} from 'lucide-react';
import { ImageLightbox, useLightbox } from '@/components/ImageLightbox';
import { useZeusStore } from '@/stores/useZeusStore';
import { EntryItem, CompressedGroup, groupEntriesByUser } from '@/components/EntryRenderers';
import type { SubagentType } from '@shared/types';

type QAViewTab = 'snapshot' | 'screenshot' | 'text' | 'console' | 'network' | 'errors';

// Keep in sync with src/main/services/subagent-registry.ts
const SUBAGENT_TYPES = [
  {
    type: 'qa' as SubagentType,
    name: 'QA Tester',
    icon: Eye,
    description: 'Browser-based QA testing with PinchTab automation',
    inputFields: [
      { key: 'task', label: 'Task', type: 'textarea' as const, required: true, placeholder: 'What to test...' },
      { key: 'targetUrl', label: 'Target URL', type: 'text' as const, required: false, placeholder: 'Auto-detected' },
    ],
  },
  {
    type: 'plan_reviewer' as SubagentType,
    name: 'Plan Reviewer',
    icon: FileSearch,
    description: 'Review implementation plans for completeness and feasibility',
    inputFields: [
      { key: 'task', label: 'Review Instructions', type: 'textarea' as const, required: true, placeholder: 'Review this plan for...' },
      { key: 'filePath', label: 'Plan File', type: 'file' as const, required: true, placeholder: 'docs/superpowers/plans/...' },
    ],
  },
];

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
      qaTargetUrl: cs?.qaTargetUrl,
    };
  }
  if (activeSessionId) {
    const ts = sessions.find((s) => s.id === activeSessionId);
    return {
      parentSessionId: activeSessionId,
      parentSessionType: 'terminal' as const,
      workingDir: ts?.cwd || '/',
      qaTargetUrl: undefined,
    };
  }
  // Fallback: pick whatever session exists
  if (activeClaudeId) {
    const cs = claudeSessions.find((s) => s.id === activeClaudeId);
    return {
      parentSessionId: activeClaudeId,
      parentSessionType: 'claude' as const,
      workingDir: cs?.workingDir || '/',
      qaTargetUrl: cs?.qaTargetUrl,
    };
  }
  if (sessions.length > 0) {
    const ts = sessions[0];
    return {
      parentSessionId: ts.id,
      parentSessionType: 'terminal' as const,
      workingDir: ts.cwd || '/',
      qaTargetUrl: undefined,
    };
  }
  return null;
}

function SubagentPanel() {
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

  const subagents = useZeusStore((s) => s.subagents);
  const activeSubagentId = useZeusStore((s) => s.activeSubagentId);
  const startSubagent = useZeusStore((s) => s.startSubagent);
  const stopSubagent = useZeusStore((s) => s.stopSubagent);
  const deleteSubagent = useZeusStore((s) => s.deleteSubagent);
  const sendSubagentMessage = useZeusStore((s) => s.sendSubagentMessage);
  const clearSubagentEntries = useZeusStore((s) => s.clearSubagentEntries);
  const selectSubagent = useZeusStore((s) => s.selectSubagent);
  const fetchSubagents = useZeusStore((s) => s.fetchSubagents);
  const fetchSubagentEntries = useZeusStore((s) => s.fetchSubagentEntries);
  const qaFlows = useZeusStore((s) => s.qaFlows);
  const fetchQaFlows = useZeusStore((s) => s.fetchQaFlows);

  const sessionCtx = useCurrentSessionContext();

  const qaCurrentUrl = useZeusStore((s) => s.qaCurrentUrl);

  const [viewTab, setViewTab] = useState<QAViewTab>('snapshot');
  const [url, setUrl] = useState(qaCurrentUrl);
  const [actionKind, setActionKind] = useState('click');
  const [actionRef, setActionRef] = useState('');
  const [actionValue, setActionValue] = useState('');

  const [qaMode, setQaMode] = useState<'browser' | 'agent'>('browser');
  const [agentFollowUp, setAgentFollowUp] = useState('');
  const [compressedLog, setCompressedLog] = useState(true);
  const { lightbox, openLightbox, closeLightbox } = useLightbox();
  const agentLogRef = useRef<HTMLDivElement>(null);
  const agentUserScrolledUp = useRef(false);
  const [showAgentScrollToBottom, setShowAgentScrollToBottom] = useState(false);

  // Panel view state for type selector / form / agents list
  const [panelView, setPanelView] = useState<'selector' | 'form' | 'agents'>('agents');
  const [selectedType, setSelectedType] = useState<SubagentType | null>(null);
  const [formInputs, setFormInputs] = useState<Record<string, string>>({});
  const [spawning, setSpawning] = useState(false);

  // Sync agent target URL when session's detected URL changes
  useEffect(() => {
    if (sessionCtx?.qaTargetUrl) {
      // Pre-fill targetUrl in formInputs if not already set
      setFormInputs((prev) => {
        if (!prev.targetUrl) return { ...prev, targetUrl: sessionCtx.qaTargetUrl! };
        return prev;
      });
    }
  }, [sessionCtx?.qaTargetUrl]);

  // Session-scoped agents
  const parentSessionId = sessionCtx?.parentSessionId ?? '';
  const parentSessionType = sessionCtx?.parentSessionType ?? 'terminal';
  const sessionAgents = useMemo(
    () => subagents[parentSessionId] ?? [],
    [subagents, parentSessionId],
  );
  const selectedAgentId = activeSubagentId[parentSessionId] ?? null;
  const selectedAgent = sessionAgents.find((a) => a.info.subagentId === selectedAgentId) ?? null;
  const isQaAgent = selectedAgent?.info.subagentType === 'qa';
  const hasRunningAgent = sessionAgents.some((a) => a.info.status === 'running');
  const hasAnyAgent = sessionAgents.length > 0;

  // Track if user has scrolled away from bottom in agent log
  useEffect(() => {
    const el = agentLogRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      agentUserScrolledUp.current = !atBottom;
      setShowAgentScrollToBottom(!atBottom);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [selectedAgentId]);

  // Auto-scroll to bottom on new entries (unless user scrolled up)
  useEffect(() => {
    const el = agentLogRef.current;
    if (!el) return;
    if (!agentUserScrolledUp.current) {
      el.scrollTop = el.scrollHeight;
    }
    // Re-check if scroll-to-bottom button should show (content may have grown)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowAgentScrollToBottom(!atBottom && el.scrollHeight > el.clientHeight);
  }, [selectedAgent?.entries.length]);

  const scrollAgentLogToBottom = useCallback(() => {
    if (agentLogRef.current) {
      agentLogRef.current.scrollTo({ top: agentLogRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // Sync URL bar when QA navigates (e.g. from Claude tool calls)
  useEffect(() => {
    if (qaCurrentUrl) setUrl(qaCurrentUrl);
  }, [qaCurrentUrl]);

  // Fetch agents from DB on mount and when parent session changes
  useEffect(() => {
    if (!parentSessionId) return;
    fetchSubagents(parentSessionId);
  }, [parentSessionId]);

  // Auto-select first running agent when switching sessions
  useEffect(() => {
    if (!parentSessionId) return;
    if (selectedAgentId && sessionAgents.find((a) => a.info.subagentId === selectedAgentId)) return;
    const running = sessionAgents.find((a) => a.info.status === 'running');
    if (running) {
      selectSubagent(parentSessionId, running.info.subagentId);
    } else if (sessionAgents.length > 0) {
      selectSubagent(parentSessionId, sessionAgents[sessionAgents.length - 1].info.subagentId);
    }
  }, [parentSessionId, sessionAgents.length]);

  // Auto-fetch entries from DB when selecting an agent with no entries loaded
  useEffect(() => {
    if (!selectedAgent) return;
    if (selectedAgent.entries.length === 0) {
      fetchSubagentEntries(selectedAgent.info.subagentId);
    }
  }, [selectedAgentId]);

  // Fetch available flows when showing type selector
  useEffect(() => {
    if (panelView === 'selector' || !hasAnyAgent) {
      fetchQaFlows();
    }
  }, [panelView, hasAnyAgent]);

  function handleStartSubagent(def: typeof SUBAGENT_TYPES[0]) {
    if (!parentSessionId || spawning) return;
    const workingDir = sessionCtx?.workingDir || '/';
    const canSubmit = def.inputFields.filter(f => f.required).every(f => formInputs[f.key]?.trim());
    if (!canSubmit) return;
    setSpawning(true);
    startSubagent(
      def.type,
      'claude',
      formInputs,
      workingDir,
      parentSessionId,
      parentSessionType as 'terminal' | 'claude',
    );
    setFormInputs({});
    // panelView switches to 'agents' once subagent_started arrives (see effect below)
  }

  // Switch to agents view and clear spawning state when a new agent arrives
  useEffect(() => {
    if (spawning && sessionAgents.length > 0) {
      setSpawning(false);
      setPanelView('agents');
    }
  }, [spawning, sessionAgents.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border bg-card sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b px-3 py-3">
        <span className={`size-2 shrink-0 rounded-full ${qaRunning ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
        <span className="text-primary flex-1 text-sm font-bold">Subagents</span>
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
          <Square className="size-3.5" />
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
                      placeholder={window.location.origin}
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
                          <>
                            <img
                              src={qaScreenshot}
                              alt="Page screenshot"
                              className="border-border w-full cursor-pointer rounded border transition-opacity hover:opacity-80"
                              onClick={() => openLightbox([qaScreenshot], 0)}
                            />
                            {lightbox && (
                              <ImageLightbox
                                images={lightbox.images}
                                initialIndex={lightbox.index}
                                onClose={closeLightbox}
                              />
                            )}
                          </>
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

              {/* Type selector view */}
              {panelView === 'selector' && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Spawn Subagent</span>
                    <button onClick={() => setPanelView('agents')} className="text-xs text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                  {SUBAGENT_TYPES.map((def) => (
                    <button
                      key={def.type}
                      onClick={() => { setSelectedType(def.type); setFormInputs({}); setPanelView('form'); }}
                      className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-card transition-colors text-left"
                    >
                      <def.icon className="size-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <div className="text-sm font-medium">{def.name}</div>
                        <div className="text-xs text-muted-foreground">{def.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Form view */}
              {panelView === 'form' && selectedType && (() => {
                const def = SUBAGENT_TYPES.find((d) => d.type === selectedType)!;
                const canSubmit = def.inputFields.filter(f => f.required).every(f => formInputs[f.key]?.trim());
                return (
                  <div className="p-3 space-y-3">
                    <button onClick={() => setPanelView('selector')} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <ChevronLeft className="size-3" /> Back
                    </button>
                    <div className="flex items-center gap-2">
                      <def.icon className="size-4 text-primary" />
                      <span className="text-sm font-medium">{def.name}</span>
                    </div>
                    {def.inputFields.map((field) => (
                      <div key={field.key}>
                        <label className="text-xs text-muted-foreground block mb-1">{field.label}{field.required && ' *'}</label>
                        {field.type === 'textarea' ? (
                          <textarea
                            className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                            rows={3}
                            placeholder={field.placeholder}
                            value={formInputs[field.key] ?? ''}
                            onChange={(e) => setFormInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          />
                        ) : (
                          <input
                            type="text"
                            className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder={field.placeholder}
                            value={formInputs[field.key] ?? ''}
                            onChange={(e) => setFormInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                    <button
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleStartSubagent(def)}
                      disabled={!canSubmit || spawning}
                    >
                      {spawning ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                      {spawning ? 'Starting...' : 'Start Agent'}
                    </button>
                  </div>
                );
              })()}

              {/* Agent list view */}
              {panelView === 'agents' && (
                <>
                  {/* Agent list bar — shows when there are agents for this session */}
                  {hasAnyAgent && (
                    <>
                      <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
                        <Bot className="text-muted-foreground size-3 shrink-0" />
                        <select
                          value={selectedAgentId ?? ''}
                          onChange={(e) => selectSubagent(parentSessionId, e.target.value || null)}
                          className="bg-secondary text-foreground min-w-0 flex-1 rounded px-1.5 py-0.5 text-[10px] outline-none"
                        >
                          {sessionAgents.map((a) => {
                            const label = a.info.name || a.info.task;
                            return (
                              <option key={a.info.subagentId} value={a.info.subagentId}>
                                {a.info.status === 'running' ? '\u25CF ' : '\u25CB '}
                                {label.slice(0, 50)}{label.length > 50 ? '...' : ''}
                                {' '}[{a.info.subagentType === 'qa' ? 'QA' : 'Review'}]
                              </option>
                            );
                          })}
                        </select>
                        {selectedAgent && selectedAgent.info.status !== 'running' && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive size-5 shrink-0"
                            onClick={() => {
                              deleteSubagent(selectedAgent.info.subagentId, parentSessionId);
                            }}
                            title="Delete agent"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                        <button onClick={() => setPanelView('selector')} title="New subagent" className="text-muted-foreground hover:text-foreground p-0.5">
                          <Plus className="size-4" />
                        </button>
                      </div>

                      {/* Selected agent view */}
                      {selectedAgent && (
                        <>
                          <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
                            <span className={`size-2 shrink-0 rounded-full ${
                              selectedAgent.info.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
                            }`} />
                            <span className="text-foreground flex-1 truncate text-[10px] font-medium">
                              {selectedAgent.info.name || selectedAgent.info.task.slice(0, 40)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className={`size-5 ${compressedLog ? 'text-primary' : 'text-muted-foreground'}`}
                              onClick={() => setCompressedLog(!compressedLog)}
                              title={compressedLog ? 'Expand all' : 'Compress view'}
                            >
                              {compressedLog ? <Maximize2 className="size-3" /> : <Minimize2 className="size-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-5"
                              onClick={() => clearSubagentEntries(selectedAgent.info.subagentId)}
                              title="Clear log"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                          <div className="relative min-h-0 flex-1">
                            <div ref={agentLogRef} className="absolute inset-0 overflow-y-auto p-4 space-y-3">
                              {selectedAgent.entries.length === 0 ? (
                                <p className="text-muted-foreground py-4 text-center text-xs">
                                  {selectedAgent.info.status === 'running' ? 'Waiting for agent output...' : 'No log entries'}
                                </p>
                              ) : compressedLog ? (
                                groupEntriesByUser(selectedAgent.entries).map((group, i, arr) => (
                                  <CompressedGroup
                                    key={group.userEntry?.id ?? `group-${i}`}
                                    group={group}
                                    isLast={i === arr.length - 1}
                                    sessionDone={selectedAgent.info.status !== 'running'}
                                  />
                                ))
                              ) : (
                                selectedAgent.entries.map((entry, i) => (
                                  <EntryItem
                                    key={entry.id}
                                    entry={entry}
                                    sessionDone={selectedAgent.info.status !== 'running'}
                                    isLastEntry={i === selectedAgent.entries.length - 1}
                                  />
                                ))
                              )}
                            </div>
                            {showAgentScrollToBottom && (
                              <button
                                onClick={() => {
                                  agentUserScrolledUp.current = false;
                                  scrollAgentLogToBottom();
                                }}
                                className="bg-primary text-primary-foreground absolute bottom-3 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-90"
                              >
                                <ArrowDown className="size-4" />
                              </button>
                            )}
                          </div>

                          {/* Bottom interaction bar */}
                          <div className="border-border shrink-0 border-t">
                            {/* Status indicator */}
                            <div className={`flex items-center gap-2 px-3 py-1.5 ${selectedAgent.info.status === 'running' ? 'bg-primary/5' : 'bg-secondary/30'}`}>
                              {selectedAgent.info.status === 'running' ? (
                                <>
                                  <Loader2 className="text-primary size-3 animate-spin" />
                                  <span className="text-primary flex-1 text-[10px] font-medium">Agent is working...</span>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-[10px]"
                                    onClick={() => stopSubagent(selectedAgent.info.subagentId)}
                                  >
                                    <Square className="size-2.5" />
                                    Stop
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <span className="bg-muted-foreground/40 size-2 rounded-full" />
                                  <span className="text-muted-foreground flex-1 text-[10px]">
                                    Agent {selectedAgent.info.status === 'stopped' ? 'stopped' : 'errored'} — send a message to resume
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive h-6 gap-1 px-2 text-[10px]"
                                    onClick={() => deleteSubagent(selectedAgent.info.subagentId, parentSessionId)}
                                  >
                                    <Trash2 className="size-2.5" />
                                    Delete
                                  </Button>
                                </>
                              )}
                            </div>
                            {/* Message input — always visible */}
                            <div className="flex items-center gap-1.5 px-2 py-2">
                              <input
                                type="text"
                                value={agentFollowUp}
                                onChange={(e) => setAgentFollowUp(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && agentFollowUp.trim()) {
                                    sendSubagentMessage(selectedAgent.info.subagentId, agentFollowUp.trim());
                                    setAgentFollowUp('');
                                    agentUserScrolledUp.current = false;
                                    scrollAgentLogToBottom();
                                  }
                                }}
                                className="bg-secondary text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded-md border border-transparent px-2.5 py-1.5 text-xs outline-none focus:border-primary/40"
                                placeholder={selectedAgent.info.status === 'running' ? 'Send a message to the agent...' : 'Send a message to resume the agent...'}
                              />
                              <Button
                                variant="default"
                                size="icon-xs"
                                className="size-7 shrink-0"
                                disabled={!agentFollowUp.trim()}
                                onClick={() => {
                                  if (agentFollowUp.trim()) {
                                    sendSubagentMessage(selectedAgent.info.subagentId, agentFollowUp.trim());
                                    setAgentFollowUp('');
                                    agentUserScrolledUp.current = false;
                                    scrollAgentLogToBottom();
                                  }
                                }}
                                title="Send message"
                              >
                                <Send className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* No agents — show type selector directly */}
                  {!hasAnyAgent && (
                    <div className="p-3 space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Spawn Subagent</span>
                      {SUBAGENT_TYPES.map((def) => (
                        <button
                          key={def.type}
                          onClick={() => { setSelectedType(def.type); setFormInputs({}); setPanelView('form'); }}
                          className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-card transition-colors text-left"
                        >
                          <def.icon className="size-5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <div className="text-sm font-medium">{def.name}</div>
                            <div className="text-xs text-muted-foreground">{def.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SubagentPanel;
