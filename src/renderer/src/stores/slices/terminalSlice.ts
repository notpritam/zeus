import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type { SessionRecord } from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

// Maps correlationId (= tabId) -> claudeSessionId for pending terminal tab creation
export const pendingSessionTerminals = new Map<string, string>();

export interface TerminalSlice {
  // State
  sessions: SessionRecord[];
  activeSessionId: string | null;
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
  fetchSessions: () => void;
  startSession: (cols?: number, rows?: number) => void;
  stopSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
  deleteTerminalSession: (id: string) => void;
  restoreTerminalSession: (id: string) => void;
  archiveTerminalSession: (id: string) => void;
  createSessionTerminal: (claudeSessionId: string, cwd: string) => void;
  closeSessionTerminal: (claudeSessionId: string, tabId: string) => void;
  switchSessionTerminal: (claudeSessionId: string, tabId: string) => void;
  toggleSessionTerminalPanel: (claudeSessionId: string) => void;
  setSessionTerminalExited: (claudeSessionId: string, tabId: string, exitCode: number) => void;
  restartSessionTerminal: (claudeSessionId: string, tabId: string, cwd: string) => void;
  setTerminalPanelHeight: (height: number) => void;
  destroyAllSessionTerminals: (claudeSessionId: string) => void;
}

export const createTerminalSlice: StateCreator<ZeusState, [], [], TerminalSlice> = (set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionTerminals: {},
  terminalPanelHeight: parseInt(localStorage.getItem('zeus-terminal-panel-height') || '30', 10),

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
    if (state.viewMode === 'diff') {
      set({ activeSessionId: sessionId, activeClaudeId: null, viewMode: 'terminal' });
    } else {
      set({ activeSessionId: sessionId, viewMode: 'terminal' });
    }
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

  toggleSessionTerminalPanel: (claudeSessionId: string) => {
    const state = get();
    const existing = state.sessionTerminals[claudeSessionId];

    if (!existing) {
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

    if (tabs.length >= 5) return;

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
});
