import type { StateCreator } from 'zustand';
import type { ZeusState, ViewMode, DiffTab } from '../types';
import { zeusWs } from '@/lib/ws';

export interface DiffSlice {
  // State
  openDiffTabs: DiffTab[];
  activeDiffTabId: string | null;
  previousViewMode: ViewMode;

  // Actions
  openDiffTab: (sessionId: string, file: string, staged: boolean) => void;
  openApprovalDiff: (sessionId: string, filePath: string, original: string, modified: string) => void;
  closeDiffTab: (tabId: string) => void;
  closeAllDiffTabs: () => void;
  setActiveDiffTab: (tabId: string) => void;
  updateDiffContent: (tabId: string, content: string) => void;
  saveDiffFile: (tabId: string) => void;
  returnToHome: () => void;
}

export const createDiffSlice: StateCreator<ZeusState, [], [], DiffSlice> = (set, get) => ({
  openDiffTabs: [],
  activeDiffTabId: null,
  previousViewMode: 'terminal',

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
      zeusWs.send({
        channel: 'files',
        sessionId: tab.sessionId,
        payload: { type: 'save_file', filePath: tab.file, content: tab.modified },
        auth: '',
      });
    } else {
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
});
