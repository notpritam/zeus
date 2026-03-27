import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type { SystemMetrics } from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface PerfSlice {
  // State
  perfMetrics: SystemMetrics | null;
  perfMonitoring: boolean;

  // Actions
  startPerfMonitoring: () => void;
  stopPerfMonitoring: () => void;
  setPerfPollInterval: (intervalMs: number) => void;
}

export const createPerfSlice: StateCreator<ZeusState, [], [], PerfSlice> = (set) => ({
  perfMetrics: null,
  perfMonitoring: false,

  startPerfMonitoring: () => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'start_monitoring' },
      auth: '',
    });
    set({ perfMonitoring: true });
  },

  stopPerfMonitoring: () => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'stop_monitoring' },
      auth: '',
    });
    set({ perfMonitoring: false, perfMetrics: null });
  },

  setPerfPollInterval: (intervalMs: number) => {
    zeusWs.send({
      channel: 'perf',
      sessionId: '',
      payload: { type: 'set_poll_interval', intervalMs },
      auth: '',
    });
  },
});
