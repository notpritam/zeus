// src/shared/permission-types.ts
// All permission-related types — single source of truth

/** Three-state action for a permission rule */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/** A single permission rule: tool + glob pattern → action */
export interface PermissionRule {
  /** Tool name pattern — supports globs. e.g. "Edit", "Bash", "Read", "mcp_*", "*" */
  tool: string;
  /** File/command pattern — supports globs. e.g. "src/**", "*.env", "rm -rf *", "*" */
  pattern: string;
  /** What to do when this rule matches */
  action: PermissionAction;
}

/** Built-in template definition */
export interface PermissionTemplate {
  id: string;
  name: string;
  description: string;
  rules: PermissionRule[];
}

/** Audit log entry — tracks every permission decision */
export interface PermissionAuditEntry {
  id: string;
  sessionId: string;
  projectId: string | null;
  toolName: string;
  pattern: string;         // the file path or command that was evaluated
  action: PermissionAction; // what was decided
  ruleMatched: string | null; // JSON of the rule that matched, or null if default
  timestamp: number;
}

/** WebSocket payloads for the permissions channel */
export type PermissionsPayload =
  | { type: 'get_rules'; projectId: string }
  | { type: 'set_rules'; projectId: string; rules: PermissionRule[] }
  | { type: 'apply_template'; projectId: string; templateId: string }
  | { type: 'get_templates' }
  | { type: 'get_audit_log'; sessionId: string; limit?: number; offset?: number }
  | { type: 'clear_rules'; projectId: string }
  // Response payloads
  | { type: 'rules_updated'; projectId: string; rules: PermissionRule[] }
  | { type: 'templates_list'; templates: PermissionTemplate[] }
  | { type: 'audit_log'; sessionId: string; entries: PermissionAuditEntry[]; total: number }
  | { type: 'permissions_error'; message: string };
