import type { StateCreator } from 'zustand';
import type { ZeusState, SubagentClient } from '../types';
import type { SubagentType, SubagentCli } from '../../../../shared/types';
import type { FlowSummary } from '../../../../shared/qa-flow-types';
import { zeusWs } from '@/lib/ws';

export interface SubagentSlice {
  // State
  subagents: Record<string, SubagentClient[]>;
  activeSubagentId: Record<string, string | null>;
  qaFlows: FlowSummary[];

  // Actions
  startSubagent: (subagentType: SubagentType, cli: SubagentCli, inputs: Record<string, string>, workingDir: string, parentSessionId: string, parentSessionType: 'terminal' | 'claude', name?: string) => void;
  stopSubagent: (subagentId: string) => void;
  deleteSubagent: (subagentId: string, parentSessionId: string) => void;
  sendSubagentMessage: (subagentId: string, text: string) => void;
  clearSubagentEntries: (subagentId: string) => void;
  selectSubagent: (parentSessionId: string, subagentId: string | null) => void;
  fetchSubagents: (parentSessionId: string) => void;
  fetchSubagentEntries: (subagentId: string) => void;
  fetchQaFlows: () => void;
}

export const createSubagentSlice: StateCreator<ZeusState, [], [], SubagentSlice> = (set, get) => ({
  subagents: {},
  activeSubagentId: {},
  qaFlows: [] as FlowSummary[],

  startSubagent: (subagentType, cli, inputs, workingDir, parentSessionId, parentSessionType, name) => {
    const envelope = {
      channel: 'subagent' as const, sessionId: parentSessionId, auth: '',
      payload: { type: 'start_subagent', subagentType, cli, inputs, workingDir, parentSessionId, parentSessionType, name },
    };
    console.log('[ZeusStore] startSubagent sending WS message:', envelope);
    zeusWs.send(envelope);
  },

  stopSubagent: (subagentId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'stop_subagent', subagentId },
    });
  },

  deleteSubagent: (subagentId: string, parentSessionId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'delete_subagent', subagentId, parentSessionId },
    });
  },

  sendSubagentMessage: (subagentId: string, text: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_message', subagentId, text },
    });
  },

  clearSubagentEntries: (subagentId: string) => {
    set((state) => {
      const updated = { ...state.subagents };
      for (const [psid, agents] of Object.entries(updated)) {
        const idx = agents.findIndex((a) => a.info.subagentId === subagentId);
        if (idx !== -1) {
          updated[psid] = agents.map((a) =>
            a.info.subagentId === subagentId ? { ...a, entries: [] } : a,
          );
          break;
        }
      }
      return { subagents: updated };
    });
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'clear_subagent_entries', subagentId },
    });
  },

  selectSubagent: (parentSessionId: string, subagentId: string | null) => {
    set((state) => ({
      activeSubagentId: { ...state.activeSubagentId, [parentSessionId]: subagentId },
    }));
  },

  fetchSubagents: (parentSessionId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'list_subagents', parentSessionId },
    });
  },

  fetchSubagentEntries: (subagentId: string) => {
    zeusWs.send({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'get_subagent_entries', subagentId },
    });
  },

  fetchQaFlows: () => {
    zeusWs.send({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'list_qa_flows' },
    });
  },
});
