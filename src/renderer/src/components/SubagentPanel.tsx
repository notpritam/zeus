import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Eye,
  Play,
  Square,
  FileSearch,
  Loader2,
  ChevronLeft,
  AlertCircle,
  Trash2,
  Bot,
  Send,
  Plus,
  Minimize2,
  Maximize2,
  ArrowDown,
  FileText,
  FolderOpen,
  Search,
  Check,
  Smartphone,
} from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { EntryItem, CompressedGroup, groupEntriesByUser } from '@/components/EntryRenderers';
import type { SubagentType } from '@shared/types';

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
  {
    type: 'android_qa' as SubagentType,
    name: 'Android QA Tester',
    icon: Smartphone,
    description: 'Android device QA testing with Maestro automation',
    inputFields: [
      { key: 'task', label: 'Task', type: 'textarea' as const, required: true, placeholder: 'What to test on the Android device...' },
      { key: 'appId', label: 'App ID', type: 'text' as const, required: false, placeholder: 'com.example.app (optional)' },
      { key: 'avdName', label: 'AVD Name', type: 'text' as const, required: false, placeholder: 'Auto-detected if omitted' },
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
  const fetchQaFlows = useZeusStore((s) => s.fetchQaFlows);
  const markdownFiles = useZeusStore((s) => s.markdownFiles);
  const fetchMarkdownFiles = useZeusStore((s) => s.fetchMarkdownFiles);

  const sessionCtx = useCurrentSessionContext();

  const [agentFollowUp, setAgentFollowUp] = useState('');
  const [compressedLog, setCompressedLog] = useState(true);
  const agentLogRef = useRef<HTMLDivElement>(null);
  const agentUserScrolledUp = useRef(false);
  const [showAgentScrollToBottom, setShowAgentScrollToBottom] = useState(false);

  // Panel view state for type selector / form / agents list
  const [panelView, setPanelView] = useState<'selector' | 'form' | 'agents'>('agents');
  const [selectedType, setSelectedType] = useState<SubagentType | null>(null);
  const [formInputs, setFormInputs] = useState<Record<string, string>>({});
  const [spawning, setSpawning] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');

  // Sync agent target URL when session's detected URL changes
  useEffect(() => {
    if (sessionCtx?.qaTargetUrl) {
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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowAgentScrollToBottom(!atBottom && el.scrollHeight > el.clientHeight);
  }, [selectedAgent?.entries.length]);

  const scrollAgentLogToBottom = useCallback(() => {
    if (agentLogRef.current) {
      agentLogRef.current.scrollTo({ top: agentLogRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

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

  // Fetch markdown files when form opens for plan_reviewer
  useEffect(() => {
    if (panelView === 'form' && selectedType === 'plan_reviewer' && parentSessionId) {
      fetchMarkdownFiles(parentSessionId);
    }
  }, [panelView, selectedType, parentSessionId]);

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
        <Bot className="text-primary size-4" />
        <span className="text-primary flex-1 text-sm font-bold">Subagents</span>
        {sessionCtx && (
          <span className="text-muted-foreground truncate text-[9px]">
            {parentSessionType === 'claude' ? 'Claude' : 'Term'}: {parentSessionId.slice(0, 8)}
          </span>
        )}
        {hasRunningAgent && (
          <span className="size-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
        )}
      </div>

      {/* No session selected */}
      {!sessionCtx && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <AlertCircle className="text-muted-foreground/40 size-6" />
          <p className="text-muted-foreground text-[10px]">Select a terminal or Claude session first</p>
        </div>
      )}

      {sessionCtx && (
        <div className="flex min-h-0 flex-1 flex-col">

          {/* Type selector view */}
          {panelView === 'selector' && (
            <div className="p-2 space-y-0.5">
              {hasAnyAgent && (
                <button onClick={() => setPanelView('agents')} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 mb-1">
                  <ChevronLeft className="size-3" /> Back
                </button>
              )}
              {SUBAGENT_TYPES.map((def) => {
                const activeCount = sessionAgents.filter((a) => a.info.subagentType === def.type && a.info.status === 'running').length;
                return (
                  <button
                    key={def.type}
                    onClick={() => { setSelectedType(def.type); setFormInputs({}); setPanelView('form'); }}
                    className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-secondary/60"
                  >
                    <def.icon className="size-4 text-primary shrink-0" />
                    <span className="text-xs font-medium flex-1">{def.name}</span>
                    {activeCount > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-green-400">
                        <span className="size-1.5 rounded-full bg-green-400 animate-pulse" />
                        {activeCount}
                      </span>
                    )}
                  </button>
                );
              })}
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
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <def.icon className="size-3.5 text-primary" />
                  </div>
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
                    ) : field.type === 'file' ? (
                      <div className="space-y-1.5">
                        {/* Selected file display / trigger */}
                        <button
                          type="button"
                          onClick={() => { setFilePickerOpen(!filePickerOpen); setFileSearchQuery(''); }}
                          className={`w-full flex items-center gap-2 rounded border px-2.5 py-2 text-left text-sm transition-colors ${
                            formInputs[field.key]
                              ? 'bg-secondary border-primary/30 text-foreground'
                              : 'bg-secondary border-border text-muted-foreground hover:border-primary/20'
                          }`}
                        >
                          {formInputs[field.key] ? (
                            <>
                              <FileText className="size-3.5 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1 truncate text-xs">{formInputs[field.key]}</span>
                              <Check className="size-3 shrink-0 text-green-400" />
                            </>
                          ) : (
                            <>
                              <FolderOpen className="size-3.5 shrink-0" />
                              <span className="text-xs">Choose a markdown file...</span>
                            </>
                          )}
                        </button>

                        {/* File picker dropdown */}
                        {filePickerOpen && (
                          <div className="rounded-md border border-border bg-card shadow-lg overflow-hidden">
                            {/* Search bar */}
                            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                              <Search className="size-3 text-muted-foreground shrink-0" />
                              <input
                                type="text"
                                autoFocus
                                value={fileSearchQuery}
                                onChange={(e) => setFileSearchQuery(e.target.value)}
                                className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                                placeholder="Filter files..."
                              />
                            </div>
                            {/* File list */}
                            <div className="max-h-48 overflow-y-auto">
                              {(() => {
                                const lowerQ = fileSearchQuery.toLowerCase();
                                const filtered = markdownFiles.filter(
                                  (f) => !lowerQ || f.path.toLowerCase().includes(lowerQ) || f.name.toLowerCase().includes(lowerQ),
                                );
                                if (filtered.length === 0) {
                                  return (
                                    <div className="px-3 py-4 text-center">
                                      <FileText className="size-5 text-muted-foreground/30 mx-auto mb-1" />
                                      <p className="text-[10px] text-muted-foreground">
                                        {markdownFiles.length === 0 ? 'No markdown files found' : 'No matching files'}
                                      </p>
                                    </div>
                                  );
                                }
                                // Group by directory
                                const grouped: Record<string, typeof filtered> = {};
                                for (const f of filtered) {
                                  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
                                  (grouped[dir] ??= []).push(f);
                                }
                                return Object.entries(grouped).map(([dir, files]) => (
                                  <div key={dir}>
                                    <div className="sticky top-0 bg-secondary/80 backdrop-blur-sm px-2.5 py-1 text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                      <FolderOpen className="size-2.5" />
                                      {dir}
                                    </div>
                                    {files.map((f) => {
                                      const isSelected = formInputs[field.key] === f.path;
                                      return (
                                        <button
                                          key={f.path}
                                          onClick={() => {
                                            setFormInputs((prev) => ({ ...prev, [field.key]: f.path }));
                                            setFilePickerOpen(false);
                                          }}
                                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                                            isSelected
                                              ? 'bg-primary/10 text-foreground'
                                              : 'hover:bg-secondary/60 text-foreground/80'
                                          }`}
                                        >
                                          <FileText className={`size-3 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                          <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
                                          {isSelected && <Check className="size-3 shrink-0 text-green-400" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
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
              {/* Agent list — shows when there are agents for this session */}
              {hasAnyAgent && (
                <>
                  {/* Agent list */}
                  <div className="border-border shrink-0 overflow-y-auto border-b" style={{ maxHeight: '35%' }}>
                    <div className="flex flex-col gap-0.5 p-1">
                      {sessionAgents.map((a) => {
                        const isSelected = a.info.subagentId === selectedAgentId;
                        const isRunning = a.info.status === 'running';
                        const label = a.info.name || a.info.task;
                        return (
                          <button
                            key={a.info.subagentId}
                            onClick={() => selectSubagent(parentSessionId, a.info.subagentId)}
                            className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                              isSelected
                                ? 'bg-primary/10 text-foreground'
                                : 'text-foreground/80 hover:bg-secondary/60'
                            }`}
                          >
                            <span className={`size-1.5 shrink-0 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                            <span className={`min-w-0 flex-1 truncate text-xs ${isSelected ? 'font-medium' : ''}`}>
                              {label.length > 50 ? label.slice(0, 50) + '...' : label}
                            </span>
                            {!isRunning && (
                              <button
                                className="text-muted-foreground hover:text-destructive absolute right-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={(e) => { e.stopPropagation(); deleteSubagent(a.info.subagentId, parentSessionId); }}
                                title="Delete"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-end px-2 py-1 border-t border-border">
                      <button onClick={() => setPanelView('selector')} title="New subagent" className="text-muted-foreground hover:text-foreground p-0.5">
                        <Plus className="size-3.5" />
                      </button>
                    </div>
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

              {/* No agents — show type list */}
              {!hasAnyAgent && (
                <div className="p-2 space-y-0.5">
                  {SUBAGENT_TYPES.map((def) => (
                    <button
                      key={def.type}
                      onClick={() => { setSelectedType(def.type); setFormInputs({}); setPanelView('form'); }}
                      className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-secondary/60"
                    >
                      <def.icon className="size-4 text-primary shrink-0" />
                      <span className="text-xs font-medium">{def.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SubagentPanel;
