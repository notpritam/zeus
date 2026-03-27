import type { StateCreator } from 'zustand';
import type { ZeusState, ViewMode } from '../types';
import type { FileTreeEntry } from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface FileSlice {
  // State
  fileTree: Record<string, Record<string, FileTreeEntry[]>>;
  fileTreeExpanded: Record<string, string[]>;
  fileTreeConnected: Record<string, boolean>;
  markdownFiles: Array<{ path: string; name: string }>;

  // Actions
  toggleFileTreeDir: (sessionId: string, dirPath: string) => void;
  openFileTab: (sessionId: string, filePath: string) => void;
  saveFileTab: (tabId: string) => void;
  reconnectFileWatcher: () => void;
  fetchMarkdownFiles: (sessionId: string) => void;
}

export const createFileSlice: StateCreator<ZeusState, [], [], FileSlice> = (set, get) => ({
  fileTree: {},
  fileTreeExpanded: {},
  fileTreeConnected: {},
  markdownFiles: [] as Array<{ path: string; name: string }>,

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

  fetchMarkdownFiles: (sessionId: string) => {
    zeusWs.send({
      channel: 'files', sessionId, auth: '',
      payload: { type: 'scan_by_extension', ext: '.md' },
    });
  },
});
