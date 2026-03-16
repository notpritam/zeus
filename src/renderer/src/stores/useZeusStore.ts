import { create } from 'zustand';
import { zeusWs } from '@/lib/ws';
import type {
  SessionRecord,
  WsEnvelope,
  SessionStartedPayload,
  SessionListPayload,
  SessionUpdatedPayload,
  StatusPayload,
  SettingsPayload,
  ClaudeSessionInfo,
  ClaudeApprovalInfo,
  NormalizedEntry,
  SavedProject,
  ClaudeDefaults,
  PermissionMode,
  ZeusSettings,
  GitStatusData,
  GitPayload,
} from '../../../shared/types';

type ViewMode = 'terminal' | 'claude';

interface ZeusState {
  // Connection
  connected: boolean;

  // Status (from WS status channel)
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;

  // Terminal sessions (from WS control channel)
  sessions: SessionRecord[];
  activeSessionId: string | null;

  // Claude sessions
  claudeSessions: ClaudeSessionInfo[];
  activeClaudeId: string | null;
  claudeEntries: Record<string, NormalizedEntry[]>;
  pendingApprovals: ClaudeApprovalInfo[];

  // Git
  gitStatus: Record<string, GitStatusData>;
  gitErrors: Record<string, string>;

  // Settings
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  settingsError: string | null;

  // New Claude session modal
  showNewClaudeModal: boolean;

  // View mode
  viewMode: ViewMode;

  // Right panel
  rightPanelOpen: boolean;
  rightPanelTab: 'source-control' | 'file-explorer';

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  fetchSessions: () => void;
  startSession: (cols?: number, rows?: number) => void;
  stopSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;

  // Claude actions
  startClaudeSession: (config: {
    prompt: string;
    workingDir: string;
    sessionName?: string;
    permissionMode?: PermissionMode;
    model?: string;
    notificationSound?: boolean;
    enableGitWatcher?: boolean;
  }) => void;
  sendClaudeMessage: (content: string) => void;
  approveClaudeTool: (approvalId: string) => void;
  denyClaudeTool: (approvalId: string, reason?: string) => void;
  interruptClaude: () => void;
  stopClaude: () => void;
  selectClaudeSession: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;

  // Modal actions
  openNewClaudeModal: () => void;
  closeNewClaudeModal: () => void;

  // Git actions
  startGitWatching: (sessionId: string, workingDir: string) => void;
  stopGitWatching: (sessionId: string) => void;
  refreshGitStatus: (sessionId: string) => void;
  commitChanges: (sessionId: string, message: string) => void;

  // Right panel actions
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: 'source-control' | 'file-explorer') => void;

  // Settings actions
  addProject: (name: string, path: string) => void;
  removeProject: (id: string) => void;
  updateDefaults: (defaults: Partial<ClaudeDefaults>) => void;
}

let claudeIdCounter = 0;

