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
  FilesPayload,
  FileTreeEntry,
  SessionActivity,
  QaPayload,
  QaInstanceInfo,
  QaTabInfo,
  QaSnapshotNode,
  QaAgentLogEntry,
  QaAgentSessionInfo,
  SystemMetrics,
  PerfPayload,
  ThemeMeta,
  ThemeFile,
} from '../../../shared/types';

type ViewMode = 'terminal' | 'claude' | 'diff';

interface QaAgentClient {
  info: QaAgentSessionInfo;
  entries: QaAgentLogEntry[];
}

interface DiffTab {
  id: string;                   // unique: `${sessionId}:${file}`
  sessionId: string;
  file: string;
  staged: boolean;
  original: string;
  modified: string;
  language: string;
  isDirty: boolean;
  mode: 'diff' | 'edit';       // 'diff' for git diffs, 'edit' for file explorer
}

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
  sessionActivity: Record<string, SessionActivity>;
  messageQueue: Record<string, Array<{ id: string; content: string }>>;

  // Git
  gitStatus: Record<string, GitStatusData>;
  gitErrors: Record<string, string>;
  gitWatcherConnected: Record<string, boolean>;
  gitNotARepo: Record<string, boolean>;

  // File tree
  fileTree: Record<string, Record<string, FileTreeEntry[]>>;  // sessionId → dirPath → entries
  fileTreeExpanded: Record<string, string[]>;                  // sessionId → expanded paths
  fileTreeConnected: Record<string, boolean>;

  // Settings
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  settingsError: string | null;

  // Themes
  themes: ThemeMeta[];
  activeThemeId: string;
  activeThemeColors: Record<string, string> | null;

  // New Claude session modal
  showNewClaudeModal: boolean;

  // View mode
  viewMode: ViewMode;

  // QA / PinchTab
  qaRunning: boolean;
  qaInstances: QaInstanceInfo[];
  qaSnapshot: QaSnapshotNode[] | null;
  qaSnapshotRaw: string | null;
  qaScreenshot: string | null;
  qaText: string | null;
  qaError: string | null;
  qaLoading: boolean;
  qaTabs: QaTabInfo[];
  qaCurrentUrl: string;
  qaConsoleLogs: Array<{ level: string; message: string; timestamp: number }>;
  qaNetworkRequests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string }>;
  qaJsErrors: Array<{ message: string; stack: string; timestamp: number }>;

  // QA Agent — keyed by parentSessionId → multiple agents
  qaAgents: Record<string, QaAgentClient[]>;        // parentSessionId → agents
  activeQaAgentId: Record<string, string | null>;   // parentSessionId → selected qaAgentId

  // Performance monitoring
  perfMetrics: SystemMetrics | null;
  perfMonitoring: boolean;

  // Right panel
  activeRightTab: 'source-control' | 'explorer' | 'qa' | 'info' | 'settings' | null;

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  toggleTunnel: () => void;
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
    enableQA?: boolean;
    qaTargetUrl?: string;
  }) => void;
  sendClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  approveClaudeTool: (approvalId: string, updatedInput?: Record<string, unknown>) => void;
  denyClaudeTool: (approvalId: string, reason?: string) => void;
  interruptClaude: () => void;
  stopClaude: () => void;
  selectClaudeSession: (id: string | null) => void;
  resumeClaudeSession: (id: string, prompt?: string) => void;
  queueMessage: (content: string) => void;
  editQueuedMessage: (msgId: string, content: string) => void;
  removeQueuedMessage: (msgId: string) => void;
  updateClaudeSession: (id: string, updates: { name?: string; color?: string | null }) => void;
  deleteClaudeSession: (id: string) => void;
  archiveClaudeSession: (id: string) => void;
  deleteTerminalSession: (id: string) => void;
  archiveTerminalSession: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;

  // Modal actions
  openNewClaudeModal: () => void;
  closeNewClaudeModal: () => void;

  // Git actions
  startGitWatching: (sessionId: string, workingDir: string) => void;
  stopGitWatching: (sessionId: string) => void;
  refreshGitStatus: (sessionId: string) => void;
  stageFiles: (sessionId: string, files: string[]) => void;
  unstageFiles: (sessionId: string, files: string[]) => void;
  stageAll: (sessionId: string) => void;
  unstageAll: (sessionId: string) => void;
  discardFiles: (sessionId: string, files: string[]) => void;
  commitChanges: (sessionId: string, message: string) => void;
  initGitRepo: (sessionId: string, workingDir: string) => void;

  // Diff tab state
  openDiffTabs: DiffTab[];
  activeDiffTabId: string | null;
  previousViewMode: 'terminal' | 'claude';

  // Diff tab actions
  openDiffTab: (sessionId: string, file: string, staged: boolean) => void;
  openApprovalDiff: (sessionId: string, filePath: string, original: string, modified: string) => void;
  closeDiffTab: (tabId: string) => void;
  closeAllDiffTabs: () => void;
  setActiveDiffTab: (tabId: string) => void;
  updateDiffContent: (tabId: string, content: string) => void;
  saveDiffFile: (tabId: string) => void;
  returnToHome: () => void;

  // File tree actions
  toggleFileTreeDir: (sessionId: string, dirPath: string) => void;
  openFileTab: (sessionId: string, filePath: string) => void;
  saveFileTab: (tabId: string) => void;

  // Watcher reconnect
  reconnectGitWatcher: () => void;
  reconnectFileWatcher: () => void;

  // QA actions
  startQA: () => void;
  stopQA: () => void;
  launchQAInstance: (headless?: boolean) => void;
  stopQAInstance: (instanceId: string) => void;
  navigateQA: (url: string) => void;
  takeSnapshot: (filter?: 'interactive' | 'full') => void;
  takeScreenshot: () => void;
  performQAAction: (kind: string, ref?: string, value?: string, key?: string) => void;
  extractQAText: () => void;
  fetchQATabs: () => void;
  clearQAError: () => void;

  // QA Agent actions
  startQAAgent: (task: string, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', targetUrl?: string, name?: string) => void;
  stopQAAgent: (qaAgentId: string) => void;
  deleteQAAgent: (qaAgentId: string, parentSessionId: string) => void;
  sendQAAgentMessage: (qaAgentId: string, text: string) => void;
  clearQAAgentEntries: (qaAgentId: string) => void;
  selectQaAgent: (parentSessionId: string, qaAgentId: string | null) => void;
  fetchQaAgents: (parentSessionId: string) => void;
  fetchQaAgentEntries: (qaAgentId: string) => void;

  // Right panel actions
  setActiveRightTab: (tab: 'source-control' | 'explorer' | 'qa' | 'info' | 'settings' | null) => void;
  toggleRightPanel: () => void;

  // Performance actions
  startPerfMonitoring: () => void;
  stopPerfMonitoring: () => void;
  setPerfPollInterval: (intervalMs: number) => void;

  // Settings actions
  addProject: (name: string, path: string, createDir?: boolean) => void;
  removeProject: (id: string) => void;
  updateDefaults: (defaults: Partial<ClaudeDefaults>) => void;

  // Theme actions
  setTheme: (themeId: string) => void;
  refreshThemes: () => void;
  openThemesFolder: () => void;
}

