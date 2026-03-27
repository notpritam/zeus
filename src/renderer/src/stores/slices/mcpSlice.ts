import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type {
  McpServerRecord,
  McpProfileRecord,
  McpHealthResult,
  SessionMcpRecord,
} from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface McpSlice {
  // State
  mcpServers: McpServerRecord[];
  mcpProfiles: McpProfileRecord[];
  mcpHealthResults: Record<string, McpHealthResult>;
  sessionMcps: Record<string, SessionMcpRecord[]>;
  mcpImportResult: { imported: string[]; skipped: string[] } | null;

  // Actions
  fetchMcpServers: () => void;
  addMcpServer: (name: string, command: string, args?: string[], env?: Record<string, string>) => void;
  updateMcpServer: (id: string, updates: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }) => void;
  removeMcpServer: (id: string) => void;
  toggleMcpServer: (id: string, enabled: boolean) => void;
  healthCheckMcp: (id?: string) => void;
  importMcpFromClaude: () => void;
  fetchMcpProfiles: () => void;
  createMcpProfile: (name: string, description: string, serverIds: string[]) => void;
  updateMcpProfile: (id: string, updates: { name?: string; description?: string; serverIds?: string[] }) => void;
  deleteMcpProfile: (id: string) => void;
  setDefaultMcpProfile: (id: string) => void;
  fetchSessionMcps: (sessionId: string) => void;
  clearMcpImportResult: () => void;
}

export const createMcpSlice: StateCreator<ZeusState, [], [], McpSlice> = (set) => ({
  mcpServers: [],
  mcpProfiles: [],
  mcpHealthResults: {},
  sessionMcps: {},
  mcpImportResult: null,

  fetchMcpServers: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_servers' }, auth: '' });
  },

  addMcpServer: (name, command, args, env) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'add_server', name, command, args, env }, auth: '' });
  },

  updateMcpServer: (id, updates) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'update_server', id, ...updates }, auth: '' });
  },

  removeMcpServer: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'remove_server', id }, auth: '' });
  },

  toggleMcpServer: (id, enabled) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'toggle_server', id, enabled }, auth: '' });
  },

  healthCheckMcp: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'health_check', id }, auth: '' });
  },

  importMcpFromClaude: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'import_claude' }, auth: '' });
  },

  fetchMcpProfiles: () => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_profiles' }, auth: '' });
  },

  createMcpProfile: (name, description, serverIds) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'create_profile', name, description, serverIds }, auth: '' });
  },

  updateMcpProfile: (id, updates) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'update_profile', id, ...updates }, auth: '' });
  },

  deleteMcpProfile: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'delete_profile', id }, auth: '' });
  },

  setDefaultMcpProfile: (id) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'set_default_profile', id }, auth: '' });
  },

  fetchSessionMcps: (sessionId) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_session_mcps', sessionId }, auth: '' });
  },

  clearMcpImportResult: () => {
    set({ mcpImportResult: null });
  },
});
