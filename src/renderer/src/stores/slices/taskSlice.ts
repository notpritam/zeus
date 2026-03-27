import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type { TaskRecord, PermissionMode } from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface TaskSlice {
  // State
  tasks: TaskRecord[];
  activeTaskId: string | null;
  taskError: string | null;

  // Actions
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

export const createTaskSlice: StateCreator<ZeusState, [], [], TaskSlice> = (set) => ({
  tasks: [],
  activeTaskId: null,
  taskError: null,

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
});
