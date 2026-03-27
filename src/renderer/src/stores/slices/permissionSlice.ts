import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type { PermissionRule, PermissionTemplate, PermissionAuditEntry } from '../../../../shared/permission-types';
import { zeusWs } from '@/lib/ws';

export interface PermissionSlice {
  // State
  permissionRules: Record<string, PermissionRule[]>;
  permissionTemplates: PermissionTemplate[];
  permissionAuditLog: Record<string, { entries: PermissionAuditEntry[]; total: number }>;

  // Actions
  fetchPermissionRules: (projectId: string) => void;
  setPermissionRules: (projectId: string, rules: PermissionRule[]) => void;
  applyPermissionTemplate: (projectId: string, templateId: string) => void;
  fetchPermissionTemplates: () => void;
  clearPermissionRules: (projectId: string) => void;
  fetchAuditLog: (sessionId: string, limit?: number, offset?: number) => void;
}

export const createPermissionSlice: StateCreator<ZeusState, [], [], PermissionSlice> = (set) => ({
  permissionRules: {},
  permissionTemplates: [],
  permissionAuditLog: {},

  fetchPermissionRules: (projectId) => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'get_rules', projectId },
    });
  },

  setPermissionRules: (projectId, rules) => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'set_rules', projectId, rules },
    });
  },

  applyPermissionTemplate: (projectId, templateId) => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'apply_template', projectId, templateId },
    });
  },

  fetchPermissionTemplates: () => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'get_templates' },
    });
  },

  clearPermissionRules: (projectId) => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'clear_rules', projectId },
    });
  },

  fetchAuditLog: (sessionId, limit, offset) => {
    zeusWs.send({
      channel: 'permissions', sessionId: '', auth: '',
      payload: { type: 'get_audit_log', sessionId, limit, offset },
    });
  },
});
