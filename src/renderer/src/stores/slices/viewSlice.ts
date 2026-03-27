import type { StateCreator } from 'zustand';
import type { ZeusState, ViewMode } from '../types';
import { zeusWs } from '@/lib/ws';

export interface ViewSlice {
  // State
  viewMode: ViewMode;
  activeRightTab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setActiveRightTab: (tab: 'source-control' | 'explorer' | 'subagents' | 'browser' | 'info' | 'settings' | 'android' | 'mcp' | 'tasks' | null) => void;
  toggleRightPanel: () => void;
}

export const createViewSlice: StateCreator<ZeusState, [], [], ViewSlice> = (set, get) => ({
  viewMode: 'terminal',
  activeRightTab: null,

  setViewMode: (mode: ViewMode) => {
    set((state) => ({
      viewMode: mode,
      previousViewMode: state.viewMode !== 'diff' ? state.viewMode : state.previousViewMode,
    }));
  },

  setActiveRightTab: (tab) => {
    set({ activeRightTab: tab });
    if (tab === 'browser') {
      zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'get_qa_status' }, auth: '' });
    }
  },

  toggleRightPanel: () => {
    set((state) => ({ activeRightTab: state.activeRightTab ? null : 'source-control' }));
  },
});
