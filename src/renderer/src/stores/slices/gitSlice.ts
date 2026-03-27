import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type { GitStatusData, GitBranchInfo } from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface GitSlice {
  // State
  gitStatus: Record<string, GitStatusData>;
  gitErrors: Record<string, string>;
  gitWatcherConnected: Record<string, boolean>;
  gitNotARepo: Record<string, boolean>;
  gitBranches: Record<string, GitBranchInfo[]>;
  gitPushing: Record<string, boolean>;
  gitPulling: Record<string, boolean>;

  // Actions
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
  reconnectGitWatcher: () => void;
}

export const createGitSlice: StateCreator<ZeusState, [], [], GitSlice> = (set, get) => ({
  gitStatus: {},
  gitErrors: {},
  gitWatcherConnected: {},
  gitNotARepo: {},
  gitBranches: {},
  gitPushing: {},
  gitPulling: {},

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
});
