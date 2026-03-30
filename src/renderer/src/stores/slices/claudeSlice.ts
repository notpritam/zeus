import type { StateCreator } from 'zustand';
import type { ZeusState, ViewMode } from '../types';
import type {
  ClaudeSessionInfo,
  ClaudeApprovalInfo,
  NormalizedEntry,
  SessionActivity,
  PermissionMode,
} from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export const ENTRIES_PAGE_SIZE = 50;

let claudeIdCounter = 0;

export function truncatePreview(content: string, max = 60): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max) + '...' : trimmed;
}

export interface ClaudeSlice {
  // State
  claudeSessions: ClaudeSessionInfo[];
  deletedClaudeSessions: ClaudeSessionInfo[];
  activeClaudeId: string | null;
  claudeEntries: Record<string, NormalizedEntry[]>;
  claudeEntriesMeta: Record<string, { oldestSeq: number | null; totalCount: number; hasMore: boolean; loading: boolean }>;
  pendingApprovals: ClaudeApprovalInfo[];
  sessionActivity: Record<string, SessionActivity>;
  lastActivityAt: Record<string, number>;
  lastUserMessagePreview: Record<string, string>;
  messageQueue: Record<string, Array<{ id: string; content: string }>>;

  // Actions
  startClaudeSession: (config: {
    prompt: string;
    workingDir: string;
    sessionName?: string;
    permissionMode?: PermissionMode;
    model?: string;
    notificationSound?: boolean;
    enableGitWatcher?: boolean;
    enableQA?: boolean;
    qaTargetUrl?: string;
    mcpProfileId?: string;
    mcpServerIds?: string[];
    mcpExcludeIds?: string[];
    projectId?: string;
  }) => void;
  sendClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  injectClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  clearClaudeHistory: () => void;
  approveClaudeTool: (approvalId: string, updatedInput?: Record<string, unknown>) => void;
  denyClaudeTool: (approvalId: string, reason?: string) => void;
  interruptClaude: () => void;
  stopClaude: () => void;
  selectClaudeSession: (id: string | null) => void;
  resumeClaudeSession: (id: string, prompt?: string) => void;
  queueMessage: (content: string) => void;
  editQueuedMessage: (msgId: string, content: string) => void;
  removeQueuedMessage: (msgId: string) => void;
  loadMoreEntries: (sessionId: string) => void;
  updateClaudeSession: (id: string, updates: { name?: string; color?: string | null }) => void;
  updateQaTargetUrl: (sessionId: string, qaTargetUrl: string) => void;
  detectQaTargetUrl: (sessionId: string) => void;
  deleteClaudeSession: (id: string) => void;
  restoreClaudeSession: (id: string) => void;
  archiveClaudeSession: (id: string) => void;
  fetchDeletedSessions: () => void;
}

