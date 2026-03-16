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
} from '../../../shared/types';

type ViewMode = 'terminal' | 'claude' | 'diff';

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

  // File tree
  fileTree: Record<string, Record<string, FileTreeEntry[]>>;  // sessionId → dirPath → entries
  fileTreeExpanded: Record<string, string[]>;                  // sessionId → expanded paths
  fileTreeConnected: Record<string, boolean>;

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
  activeRightTab: 'source-control' | 'explorer' | null;

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
  sendClaudeMessage: (content: string, files?: string[], images?: Array<{ filename: string; mediaType: string; dataUrl: string }>) => void;
  approveClaudeTool: (approvalId: string) => void;
  denyClaudeTool: (approvalId: string, reason?: string) => void;
  interruptClaude: () => void;
  stopClaude: () => void;
  selectClaudeSession: (id: string | null) => void;
  resumeClaudeSession: (id: string) => void;
  queueMessage: (content: string) => void;
  editQueuedMessage: (msgId: string, content: string) => void;
  removeQueuedMessage: (msgId: string) => void;
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

  // Right panel actions
  setActiveRightTab: (tab: 'source-control' | 'explorer' | null) => void;
  toggleRightPanel: () => void;

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
  sessionActivity: {},
  messageQueue: {},

  gitStatus: {},
  gitErrors: {},
  gitWatcherConnected: {},
  openDiffTabs: [],
  activeDiffTabId: null,
  previousViewMode: 'terminal' as const,

  fileTree: {},
  fileTreeExpanded: {},
  fileTreeConnected: {},

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

        // Only request state for the active session (watchers are already alive on backend)
        const activeId = get().activeClaudeId;
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

      if (payload.type === 'session_activity') {
        const { activity } = envelope.payload as { activity: SessionActivity };
        set((state) => ({
          sessionActivity: { ...state.sessionActivity, [sid]: activity },
        }));

        // Auto-send queued messages when session becomes idle
        if (activity.state === 'idle') {
          const queue = get().messageQueue[sid];
          if (queue && queue.length > 0) {
            const next = queue[0];
            // Remove from queue
            set((state) => ({
              messageQueue: {
                ...state.messageQueue,
                [sid]: (state.messageQueue[sid] ?? []).slice(1),
              },
            }));
            // Send the queued message
            const userEntry: NormalizedEntry = {
              id: `user-${Date.now()}`,
              entryType: { type: 'user_message' },
              content: next.content,
            };
            set((state) => ({
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
          }
        }
      }

      if (payload.type === 'done') {
        set((state) => ({
          claudeSessions: state.claudeSessions.map((s) =>
            s.id === sid ? { ...s, status: 'done' as const } : s,
          ),
          pendingApprovals: state.pendingApprovals.filter((a) => a.sessionId !== sid),
          sessionActivity: { ...state.sessionActivity, [sid]: { state: 'idle' } },
        }));
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
        }));
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

    zeusWs.connect();

    // Return cleanup function
    return () => {
      unsubStatus();
      unsubControl();
      unsubClaude();
      unsubSettings();
      unsubGit();
      unsubFiles();
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
      payload: { type: 'send_message', content, files, images },
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

  resumeClaudeSession: (id: string) => {
    const state = get();
    const session = state.claudeSessions.find((s) => s.id === id);
    if (!session || !session.claudeSessionId) return;

    const existingEntries = state.claudeEntries[id] ?? [];
    const resumePrompt = 'Continue where you left off.';

    // Create a new client session ID but resume the real Claude conversation
    const newId = `claude-${Date.now()}-${++claudeIdCounter}`;
    const newSession: ClaudeSessionInfo = {
      id: newId,
      claudeSessionId: session.claudeSessionId,
      status: 'running',
      prompt: session.prompt,
      name: session.name ? `${session.name} (resumed)` : session.name,
      notificationSound: session.notificationSound,
      enableGitWatcher: session.enableGitWatcher,
      workingDir: session.workingDir,
      startedAt: Date.now(),
    };

    set((state) => ({
      claudeSessions: [...state.claudeSessions, newSession],
      activeClaudeId: newId,
      claudeEntries: { ...state.claudeEntries, [newId]: [...existingEntries] },
      viewMode: 'claude',
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: newId,
      payload: {
        type: 'resume_claude',
        claudeSessionId: session.claudeSessionId,
        prompt: resumePrompt,
        workingDir: session.workingDir || '/',
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

  // --- Right panel actions ---

  setActiveRightTab: (tab: 'source-control' | 'explorer' | null) => {
    set({ activeRightTab: tab });
  },

  toggleRightPanel: () => {
    set((state) => ({ activeRightTab: state.activeRightTab ? null : 'source-control' }));
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
