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
  GitBranchInfo,
  FilesPayload,
  FileTreeEntry,
  SessionActivity,
  QaBrowserPayload,
  QaInstanceInfo,
  QaTabInfo,
  QaSnapshotNode,
  SubagentSessionInfo,
  SubagentType,
  SubagentCli,
  SystemMetrics,
  PerfPayload,
  ThemeMeta,
  ThemeFile,
  AndroidDeviceInfo,
  LogcatEntry,
  AndroidViewNode,
  AndroidPayload,
  McpServerRecord,
  McpProfileRecord,
  McpHealthResult,
  SessionMcpRecord,
  McpPayload,
  TaskRecord,
  TaskPayload,
} from '../../../shared/types';
import type { FlowSummary } from '../../../shared/qa-flow-types';

type ViewMode = 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session';

interface SubagentClient {
  info: SubagentSessionInfo;
  entries: NormalizedEntry[];
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
  claudeEntriesMeta: Record<string, { oldestSeq: number | null; totalCount: number; hasMore: boolean; loading: boolean }>;
  pendingApprovals: ClaudeApprovalInfo[];
  sessionActivity: Record<string, SessionActivity>;
  lastActivityAt: Record<string, number>; // sessionId → timestamp of last activity
  lastUserMessagePreview: Record<string, string>; // sessionId → truncated last user message (for sidebar)
  messageQueue: Record<string, Array<{ id: string; content: string }>>;

  // Git
  gitStatus: Record<string, GitStatusData>;
  gitErrors: Record<string, string>;
  gitWatcherConnected: Record<string, boolean>;
  gitNotARepo: Record<string, boolean>;
  gitBranches: Record<string, GitBranchInfo[]>;
  gitPushing: Record<string, boolean>;
  gitPulling: Record<string, boolean>;

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
  autoTunnel: boolean;
  activeThemeColors: Record<string, string> | null;

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

  // QA URL detection result (transient — for UI feedback)
  qaUrlDetectionResult: { sessionId: string; qaTargetUrl: string | null; source: string; detail: string; framework?: string; verification?: string; timestamp: number } | null;

  // Android QA
  androidRunning: boolean;
  androidDevices: AndroidDeviceInfo[];
  androidAvds: string[];
  androidScreenshot: string | null;
  androidViewHierarchy: AndroidViewNode[] | null;
  androidLogcat: LogcatEntry[];

  // Android QA actions
  startAndroidEmulator: (avdName?: string) => void;
  stopAndroidEmulator: () => void;
  listAndroidDevices: () => void;
  takeAndroidScreenshot: () => void;
  getAndroidViewHierarchy: () => void;
  installAndroidApk: (apkPath: string) => void;
  launchAndroidApp: (appId: string) => void;
  clearAndroidLogcat: () => void;

  // MCP Management
  mcpServers: McpServerRecord[];
  mcpProfiles: McpProfileRecord[];
  mcpHealthResults: Record<string, McpHealthResult>;
  sessionMcps: Record<string, SessionMcpRecord[]>;
  mcpImportResult: { imported: string[]; skipped: string[] } | null;

  // Subagents — keyed by parentSessionId → multiple agents
  subagents: Record<string, SubagentClient[]>;        // parentSessionId → agents
  activeSubagentId: Record<string, string | null>;   // parentSessionId → selected subagentId
  qaFlows: FlowSummary[];
  markdownFiles: Array<{ path: string; name: string }>;

  // Performance monitoring
  perfMetrics: SystemMetrics | null;
  perfMonitoring: boolean;

  // Tasks
  tasks: TaskRecord[];
  activeTaskId: string | null;
  taskError: string | null;

  // Right panel
  activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null;

  // Session terminal panel (per-Claude-session terminals)
  sessionTerminals: Record<string, {
    tabs: Array<{
      tabId: string;
      terminalSessionId: string;
      label: string;
      createdAt: number;
      exited: boolean;
      exitCode?: number;
    }>;
    activeTabId: string | null;
    panelVisible: boolean;
  }>;
  terminalPanelHeight: number;

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  toggleTunnel: () => void;
  setAutoTunnel: (enabled: boolean) => void;
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
    mcpProfileId?: string;
    mcpServerIds?: string[];
    mcpExcludeIds?: string[];
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
  loadMoreEntries: (sessionId: string) => void;
  updateClaudeSession: (id: string, updates: { name?: string; color?: string | null }) => void;
  updateQaTargetUrl: (sessionId: string, qaTargetUrl: string) => void;
  detectQaTargetUrl: (sessionId: string) => void;
  deleteClaudeSession: (id: string) => void;
  restoreClaudeSession: (id: string) => void;
  archiveClaudeSession: (id: string) => void;
  deleteTerminalSession: (id: string) => void;
  restoreTerminalSession: (id: string) => void;
  archiveTerminalSession: (id: string) => void;
  fetchDeletedSessions: () => void;
  deletedClaudeSessions: ClaudeSessionInfo[];
  setViewMode: (mode: ViewMode) => void;

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
  listBranches: (sessionId: string) => void;
  checkoutBranch: (sessionId: string, branch: string) => void;
  createBranch: (sessionId: string, branch: string, checkout?: boolean) => void;
  deleteBranch: (sessionId: string, branch: string, force?: boolean) => void;
  gitPush: (sessionId: string, force?: boolean) => void;
  gitPull: (sessionId: string) => void;
  gitFetch: (sessionId: string) => void;

  // Diff tab state
  openDiffTabs: DiffTab[];
  activeDiffTabId: string | null;
  previousViewMode: ViewMode;

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