export const useZeusStore = create<ZeusState>((set, get) => ({
  connected: false,
  powerBlock: true,
  websocket: true,
  tunnel: null,
  sessions: [],
  activeSessionId: null,

  claudeSessions: [],
  activeClaudeId: null,
  claudeEntries: {},
  pendingApprovals: [],

  gitStatus: {},
  gitErrors: {},

  savedProjects: [],
  claudeDefaults: {
    permissionMode: 'bypassPermissions',
    model: '',
    notificationSound: true,
  },
  lastUsedProjectId: null,
  settingsError: null,
  showNewClaudeModal: false,

  viewMode: 'terminal',

  rightPanelOpen: false,
  rightPanelTab: 'source-control',

  connect: () => {
    // Subscribe to status channel
    const unsubStatus = zeusWs.on('status', (envelope: WsEnvelope) => {
      const payload = envelope.payload as StatusPayload & { type: string };

      if (payload.type === '_connected') {
        set({ connected: true });
        // Request initial state
        zeusWs.send({
          channel: 'status',
          sessionId: '',
          payload: { type: 'get_status' },
          auth: '',
        });
        zeusWs.send({
          channel: 'control',
          sessionId: '',
          payload: { type: 'list_sessions' },
          auth: '',
        });
        zeusWs.send({
          channel: 'settings',
          sessionId: '',
          payload: { type: 'get_settings' },
          auth: '',
        });
        zeusWs.send({
          channel: 'claude',
          sessionId: '',
          payload: { type: 'list_claude_sessions' },
          auth: '',
        });
        return;
      }

      if (payload.type === '_disconnected') {
        set({ connected: false });
        return;
      }

      if (payload.type === 'status_update') {
        set({
          powerBlock: payload.powerBlock ?? get().powerBlock,
          websocket: payload.websocket ?? get().websocket,
          tunnel: payload.tunnel !== undefined ? payload.tunnel : get().tunnel,
        });
      }
    });

    // Subscribe to control channel
    const unsubControl = zeusWs.on('control', (envelope: WsEnvelope) => {
      const payload = envelope.payload as { type: string };

      if (payload.type === 'session_started') {
        const p = envelope.payload as SessionStartedPayload;
        set({ activeSessionId: p.sessionId });
      }

      if (payload.type === 'session_list') {
        const p = envelope.payload as SessionListPayload;
        set({ sessions: p.sessions });
      }

      if (payload.type === 'session_updated') {
        const p = envelope.payload as SessionUpdatedPayload;
        set((state) => {
          const exists = state.sessions.find((s) => s.id === p.session.id);
          if (exists) {
            return {
              sessions: state.sessions.map((s) => (s.id === p.session.id ? p.session : s)),
            };
          }
          return { sessions: [...state.sessions, p.session] };
        });
      }
    });

    // Subscribe to claude channel
    const unsubClaude = zeusWs.on('claude', (envelope: WsEnvelope) => {
      const payload = envelope.payload as { type: string };
      const sid = envelope.sessionId;

      if (payload.type === 'claude_session_list') {
        const { sessions } = envelope.payload as { sessions: ClaudeSessionInfo[] };
        set((state) => {
          // Keep any live sessions from current state, add historical from DB
          const liveIds = new Set(
            state.claudeSessions.filter((s) => s.status === 'running').map((s) => s.id),
          );
          const merged = [
            ...state.claudeSessions.filter((s) => liveIds.has(s.id)),
            ...sessions.filter((s) => !liveIds.has(s.id)),
          ];
          return { claudeSessions: merged };
        });
        return;
      }

      if (payload.type === 'claude_history') {
        const { entries } = envelope.payload as { entries: NormalizedEntry[] };
        set((state) => ({
          claudeEntries: { ...state.claudeEntries, [sid]: entries },
        }));
        return;
      }

      if (payload.type === 'entry') {
        const entry = (envelope.payload as { entry: NormalizedEntry }).entry;
        set((state) => {
          const existing = state.claudeEntries[sid] ?? [];
          // Check if this is a streaming update (same id = replace)
          const idx = existing.findIndex((e) => e.id === entry.id);
          const updated =
            idx >= 0
              ? [...existing.slice(0, idx), entry, ...existing.slice(idx + 1)]
              : [...existing, entry];
          return { claudeEntries: { ...state.claudeEntries, [sid]: updated } };
        });
      }

      if (payload.type === 'claude_session_id') {
        const { claudeSessionId } = envelope.payload as { claudeSessionId: string };
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, claudeSessionId } : s,
          ),
        }));
      }

      if (payload.type === 'approval_needed') {
        const approval = envelope.payload as {
          approvalId: string;
          toolName: string;
          toolInput: unknown;
          toolUseId?: string;
        };
        set((state) => ({
          pendingApprovals: [
            ...state.pendingApprovals,
            {
              approvalId: approval.approvalId,
              sessionId: sid,
              toolName: approval.toolName,
              toolInput: approval.toolInput,
              toolUseId: approval.toolUseId,
            },
          ],
        }));
      }

      if (payload.type === 'done') {
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'done' as const } : s,
          ),
          pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
        }));
      }

      if (payload.type === 'error') {
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'error' as const } : s,
          ),
        }));
      }
    });

    // Subscribe to settings channel
    const unsubSettings = zeusWs.on('settings', (envelope: WsEnvelope) => {
      const payload = envelope.payload as SettingsPayload;
      if (payload.type === 'settings_update') {
        const s = (payload as { settings: ZeusSettings }).settings;
        set({
          savedProjects: s.savedProjects,
          claudeDefaults: s.claudeDefaults,
          lastUsedProjectId: s.lastUsedProjectId,
          settingsError: null,
        });
      }
      if (payload.type === 'settings_error') {
        const { message } = payload as { message: string };
        set({ settingsError: message });
      }
    });

    // Subscribe to git channel
    const unsubGit = zeusWs.on('git', (envelope: WsEnvelope) => {
      const payload = envelope.payload as GitPayload;
      const sid = envelope.sessionId;

      if (payload.type === 'git_status') {
        set((state) => ({
          gitStatus: { ...state.gitStatus, [sid]: payload.data },
          gitErrors: { ...state.gitErrors, [sid]: undefined as unknown as string },
        }));
        // Auto-open right panel on first status
        if (!get().rightPanelOpen && payload.data.changes.length > 0) {
          set({ rightPanelOpen: true });
        }
      }

      if (payload.type === 'git_commit_result') {
        if (!payload.success && payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
      }

      if (payload.type === 'git_error') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: payload.message },
        }));
      }

      if (payload.type === 'not_a_repo') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: 'Not a git repository' },
        }));
      }
    });

    zeusWs.connect();

    // Return cleanup function
    return () => {
      unsubStatus();
      unsubControl();
      unsubClaude();
      unsubSettings();
      unsubGit();
      zeusWs.disconnect();
      set({ connected: false });
    };
  },

  togglePower: () => {
    zeusWs.send({
      channel: 'status',
      sessionId: '',
      payload: { type: 'toggle_power' },
      auth: '',
    });
  },

  fetchSessions: () => {
    zeusWs.send({
      channel: 'control',
      sessionId: '',
      payload: { type: 'list_sessions' },
      auth: '',
    });
  },

  startSession: (cols?: number, rows?: number) => {
    set({ viewMode: 'terminal' });
    zeusWs.send({
      channel: 'control',
      sessionId: '',
      payload: { type: 'start_session', cols, rows },
      auth: '',
    });
  },

  stopSession: (sessionId: string) => {
    zeusWs.send({
      channel: 'control',
      sessionId,
      payload: { type: 'stop_session' },
      auth: '',
    });
  },

  selectSession: (sessionId: string | null) => {
    set({ activeSessionId: sessionId, viewMode: 'terminal' });
  },

  // --- Claude actions ---

  startClaudeSession: (config) => {
    const {
      prompt,
      workingDir,
      sessionName,
      permissionMode,
      model,
      notificationSound,
      enableGitWatcher,
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
      workingDir,
      startedAt: Date.now(),
    };

    // Add optimistic user message entry for the initial prompt
    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content: prompt,
    };

    set((state) => ({
      claudeSessions: [...state.claudeSessions, session],
      activeClaudeId: id,
      claudeEntries: { ...state.claudeEntries, [id]: [userEntry] },
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
      },
      auth: '',
    });
  },

  sendClaudeMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

    // Add optimistic user message entry
    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content,
    };
    set((state) => ({
      claudeEntries: {
        ...state.claudeEntries,
        [activeClaudeId]: [...(state.claudeEntries[activeClaudeId] ?? []), userEntry],
      },
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'send_message', content },
      auth: '',
    });
  },

  approveClaudeTool: (approvalId: string) => {
    const approval = get().pendingApprovals.find((a) => a.approvalId === approvalId);
    if (!approval) return;

    zeusWs.send({
      channel: 'claude',
      sessionId: approval.sessionId,
      payload: { type: 'approve_tool', approvalId },
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

  selectClaudeSession: (id: string | null) => {
    set({ activeClaudeId: id, viewMode: id ? 'claude' : get().viewMode });
    // Lazy-load entries from DB if not already loaded
    if (id && (!get().claudeEntries[id] || get().claudeEntries[id].length === 0)) {
      zeusWs.send({
        channel: 'claude',
        sessionId: id,
        payload: { type: 'get_claude_history' },
        auth: '',
      });
    }
  },

  setViewMode: (mode: ViewMode) => {
    set({ viewMode: mode });
  },

  // --- Modal actions ---

  openNewClaudeModal: () => set({ showNewClaudeModal: true }),
  closeNewClaudeModal: () => set({ showNewClaudeModal: false }),

  // --- Git actions ---

  startGitWatching: (sessionId: string, workingDir: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'start_watching', workingDir },
      auth: '',
    });
  },

  stopGitWatching: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'stop_watching' },
      auth: '',
    });
  },

  refreshGitStatus: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'refresh' },
      auth: '',
    });
  },

  commitChanges: (sessionId: string, message: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_commit', message },
      auth: '',
    });
  },

  // --- Right panel actions ---

  toggleRightPanel: () => {
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen }));
  },

  setRightPanelTab: (tab: 'source-control' | 'file-explorer') => {
    set({ rightPanelTab: tab });
  },

  // --- Settings actions ---

  addProject: (name: string, path: string) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'add_project', name, path },
      auth: '',
    });
  },

  removeProject: (id: string) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'remove_project', id },
      auth: '',
    });
  },

  updateDefaults: (defaults: Partial<ClaudeDefaults>) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'update_defaults', defaults },
      auth: '',
    });
  },
}));
