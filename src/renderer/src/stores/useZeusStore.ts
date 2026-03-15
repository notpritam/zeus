import { create } from 'zustand';
import { zeusWs } from '@/lib/ws';
import type {
  SessionRecord,
  WsEnvelope,
  SessionStartedPayload,
  SessionListPayload,
  SessionUpdatedPayload,
  StatusPayload,
  ClaudeSessionInfo,
  ClaudeApprovalInfo,
  NormalizedEntry,
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

  // View mode
  viewMode: ViewMode;

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  fetchSessions: () => void;
  startSession: (cols?: number, rows?: number) => void;
  stopSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;

  // Claude actions
  startClaudeSession: (prompt: string, workingDir?: string) => void;
  sendClaudeMessage: (content: string) => void;
  approveClaudeTool: (approvalId: string) => void;
  denyClaudeTool: (approvalId: string, reason?: string) => void;
  interruptClaude: () => void;
  stopClaude: () => void;
  selectClaudeSession: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
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
  viewMode: 'terminal',

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
          tunnel: payload.tunnel ?? get().tunnel,
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

    zeusWs.connect();

    // Return cleanup function
    return () => {
      unsubStatus();
      unsubControl();
      unsubClaude();
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

  startClaudeSession: (prompt: string, workingDir?: string) => {
    const id = `claude-${Date.now()}-${++claudeIdCounter}`;
    const session: ClaudeSessionInfo = {
      id,
      claudeSessionId: null,
      status: 'running',
      prompt,
      startedAt: Date.now(),
    };

    set((state) => ({
      claudeSessions: [...state.claudeSessions, session],
      activeClaudeId: id,
      claudeEntries: { ...state.claudeEntries, [id]: [] },
      viewMode: 'claude',
    }));

    zeusWs.send({
      channel: 'claude',
      sessionId: id,
      payload: { type: 'start_claude', prompt, workingDir },
      auth: '',
    });
  },

  sendClaudeMessage: (content: string) => {
    const { activeClaudeId } = get();
    if (!activeClaudeId) return;

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
  },

  setViewMode: (mode: ViewMode) => {
    set({ viewMode: mode });
  },
}));