  // Subagent actions
  startSubagent: (subagentType: SubagentType, cli: SubagentCli, inputs: Record<string, string>, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', name?: string) => void;
  stopSubagent: (subagentId: string) => void;
  deleteSubagent: (subagentId: string, parentSessionId: string) => void;
  sendSubagentMessage: (subagentId: string, text: string) => void;
  clearSubagentEntries: (subagentId: string) => void;
  selectSubagent: (parentSessionId: string, subagentId: string | null) => void;
  fetchSubagents: (parentSessionId: string) => void;
  fetchSubagentEntries: (subagentId: string) => void;
  fetchQaFlows: () => void;
  fetchMarkdownFiles: (sessionId: string) => void;

  // MCP actions
  fetchMcpServers: () => void;
  addMcpServer: (name: string, command: string, args?: string[], env?: Record<string, string>) => void;
  updateMcpServer: (id: string, updates: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }) => void;
  removeMcpServer: (id: string) => void;
  toggleMcpServer: (id: string, enabled: boolean) => void;
  healthCheckMcp: (id?: string) => void;
  importMcpFromClaude: () => void;
  fetchMcpProfiles: () => void;
  createMcpProfile: (name: string, description: string, serverIds: string[]) => void;
  updateMcpProfile: (id: string, updates: { name?: string; description?: string; serverIds?: string[] }) => void;
  deleteMcpProfile: (id: string) => void;
  setDefaultMcpProfile: (id: string) => void;
  fetchSessionMcps: (sessionId: string) => void;
  clearMcpImportResult: () => void;

  // Right panel actions
  setActiveRightTab: (tab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null) => void;
  toggleRightPanel: () => void;

  // Session terminal actions
  createSessionTerminal: (claudeSessionId: string, cwd: string) => void;
  closeSessionTerminal: (claudeSessionId: string, tabId: string) => void;
  switchSessionTerminal: (claudeSessionId: string, tabId: string) => void;
  toggleSessionTerminalPanel: (claudeSessionId: string) => void;
  setSessionTerminalExited: (claudeSessionId: string, tabId: string, exitCode: number) => void;
  restartSessionTerminal: (claudeSessionId: string, tabId: string, cwd: string) => void;
  setTerminalPanelHeight: (height: number) => void;
  destroyAllSessionTerminals: (claudeSessionId: string) => void;

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

  // Task actions
  createTask: (name: string, prompt: string, projectPath: string, opts?: { baseBranch?: string; permissionMode?: PermissionMode; model?: string }) => void;
  listTasks: () => void;
  selectTask: (taskId: string | null) => void;
  continueTask: (taskId: string, prompt: string) => void;
  mergeTask: (taskId: string) => void;
  createTaskPR: (taskId: string, title?: string, body?: string) => void;
  archiveTask: (taskId: string) => void;
  unarchiveTask: (taskId: string) => void;
  discardTask: (taskId: string) => void;
  getTaskDiff: (taskId: string) => void;
}

const ENTRIES_PAGE_SIZE = 50;

let claudeIdCounter = 0;

function truncatePreview(content: string, max = 60): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max) + '...' : trimmed;
}
let drainInFlight: Record<string, boolean> = {};