let claudeIdCounter = 0;
let drainInFlight: Record<string, boolean> = {};

/**
 * Drain the next queued message for a session.
 * Called when a session becomes idle or done.
 * - If session is still alive (idle activity), sends via send_message
 * - If session process exited (done), resumes via resume_claude
 * Returns true if a message was drained.
 */
function drainQueue(
  sid: string,
  reason: 'idle' | 'done',
  get: () => ZeusState,
  set: (fn: (state: ZeusState) => Partial<ZeusState>) => void,
): boolean {
  if (drainInFlight[sid]) return false;

  const queue = get().messageQueue[sid];
  if (!queue || queue.length === 0) return false;

  const session = get().claudeSessions.find((s) => s.id === sid);
  if (!session) return false;

  const next = queue[0];
  drainInFlight[sid] = true;

  // Remove from queue + add optimistic user entry
  const userEntry: NormalizedEntry = {
    id: `user-${Date.now()}`,
    entryType: { type: 'user_message' },
    content: next.content,
    timestamp: new Date().toISOString(),
  };

  if (reason === 'idle') {
    // Session process is alive — send follow-up directly
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sid]: (state.messageQueue[sid] ?? []).slice(1),
      },
      claudeEntries: {
        ...state.claudeEntries,
        [sid]: [...(state.claudeEntries[sid] ?? []), userEntry],
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: sid,
      payload: { type: 'send_message', content: next.content },
      auth: '',
    });
  } else {
    // Session process exited — resume with queued message
    if (!session.claudeSessionId) {
      drainInFlight[sid] = false;
      return false;
    }
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sid]: (state.messageQueue[sid] ?? []).slice(1),
      },
      claudeSessions: state.claudeSessions.map((s) =>
        s.id === sid ? { ...s, status: 'running' as const } : s,
      ),
      sessionActivity: { ...state.sessionActivity, [sid]: { state: 'starting' } },
      claudeEntries: {
        ...state.claudeEntries,
        [sid]: [...(state.claudeEntries[sid] ?? []), userEntry],
      },
    }));
    zeusWs.send({
      channel: 'claude',
      sessionId: sid,
      payload: {
        type: 'resume_claude',
        claudeSessionId: session.claudeSessionId,
        prompt: next.content,
        workingDir: session.workingDir || '/',
      },
      auth: '',
    });
  }

  // Clear in-flight after a short delay to allow server to process
  setTimeout(() => { drainInFlight[sid] = false; }, 500);
  return true;
}

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
  sessionActivity: {},
  messageQueue: {},

  gitStatus: {},
  gitErrors: {},
  gitWatcherConnected: {},
  gitNotARepo: {},
  openDiffTabs: [],
  activeDiffTabId: null,
  previousViewMode: 'terminal' as const,

  fileTree: {},
  fileTreeExpanded: {},
  fileTreeConnected: {},

  qaRunning: false,
  qaInstances: [],
  qaSnapshot: null,
  qaSnapshotRaw: null,
  qaScreenshot: null,
  qaText: null,
  qaError: null,
  qaLoading: false,
  qaTabs: [],
  qaCurrentUrl: 'http://localhost:5173',
  qaConsoleLogs: [],
  qaNetworkRequests: [],
  qaJsErrors: [],

  qaAgents: {},
  activeQaAgentId: {},


  perfMetrics: null,
  perfMonitoring: false,

  savedProjects: [],
  claudeDefaults: {
    permissionMode: 'bypassPermissions',
    model: '',
    notificationSound: true,
  },
  lastUsedProjectId: null,
  settingsError: null,
  themes: [],
  activeThemeId: 'zeus-dark',
  activeThemeColors: null,
  showNewClaudeModal: false,

  viewMode: 'terminal',

  activeRightTab: null,

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

        // Fetch QA agents for the active terminal session on reconnect
        const activeTermId = get().activeSessionId;
        if (activeTermId) {
          zeusWs.send({
            channel: 'qa', sessionId: '', auth: '',
            payload: { type: 'list_qa_agents', parentSessionId: activeTermId },
          });
        }
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

      if (payload.type === 'terminal_session_deleted') {
        const { deletedId } = envelope.payload as { deletedId: string };
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== deletedId),
          activeSessionId: state.activeSessionId === deletedId ? null : state.activeSessionId,
        }));
      }

      if (payload.type === 'terminal_session_archived') {
        const { archivedId } = envelope.payload as { archivedId: string };
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== archivedId),
          activeSessionId: state.activeSessionId === archivedId ? null : state.activeSessionId,
        }));
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

        let activeId = get().activeClaudeId;

        // Auto-select the most recent session if none is active
        if (!activeId && sessions.length > 0) {
          // Prefer a running session, then most recent by startedAt
          const running = sessions.find((s) => s.status === 'running');
          const mostRecent = running ?? sessions.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
          activeId = mostRecent.id;
          set({ activeClaudeId: activeId, viewMode: 'claude' });
          // Lazy-load entries from DB for the auto-selected session
          zeusWs.send({
            channel: 'claude',
            sessionId: activeId,
            payload: { type: 'get_claude_history' },
            auth: '',
          });
        }

        // Only request state for the active session (watchers are already alive on backend)
        const activeSession = sessions.find((s) => s.id === activeId && s.workingDir);
        if (activeSession) {
          zeusWs.send({
            channel: 'git',
            sessionId: activeSession.id,
            payload: { type: 'start_watching', workingDir: activeSession.workingDir! },
            auth: '',
          });
          zeusWs.send({
            channel: 'files',
            sessionId: activeSession.id,
            payload: { type: 'start_watching', workingDir: activeSession.workingDir! },
            auth: '',
          });
        }

        // Fetch QA agents for the active session on reconnect
        if (activeId) {
          zeusWs.send({
            channel: 'qa', sessionId: '', auth: '',
            payload: { type: 'list_qa_agents', parentSessionId: activeId },
          });
        }
        return;
      }

      if (payload.type === 'claude_history') {
        const { entries } = envelope.payload as { entries: NormalizedEntry[] };
        set((state) => ({
          claudeEntries: { ...state.claudeEntries, [sid]: entries },
        }));
        return;
      }

      if (payload.type === 'claude_started') {
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: { state: 'starting' } },
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'running' as const } : s,
          ),
        }));
      }

      if (payload.type === 'turn_complete') {
        // Turn finished — session stays alive for follow-ups.
        // Activity will be set to idle by the session_activity event.
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

      if (payload.type === 'session_activity') {
        const { activity } = envelope.payload as { activity: SessionActivity };
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: activity },
        }));

        // Auto-drain queued messages when session becomes idle
        if (activity.state === 'idle') {
          drainQueue(sid, 'idle', get, set);
        }
      }

      if (payload.type === 'done') {
        // Try to drain queue first — if there are queued messages, auto-resume
        const drained = drainQueue(sid, 'done', get, set);
        if (!drained) {
          set((state) => ({
            claudeSessions: state.claudeSessions.map((s) =>
              s.id === sid ? { ...s, status: 'done' as const } : s,
            ),
            pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
            sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
          }));
        }
      }

      if (payload.type === 'error') {
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'error' as const } : s,
          ),
          sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
        }));
      }

      if (payload.type === 'claude_session_deleted') {
        const { deletedId } = envelope.payload as { deletedId: string };
        set((state) => ({
          claudeSessions: state.claudeSessions.filter((s) => s.id !== deletedId),
          claudeEntries: Object.fromEntries(
            Object.entries(state.claudeEntries).filter(([k]) => k !== deletedId),
          ),
          pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== deletedId),
          activeClaudeId: state.activeClaudeId === deletedId ? null : state.activeClaudeId,
        }));
      }

      if (payload.type === 'claude_session_archived') {
        const { archivedId } = envelope.payload as { archivedId: string };
        set((state) => ({
          claudeSessions: state.claudeSessions.filter((s) => s.id !== archivedId),
          pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== archivedId),
          activeClaudeId: state.activeClaudeId === archivedId ? null : state.activeClaudeId,
        }));
      }

      if (payload.type === 'claude_session_updated') {
        const { sessionId, name, color } = envelope.payload as { sessionId: string; name?: string; color?: string | null };
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  ...(name !== undefined ? { name } : {}),
                  ...(color !== undefined ? { color: color ?? undefined } : {}),
                }
              : s,
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
          activeThemeId: s.activeThemeId,
          themes: s.themes,
          settingsError: null,
        });
      }
      if (payload.type === 'theme_colors') {
        const theme = (payload as { theme: ThemeFile }).theme;
        const root = document.documentElement;
        for (const [key, value] of Object.entries(theme.colors)) {
          root.style.setProperty(`--color-${key}`, value);
        }
        if (theme.type === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        set({ activeThemeColors: theme.colors });
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

      // Always track connection state for all sessions
      if (payload.type === 'git_connected') {
        set((state) => ({
          gitWatcherConnected: { ...state.gitWatcherConnected, [sid]: true },
        }));
      }

      if (payload.type === 'git_disconnected') {
        set((state) => ({
          gitWatcherConnected: { ...state.gitWatcherConnected, [sid]: false },
        }));
      }

      if (payload.type === 'not_a_repo') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: 'Not a git repository' },
          gitWatcherConnected: { ...state.gitWatcherConnected, [sid]: false },
          gitNotARepo: { ...state.gitNotARepo, [sid]: true },
        }));
      }

      if (payload.type === 'git_init_result') {
        if (payload.success) {
          set((state) => ({
            gitNotARepo: { ...state.gitNotARepo, [sid]: false },
            gitErrors: { ...state.gitErrors, [sid]: undefined as unknown as string },
          }));
        } else {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error ?? 'Failed to initialize git' },
          }));
        }
      }

      // Only process detailed events for the active session
      if (sid !== get().activeClaudeId) return;

      if (payload.type === 'git_heartbeat') {
        const current = get().gitWatcherConnected[sid];
        if (!current) {
          set((state) => ({
            gitWatcherConnected: { ...state.gitWatcherConnected, [sid]: true },
          }));
        }
      }

      if (payload.type === 'git_status') {
        set((state) => ({
          gitStatus: { ...state.gitStatus, [sid]: payload.data },
          gitErrors: { ...state.gitErrors, [sid]: undefined as unknown as string },
          gitWatcherConnected: { ...state.gitWatcherConnected, [sid]: true },
          gitNotARepo: { ...state.gitNotARepo, [sid]: false },
        }));
        // Auto-open right panel on first status with changes
        const totalChanges = payload.data.staged.length + payload.data.unstaged.length;
        if (!get().activeRightTab && totalChanges > 0) {
          set({ activeRightTab: 'source-control' });
        }
      }

      if (payload.type === 'git_file_contents_result') {
        const tabId = `${sid}:${payload.file}`;
        const existing = get().openDiffTabs.find((t) => t.id === tabId);
        if (existing) {
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === tabId
                ? { ...t, staged: payload.staged, original: payload.original, modified: payload.modified, language: payload.language, isDirty: false }
                : t,
            ),
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
          }));
        } else {
          const newTab: DiffTab = {
            id: tabId,
            sessionId: sid,
            file: payload.file,
            staged: payload.staged,
            original: payload.original,
            modified: payload.modified,
            language: payload.language,
            isDirty: false,
            mode: 'diff',
          };
          set((state) => ({
            openDiffTabs: [...state.openDiffTabs, newTab],
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
            previousViewMode:
              state.viewMode !== 'diff'
                ? (state.viewMode as 'terminal' | 'claude')
                : state.previousViewMode,
          }));
        }
      }

      if (payload.type === 'git_file_contents_error') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: payload.error },
        }));
      }

      if (payload.type === 'git_save_file_result') {
        const saveTabId = `${sid}:${payload.file}`;
        if (payload.success) {
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === saveTabId ? { ...t, isDirty: false } : t,
            ),
          }));
        } else if (payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
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
    });

    // Subscribe to files channel
    const unsubFiles = zeusWs.on('files', (envelope: WsEnvelope) => {
      const payload = envelope.payload as FilesPayload;
      const sid = envelope.sessionId;

      // Always track connection state for all sessions
      if (payload.type === 'files_connected') {
        set((state) => ({
          fileTreeConnected: { ...state.fileTreeConnected, [sid]: true },
        }));
      }

      // Only process detailed events for the active session
      if (sid !== get().activeClaudeId) return;

      if (payload.type === 'directory_listing') {
        set((state) => ({
          fileTree: {
            ...state.fileTree,
            [sid]: {
              ...(state.fileTree[sid] || {}),
              [payload.dirPath]: payload.entries,
            },
          },
        }));
      }

      if (payload.type === 'files_changed') {
        // Re-fetch expanded directories
        const expanded = get().fileTreeExpanded[sid] || [];
        // Always re-fetch root
        const dirsToRefresh = ['', ...expanded.filter((d) => payload.directories.includes(d) || payload.directories.some((changed) => changed.startsWith(d)))];
        const unique = [...new Set(dirsToRefresh)];
        for (const dirPath of unique) {
          zeusWs.send({
            channel: 'files',
            sessionId: sid,
            payload: { type: 'list_directory', dirPath },
            auth: '',
          });
        }
      }

      if (payload.type === 'read_file_result') {
        const tabId = `${sid}:edit:${payload.filePath}`;
        const existing = get().openDiffTabs.find((t) => t.id === tabId);
        if (existing) {
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === tabId
                ? { ...t, original: payload.content, modified: payload.content, language: payload.language, isDirty: false }
                : t,
            ),
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
          }));
        } else {
          const newTab: DiffTab = {
            id: tabId,
            sessionId: sid,
            file: payload.filePath,
            staged: false,
            original: payload.content,
            modified: payload.content,
            language: payload.language,
            isDirty: false,
            mode: 'edit',
          };
          set((state) => ({
            openDiffTabs: [...state.openDiffTabs, newTab],
            activeDiffTabId: tabId,
            viewMode: 'diff' as ViewMode,
            previousViewMode:
              state.viewMode !== 'diff'
                ? (state.viewMode as 'terminal' | 'claude')
                : state.previousViewMode,
          }));
        }
      }

      if (payload.type === 'read_file_error') {
        console.error(`[files] read error: ${payload.error}`);
      }

      if (payload.type === 'save_file_result') {
        const saveTabId = `${sid}:edit:${payload.filePath}`;
        if (payload.success) {
          set((state) => ({
            openDiffTabs: state.openDiffTabs.map((t) =>
              t.id === saveTabId ? { ...t, isDirty: false, original: t.modified } : t,
            ),
          }));
        }
      }

      if (payload.type === 'files_error') {
        console.error(`[files] error: ${payload.message}`);
      }
    });

    // Subscribe to QA channel
    const unsubQA = zeusWs.on('qa', (envelope: WsEnvelope) => {
      const payload = envelope.payload as QaPayload;

      if (payload.type === 'qa_started') {
        set({ qaRunning: true, qaLoading: false, qaError: null });
      }
      if (payload.type === 'qa_stopped') {
        set({
          qaRunning: false, qaInstances: [], qaTabs: [],
          qaSnapshot: null, qaSnapshotRaw: null, qaScreenshot: null,
          qaText: null, qaLoading: false, qaError: null,
          qaCurrentUrl: 'http://localhost:5173',
          qaConsoleLogs: [], qaNetworkRequests: [], qaJsErrors: [],
          qaAgents: {}, activeQaAgentId: {},
        });
      }
      if (payload.type === 'qa_status') {
        set({ qaRunning: payload.running, qaInstances: payload.instances, qaLoading: false });
      }
      if (payload.type === 'instance_launched') {
        set((state) => ({
          qaInstances: [...state.qaInstances, payload.instance],
          qaLoading: false, qaError: null,
        }));
      }
      if (payload.type === 'instance_stopped') {
        set((state) => ({
          qaInstances: state.qaInstances.filter((i) => i.instanceId !== payload.instanceId),
          qaLoading: false,
        }));
      }
      if (payload.type === 'navigate_result') {
        set({
          qaLoading: false,
          qaError: null,
          ...(payload.url ? { qaCurrentUrl: payload.url } : {}),
        });
      }
      if (payload.type === 'snapshot_result') {
        set({ qaSnapshot: payload.nodes, qaSnapshotRaw: payload.raw ?? null, qaLoading: false, qaError: null });
      }
      if (payload.type === 'screenshot_result') {
        set({ qaScreenshot: payload.dataUrl, qaLoading: false, qaError: null });
      }
      if (payload.type === 'text_result') {
        set({ qaText: payload.text, qaLoading: false, qaError: null });
      }
      if (payload.type === 'action_result') {
        set({ qaLoading: false, qaError: payload.success ? null : (payload.message ?? 'Action failed') });
        // Auto-refresh snapshot after successful action
        if (payload.success) {
          get().takeSnapshot('interactive');
        }
      }
      if (payload.type === 'tabs_list') {
        set({ qaTabs: payload.tabs, qaLoading: false });
      }
      if (payload.type === 'qa_error') {
        set({ qaError: payload.message, qaLoading: false });
      }
      if (payload.type === 'cdp_console') {
        set((state) => ({
          qaConsoleLogs: [...state.qaConsoleLogs, ...payload.logs].slice(-500),
        }));
      }
      if (payload.type === 'cdp_network') {
        set((state) => ({
          qaNetworkRequests: [...state.qaNetworkRequests, ...payload.requests].slice(-500),
        }));
      }
      if (payload.type === 'cdp_error') {
        set((state) => ({
          qaJsErrors: [...state.qaJsErrors, ...payload.errors].slice(-500),
        }));
      }
      if (payload.type === 'qa_agent_started') {
        const { qaAgentId, parentSessionId, parentSessionType, name, task, targetUrl } = payload;
        const newAgent: QaAgentClient = {
          info: { qaAgentId, parentSessionId, parentSessionType, name, task, targetUrl, status: 'running', startedAt: Date.now() },
          entries: [],
        };
        set((state) => ({
          qaAgents: {
            ...state.qaAgents,
            [parentSessionId]: [...(state.qaAgents[parentSessionId] ?? []), newAgent],
          },
          activeQaAgentId: {
            ...state.activeQaAgentId,
            [parentSessionId]: qaAgentId,
          },
        }));
      }
      if (payload.type === 'qa_agent_stopped') {
        const { qaAgentId, parentSessionId } = payload;
        set((state) => {
          const agents = (state.qaAgents[parentSessionId] ?? []).map((a) =>
            a.info.qaAgentId === qaAgentId ? { ...a, info: { ...a.info, status: 'stopped' as const } } : a,
          );
          return { qaAgents: { ...state.qaAgents, [parentSessionId]: agents } };
        });
      }
      if (payload.type === 'qa_agent_deleted') {
        const { qaAgentId, parentSessionId } = payload;
        set((state) => {
          const agents = (state.qaAgents[parentSessionId] ?? []).filter((a) => a.info.qaAgentId !== qaAgentId);
          const activeId = state.activeQaAgentId[parentSessionId];
          const newActiveId = activeId === qaAgentId
            ? (agents.length > 0 ? agents[agents.length - 1].info.qaAgentId : null)
            : activeId;
          return {
            qaAgents: { ...state.qaAgents, [parentSessionId]: agents },
            activeQaAgentId: { ...state.activeQaAgentId, [parentSessionId]: newActiveId },
          };
        });
      }
      if (payload.type === 'qa_agent_entry') {
        const { qaAgentId, parentSessionId, entry } = payload;
        set((state) => {
          const agents = (state.qaAgents[parentSessionId] ?? []).map((a) =>
            a.info.qaAgentId === qaAgentId
              ? { ...a, entries: [...a.entries, entry].slice(-500) }
              : a,
          );
          return { qaAgents: { ...state.qaAgents, [parentSessionId]: agents } };
        });
      }
      if (payload.type === 'qa_agent_list') {
        const { parentSessionId, agents } = payload;
        set((state) => {
          // Merge server list with any existing entries we may have
          const existing = state.qaAgents[parentSessionId] ?? [];
          const merged = agents.map((info) => {
            const found = existing.find((a) => a.info.qaAgentId === info.qaAgentId);
            return found ? { ...found, info } : { info, entries: [] };
          });
          return { qaAgents: { ...state.qaAgents, [parentSessionId]: merged } };
        });
      }
      if (payload.type === 'qa_agent_entries') {
        const { qaAgentId, entries } = payload;
        set((state) => {
          // Find the agent across all parent sessions and load its entries
          const updated = { ...state.qaAgents };
          for (const parentId of Object.keys(updated)) {
            updated[parentId] = updated[parentId].map((a) =>
              a.info.qaAgentId === qaAgentId ? { ...a, entries } : a,
            );
          }
          return { qaAgents: updated };
        });
      }
    });

    // Subscribe to perf channel
    const unsubPerf = zeusWs.on('perf', (envelope: WsEnvelope) => {
      const payload = envelope.payload as PerfPayload;
      if (payload.type === 'perf_update') {
        set({ perfMetrics: payload.metrics, perfMonitoring: true });
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
      unsubFiles();
      unsubQA();
      unsubPerf();
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

  toggleTunnel: () => {
    zeusWs.send({
      channel: 'status',
      sessionId: '',
      payload: { type: 'toggle_tunnel' },
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
    const state = get();
    // If in diff view, revert since terminal sessions don't own file tabs
    if (state.viewMode === 'diff') {
      set({ activeSessionId: sessionId, activeClaudeId: null, viewMode: 'terminal' });
    } else {
      set({ activeSessionId: sessionId, viewMode: 'terminal' });
    }
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
      enableQA,
      qaTargetUrl,
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

    // Add optimistic user message entry for the initial prompt
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
      sessionActivity: { ...state.sessionActivity, [id]: { state: 'starting' } },
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
      },
      auth: '',
    });

    // Explicitly request git and file tree watchers from frontend side
    // so we don't rely solely on backend auto-start (which has race conditions)
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

    // Build metadata for optimistic entry
    const meta: Record<string, unknown> = {};
    if (files && files.length > 0) meta.files = files;
    if (images && images.length > 0) meta.images = images.map((img) => ({ filename: img.filename, dataUrl: img.dataUrl }));

    // Add optimistic user message entry (display original content, not file contents)
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
      sessionActivity: { ...state.sessionActivity, [activeClaudeId]: { state: 'starting' } },
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: activeClaudeId,
      payload: { type: 'send_message', content, files, images },
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

    // Strip any stacked "(resumed)" suffixes to get the clean original name
    const originalName = session.name?.replace(/\s*\(resumed\)$/g, '') || session.name;

    // Create a new client session ID but resume the real Claude conversation
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

    set((state) => ({
      claudeSessions: [...state.claudeSessions, newSession],
      activeClaudeId: newId,
      claudeEntries: { ...state.claudeEntries, [newId]: [...existingEntries] },
      sessionActivity: { ...state.sessionActivity, [newId]: { state: 'starting' } },
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

    // Start git/file watchers if enabled
    if (session.enableGitWatcher !== false) {
      zeusWs.send({
        channel: 'git',
        sessionId: newId,
        payload: { type: 'start_watching', workingDir: session.workingDir || '/' },
        auth: '',
      });
      zeusWs.send({
        channel: 'filetree',
        sessionId: newId,
        payload: { type: 'start_watching', workingDir: session.workingDir || '/' },
        auth: '',
      });
    }
  },

  queueMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;
    const msg = { id: `q-${Date.now()}-${Math.random()}`, content };
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [activeClaudeId]: [...(state.messageQueue[activeClaudeId] ?? []), msg],
      },
    }));
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
  },

  selectClaudeSession: (id: string | null) => {
    const state = get();
    let newViewMode: ViewMode = id ? 'claude' : state.viewMode;
    let newActiveDiffTabId = state.activeDiffTabId;

    // If currently in diff view, check if the active tab belongs to the new session
    if (id && state.viewMode === 'diff' && state.activeDiffTabId) {
      const activeTab = state.openDiffTabs.find((t) => t.id === state.activeDiffTabId);
      if (activeTab && activeTab.sessionId !== id) {
        // Active tab belongs to a different session — check if new session has tabs
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
      // Lazy-load entries from DB if not already loaded
      if (!get().claudeEntries[id] || get().claudeEntries[id].length === 0) {
        zeusWs.send({
          channel: 'claude',
          sessionId: id,
          payload: { type: 'get_claude_history' },
          auth: '',
        });
      }
      // Request current git + files state (idempotent — watcher reused if alive)
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

  deleteClaudeSession: (id: string) => {
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'delete_claude_session' },
      auth: '',
    });
  },

  archiveClaudeSession: (id: string) => {
    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'archive_claude_session' },
      auth: '',
    });
  },

  deleteTerminalSession: (id: string) => {
    zeusWs.send({
      channel: 'control',
      sessionId: id,
      payload: { type: 'delete_terminal_session' },
      auth: '',
    });
  },

  archiveTerminalSession: (id: string) => {
    zeusWs.send({
      channel: 'control',
      sessionId: id,
      payload: { type: 'archive_terminal_session' },
      auth: '',
    });
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

  stageFiles: (sessionId: string, files: string[]) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_stage', files },
      auth: '',
    });
  },

  unstageFiles: (sessionId: string, files: string[]) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_unstage', files },
      auth: '',
    });
  },

  stageAll: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_stage_all' },
      auth: '',
    });
  },

  unstageAll: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_unstage_all' },
      auth: '',
    });
  },

  discardFiles: (sessionId: string, files: string[]) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_discard', files },
      auth: '',
    });
  },

  openDiffTab: (sessionId: string, file: string, staged: boolean) => {
    const tabId = `${sessionId}:${file}`;
    const existing = get().openDiffTabs.find((t) => t.id === tabId);
    if (existing) {
      set((state) => ({
        activeDiffTabId: tabId,
        viewMode: 'diff' as ViewMode,
        previousViewMode:
          state.viewMode !== 'diff'
            ? (state.viewMode as 'terminal' | 'claude')
            : state.previousViewMode,
      }));
      return;
    }
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_file_contents', file, staged },
      auth: '',
    });
  },

  openApprovalDiff: (sessionId: string, filePath: string, original: string, modified: string) => {
    const tabId = `${sessionId}:approval:${filePath}`;
    const existing = get().openDiffTabs.find((t) => t.id === tabId);
    if (existing) {
      // Update content and switch to it
      set((state) => ({
        openDiffTabs: state.openDiffTabs.map((t) =>
          t.id === tabId ? { ...t, original, modified, isDirty: false } : t,
        ),
        activeDiffTabId: tabId,
        viewMode: 'diff' as ViewMode,
        previousViewMode:
          state.viewMode !== 'diff'
            ? (state.viewMode as 'terminal' | 'claude')
            : state.previousViewMode,
      }));
      return;
    }

    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const extMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
      '.css': 'css', '.html': 'html', '.json': 'json', '.md': 'markdown',
      '.py': 'python', '.rs': 'rust', '.go': 'go', '.yaml': 'yaml', '.yml': 'yaml',
      '.sh': 'shell', '.sql': 'sql', '.xml': 'xml',
    };

    const newTab: DiffTab = {
      id: tabId,
      sessionId,
      file: filePath,
      staged: false,
      original,
      modified,
      language: extMap[ext] || 'plaintext',
      isDirty: false,
      mode: 'diff',
    };

    set((state) => ({
      openDiffTabs: [...state.openDiffTabs, newTab],
      activeDiffTabId: tabId,
      viewMode: 'diff' as ViewMode,
      previousViewMode:
        state.viewMode !== 'diff'
          ? (state.viewMode as 'terminal' | 'claude')
          : state.previousViewMode,
    }));
  },

  closeDiffTab: (tabId: string) => {
    set((state) => {
      const remaining = state.openDiffTabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeDiffTabId;
      let newViewMode = state.viewMode;

      if (state.activeDiffTabId === tabId) {
        // Only consider tabs from the current session for "next tab" logic
        const currentSessionId = state.activeClaudeId ?? state.activeSessionId;
        const sessionTabs = remaining.filter((t) => t.sessionId === currentSessionId);

        if (sessionTabs.length > 0) {
          const closedIdx = state.openDiffTabs.findIndex((t) => t.id === tabId);
          const nextIdx = Math.min(closedIdx, sessionTabs.length - 1);
          newActiveId = sessionTabs[nextIdx].id;
        } else {
          newActiveId = null;
          newViewMode = state.previousViewMode;
        }
      }

      return {
        openDiffTabs: remaining,
        activeDiffTabId: newActiveId,
        viewMode: newViewMode,
      };
    });
  },

  closeAllDiffTabs: () => {
    set((state) => {
      const currentSessionId = state.activeClaudeId ?? state.activeSessionId;
      // Only close tabs belonging to the current session
      const remaining = state.openDiffTabs.filter((t) => t.sessionId !== currentSessionId);
      return {
        openDiffTabs: remaining,
        activeDiffTabId: null,
        viewMode: state.previousViewMode,
      };
    });
  },

  setActiveDiffTab: (tabId: string) => {
    set((state) => ({
      activeDiffTabId: tabId,
      viewMode: 'diff' as ViewMode,
      previousViewMode:
        state.viewMode !== 'diff'
          ? (state.viewMode as 'terminal' | 'claude')
          : state.previousViewMode,
    }));
  },

  updateDiffContent: (tabId: string, content: string) => {
    set((state) => ({
      openDiffTabs: state.openDiffTabs.map((t) =>
        t.id === tabId ? { ...t, modified: content, isDirty: true } : t,
      ),
    }));
  },

  saveDiffFile: (tabId: string) => {
    const tab = get().openDiffTabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.mode === 'edit') {
      // Save via files channel
      zeusWs.send({
        channel: 'files',
        sessionId: tab.sessionId,
        payload: { type: 'save_file', filePath: tab.file, content: tab.modified },
        auth: '',
      });
    } else {
      // Save via git channel (existing behavior)
      zeusWs.send({
        channel: 'git',
        sessionId: tab.sessionId,
        payload: { type: 'git_save_file', file: tab.file, content: tab.modified },
        auth: '',
      });
    }
  },

  returnToHome: () => {
    set((state) => ({
      viewMode: state.previousViewMode,
    }));
  },

  commitChanges: (sessionId: string, message: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_commit', message },
      auth: '',
    });
  },

  initGitRepo: (sessionId: string, workingDir: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_init', workingDir },
      auth: '',
    });
  },

  // --- File tree actions ---

  toggleFileTreeDir: (sessionId: string, dirPath: string) => {
    const expanded = get().fileTreeExpanded[sessionId] || [];
    const isExpanded = expanded.includes(dirPath);

    if (isExpanded) {
      set((state) => ({
        fileTreeExpanded: {
          ...state.fileTreeExpanded,
          [sessionId]: expanded.filter((p) => p !== dirPath),
        },
      }));
    } else {
      set((state) => ({
        fileTreeExpanded: {
          ...state.fileTreeExpanded,
          [sessionId]: [...expanded, dirPath],
        },
      }));
      const cached = get().fileTree[sessionId]?.[dirPath];
      if (!cached) {
        zeusWs.send({
          channel: 'files',
          sessionId,
          payload: { type: 'list_directory', dirPath },
          auth: '',
        });
      }
    }
  },

  openFileTab: (sessionId: string, filePath: string) => {
    const tabId = `${sessionId}:edit:${filePath}`;
    const existing = get().openDiffTabs.find((t) => t.id === tabId);
    if (existing) {
      set((state) => ({
        activeDiffTabId: tabId,
        viewMode: 'diff' as ViewMode,
        previousViewMode:
          state.viewMode !== 'diff'
            ? (state.viewMode as 'terminal' | 'claude')
            : state.previousViewMode,
      }));
      return;
    }
    zeusWs.send({
      channel: 'files',
      sessionId,
      payload: { type: 'read_file', filePath },
      auth: '',
    });
  },

  saveFileTab: (tabId: string) => {
    const tab = get().openDiffTabs.find((t) => t.id === tabId);
    if (!tab || tab.mode !== 'edit') return;
    zeusWs.send({
      channel: 'files',
      sessionId: tab.sessionId,
      payload: { type: 'save_file', filePath: tab.file, content: tab.modified },
      auth: '',
    });
  },

  // --- Watcher reconnect ---

  reconnectGitWatcher: () => {
    const session = get().claudeSessions.find((s) => s.id === get().activeClaudeId);
    if (!session?.workingDir) return;
    zeusWs.send({
      channel: 'git',
      sessionId: session.id,
      payload: { type: 'start_watching', workingDir: session.workingDir },
      auth: '',
    });
  },

  reconnectFileWatcher: () => {
    const session = get().claudeSessions.find((s) => s.id === get().activeClaudeId)
      ?? get().claudeSessions.find((s) => s.workingDir);
    if (!session?.workingDir) return;
    zeusWs.send({
      channel: 'files',
      sessionId: session.id,
      payload: { type: 'start_watching', workingDir: session.workingDir },
      auth: '',
    });
  },

  // --- QA actions ---

  startQA: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'start_qa' }, auth: '' });
  },

  stopQA: () => {
    set({ qaLoading: true });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'stop_qa' }, auth: '' });
  },

  launchQAInstance: (headless?: boolean) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'launch_instance', headless }, auth: '' });
  },

  stopQAInstance: (instanceId: string) => {
    set({ qaLoading: true });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'stop_instance', instanceId }, auth: '' });
  },

  navigateQA: (url: string) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'navigate', url }, auth: '' });
  },

  takeSnapshot: (filter?: 'interactive' | 'full') => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'snapshot', filter }, auth: '' });
  },

  takeScreenshot: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'screenshot' }, auth: '' });
  },

  performQAAction: (kind: string, ref?: string, value?: string, key?: string) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'action', kind, ref, value, key }, auth: '' });
  },

  extractQAText: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'text' }, auth: '' });
  },

  fetchQATabs: () => {
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'list_tabs' }, auth: '' });
  },

  clearQAError: () => {
    set({ qaError: null });
  },

  // --- QA Agent actions ---

  startQAAgent: (task: string, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', targetUrl?: string, name?: string) => {
    set({ qaError: null });
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'start_qa_agent', task, name, workingDir, targetUrl, parentSessionId, parentSessionType },
    });
  },

  stopQAAgent: (qaAgentId: string) => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'stop_qa_agent', qaAgentId },
    });
  },

  deleteQAAgent: (qaAgentId: string, parentSessionId: string) => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'delete_qa_agent', qaAgentId, parentSessionId },
    });
  },

  sendQAAgentMessage: (qaAgentId: string, text: string) => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_message', qaAgentId, text },
    });
  },

  clearQAAgentEntries: (qaAgentId: string) => {
    set((state) => {
      // Find the agent across all parent sessions
      const updated = { ...state.qaAgents };
      for (const [psid, agents] of Object.entries(updated)) {
        const idx = agents.findIndex((a) => a.info.qaAgentId === qaAgentId);
        if (idx !== -1) {
          updated[psid] = agents.map((a) =>
            a.info.qaAgentId === qaAgentId ? { ...a, entries: [] } : a,
          );
          break;
        }
      }
      return { qaAgents: updated };
    });
  },

  selectQaAgent: (parentSessionId: string, qaAgentId: string | null) => {
    set((state) => ({
      activeQaAgentId: { ...state.activeQaAgentId, [parentSessionId]: qaAgentId },
    }));
  },

  fetchQaAgents: (parentSessionId: string) => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'list_qa_agents', parentSessionId },
    });
  },

  fetchQaAgentEntries: (qaAgentId: string) => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'get_qa_agent_entries', qaAgentId },
    });
  },

  // --- Right panel actions ---

  setActiveRightTab: (tab: 'source-control' | 'explorer' | 'qa' | 'info' | 'settings' | null) => {
    set({ activeRightTab: tab });
    // Fetch QA status when switching to QA tab
    if (tab === 'qa') {
      zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'get_qa_status' }, auth: '' });
    }
  },

  toggleRightPanel: () => {
    set((state) => ({ activeRightTab: state.activeRightTab ? null : 'source-control' }));
  },


  // --- Performance actions ---

  startPerfMonitoring: () => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'start_monitoring' },
      auth: '',
    });
    set({ perfMonitoring: true });
  },

  stopPerfMonitoring: () => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'stop_monitoring' },
      auth: '',
    });
    set({ perfMonitoring: false, perfMetrics: null });
  },

  setPerfPollInterval: (intervalMs: number) => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'set_poll_interval', intervalMs },
      auth: '',
    });
  },

  // --- Settings actions ---

  addProject: (name: string, path: string, createDir?: boolean) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'add_project', name, path, createDir },
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

  setTheme: (themeId: string) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'set_theme', themeId },
      auth: '',
    });
  },

  refreshThemes: () => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'refresh_themes' },
      auth: '',
    });
  },

  openThemesFolder: () => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'open_themes_folder' },
      auth: '',
    });
  },
}));