export const createClaudeSlice: StateCreator<ZeusState, [], [], ClaudeSlice> = (set, get) => ({
  claudeSessions: [],
  deletedClaudeSessions: [],
  activeClaudeId: null,
  claudeEntries: {},
  claudeEntriesMeta: {},
  pendingApprovals: [],
  sessionActivity: {},
  lastActivityAt: {},
  lastUserMessagePreview: {},
  messageQueue: {},

  startClaudeSession: (config) => {
    const {
      prompt,
      workingDir,
      sessionName,
      permissionMode,
      model,
      notificationSound,
      enableGitWatcher,
      enableQA,
      qaTargetUrl,
      mcpProfileId,
      mcpServerIds,
      mcpExcludeIds,
      projectId,
    } = config;
    const id = `claude-${Date.now()}-${++claudeIdCounter}`;
    const session: ClaudeSessionInfo = {
      id,
      claudeSessionId: null,
      status: 'running',
      prompt,
      name: sessionName,
      notificationSound,
      enableGitWatcher,
      enableQA,
      workingDir,
      startedAt: Date.now(),
      permissionMode,
      model,
    };

    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content: prompt,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      claudeSessions: [...state.claudeSessions, session],
      activeClaudeId: id,
      claudeEntries: { ...state.claudeEntries, [id]: [userEntry] },
      lastUserMessagePreview: { ...state.lastUserMessagePreview, [id]: truncatePreview(prompt) },
      sessionActivity: { ...state.sessionActivity, [id]: { state: 'starting' } },
      lastActivityAt: { ...state.lastActivityAt, [id]: Date.now() },
      viewMode: 'claude',
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: {
        type: 'start_claude',
        prompt,
        workingDir,
        permissionMode,
        model,
        sessionName,
        notificationSound,
        enableGitWatcher,
        enableQA,
        qaTargetUrl,
        mcpProfileId,
        mcpServerIds,
        mcpExcludeIds,
        projectId,
      },
      auth: '',
    });

    if (enableGitWatcher !== false) {
      zeusWs.send({
        channel: 'git',
        sessionId: id,
        payload: { type: 'start_watching', workingDir },
        auth: '',
      });
    }
    zeusWs.send({
      channel: 'files',
      sessionId: id,
      payload: { type: 'start_watching', workingDir },
      auth: '',
    });
  },

  sendClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

    const meta: Record<string, unknown> = {};
    if (files && files.length > 0) meta.files = files;
    if (images && images.length > 0) meta.images = images.map((img) => ({ filename: img.filename, dataUrl: img.dataUrl }));

    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content,
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      claudeEntries: {
        ...state.claudeEntries,
        [activeClaudeId]: [...(state.claudeEntries[activeClaudeId] ?? []), userEntry],
      },
      lastUserMessagePreview: {
        ...state.lastUserMessagePreview,
        [activeClaudeId]: truncatePreview(content),
      },
      sessionActivity: { ...state.sessionActivity, [activeClaudeId]: { state: 'starting' } },
      lastActivityAt: { ...state.lastActivityAt, [activeClaudeId]: Date.now() },
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'send_message', content, files, images },
      auth: '',
    });
  },

  injectClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

    const meta: Record<string, unknown> = {};
    if (files && files.length > 0) meta.files = files;
    if (images && images.length > 0) meta.images = images.map((img) => ({ filename: img.filename, dataUrl: img.dataUrl }));

    const userEntry: NormalizedEntry = {
      id: `user-inject-${Date.now()}`,
      entryType: { type: 'user_message' },
      content,
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      claudeEntries: {
        ...state.claudeEntries,
        [activeClaudeId]: [...(state.claudeEntries[activeClaudeId] ?? []), userEntry],
      },
      lastUserMessagePreview: {
        ...state.lastUserMessagePreview,
        [activeClaudeId]: truncatePreview(content),
      },
      lastActivityAt: { ...state.lastActivityAt, [activeClaudeId]: Date.now() },
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'inject_message', content, files, images },
      auth: '',
    });
  },

  clearClaudeHistory: () => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    set((state) => ({
      claudeEntries: { ...state.claudeEntries, [activeClaudeId]: [] },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'clear_history' },
      auth: '',
    });
  },

  approveClaudeTool: (approvalId: string, updatedInput?: Record<string, unknown>) => {
    const approval = get().pendingApprovals.find((a) => a.approvalId === approvalId);
    if (!approval) return;

    zeusWs.send({
      channel: 'claude',
      sessionId: approval.sessionId,
      payload: { type: 'approve_tool', approvalId, updatedInput },
      auth: '',
    });

    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.approvalId !== approvalId),
    }));
  },

  denyClaudeTool: (approvalId: string, reason?: string) => {
    const approval = get().pendingApprovals.find((a) => a.approvalId === approvalId);
    if (!approval) return;

    zeusWs.send({
      channel: 'claude',
      sessionId: approval.sessionId,
      payload: { type: 'deny_tool', approvalId, reason },
      auth: '',
    });

    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.approvalId !== approvalId),
    }));
  },

  interruptClaude: () => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'interrupt' },
      auth: '',
    });
  },

  stopClaude: () => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'stop_claude' },
      auth: '',
    });

    set((state) => ({
      claudeSessions: state.claudeSessions.map((s) =>
        s.id === activeClaudeId ? { ...s, status: 'done' as const } : s,
      ),
      pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== activeClaudeId),
    }));
  },

  resumeClaudeSession: (id: string, prompt?: string) => {
    const state = get();
    const session = state.claudeSessions.find((s) => s.id === id);
    if (!session || !session.claudeSessionId) return;

    const existingEntries = state.claudeEntries[id] ?? [];
    const originalName = session.name?.replace(/\s*\(resumed\)$/g, '') || session.name;

    const newId = `claude-${Date.now()}-${++claudeIdCounter}`;
    const newSession: ClaudeSessionInfo = {
      id: newId,
      claudeSessionId: session.claudeSessionId,
      status: 'running',
      prompt: session.prompt,
      name: originalName,
      color: session.color,
      notificationSound: session.notificationSound,
      enableGitWatcher: session.enableGitWatcher,
      workingDir: session.workingDir,
      startedAt: Date.now(),
    };

    const resumePrompt = prompt || 'Continue working.';
    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content: resumePrompt,
      timestamp: new Date().toISOString(),
    };

    set((s) => ({
      claudeSessions: [...s.claudeSessions, newSession],
      activeClaudeId: newId,
      claudeEntries: { ...s.claudeEntries, [newId]: [...existingEntries, userEntry] },
      claudeEntriesMeta: {
        ...s.claudeEntriesMeta,
        [newId]: s.claudeEntriesMeta[id]
          ? { ...s.claudeEntriesMeta[id] }
          : { oldestSeq: null, totalCount: existingEntries.length + 1, hasMore: false, loading: false },
      },
      lastUserMessagePreview: {
        ...s.lastUserMessagePreview,
        [newId]: truncatePreview(resumePrompt),
      },
      sessionActivity: { ...s.sessionActivity, [newId]: { state: 'starting' } },
      lastActivityAt: { ...s.lastActivityAt, [newId]: Date.now() },
      viewMode: 'claude',
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: newId,
      payload: {
        type: 'resume_claude',
        claudeSessionId: session.claudeSessionId,
        prompt: prompt || 'Continue working.',
        workingDir: session.workingDir || '/',
        name: originalName,
        color: session.color,
      },
      auth: '',
    });

    if (session.enableGitWatcher !== false) {
      zeusWs.send({
        channel: 'git',
        sessionId: newId,
        payload: { type: 'start_watching', workingDir: session.workingDir || '/' },
        auth: '',
      });
      zeusWs.send({
        channel: 'files',
        sessionId: newId,
        payload: { type: 'start_watching', workingDir: session.workingDir || '/' },
        auth: '',
      });
    }
  },

  queueMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: [...(state.messageQueue[activeClaudeId] ?? []), { id, content }],
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'queue_message', id, content },
      auth: '',
    });
  },

  editQueuedMessage: (msgId: string, content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).map((m) =>
          m.id === msgId ? { ...m, content } : m,
        ),
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'edit_queued_message', msgId, content },
      auth: '',
    });
  },

  removeQueuedMessage: (msgId: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: (state.messageQueue[activeClaudeId] ?? []).filter((m) => m.id !== msgId),
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'remove_queued_message', msgId },
      auth: '',
    });
  },

  loadMoreEntries: (sessionId: string) => {
    const meta = get().claudeEntriesMeta[sessionId];
    if (!meta || !meta.hasMore || meta.loading) return;
    set((state) => ({
      claudeEntriesMeta: {
        ...state.claudeEntriesMeta,
        [sessionId]: { ...state.claudeEntriesMeta[sessionId], loading: true },
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId,
      payload: {
        type: 'get_claude_history',
        limit: ENTRIES_PAGE_SIZE,
        beforeSeq: meta.oldestSeq ?? undefined,
      },
      auth: '',
    });
  },

  selectClaudeSession: (id: string | null) => {
    const state = get();
    let newViewMode: ViewMode = id ? 'claude' : state.viewMode;
    let newActiveDiffTabId = state.activeDiffTabId;

    if (id && state.viewMode === 'diff' && state.activeDiffTabId) {
      const activeTab = state.openDiffTabs.find((t) => t.id === state.activeDiffTabId);
      if (activeTab && activeTab.sessionId !== id) {
        const newSessionTabs = state.openDiffTabs.filter((t) => t.sessionId === id);
        if (newSessionTabs.length > 0) {
          newActiveDiffTabId = newSessionTabs[0].id;
          newViewMode = 'diff';
        } else {
          newViewMode = 'claude';
        }
      }
    }

    set({ activeClaudeId: id, viewMode: newViewMode, activeDiffTabId: newActiveDiffTabId });
    if (id) {
      if (!get().claudeEntries[id] || get().claudeEntries[id].length === 0) {
        zeusWs.send({
          channel: 'claude',
          sessionId: id,
          payload: { type: 'get_claude_history', limit: ENTRIES_PAGE_SIZE },
          auth: '',
        });
      }
      const session = get().claudeSessions.find((s) => s.id === id);
      if (session?.workingDir) {
        zeusWs.send({
          channel: 'git',
          sessionId: id,
          payload: { type: 'start_watching', workingDir: session.workingDir },
          auth: '',
        });
        zeusWs.send({
          channel: 'files',
          sessionId: id,
          payload: { type: 'start_watching', workingDir: session.workingDir },
          auth: '',
        });
      }
    }
  },

  updateClaudeSession: (id: string, updates: { name?: string; color?: string | null }) => {
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'update_claude_session', ...updates },
      auth: '',
    });
  },

  updateQaTargetUrl: (sessionId: string, qaTargetUrl: string) => {
    zeusWs.send({
      channel: 'claude',
      sessionId,
      payload: { type: 'update_qa_target_url', qaTargetUrl },
      auth: '',
    });
  },

  detectQaTargetUrl: (sessionId: string) => {
    zeusWs.send({
      channel: 'claude',
      sessionId,
      payload: { type: 'detect_qa_target_url' },
      auth: '',
    });
  },

  deleteClaudeSession: (id: string) => {
    get().destroyAllSessionTerminals(id);
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'delete_claude_session' },
      auth: '',
    });
  },

  restoreClaudeSession: (id: string) => {
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'restore_claude_session' },
      auth: '',
    });
  },

  archiveClaudeSession: (id: string) => {
    get().destroyAllSessionTerminals(id);
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'archive_claude_session' },
      auth: '',
    });
  },

  fetchDeletedSessions: () => {
    zeusWs.send({
      channel: 'claude',
      sessionId: '',
      payload: { type: 'list_deleted_sessions' },
      auth: '',
    });
  },
});
