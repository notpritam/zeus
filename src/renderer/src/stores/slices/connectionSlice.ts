import type { StateCreator } from 'zustand';
import type { ZeusState, ViewMode, DiffTab } from '../types';
import { zeusWs } from '@/lib/ws';
import { ENTRIES_PAGE_SIZE, truncatePreview } from './claudeSlice';
import { pendingSessionTerminals } from './terminalSlice';
import type {
  WsEnvelope,
  SessionStartedPayload,
  SessionListPayload,
  SessionUpdatedPayload,
  StatusPayload,
  SettingsPayload,
  ClaudeSessionInfo,
  NormalizedEntry,
  SessionActivity,
  GitPayload,
  FilesPayload,
  QaBrowserPayload,
  PerfPayload,
  ThemeFile,
  ZeusSettings,
  AndroidPayload,
  McpPayload,
  TaskPayload,
  SubagentSessionInfo,
  SubagentType,
  SubagentCli,
} from '../../../../shared/types';
import type { PermissionsPayload } from '../../../../shared/permission-types';

export interface ConnectionSlice {
  // State
  connected: boolean;
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  toggleTunnel: () => void;
  setAutoTunnel: (enabled: boolean) => void;
}

export const createConnectionSlice: StateCreator<ZeusState, [], [], ConnectionSlice> = (set, get) => ({
  connected: false,
  powerBlock: true,
  websocket: true,
  tunnel: null,

  connect: () => {
    // Subscribe to status channel
    const unsubStatus = zeusWs.on('status', (envelope: WsEnvelope) => {
      // _connected/_disconnected are synthetic events from ZeusWs, not part of StatusPayload
      const payload = envelope.payload as Record<string, unknown>;

      if (payload.type === '_connected') {
        set({ connected: true });
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
        const sp = payload as unknown as StatusPayload & { type: 'status_update' };
        set({
          powerBlock: sp.powerBlock ?? get().powerBlock,
          websocket: sp.websocket ?? get().websocket,
          tunnel: sp.tunnel !== undefined ? sp.tunnel : get().tunnel,
        });
      }
    });

    // Subscribe to control channel
    const unsubControl = zeusWs.on('control', (envelope: WsEnvelope) => {
      const payload = envelope.payload as { type: string };

      if (payload.type === 'session_started') {
        const p = envelope.payload as SessionStartedPayload;
        const correlationId = p.correlationId;
        const matchedClaudeId = correlationId ? pendingSessionTerminals.get(correlationId) : undefined;

        if (correlationId && matchedClaudeId) {
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
          set((state) => ({
            activeSessionId: p.sessionId,
            lastActivityAt: { ...state.lastActivityAt, [p.sessionId]: Date.now() },
          }));
        }
      }

      if (payload.type === 'session_list') {
        const p = envelope.payload as SessionListPayload;
        set({ sessions: p.sessions });
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

        if (!activeId && sessions.length > 0) {
          const running = sessions.find((s) => s.status === 'running');
          const mostRecent = running ?? sessions.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
          activeId = mostRecent.id;
          set({ activeClaudeId: activeId, viewMode: 'claude' });
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
          prepend?: boolean;
        };
        const { entries, totalCount, oldestSeq, isPaginated } = p;

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
            const isLoadMore = meta && meta.oldestSeq !== null;
            const existingEntries = isLoadMore ? (state.claudeEntries[sid] ?? []) : [];
            const incomingIds = new Set(entries.map((e) => e.id));
            const deduped = existingEntries.filter((e) => !incomingIds.has(e.id));
            const merged = isLoadMore ? [...entries, ...deduped] : entries;
            let preview = state.lastUserMessagePreview[sid];
            if (!isLoadMore && lastUserPreview) {
              preview = lastUserPreview;
            } else if (!preview) {
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
        // Activity will be set to idle by the session_activity event.
      }

      if (payload.type === 'entry') {
        const entry = (envelope.payload as { entry: NormalizedEntry }).entry;
        set((state) => {
          const existing = state.claudeEntries[sid] ?? [];
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

      if (payload.type === 'queue_updated') {
        const { queue } = envelope.payload as { queue: Array<{ id: string; content: string }> };
        set((state) => ({
          messageQueue: { ...state.messageQueue, [sid]: queue },
        }));
      }

      if (payload.type === 'queue_drained') {
        const { msgId } = envelope.payload as { msgId: string };
        const queue = get().messageQueue[sid] ?? [];
        const drained = queue.find((m) => m.id === msgId);
        if (drained) {
          const userEntry: NormalizedEntry = {
            id: `user-${Date.now()}`,
            entryType: { type: 'user_message' },
            content: drained.content,
            timestamp: new Date().toISOString(),
          };
          set((state) => ({
            claudeEntries: {
              ...state.claudeEntries,
              [sid]: [...(state.claudeEntries[sid] ?? []), userEntry],
            },
            lastUserMessagePreview: {
              ...state.lastUserMessagePreview,
              [sid]: truncatePreview(drained.content),
            },
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
              ? [...state.claudeSessions, { ...restored, status: 'done' as const }]
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
        if (sid === get().activeClaudeId) {
          const totalChanges = payload.data.staged.length + payload.data.unstaged.length;
          if (!get().activeRightTab && totalChanges > 0) {
            set({ activeRightTab: 'source-control' });
          }
        }
      }

      if (payload.type === 'git_branches_result') {
        set((state) => ({
          gitBranches: { ...state.gitBranches, [sid]: payload.branches },
        }));
      }

      if (payload.type === 'git_error') {
        set((state) => ({
          gitErrors: { ...state.gitErrors, [sid]: payload.message },
        }));
      }

      // Only process detailed events for the active session
      if (sid !== get().activeClaudeId) return;

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

      if (payload.type === 'files_connected') {
        set((state) => ({
          fileTreeConnected: { ...state.fileTreeConnected, [sid]: true },
        }));
      }

      if (payload.type === 'scan_by_extension_result') {
        const files = (payload as { results: Array<{ path: string; name: string }> }).results;
        set({ markdownFiles: files });
      }

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
        const expanded = get().fileTreeExpanded[sid] || [];
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubSubagent = zeusWs.on('subagent', (envelope: WsEnvelope) => {
      const payload = envelope.payload as Record<string, any>;

      if (payload.type === 'subagent_started') {
        const { subagentId, subagentType, cli, parentSessionId, parentSessionType, name, task, targetUrl } = payload as {
          subagentId: string; subagentType?: string; cli?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; task: string; targetUrl?: string;
        };
        set((state) => {
          const existing = (state.subagents[parentSessionId] ?? []).find((a) => a.info.subagentId === subagentId);
          let agents: typeof state.subagents[string];
          if (existing) {
            agents = (state.subagents[parentSessionId] ?? []).map((a) =>
              a.info.subagentId === subagentId ? { ...a, info: { ...a.info, status: 'running' as const } } : a,
            );
          } else {
            const newAgent = {
              info: { subagentId, subagentType: (subagentType ?? 'qa') as SubagentType, cli: (cli ?? 'claude') as SubagentCli, parentSessionId, parentSessionType, name, task, targetUrl, status: 'running' as const, startedAt: Date.now() },
              entries: [] as NormalizedEntry[],
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
          const existing = state.subagents[parentSessionId] ?? [];
          const merged = agents.map((info) => {
            const found = existing.find((a) => a.info.subagentId === info.subagentId);
            return found ? { ...found, info } : { info, entries: [] as NormalizedEntry[] };
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
        const task = p.task;
        set((s) => {
          const updates: Partial<ZeusState> = {
            tasks: [task, ...s.tasks],
            taskError: null,
            activeTaskId: task.id,
          };

          if (task.sessionId) {
            const sessionExists = s.claudeSessions.some((cs) => cs.id === task.sessionId);
            if (!sessionExists) {
              const session: ClaudeSessionInfo = {
                id: task.sessionId,
                claudeSessionId: null,
                status: 'running',
                prompt: task.prompt,
                name: task.name,
                notificationSound: true,
                workingDir: task.worktreeDir,
                startedAt: task.createdAt,
              };
              const userEntry: NormalizedEntry = {
                id: `user-${Date.now()}`,
                entryType: { type: 'user_message' },
                content: task.prompt,
                timestamp: new Date().toISOString(),
              };
              updates.claudeSessions = [...s.claudeSessions, session];
              updates.activeClaudeId = task.sessionId;
              updates.claudeEntries = { ...s.claudeEntries, [task.sessionId]: [userEntry] };
              updates.lastUserMessagePreview = { ...s.lastUserMessagePreview, [task.sessionId]: truncatePreview(task.prompt) };
              updates.sessionActivity = { ...s.sessionActivity, [task.sessionId]: { state: 'starting' } };
              updates.lastActivityAt = { ...s.lastActivityAt, [task.sessionId]: Date.now() };
              updates.viewMode = 'claude';
            }
          }

          return updates;
        });

        if (task.sessionId && task.worktreeDir) {
          zeusWs.send({
            channel: 'git',
            sessionId: task.sessionId,
            payload: { type: 'start_watching', workingDir: task.worktreeDir },
            auth: '',
          });
          zeusWs.send({
            channel: 'files',
            sessionId: task.sessionId,
            payload: { type: 'start_watching', workingDir: task.worktreeDir },
            auth: '',
          });
        }
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

    const unsubPermissions = zeusWs.on('permissions', (envelope: WsEnvelope) => {
      const payload = envelope.payload as PermissionsPayload;

      if (payload.type === 'rules_updated') {
        set((state) => ({
          permissionRules: { ...state.permissionRules, [payload.projectId]: payload.rules },
        }));
      }

      if (payload.type === 'templates_list') {
        set({ permissionTemplates: payload.templates });
      }

      if (payload.type === 'audit_log') {
        set((state) => ({
          permissionAuditLog: {
            ...state.permissionAuditLog,
            [payload.sessionId]: { entries: payload.entries, total: payload.total },
          },
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
      unsubFiles();
      unsubQA();
      unsubSubagent();
      unsubPerf();
      unsubAndroid();
      unsubMcp();
      unsubTask();
      unsubPermissions();
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
});
