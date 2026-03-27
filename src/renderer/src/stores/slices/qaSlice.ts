import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type {
  QaInstanceInfo,
  QaSnapshotNode,
  QaTabInfo,
} from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface QaSlice {
  // State
  qaRunning: boolean;
  qaInstances: QaInstanceInfo[];
  qaSnapshot: QaSnapshotNode[] | null;
  qaSnapshotRaw: string | null;
  qaScreenshot: string | null;
  qaText: string | null;
  qaError: string | null;
  qaLoading: boolean;
  qaTabs: QaTabInfo[];
  qaCurrentUrl: string;
  qaConsoleLogs: Array<{ level: string; message: string; timestamp: number }>;
  qaNetworkRequests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string }>;
  qaJsErrors: Array<{ message: string; stack: string; timestamp: number }>;
  qaUrlDetectionResult: { sessionId: string; qaTargetUrl: string | null; source: string; detail: string; framework?: string; verification?: string; timestamp: number } | null;

  // Actions
  startQA: () => void;
  stopQA: () => void;
  launchQAInstance: (headless?: boolean) => void;
  stopQAInstance: (instanceId: string) => void;
  navigateQA: (url: string) => void;
  takeSnapshot: (filter?: 'interactive' | 'full') => void;
  takeScreenshot: () => void;
  performQAAction: (kind: string, ref?: string, value?: string, key?: string) => void;
  extractQAText: () => void;
  fetchQATabs: () => void;
  clearQAError: () => void;
}

export const createQaSlice: StateCreator<ZeusState, [], [], QaSlice> = (set, get) => ({
  qaRunning: false,
  qaInstances: [],
  qaSnapshot: null,
  qaSnapshotRaw: null,
  qaScreenshot: null,
  qaText: null,
  qaError: null,
  qaLoading: false,
  qaTabs: [],
  qaCurrentUrl: window.location.origin,
  qaConsoleLogs: [],
  qaNetworkRequests: [],
  qaJsErrors: [],
  qaUrlDetectionResult: null,

  startQA: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'start_qa' }, auth: '' });
  },

  stopQA: () => {
    set({ qaLoading: true });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'stop_qa' }, auth: '' });
  },

  launchQAInstance: (headless?: boolean) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'launch_instance', headless }, auth: '' });
  },

  stopQAInstance: (instanceId: string) => {
    set({ qaLoading: true });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'stop_instance', instanceId }, auth: '' });
  },

  navigateQA: (url: string) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'navigate', url }, auth: '' });
  },

  takeSnapshot: (filter?: 'interactive' | 'full') => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'snapshot', filter }, auth: '' });
  },

  takeScreenshot: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'screenshot' }, auth: '' });
  },

  performQAAction: (kind: string, ref?: string, value?: string, key?: string) => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'action', kind, ref, value, key }, auth: '' });
  },

  extractQAText: () => {
    set({ qaLoading: true, qaError: null });
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'text' }, auth: '' });
  },

  fetchQATabs: () => {
    zeusWs.send({ channel: 'qa', sessionId: '', payload: { type: 'list_tabs' }, auth: '' });
  },

  clearQAError: () => {
    set({ qaError: null });
  },
});