// Maps correlationId (= tabId) → claudeSessionId for pending terminal tab creation
const pendingSessionTerminals = new Map<string, string>();

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
      lastUserMessagePreview: {
        ...state.lastUserMessagePreview,
        [sid]: truncatePreview(next.content),
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
      lastUserMessagePreview: {
        ...state.lastUserMessagePreview,
        [sid]: truncatePreview(next.content),
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
  deletedClaudeSessions: [],
  activeClaudeId: null,
  claudeEntries: {},
  claudeEntriesMeta: {},
  pendingApprovals: [],
  sessionActivity: {},
  lastActivityAt: {},
  lastUserMessagePreview: {},
  messageQueue: {},

  gitStatus: {},
  gitErrors: {},
  gitWatcherConnected: {},
  gitNotARepo: {},
  gitBranches: {},
  gitPushing: {},
  gitPulling: {},
  openDiffTabs: [],
  activeDiffTabId: null,
  previousViewMode: 'terminal',

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
  qaCurrentUrl: window.location.origin,
  qaConsoleLogs: [],
  qaNetworkRequests: [],
  qaJsErrors: [],

  qaUrlDetectionResult: null,

  androidRunning: false,
  androidDevices: [],
  androidAvds: [],
  androidScreenshot: null,
  androidViewHierarchy: null,
  androidLogcat: [],

  mcpServers: [],
  mcpProfiles: [],
  mcpHealthResults: {},
  sessionMcps: {},
  mcpImportResult: null,

  subagents: {},
  activeSubagentId: {},
  qaFlows: [] as FlowSummary[],
  markdownFiles: [] as Array<{ path: string; name: string }>,


  perfMetrics: null,
  perfMonitoring: false,

  tasks: [],
  activeTaskId: null,
  taskError: null,

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
  autoTunnel: false,
  activeThemeColors: null,

  viewMode: 'terminal',

  activeRightTab: null,

  sessionTerminals: {},
  terminalPanelHeight: parseInt(localStorage.getItem('zeus-terminal-panel-height') || '30', 10),

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
        zeusWs.send({
          channel: 'task', sessionId: '', auth: '', payload: { type: 'list_tasks' },
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

        // Check if this session belongs to a pending session terminal tab
        const correlationId = p.correlationId;
        const matchedClaudeId = correlationId ? pendingSessionTerminals.get(correlationId) : undefined;

        if (correlationId && matchedClaudeId) {
          // This is a session terminal tab — link it using the correlationId as tabId
          pendingSessionTerminals.delete(correlationId);
          const shellName = p.shell.split('/').pop() || 'shell';
          set((state) => {
            const st = state.sessionTerminals[matchedClaudeId];
            if (!st) return {};
            const tabNumber = st.tabs.length;
            return {
              sessionTerminals: {
                ...state.sessionTerminals,
                [matchedClaudeId]: {
                  ...st,
                  tabs: st.tabs.map(t =>
                    t.tabId === correlationId
                      ? { ...t, terminalSessionId: p.sessionId, label: `${shellName} ${tabNumber}` }
                      : t
                  ),
                },
              },
              lastActivityAt: { ...state.lastActivityAt, [p.sessionId]: Date.now() },
            };
          });
        } else {
          // Normal standalone terminal session (existing behavior)
          set((state) => ({
            activeSessionId: p.sessionId,
            lastActivityAt: { ...state.lastActivityAt, [p.sessionId]: Date.now() },
          }));
        }
      }

      if (payload.type === 'session_list') {
        const p = envelope.payload as SessionListPayload;
        set({ sessions: p.sessions });

        // Fetch subagents for the active terminal session on reconnect
        const activeTermId = get().activeSessionId;
        if (activeTermId) {
          zeusWs.send({
            channel: 'subagent', sessionId: '', auth: '',
            payload: { type: 'list_subagents', parentSessionId: activeTermId },
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
              lastActivityAt: { ...state.lastActivityAt, [p.session.id]: Date.now() },
            };
          }
          return {
            sessions: [...state.sessions, p.session],
            lastActivityAt: { ...state.lastActivityAt, [p.session.id]: Date.now() },
          };
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

      if (payload.type === 'terminal_session_restored') {
        // Re-fetch sessions to get the restored one
        zeusWs.send({
          channel: 'control',
          sessionId: '',
          payload: { type: 'list_sessions' },
          auth: '',
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

        let activeId = get().activeClaudeId;

        // Auto-select the most recent session if none is active
        if (!activeId && sessions.length > 0) {
          // Prefer a running session, then most recent by startedAt
          const running = sessions.find((s) => s.status === 'running');
          const mostRecent = running ?? sessions.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
          activeId = mostRecent.id;
          set({ activeClaudeId: activeId, viewMode: 'claude' });
          // Lazy-load latest page of entries from DB (skip if already loaded from previous connection)
          const existing = get().claudeEntries[activeId];
          if (!existing || existing.length === 0) {
            zeusWs.send({
              channel: 'claude',
              sessionId: activeId,
              payload: { type: 'get_claude_history', limit: ENTRIES_PAGE_SIZE },
              auth: '',
            });
          }
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

        // Fetch subagents for the active session on reconnect
        if (activeId) {
          zeusWs.send({
            channel: 'subagent', sessionId: '', auth: '',
            payload: { type: 'list_subagents', parentSessionId: activeId },
          });
        }
        return;
      }

      if (payload.type === 'claude_history') {
        const p = envelope.payload as {
          entries: NormalizedEntry[];
          totalCount?: number;
          oldestSeq?: number | null;
          isPaginated?: boolean;
          prepend?: boolean; // set by loadMoreEntries to signal prepend
        };
        const { entries, totalCount, oldestSeq, isPaginated } = p;

        // Compute last user message preview from loaded entries
        const lastUserPreview = (() => {
          for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].entryType.type === 'user_message') {
              return truncatePreview(entries[i].content);
            }
          }
          return '';
        })();

        if (isPaginated) {
          set((state) => {
            const meta = state.claudeEntriesMeta[sid];
            const isLoadMore = meta && meta.oldestSeq !== null; // already had entries
            const existingEntries = isLoadMore ? (state.claudeEntries[sid] ?? []) : [];
            // Prepend older entries (loadMore) or set initial page
            // Deduplicate by entry ID to prevent duplicate keys on reconnect
            const incomingIds = new Set(entries.map((e) => e.id));
            const deduped = existingEntries.filter((e) => !incomingIds.has(e.id));
            const merged = isLoadMore ? [...entries, ...deduped] : entries;
            // For initial load, also compute from merged entries (includes existing + new)
            let preview = state.lastUserMessagePreview[sid];
            if (!isLoadMore && lastUserPreview) {
              preview = lastUserPreview;
            } else if (!preview) {
              // Compute from merged if we didn't have one
              for (let i = merged.length - 1; i >= 0; i--) {
                if (merged[i].entryType.type === 'user_message') {
                  preview = truncatePreview(merged[i].content);
                  break;
                }
              }
            }
            return {
              claudeEntries: { ...state.claudeEntries, [sid]: merged },
              claudeEntriesMeta: {
                ...state.claudeEntriesMeta,
                [sid]: {
                  oldestSeq: oldestSeq ?? null,
                  totalCount: totalCount ?? 0,
                  hasMore: (oldestSeq ?? 0) > 0 && merged.length < (totalCount ?? 0),
                  loading: false,
                },
              },
              ...(preview ? { lastUserMessagePreview: { ...state.lastUserMessagePreview, [sid]: preview } } : {}),
            };
          });
        } else {
          // Legacy full-load
          set((state) => ({
            claudeEntries: { ...state.claudeEntries, [sid]: entries },
            claudeEntriesMeta: {
              ...state.claudeEntriesMeta,
              [sid]: { oldestSeq: null, totalCount: entries.length, hasMore: false, loading: false },
            },
            ...(lastUserPreview ? { lastUserMessagePreview: { ...state.lastUserMessagePreview, [sid]: lastUserPreview } } : {}),
          }));
        }
        return;
      }

      if (payload.type === 'claude_started') {
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: { state: 'starting' } },
          lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
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
          return {
            claudeEntries: { ...state.claudeEntries, [sid]: updated },
            lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
          };
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
          lastActivityAt: { ...state.lastActivityAt, [sid]: Date.now() },
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
          claudeEntriesMeta: Object.fromEntries(
            Object.entries(state.claudeEntriesMeta).filter(([k]) => k !== deletedId),
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

      if (payload.type === 'claude_session_restored') {
        const { sessionId: restoredId } = envelope.payload as { sessionId: string };
        set((state) => {
          const restored = state.deletedClaudeSessions.find((s) => s.id === restoredId);
          return {
            deletedClaudeSessions: state.deletedClaudeSessions.filter((s) => s.id !== restoredId),
            claudeSessions: restored
              ? [...state.claudeSessions, { ...restored, status: 'completed' as const }]
              : state.claudeSessions,
          };
        });
      }

      if (payload.type === 'deleted_sessions_list') {
        const { sessions } = envelope.payload as { sessions: ClaudeSessionInfo[] };
        set({ deletedClaudeSessions: sessions });
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

      if (payload.type === 'qa_target_url_updated') {
        const { sessionId, qaTargetUrl } = envelope.payload as { sessionId: string; qaTargetUrl: string | null };
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sessionId ? { ...s, qaTargetUrl: qaTargetUrl ?? undefined } : s,
          ),
        }));
      }

      if (payload.type === 'qa_target_url_detected') {
        const { sessionId, qaTargetUrl, source, detail, framework, verification } = envelope.payload as {
          sessionId: string; qaTargetUrl: string | null; source: string; detail: string; framework?: string; verification?: string;
        };
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sessionId ? { ...s, qaTargetUrl: qaTargetUrl ?? undefined } : s,
          ),
          // Store detection result for UI feedback
          qaUrlDetectionResult: { sessionId, qaTargetUrl, source, detail, framework, verification, timestamp: Date.now() },
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
          autoTunnel: s.autoTunnel,
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
                ? state.viewMode
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

      if (payload.type === 'git_branches_result') {
        set((state) => ({
          gitBranches: { ...state.gitBranches, [sid]: payload.branches },
        }));
      }

      if (payload.type === 'git_checkout_result') {
        if (!payload.success && payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
      }

      if (payload.type === 'git_create_branch_result') {
        if (!payload.success && payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
      }

      if (payload.type === 'git_delete_branch_result') {
        if (!payload.success && payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
      }

      if (payload.type === 'git_push_result') {
        set((state) => ({
          gitPushing: { ...state.gitPushing, [sid]: false },
          ...(!payload.success && payload.error
            ? { gitErrors: { ...state.gitErrors, [sid]: payload.error } }
            : {}),
        }));
      }

      if (payload.type === 'git_pull_result') {
        set((state) => ({
          gitPulling: { ...state.gitPulling, [sid]: false },
          ...(!payload.success && payload.error
            ? { gitErrors: { ...state.gitErrors, [sid]: payload.error } }
            : {}),
        }));
      }

      if (payload.type === 'git_fetch_result') {
        if (!payload.success && payload.error) {
          set((state) => ({
            gitErrors: { ...state.gitErrors, [sid]: payload.error! },
          }));
        }
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

      // Handle extension scan results for any session
      if (payload.type === 'scan_by_extension_result') {
        const files = (payload as { results: Array<{ path: string; name: string }> }).results;
        set({ markdownFiles: files });
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
                ? state.viewMode
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
      const payload = envelope.payload as QaBrowserPayload;

      if (payload.type === 'qa_started') {
        set({ qaRunning: true, qaLoading: false, qaError: null });
      }
      if (payload.type === 'qa_stopped') {
        set({
          qaRunning: false, qaInstances: [], qaTabs: [],
          qaSnapshot: null, qaSnapshotRaw: null, qaScreenshot: null,
          qaText: null, qaLoading: false, qaError: null,
          qaCurrentUrl: window.location.origin,
          qaConsoleLogs: [], qaNetworkRequests: [], qaJsErrors: [],
          subagents: {}, activeSubagentId: {},
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
      if (payload.type === 'qa_flows_list') {
        set({ qaFlows: payload.flows });
      }
    });

    // Subscribe to subagent channel
    const unsubSubagent = zeusWs.on('subagent', (envelope: WsEnvelope) => {
      const payload = envelope.payload as { type: string; [key: string]: unknown };

      if (payload.type === 'subagent_started') {
        const { subagentId, subagentType, cli, parentSessionId, parentSessionType, name, task, targetUrl } = payload as {
          subagentId: string; subagentType?: string; cli?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; task: string; targetUrl?: string;
        };
        set((state) => {
          const existing = (state.subagents[parentSessionId] ?? []).find((a) => a.info.subagentId === subagentId);
          let agents: SubagentClient[];
          if (existing) {
            // Agent already exists (resume) — update status back to running
            agents = (state.subagents[parentSessionId] ?? []).map((a) =>
              a.info.subagentId === subagentId ? { ...a, info: { ...a.info, status: 'running' as const } } : a,
            );
          } else {
            // New agent
            const newAgent: SubagentClient = {
              info: { subagentId, subagentType: (subagentType ?? 'qa') as SubagentType, cli: (cli ?? 'claude') as SubagentCli, parentSessionId, parentSessionType, name, task, targetUrl, status: 'running', startedAt: Date.now() },
              entries: [],
            };
            agents = [...(state.subagents[parentSessionId] ?? []), newAgent];
          }
          return {
            subagents: { ...state.subagents, [parentSessionId]: agents },
            activeSubagentId: { ...state.activeSubagentId, [parentSessionId]: subagentId },
          };
        });
      }
      if (payload.type === 'subagent_stopped') {
        const { subagentId, parentSessionId } = payload as { subagentId: string; parentSessionId: string };
        set((state) => {
          const agents = (state.subagents[parentSessionId] ?? []).map((a) =>
            a.info.subagentId === subagentId ? { ...a, info: { ...a.info, status: 'stopped' as const } } : a,
          );
          return { subagents: { ...state.subagents, [parentSessionId]: agents } };
        });
      }
      if (payload.type === 'subagent_deleted') {
        const { subagentId, parentSessionId } = payload as { subagentId: string; parentSessionId: string };
        set((state) => {
          const agents = (state.subagents[parentSessionId] ?? []).filter((a) => a.info.subagentId !== subagentId);
          const activeId = state.activeSubagentId[parentSessionId];
          const newActiveId = activeId === subagentId
            ? (agents.length > 0 ? agents[agents.length - 1].info.subagentId : null)
            : activeId;
          return {
            subagents: { ...state.subagents, [parentSessionId]: agents },
            activeSubagentId: { ...state.activeSubagentId, [parentSessionId]: newActiveId },
          };
        });
      }
      if (payload.type === 'subagent_entry') {
        const { subagentId, parentSessionId, entry } = payload as { subagentId: string; parentSessionId: string; entry: NormalizedEntry };
        set((state) => {
          const agents = (state.subagents[parentSessionId] ?? []).map((a) =>
            a.info.subagentId === subagentId
              ? { ...a, entries: [...a.entries, entry].slice(-500) }
              : a,
          );
          return { subagents: { ...state.subagents, [parentSessionId]: agents } };
        });
      }
      if (payload.type === 'subagent_list') {
        const { parentSessionId, agents } = payload as { parentSessionId: string; agents: SubagentSessionInfo[] };
        set((state) => {
          // Merge server list with any existing entries we may have
          const existing = state.subagents[parentSessionId] ?? [];
          const merged = agents.map((info) => {
            const found = existing.find((a) => a.info.subagentId === info.subagentId);
            return found ? { ...found, info } : { info, entries: [] };
          });
          return { subagents: { ...state.subagents, [parentSessionId]: merged } };
        });
      }
      if (payload.type === 'subagent_entries') {
        const { subagentId, entries: dbEntries } = payload as { subagentId: string; entries: NormalizedEntry[] };
        set((state) => {
          const updated = { ...state.subagents };
          for (const parentId of Object.keys(updated)) {
            updated[parentId] = updated[parentId].map((a) => {
              if (a.info.subagentId !== subagentId) return a;
              // Merge: DB entries are the base, append any streamed entries
              // that arrived after the last DB entry (by ID dedup)
              const dbIds = new Set(dbEntries.map((e) => e.id));
              const newer = a.entries.filter((e) => !dbIds.has(e.id));
              return { ...a, entries: [...dbEntries, ...newer] };
            });
          }
          return { subagents: updated };
        });
      }
      if (payload.type === 'subagent_error') {
        const { message } = payload as { type: string; message: string };
        console.error('[ZeusStore] subagent_error:', message);
        set({ qaError: message });
      }
    });

    // Subscribe to perf channel
    const unsubPerf = zeusWs.on('perf', (envelope: WsEnvelope) => {
      const payload = envelope.payload as PerfPayload;
      if (payload.type === 'perf_update') {
        set({ perfMetrics: payload.metrics, perfMonitoring: true });
      }
    });

    // Subscribe to android channel
    const unsubAndroid = zeusWs.on('android', (envelope: WsEnvelope) => {
      const payload = envelope.payload as AndroidPayload;
      switch (payload.type) {
        case 'emulator_started':
          set({ androidRunning: true, androidDevices: [...get().androidDevices, payload.device] });
          break;
        case 'emulator_stopped':
          set({ androidRunning: false, androidDevices: [], androidLogcat: [] });
          break;
        case 'devices_list':
          set({ androidDevices: payload.devices, androidAvds: payload.avds });
          break;
        case 'android_status':
          set({ androidRunning: payload.running, androidDevices: payload.devices });
          break;
        case 'screenshot_result':
          set({ androidScreenshot: payload.dataUrl });
          break;
        case 'view_hierarchy_result':
          set({ androidViewHierarchy: payload.nodes });
          break;
        case 'logcat_entries':
          set({ androidLogcat: [...get().androidLogcat, ...payload.entries].slice(-500) });
          break;
        case 'android_error':
          console.error('[AndroidQA]', payload.message);
          break;
      }
    });

    // Subscribe to mcp channel
    const unsubMcp = zeusWs.on('mcp', (envelope: WsEnvelope) => {
      const payload = envelope.payload as McpPayload;
      switch (payload.type) {
        case 'servers_list':
          set({ mcpServers: payload.servers });
          break;
        case 'server_added':
          set({ mcpServers: [...get().mcpServers, payload.server] });
          break;
        case 'server_updated':
          set({ mcpServers: get().mcpServers.map((s) => s.id === payload.server.id ? payload.server : s) });
          break;
        case 'server_removed':
          set({ mcpServers: get().mcpServers.filter((s) => s.id !== payload.id) });
          break;
        case 'health_result':
          set({
            mcpHealthResults: {
              ...get().mcpHealthResults,
              [payload.id]: { healthy: payload.healthy, error: payload.error, latencyMs: payload.latencyMs },
            },
          });
          break;
        case 'health_results':
          set({ mcpHealthResults: { ...get().mcpHealthResults, ...payload.results } });
          break;
        case 'import_result':
          set({ mcpImportResult: { imported: payload.imported, skipped: payload.skipped } });
          break;
        case 'profiles_list':
          set({ mcpProfiles: payload.profiles });
          break;
        case 'profile_created':
          set({ mcpProfiles: [...get().mcpProfiles, payload.profile] });
          break;
        case 'profile_updated':
          set({ mcpProfiles: get().mcpProfiles.map((p) => p.id === payload.profile.id ? payload.profile : p) });
          break;
        case 'profile_deleted':
          set({ mcpProfiles: get().mcpProfiles.filter((p) => p.id !== payload.id) });
          break;
        case 'session_mcps':
          set({ sessionMcps: { ...get().sessionMcps, [payload.sessionId]: payload.mcps } });
          break;
        case 'session_mcp_status': {
          const existing = get().sessionMcps[payload.sessionId] ?? [];
          set({
            sessionMcps: {
              ...get().sessionMcps,
              [payload.sessionId]: existing.map((m) =>
                m.serverId === payload.serverId ? { ...m, status: payload.status } : m,
              ),
            },
          });
          break;
        }
        case 'mcp_error':
          console.error('[MCP]', payload.message);
          break;
      }
    });

    // Subscribe to task channel
    const unsubTask = zeusWs.on('task', (envelope: WsEnvelope) => {
      const p = envelope.payload as TaskPayload;
      if (p.type === 'task_created') {
        set((s) => ({ tasks: [p.task, ...s.tasks], taskError: null }));
      } else if (p.type === 'task_updated') {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === p.task.id ? p.task : t)),
          taskError: null,
        }));
      } else if (p.type === 'task_list') {
        set({ tasks: p.tasks, taskError: null });
      } else if (p.type === 'task_deleted') {
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== p.taskId),
          activeTaskId: s.activeTaskId === p.taskId ? null : s.activeTaskId,
          taskError: null,
        }));
      } else if (p.type === 'task_diff') {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === p.taskId ? { ...t, diffSummary: p.summary } : t,
          ),
        }));
      } else if (p.type === 'task_error') {
        set({ taskError: p.message });
        setTimeout(() => set({ taskError: null }), 5000);
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
      unsubSubagent();
      unsubPerf();
      unsubAndroid();
      unsubMcp();
      unsubTask();
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

  setAutoTunnel: (enabled: boolean) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'set_auto_tunnel', enabled },
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
      mcpProfileId,
      mcpServerIds,
      mcpExcludeIds,
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

    // Add optimistic user message for the resume prompt
    const resumePrompt = prompt || 'Continue working.';
    const userEntry: NormalizedEntry = {
      id: `user-${Date.now()}`,
      entryType: { type: 'user_message' },
      content: resumePrompt,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      claudeSessions: [...state.claudeSessions, newSession],
      activeClaudeId: newId,
      claudeEntries: { ...state.claudeEntries, [newId]: [...existingEntries, userEntry] },
      claudeEntriesMeta: {
        ...state.claudeEntriesMeta,
        [newId]: state.claudeEntriesMeta[id]
          ? { ...state.claudeEntriesMeta[id] }
          : { oldestSeq: null, totalCount: existingEntries.length + 1, hasMore: false, loading: false },
      },
      lastUserMessagePreview: {
        ...state.lastUserMessagePreview,
        [newId]: truncatePreview(resumePrompt),
      },
      sessionActivity: { ...state.sessionActivity, [newId]: { state: 'starting' } },
      lastActivityAt: { ...state.lastActivityAt, [newId]: Date.now() },
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

  loadMoreEntries: (sessionId: string) => {
    const meta = get().claudeEntriesMeta[sessionId];
    if (!meta || !meta.hasMore || meta.loading) return;
    // Mark loading
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
      // Lazy-load latest page of entries from DB if not already loaded
      if (!get().claudeEntries[id] || get().claudeEntries[id].length === 0) {
        zeusWs.send({
          channel: 'claude',
          sessionId: id,
          payload: { type: 'get_claude_history', limit: ENTRIES_PAGE_SIZE },
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

  deleteTerminalSession: (id: string) => {
    zeusWs.send({
      channel: 'control',
      sessionId: id,
      payload: { type: 'delete_terminal_session' },
      auth: '',
    });
  },

  restoreTerminalSession: (id: string) => {
    zeusWs.send({
      channel: 'control',
      sessionId: id,
      payload: { type: 'restore_terminal_session' },
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

  fetchDeletedSessions: () => {
    zeusWs.send({
      channel: 'claude',
      sessionId: '',
      payload: { type: 'list_deleted_sessions' },
      auth: '',
    });
  },

  setViewMode: (mode: ViewMode) => {
    set((state) => ({
      viewMode: mode,
      previousViewMode: state.viewMode !== 'diff' ? state.viewMode : state.previousViewMode,
    }));
  },

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
            ? state.viewMode
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
            ? state.viewMode
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
          ? state.viewMode
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
          ? state.viewMode
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

  listBranches: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_list_branches' },
      auth: '',
    });
  },

  checkoutBranch: (sessionId: string, branch: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_checkout', branch },
      auth: '',
    });
  },

  createBranch: (sessionId: string, branch: string, checkout = true) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_create_branch', branch, checkout },
      auth: '',
    });
  },

  deleteBranch: (sessionId: string, branch: string, force = false) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_delete_branch', branch, force },
      auth: '',
    });
  },

  gitPush: (sessionId: string, force = false) => {
    set((state) => ({ gitPushing: { ...state.gitPushing, [sessionId]: true } }));
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_push', force },
      auth: '',
    });
  },

  gitPull: (sessionId: string) => {
    set((state) => ({ gitPulling: { ...state.gitPulling, [sessionId]: true } }));
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_pull' },
      auth: '',
    });
  },

  gitFetch: (sessionId: string) => {
    zeusWs.send({
      channel: 'git',
      sessionId,
      payload: { type: 'git_fetch' },
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
            ? state.viewMode
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

  // --- Subagent actions ---

  startSubagent: (subagentType: SubagentType, cli: SubagentCli, inputs: Record<string, string>, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', name?: string) => {
    const envelope = {
      channel: 'subagent' as const, sessionId: parentSessionId, auth: '',
      payload: { type: 'start_subagent', subagentType, cli, inputs, workingDir, parentSessionId, parentSessionType, name },
    };
    console.log('[ZeusStore] startSubagent sending WS message:', envelope);
    zeusWs.send(envelope);
  },

  stopSubagent: (subagentId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'stop_subagent', subagentId },
    });
  },

  deleteSubagent: (subagentId: string, parentSessionId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'delete_subagent', subagentId, parentSessionId },
    });
  },

  sendSubagentMessage: (subagentId: string, text: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_message', subagentId, text },
    });
  },

  clearSubagentEntries: (subagentId: string) => {
    // Clear locally
    set((state) => {
      const updated = { ...state.subagents };
      for (const [psid, agents] of Object.entries(updated)) {
        const idx = agents.findIndex((a) => a.info.subagentId === subagentId);
        if (idx !== -1) {
          updated[psid] = agents.map((a) =>
            a.info.subagentId === subagentId ? { ...a, entries: [] } : a,
          );
          break;
        }
      }
      return { subagents: updated };
    });
    // Clear from server DB so entries don't reappear on refresh
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'clear_subagent_entries', subagentId },
    });
  },

  selectSubagent: (parentSessionId: string, subagentId: string | null) => {
    set((state) => ({
      activeSubagentId: { ...state.activeSubagentId, [parentSessionId]: subagentId },
    }));
  },

  fetchSubagents: (parentSessionId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'list_subagents', parentSessionId },
    });
  },

  fetchSubagentEntries: (subagentId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'get_subagent_entries', subagentId },
    });
  },

  fetchQaFlows: () => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'list_qa_flows' },
    });
  },

  fetchMarkdownFiles: (sessionId: string) => {
    zeusWs.send({
      channel: 'files', sessionId, auth: '',
      payload: { type: 'scan_by_extension', ext: '.md' },
    });
  },

  // --- Right panel actions ---

  setActiveRightTab: (tab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null) => {
    set({ activeRightTab: tab });
    // Fetch QA status when switching to browser tab
    if (tab === 'browser') {
      zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'get_qa_status' }, auth: '' });
    }
  },

  toggleRightPanel: () => {
    set((state) => ({ activeRightTab: state.activeRightTab ? null : 'source-control' }));
  },

  // --- Session terminal actions ---

  toggleSessionTerminalPanel: (claudeSessionId: string) => {
    const state = get();
    const existing = state.sessionTerminals[claudeSessionId];

    if (!existing) {
      // First open — create state and auto-create first tab
      const session = state.claudeSessions.find(s => s.id === claudeSessionId);
      const cwd = session?.workingDir || '/';

      set((s) => ({
        sessionTerminals: {
          ...s.sessionTerminals,
          [claudeSessionId]: { tabs: [], activeTabId: null, panelVisible: true },
        },
      }));

      get().createSessionTerminal(claudeSessionId, cwd);
      return;
    }

    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: { ...existing, panelVisible: !existing.panelVisible },
      },
    }));
  },

  createSessionTerminal: (claudeSessionId: string, cwd: string) => {
    const state = get();
    const existing = state.sessionTerminals[claudeSessionId];
    const tabs = existing?.tabs || [];

    // 5-tab cap — count ALL tabs (including exited)
    if (tabs.length >= 5) return;

    // Generate stable tabId — also used as correlationId
    const tabId = crypto.randomUUID();

    const pendingTab = {
      tabId,
      terminalSessionId: '',
      label: 'starting...',
      createdAt: Date.now(),
      exited: false,
    };

    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: {
          tabs: [...tabs, pendingTab],
          activeTabId: tabId,
          panelVisible: true,
        },
      },
    }));

    pendingSessionTerminals.set(tabId, claudeSessionId);

    zeusWs.send({
      channel: 'control',
      sessionId: '',
      payload: { type: 'start_session', cwd, correlationId: tabId },
      auth: '',
    });
  },

  closeSessionTerminal: (claudeSessionId: string, tabId: string) => {
    const state = get();
    const st = state.sessionTerminals[claudeSessionId];
    if (!st) return;

    const tab = st.tabs.find(t => t.tabId === tabId);
    if (!tab) return;

    if (tab.terminalSessionId) {
      if (!tab.exited) {
        zeusWs.send({
          channel: 'control',
          sessionId: tab.terminalSessionId,
          payload: { type: 'stop_session' },
          auth: '',
        });
      }
      // Remove from DB so it doesn't reappear in the sidebar terminal list
      zeusWs.send({
        channel: 'control',
        sessionId: tab.terminalSessionId,
        payload: { type: 'delete_terminal_session' },
        auth: '',
      });
    }

    const newTabs = st.tabs.filter(t => t.tabId !== tabId);
    const newActiveTabId = st.activeTabId === tabId
      ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].tabId : null)
      : st.activeTabId;

    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: {
          ...st,
          tabs: newTabs,
          activeTabId: newActiveTabId,
          panelVisible: newTabs.length > 0 ? st.panelVisible : false,
        },
      },
    }));
  },

  switchSessionTerminal: (claudeSessionId: string, tabId: string) => {
    const st = get().sessionTerminals[claudeSessionId];
    if (!st) return;
    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: { ...st, activeTabId: tabId },
      },
    }));
  },

  setSessionTerminalExited: (claudeSessionId: string, tabId: string, exitCode: number) => {
    const st = get().sessionTerminals[claudeSessionId];
    if (!st) return;
    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: {
          ...st,
          tabs: st.tabs.map(t =>
            t.tabId === tabId ? { ...t, exited: true, exitCode } : t
          ),
        },
      },
    }));
  },

  restartSessionTerminal: (claudeSessionId: string, tabId: string, cwd: string) => {
    const st = get().sessionTerminals[claudeSessionId];
    if (!st) return;
    const tab = st.tabs.find(t => t.tabId === tabId);
    if (!tab) return;

    pendingSessionTerminals.set(tabId, claudeSessionId);

    set((s) => ({
      sessionTerminals: {
        ...s.sessionTerminals,
        [claudeSessionId]: {
          ...st,
          tabs: st.tabs.map(t =>
            t.tabId === tabId
              ? { ...t, terminalSessionId: '', exited: false, exitCode: undefined, label: 'restarting...' }
              : t
          ),
        },
      },
    }));

    zeusWs.send({
      channel: 'control',
      sessionId: '',
      payload: { type: 'start_session', cwd, correlationId: tabId },
      auth: '',
    });
  },

  setTerminalPanelHeight: (height: number) => {
    const clamped = Math.min(80, Math.max(15, height));
    localStorage.setItem('zeus-terminal-panel-height', String(clamped));
    set({ terminalPanelHeight: clamped });
  },

  destroyAllSessionTerminals: (claudeSessionId: string) => {
    const st = get().sessionTerminals[claudeSessionId];
    if (!st) return;

    for (const tab of st.tabs) {
      if (tab.terminalSessionId) {
        if (!tab.exited) {
          zeusWs.send({
            channel: 'control',
            sessionId: tab.terminalSessionId,
            payload: { type: 'stop_session' },
            auth: '',
          });
        }
        zeusWs.send({
          channel: 'control',
          sessionId: tab.terminalSessionId,
          payload: { type: 'delete_terminal_session' },
          auth: '',
        });
      }
    }

    set((s) => {
      const { [claudeSessionId]: _, ...rest } = s.sessionTerminals;
      return { sessionTerminals: rest };
    });
  },

  // --- Android QA actions ---

  startAndroidEmulator: (avdName?: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'start_emulator', avdName },
    });
  },
  stopAndroidEmulator: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'stop_emulator' },
    });
  },
  listAndroidDevices: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'list_devices' },
    });
  },
  takeAndroidScreenshot: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'screenshot' },
    });
  },
  getAndroidViewHierarchy: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'view_hierarchy' },
    });
  },
  installAndroidApk: (apkPath: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'install_apk', apkPath },
    });
  },
  launchAndroidApp: (appId: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'launch_app', appId },
    });
  },
  clearAndroidLogcat: () => {
    set({ androidLogcat: [] });
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

  // --- MCP actions ---

  fetchMcpServers: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_servers' }, auth: '' });
  },

  addMcpServer: (name, command, args, env) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'add_server', name, command, args, env }, auth: '' });
  },

  updateMcpServer: (id, updates) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'update_server', id, ...updates }, auth: '' });
  },

  removeMcpServer: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'remove_server', id }, auth: '' });
  },

  toggleMcpServer: (id, enabled) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'toggle_server', id, enabled }, auth: '' });
  },

  healthCheckMcp: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'health_check', id }, auth: '' });
  },

  importMcpFromClaude: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'import_claude' }, auth: '' });
  },

  fetchMcpProfiles: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_profiles' }, auth: '' });
  },

  createMcpProfile: (name, description, serverIds) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'create_profile', name, description, serverIds }, auth: '' });
  },

  updateMcpProfile: (id, updates) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'update_profile', id, ...updates }, auth: '' });
  },

  deleteMcpProfile: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'delete_profile', id }, auth: '' });
  },

  setDefaultMcpProfile: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'set_default_profile', id }, auth: '' });
  },

  fetchSessionMcps: (sessionId) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_session_mcps', sessionId }, auth: '' });
  },

  clearMcpImportResult: () => {
    set({ mcpImportResult: null });
  },

  // --- Task actions ---

  createTask: (name, prompt, projectPath, opts) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'create_task', name, prompt, projectPath, ...opts },
    });
  },
  listTasks: () => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'list_tasks' },
    });
  },
  selectTask: (taskId) => set({ activeTaskId: taskId }),
  continueTask: (taskId, prompt) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'continue_task', taskId, prompt },
    });
  },
  mergeTask: (taskId) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'merge_task', taskId },
    });
  },
  createTaskPR: (taskId, title, body) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'create_pr', taskId, title, body },
    });
  },
  archiveTask: (taskId) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'archive_task', taskId },
    });
  },
  unarchiveTask: (taskId) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'unarchive_task', taskId },
    });
  },
  discardTask: (taskId) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'discard_task', taskId },
    });
  },
  getTaskDiff: (taskId) => {
    zeusWs.send({
      channel: 'task', sessionId: '', auth: '',
      payload: { type: 'get_task_diff', taskId },
    });
  },
}));
