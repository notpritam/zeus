import { create } from 'zustand';
import { zeusWs } from '@/lib/ws';
import type {
  SessionRecord,
  WsEnvelope,
  SessionStartedPayload,
  SessionListPayload,
  SessionUpdatedPayload,
  StatusPayload,
} from '../../../shared/types';

interface ZeusState {
  // Connection
  connected: boolean;

  // Status (from WS status channel)
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;

  // Sessions (from WS control channel)
  sessions: SessionRecord[];
  activeSessionId: string | null;

  // Actions
  connect: () => () => void;
  togglePower: () => void;
  fetchSessions: () => void;
  startSession: (cols?: number, rows?: number) => void;
  stopSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
}

export const useZeusStore = create<ZeusState>((set, get) => ({
  connected: false,
  powerBlock: true,
  websocket: true,
  tunnel: null,
  sessions: [],
  activeSessionId: null,

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

    zeusWs.connect();

    // Return cleanup function
    return () => {
      unsubStatus();
      unsubControl();
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
    set({ activeSessionId: sessionId });
  },
}));
