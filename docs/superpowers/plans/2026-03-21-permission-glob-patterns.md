# Permission System with Glob Patterns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Zeus's 4 broad permission modes with fine-grained, per-project permission rules using glob patterns — auto-resolving Claude CLI approval requests based on tool name + file path matching.

**Architecture:** A permission evaluator intercepts Claude CLI's `can_use_tool` control requests inside `ClaudeSession.handleControlRequest()`. Before forwarding to the frontend (the current `approval_needed` flow), it evaluates the request against the project's permission ruleset. If a rule says `allow`, it auto-approves. If `deny`, it auto-denies. If `ask` (or no match), the existing approval UI takes over. Rules are stored per-project in SQLite. Templates are pre-built rulesets.

**Tech Stack:** TypeScript, better-sqlite3, picomatch (glob matching), existing Zustand store, existing WebSocket envelope protocol.

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/shared/permission-types.ts` | Permission rule types, template definitions, audit entry type |
| **Create:** `src/main/services/permission-evaluator.ts` | Core evaluation logic: `evaluate()`, wildcard matching, template definitions |
| **Create:** `src/renderer/src/components/PermissionRulesEditor.tsx` | UI for managing per-project permission rules |
| **Modify:** `src/main/services/db.ts` | Migration 13: `permission_rules` + `permission_audit_log` tables |
| **Modify:** `src/main/services/claude-session.ts` | Intercept `handleControlRequest` with evaluator |
| **Modify:** `src/main/services/websocket.ts` | Handle `permissions` channel messages, audit log queries |
| **Modify:** `src/shared/types.ts` | Add `'permissions'` to WsEnvelope channel, permission payloads |
| **Modify:** `src/renderer/src/stores/useZeusStore.ts` | Permission rules state slice + actions |
| **Modify:** `src/renderer/src/components/NewSessionView.tsx` | Show active rules summary, link to editor |
| **Modify:** `src/renderer/src/components/RightPanel.tsx` | (optional) Permission rules activity bar icon |

---

### Task 1: Permission Types

**Files:**
- Create: `src/shared/permission-types.ts`

- [ ] **Step 1: Create the permission types file**

```typescript
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

/** A named set of rules stored per-project */
export interface PermissionRuleset {
  id: string;
  projectId: string;
  name: string;            // e.g. "Frontend Dev", "DevOps", or "Custom"
  rules: PermissionRule[];
  isTemplate: boolean;     // true if derived from a built-in template
  createdAt: number;
  updatedAt: number;
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
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep permission-types || echo "No errors"`
Expected: No errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/permission-types.ts
git commit -m "feat(permissions): add permission rule types, template types, and audit entry types"
```

---

### Task 2: Permission Evaluator

**Files:**
- Create: `src/main/services/permission-evaluator.ts`

This is the core logic — pure functions, no side effects, easy to test.

- [ ] **Step 1: Create the evaluator module**

```typescript
// src/main/services/permission-evaluator.ts
import picomatch from 'picomatch';
import type { PermissionRule, PermissionAction, PermissionTemplate } from '../../shared/permission-types';

/**
 * Evaluate a tool call against a ruleset.
 * Uses LAST-WINS strategy: later rules override earlier ones.
 * Returns 'ask' if no rule matches (safe default).
 */
export function evaluate(
  toolName: string,
  pattern: string,
  rules: PermissionRule[],
): { action: PermissionAction; matchedRule: PermissionRule | null } {
  let matchedRule: PermissionRule | null = null;

  for (const rule of rules) {
    if (matchGlob(toolName, rule.tool) && matchGlob(pattern, rule.pattern)) {
      matchedRule = rule;
      // Don't break — last match wins
    }
  }

  return {
    action: matchedRule?.action ?? 'ask',
    matchedRule,
  };
}

/**
 * Match a string against a glob pattern.
 * Supports: * (any chars), ? (single char), ** (any path segments)
 * Special cases: exact string match, "*" matches everything.
 */
export function matchGlob(str: string, pattern: string): boolean {
  // Exact wildcard matches everything
  if (pattern === '*') return true;

  // Exact match (fast path)
  if (pattern === str) return true;

  // Normalize path separators
  const normalizedStr = str.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Use picomatch for glob matching
  return picomatch.isMatch(normalizedStr, normalizedPattern, {
    dot: true,          // match dotfiles
    nocase: false,      // case-sensitive
    contains: false,    // full match required
  });
}

/**
 * Extract the relevant pattern from a tool call's input.
 * Maps tool names to the file path or command being accessed.
 */
export function extractPattern(toolName: string, toolInput: unknown): string {
  const input = toolInput as Record<string, unknown> | null;
  if (!input) return '*';

  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return String(input.file_path ?? input.filePath ?? '*');

    case 'Bash':
      return String(input.command ?? '*');

    case 'Glob':
      return String(input.pattern ?? '*');

    case 'Grep':
      return String(input.path ?? input.pattern ?? '*');

    case 'NotebookEdit':
    case 'NotebookRead':
      return String(input.notebook_path ?? '*');

    case 'WebFetch':
    case 'WebSearch':
      return String(input.url ?? input.query ?? '*');

    default:
      // For MCP tools and others, use the first string value or '*'
      for (const val of Object.values(input)) {
        if (typeof val === 'string' && val.length > 0 && val.length < 500) return val;
      }
      return '*';
  }
}

/**
 * Make a file path relative to the project directory for matching.
 * Rules use relative paths (e.g. "src/**") but tools receive absolute paths.
 */
export function relativize(filePath: string, projectDir: string): string {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedProject = projectDir.replace(/\\/g, '/').replace(/\/$/, '') + '/';

  if (normalizedFile.startsWith(normalizedProject)) {
    return normalizedFile.slice(normalizedProject.length);
  }
  return normalizedFile; // outside project — use absolute path
}

// ─── Built-in Templates ───

export const PERMISSION_TEMPLATES: PermissionTemplate[] = [
  {
    id: 'frontend-dev',
    name: 'Frontend Dev',
    description: 'Allow edits in src/, deny config files, ask for bash commands',
    rules: [
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },
      { tool: 'Edit', pattern: 'src/**', action: 'allow' },
      { tool: 'Write', pattern: 'src/**', action: 'allow' },
      { tool: 'Edit', pattern: 'public/**', action: 'allow' },
      { tool: 'Edit', pattern: '*.env*', action: 'deny' },
      { tool: 'Edit', pattern: '*.secret*', action: 'deny' },
      { tool: 'Edit', pattern: 'config/**', action: 'ask' },
      { tool: 'Bash', pattern: 'npm *', action: 'allow' },
      { tool: 'Bash', pattern: 'npx *', action: 'allow' },
      { tool: 'Bash', pattern: 'yarn *', action: 'allow' },
      { tool: 'Bash', pattern: 'pnpm *', action: 'allow' },
      { tool: 'Bash', pattern: 'bun *', action: 'allow' },
      { tool: 'Bash', pattern: 'git *', action: 'allow' },
      { tool: 'Bash', pattern: 'rm *', action: 'ask' },
      { tool: 'Bash', pattern: '*', action: 'ask' },
    ],
  },
  {
    id: 'full-stack',
    name: 'Full Stack',
    description: 'Allow edits everywhere except secrets, allow common dev commands',
    rules: [
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },
      { tool: 'Edit', pattern: '**', action: 'allow' },
      { tool: 'Write', pattern: '**', action: 'allow' },
      { tool: 'Edit', pattern: '*.env*', action: 'deny' },
      { tool: 'Edit', pattern: '**/*.secret*', action: 'deny' },
      { tool: 'Edit', pattern: '**/credentials*', action: 'deny' },
      { tool: 'Bash', pattern: 'npm *', action: 'allow' },
      { tool: 'Bash', pattern: 'npx *', action: 'allow' },
      { tool: 'Bash', pattern: 'git *', action: 'allow' },
      { tool: 'Bash', pattern: 'docker *', action: 'allow' },
      { tool: 'Bash', pattern: 'make *', action: 'allow' },
      { tool: 'Bash', pattern: 'cargo *', action: 'allow' },
      { tool: 'Bash', pattern: 'go *', action: 'allow' },
      { tool: 'Bash', pattern: 'python *', action: 'allow' },
      { tool: 'Bash', pattern: 'rm -rf *', action: 'ask' },
      { tool: 'Bash', pattern: '*', action: 'ask' },
    ],
  },
  {
    id: 'devops',
    name: 'DevOps',
    description: 'Allow bash and infra commands, deny writing app code',
    rules: [
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },
      { tool: 'Edit', pattern: 'src/**', action: 'deny' },
      { tool: 'Edit', pattern: 'Dockerfile*', action: 'allow' },
      { tool: 'Edit', pattern: 'docker-compose*', action: 'allow' },
      { tool: 'Edit', pattern: '.github/**', action: 'allow' },
      { tool: 'Edit', pattern: '**/infra/**', action: 'allow' },
      { tool: 'Edit', pattern: '*.yml', action: 'allow' },
      { tool: 'Edit', pattern: '*.yaml', action: 'allow' },
      { tool: 'Edit', pattern: '*.toml', action: 'allow' },
      { tool: 'Bash', pattern: '*', action: 'allow' },
      { tool: 'Bash', pattern: 'rm -rf /*', action: 'deny' },
    ],
  },
  {
    id: 'read-only',
    name: 'Read Only',
    description: 'Allow reads and searches only — no edits, no commands',
    rules: [
      { tool: 'Read', pattern: '*', action: 'allow' },
      { tool: 'Glob', pattern: '*', action: 'allow' },
      { tool: 'Grep', pattern: '*', action: 'allow' },
      { tool: 'Edit', pattern: '*', action: 'deny' },
      { tool: 'Write', pattern: '*', action: 'deny' },
      { tool: 'Bash', pattern: '*', action: 'deny' },
      { tool: 'WebFetch', pattern: '*', action: 'ask' },
    ],
  },
  {
    id: 'yolo',
    name: 'YOLO (Allow All)',
    description: 'Allow everything — equivalent to bypassPermissions but with audit logging',
    rules: [
      { tool: '*', pattern: '*', action: 'allow' },
    ],
  },
];
```

- [ ] **Step 2: Install picomatch**

Run: `npm install picomatch && npm install -D @types/picomatch`

- [ ] **Step 3: Verify file compiles**

Run: `npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep permission-evaluator || echo "No errors"`

- [ ] **Step 4: Commit**

```bash
git add src/main/services/permission-evaluator.ts package.json package-lock.json
git commit -m "feat(permissions): add permission evaluator with glob matching and 5 built-in templates"
```

---

### Task 3: Database Migration

**Files:**
- Modify: `src/main/services/db.ts`

- [ ] **Step 1: Bump SCHEMA_VERSION and add migration 13**

In `db.ts`, change `SCHEMA_VERSION` from `12` to `13`, then add:

```typescript
  if (currentVersion < 13) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS permission_rules (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        name        TEXT NOT NULL DEFAULT 'Custom',
        rules       TEXT NOT NULL DEFAULT '[]',
        is_template INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pr_project ON permission_rules(project_id);

      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        project_id  TEXT,
        tool_name   TEXT NOT NULL,
        pattern     TEXT NOT NULL,
        action      TEXT NOT NULL,
        rule_matched TEXT,
        timestamp   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pal_session ON permission_audit_log(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_pal_project ON permission_audit_log(project_id, timestamp);
    `);
  }
```

- [ ] **Step 2: Add CRUD helpers for permission rules**

Add after existing CRUD functions:

```typescript
// ─── Permission Rules ───

export function getPermissionRules(projectId: string): PermissionRule[] {
  const database = getDb();
  const row = database.prepare(
    'SELECT rules FROM permission_rules WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(projectId) as { rules: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.rules);
  } catch {
    return [];
  }
}

export function setPermissionRules(projectId: string, rules: PermissionRule[], name = 'Custom', isTemplate = false): void {
  const database = getDb();
  const existing = database.prepare(
    'SELECT id FROM permission_rules WHERE project_id = ? LIMIT 1'
  ).get(projectId) as { id: string } | undefined;
  const now = Date.now();

  if (existing) {
    database.prepare(
      'UPDATE permission_rules SET rules = ?, name = ?, is_template = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(rules), name, isTemplate ? 1 : 0, now, existing.id);
  } else {
    const id = crypto.randomUUID();
    database.prepare(
      'INSERT INTO permission_rules (id, project_id, name, rules, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, name, JSON.stringify(rules), isTemplate ? 1 : 0, now, now);
  }
}

export function clearPermissionRules(projectId: string): void {
  const database = getDb();
  database.prepare('DELETE FROM permission_rules WHERE project_id = ?').run(projectId);
}

// ─── Permission Audit Log ───

export function insertAuditEntry(entry: {
  id: string; sessionId: string; projectId: string | null;
  toolName: string; pattern: string; action: string;
  ruleMatched: string | null; timestamp: number;
}): void {
  const database = getDb();
  database.prepare(
    `INSERT INTO permission_audit_log (id, session_id, project_id, tool_name, pattern, action, rule_matched, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entry.id, entry.sessionId, entry.projectId, entry.toolName, entry.pattern, entry.action, entry.ruleMatched, entry.timestamp);
}

export function getAuditLog(sessionId: string, limit = 100, offset = 0): { entries: any[]; total: number } {
  const database = getDb();
  const total = (database.prepare(
    'SELECT COUNT(*) as count FROM permission_audit_log WHERE session_id = ?'
  ).get(sessionId) as { count: number }).count;

  const entries = database.prepare(
    'SELECT * FROM permission_audit_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset);

  return { entries, total };
}

export function pruneOldAuditLogs(maxAgeDays = 30): void {
  const database = getDb();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  database.prepare('DELETE FROM permission_audit_log WHERE timestamp < ?').run(cutoff);
}
```

Add the imports at the top of db.ts:
```typescript
import crypto from 'crypto';
import type { PermissionRule } from '../../shared/permission-types';
```

**Note:** `crypto` is needed for `crypto.randomUUID()` in `setPermissionRules()`. Check if `crypto` is already imported — if not, add it.

Wire `pruneOldAuditLogs()` into the existing `pruneOldSessions()` function.

- [ ] **Step 3: Verify migration runs**

Run: `npm run dev` — check console for no migration errors, then stop.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/db.ts
git commit -m "feat(permissions): add permission_rules and permission_audit_log tables (migration 13)"
```

---

### Task 4: Intercept Claude Approval Requests

**Files:**
- Modify: `src/main/services/claude-session.ts`

This is the critical integration point. We intercept `handleControlRequest` to auto-resolve based on glob rules.

- [ ] **Step 1: Add permission rule support to SessionOptions**

In `claude-session.ts`, update the `SessionOptions` interface:

```typescript
import type { PermissionRule } from '../../shared/permission-types';

export interface SessionOptions {
  workingDir: string;
  permissionMode?: PermissionMode;
  model?: string;
  resumeSessionId?: string;
  resumeAtMessageId?: string;
  enableQA?: boolean;
  qaTargetUrl?: string;
  zeusSessionId?: string;
  subagentId?: string;
  mcpServers?: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>;
  permissionRules?: PermissionRule[];  // NEW: glob-based rules
  projectId?: string;                 // NEW: for audit logging
}
```

- [ ] **Step 2: Store rules and projectId on the session**

Add fields to the `ClaudeSession` class:

```typescript
export class ClaudeSession extends EventEmitter {
  // ... existing fields ...
  private permissionRules: PermissionRule[];
  private projectId: string | null;

  constructor(private options: SessionOptions) {
    super();
    this.logProcessor = new ClaudeLogProcessor(options.workingDir);
    this.permissionRules = options.permissionRules ?? [];
    this.projectId = options.projectId ?? null;
  }
```

- [ ] **Step 3: Modify handleControlRequest to evaluate rules**

Replace the `handleControlRequest` method. Keep `AskUserQuestion` always-ask and `ExitPlanMode` auto-approve, but evaluate everything else against glob rules:

```typescript
import { evaluate, extractPattern, relativize } from './permission-evaluator';
import { insertAuditEntry } from './db';

  private async handleControlRequest(
    requestId: string,
    request: ControlRequestType,
  ): Promise<void> {
    if (request.subtype === 'can_use_tool') {
      const { tool_name, input, tool_use_id } = request;

      // AskUserQuestion — always needs user input (not a permission issue)
      if (tool_name === 'AskUserQuestion') {
        const approvalId = crypto.randomUUID();
        this.pendingApprovals.set(approvalId, { requestId, toolInput: input });
        this.emit('approval_needed', {
          approvalId,
          requestId,
          toolName: tool_name,
          toolInput: input,
          toolUseId: tool_use_id,
        });
        this.emit('activity', { state: 'waiting_approval', toolName: tool_name });
        return;
      }

      // ExitPlanMode — approve and switch to bypass
      if (tool_name === 'ExitPlanMode') {
        const result: PermissionResult = {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [
            { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
          ],
        };
        await this.protocol!.sendPermissionResponse(requestId, result);
        return;
      }

      // ─── Glob rule evaluation ───
      if (this.permissionRules.length > 0) {
        const rawPattern = extractPattern(tool_name, input);
        const pattern = relativize(rawPattern, this.options.workingDir);
        const { action, matchedRule } = evaluate(tool_name, pattern, this.permissionRules);

        // Audit log
        this.logAudit(tool_name, pattern, action, matchedRule);

        if (action === 'allow') {
          // Auto-approve — no UI needed
          const result: PermissionResult = {
            behavior: 'allow',
            updatedInput: input,
          };
          await this.protocol!.sendPermissionResponse(requestId, result);
          this.emit('permission_auto_resolved', { toolName: tool_name, pattern, action: 'allow' });
          return;
        }

        if (action === 'deny') {
          // Auto-deny — no UI needed
          const result: PermissionResult = {
            behavior: 'deny',
            message: `Permission denied by project rule: ${matchedRule?.tool}:${matchedRule?.pattern} → deny`,
          };
          await this.protocol!.sendPermissionResponse(requestId, result);
          this.emit('permission_auto_resolved', { toolName: tool_name, pattern, action: 'deny' });
          return;
        }

        // action === 'ask' → fall through to existing UI flow
      }

      // ─── Existing flow: emit for user approval ───
      const approvalId = crypto.randomUUID();
      this.pendingApprovals.set(approvalId, { requestId, toolInput: input });
      this.emit('approval_needed', {
        approvalId,
        requestId,
        toolName: tool_name,
        toolInput: input,
        toolUseId: tool_use_id,
      });
      this.emit('activity', { state: 'waiting_approval', toolName: tool_name });

    } else if (request.subtype === 'hook_callback') {
      // ... keep existing hook_callback handling unchanged ...
    }
  }

  private logAudit(toolName: string, pattern: string, action: string, matchedRule: PermissionRule | null): void {
    try {
      insertAuditEntry({
        id: crypto.randomUUID(),
        sessionId: this.options.zeusSessionId ?? '',
        projectId: this.projectId,
        toolName,
        pattern,
        action,
        ruleMatched: matchedRule ? JSON.stringify(matchedRule) : null,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn('[ClaudeSession] Failed to log audit entry:', err);
    }
  }
```

- [ ] **Step 4: Important — set permissionMode to 'default' when rules are active**

When glob rules are provided, we need Claude CLI to actually ASK us about tools (not auto-approve everything). The trick: always use `default` or a custom hook that routes everything through our `handleControlRequest`. Update the `start()` method where hooks are built:

Find the `buildHooks` method and add this logic at the start:

```typescript
private buildHooks(mode: PermissionMode): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> = {};

  // If glob rules are active, route ALL tools through approval
  // (our evaluator will auto-resolve most of them)
  if (this.permissionRules.length > 0) {
    hooks['PreToolUse'] = [
      { matcher: '.*', hookCallbackIds: ['tool_approval'] },
    ];
    return hooks;
  }

  // ... existing mode-based hook logic unchanged ...
}
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep claude-session || echo "No errors"`

- [ ] **Step 6: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "feat(permissions): intercept tool approvals with glob rule evaluation + audit logging"
```

---

### Task 5: WebSocket Channel for Permissions

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/websocket.ts`

- [ ] **Step 1: Add 'permissions' to the WsEnvelope channel union**

In `src/shared/types.ts`, find the `WsEnvelope` interface and add `'permissions'` to the channel union:

```typescript
export interface WsEnvelope {
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android' | 'mcp' | 'task' | 'permissions';
  sessionId: string;
  payload: unknown;
  auth: string;
}
```

Also import and re-export the PermissionsPayload type:

```typescript
export type { PermissionsPayload } from './permission-types';
```

- [ ] **Step 2: Add handlePermissions() in websocket.ts**

In `websocket.ts`, add the handler function and wire it into the channel switch:

```typescript
import type { PermissionsPayload } from '../../shared/permission-types';
import { getPermissionRules, setPermissionRules, clearPermissionRules, getAuditLog } from './db';
import { PERMISSION_TEMPLATES } from './permission-evaluator';

async function handlePermissions(
  ws: WebSocket,
  envelope: WsEnvelope,
  payload: PermissionsPayload,
): Promise<void> {
  if (payload.type === 'get_rules') {
    const rules = getPermissionRules(payload.projectId);
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'rules_updated', projectId: payload.projectId, rules },
      auth: '',
    });
  }

  else if (payload.type === 'set_rules') {
    setPermissionRules(payload.projectId, payload.rules);
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'rules_updated', projectId: payload.projectId, rules: payload.rules },
      auth: '',
    });
  }

  else if (payload.type === 'apply_template') {
    const template = PERMISSION_TEMPLATES.find(t => t.id === payload.templateId);
    if (!template) {
      broadcastEnvelope({
        channel: 'permissions',
        sessionId: envelope.sessionId,
        payload: { type: 'permissions_error', message: `Template not found: ${payload.templateId}` },
        auth: '',
      });
      return;
    }
    setPermissionRules(payload.projectId, template.rules, template.name, true);
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'rules_updated', projectId: payload.projectId, rules: template.rules },
      auth: '',
    });
  }

  else if (payload.type === 'get_templates') {
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'templates_list', templates: PERMISSION_TEMPLATES },
      auth: '',
    });
  }

  else if (payload.type === 'get_audit_log') {
    const { entries, total } = getAuditLog(payload.sessionId, payload.limit, payload.offset);
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'audit_log', sessionId: payload.sessionId, entries, total },
      auth: '',
    });
  }

  else if (payload.type === 'clear_rules') {
    clearPermissionRules(payload.projectId);
    broadcastEnvelope({
      channel: 'permissions',
      sessionId: envelope.sessionId,
      payload: { type: 'rules_updated', projectId: payload.projectId, rules: [] },
      auth: '',
    });
  }
}
```

Add the routing in the channel switch. **Important:** `handleMessage()` is NOT async, so use `.catch()` like the other handlers:

```typescript
case 'permissions':
  handlePermissions(ws, envelope, envelope.payload as PermissionsPayload).catch((err) => {
    sendEnvelope(ws, {
      channel: 'permissions', sessionId: envelope.sessionId, auth: '',
      payload: { type: 'permissions_error', message: err.message },
    });
  });
  break;
```

- [ ] **Step 3: Wire permission rules into Claude session start**

In the `handleClaude` function where `start_claude` is handled, load permission rules for the project:

Find the `start_claude` handler and add after the session is created:

```typescript
// Load permission rules for the project
const projectId = (envelope.payload as ClaudeStartPayload).projectId;
let permissionRules: PermissionRule[] = [];
if (projectId) {
  permissionRules = getPermissionRules(projectId);
}
```

Pass them in the `SessionOptions` object (the third argument of `claudeManager.createSession(clientKey, prompt, options)`):

```typescript
// In the existing createSession call, add to the options object (third argument):
{
  // ... existing options (workingDir, permissionMode, model, etc.) ...
  permissionRules,
  projectId: projectId ?? undefined,
}
```

**Important:** `claudeManager.createSession()` takes 3 arguments: `(clientKey: string, prompt: string, options: SessionOptions)`. Do NOT restructure the call — just add the new fields to the existing options object.

Also add `projectId` to the `ClaudeStartPayload` type in `types.ts`:

```typescript
export interface ClaudeStartPayload {
  // ... existing fields ...
  projectId?: string;  // for loading permission rules
}
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/services/websocket.ts
git commit -m "feat(permissions): add permissions WebSocket channel with CRUD + audit log + template operations"
```

---

### Task 6: Frontend Store Slice

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Add permission state and actions to the store**

Add to the state type (after the task state):

```typescript
// Permissions
permissionRules: Record<string, PermissionRule[]>;  // projectId → rules
permissionTemplates: PermissionTemplate[];
permissionAuditLog: Record<string, { entries: PermissionAuditEntry[]; total: number }>;  // sessionId → log
```

Add to the actions type:

```typescript
// Permission actions
fetchPermissionRules: (projectId: string) => void;
setPermissionRules: (projectId: string, rules: PermissionRule[]) => void;
applyPermissionTemplate: (projectId: string, templateId: string) => void;
fetchPermissionTemplates: () => void;
clearPermissionRules: (projectId: string) => void;
fetchAuditLog: (sessionId: string, limit?: number, offset?: number) => void;
```

Add initial state:

```typescript
permissionRules: {},
permissionTemplates: [],
permissionAuditLog: {},
```

Add the WebSocket subscription for `'permissions'` channel. **Important:** The store uses `zeusWs.on('channelName', handler)` — NOT `if (envelope.channel === ...)`. Add alongside the other `zeusWs.on(...)` subscriptions and add the unsubscribe to the cleanup return function:

```typescript
const unsubPermissions = zeusWs.on('permissions', (envelope: WsEnvelope) => {
  const payload = envelope.payload as PermissionsPayload;

  if (payload.type === 'rules_updated') {
    set((state) => ({
      permissionRules: { ...state.permissionRules, [payload.projectId]: payload.rules },
    }));
  }

  if (payload.type === 'templates_list') {
    set({ permissionTemplates: payload.templates });
  }

  if (payload.type === 'audit_log') {
    set((state) => ({
      permissionAuditLog: {
        ...state.permissionAuditLog,
        [payload.sessionId]: { entries: payload.entries, total: payload.total },
      },
    }));
  }
});
```

Then add `unsubPermissions();` to the cleanup return function (where all other `unsub*()` calls are).
```

Add the action implementations:

```typescript
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
```

Import the types at the top:

```typescript
import type { PermissionRule, PermissionTemplate, PermissionAuditEntry, PermissionsPayload } from '../../../shared/permission-types';
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(permissions): add permission rules store slice with CRUD + template + audit actions"
```

---

### Task 7: Permission Rules Editor UI

**Files:**
- Create: `src/renderer/src/components/PermissionRulesEditor.tsx`

- [ ] **Step 1: Create the editor component**

```typescript
// src/renderer/src/components/PermissionRulesEditor.tsx
import { useState, useEffect } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Shield, ShieldCheck, ShieldX, ShieldQuestion, Copy } from 'lucide-react';
import type { PermissionRule, PermissionAction } from '../../../shared/permission-types';

const ACTION_STYLES: Record<PermissionAction, { bg: string; icon: typeof Shield }> = {
  allow: { bg: 'bg-green-500/20 text-green-400', icon: ShieldCheck },
  deny: { bg: 'bg-red-500/20 text-red-400', icon: ShieldX },
  ask: { bg: 'bg-yellow-500/20 text-yellow-400', icon: ShieldQuestion },
};

function RuleRow({
  rule,
  index,
  onUpdate,
  onRemove,
}: {
  rule: PermissionRule;
  index: number;
  onUpdate: (index: number, rule: PermissionRule) => void;
  onRemove: (index: number) => void;
}) {
  const style = ACTION_STYLES[rule.action];
  const Icon = style.icon;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground w-5 text-right text-[9px]">{index + 1}</span>
      <Input
        value={rule.tool}
        onChange={(e) => onUpdate(index, { ...rule, tool: e.target.value })}
        placeholder="Tool (e.g. Edit, Bash, *)"
        className="h-7 flex-1 font-mono text-[11px]"
      />
      <span className="text-muted-foreground text-[10px]">:</span>
      <Input
        value={rule.pattern}
        onChange={(e) => onUpdate(index, { ...rule, pattern: e.target.value })}
        placeholder="Pattern (e.g. src/**, *.env)"
        className="h-7 flex-[2] font-mono text-[11px]"
      />
      <select
        value={rule.action}
        onChange={(e) => onUpdate(index, { ...rule, action: e.target.value as PermissionAction })}
        className={`h-7 rounded-md border px-1.5 text-[10px] font-medium ${style.bg}`}
      >
        <option value="allow">Allow</option>
        <option value="deny">Deny</option>
        <option value="ask">Ask</option>
      </select>
      <Button size="sm" variant="ghost" className="size-7 p-0 text-red-400 hover:text-red-300" onClick={() => onRemove(index)}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

export function PermissionRulesEditor({ projectId }: { projectId: string }) {
  const {
    permissionRules, permissionTemplates,
    fetchPermissionRules, setPermissionRules, applyPermissionTemplate,
    fetchPermissionTemplates, clearPermissionRules,
  } = useZeusStore();

  const [localRules, setLocalRules] = useState<PermissionRule[]>([]);
  const [dirty, setDirty] = useState(false);

  const rules = permissionRules[projectId] ?? [];

  // Fetch on mount
  useEffect(() => {
    fetchPermissionRules(projectId);
    fetchPermissionTemplates();
  }, [projectId, fetchPermissionRules, fetchPermissionTemplates]);

  // Sync from store to local
  useEffect(() => {
    if (!dirty) {
      setLocalRules(rules);
    }
  }, [rules, dirty]);

  const handleUpdate = (index: number, rule: PermissionRule) => {
    const next = [...localRules];
    next[index] = rule;
    setLocalRules(next);
    setDirty(true);
  };

  const handleRemove = (index: number) => {
    setLocalRules(localRules.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleAdd = () => {
    setLocalRules([...localRules, { tool: '*', pattern: '*', action: 'ask' }]);
    setDirty(true);
  };

  const handleSave = () => {
    setPermissionRules(projectId, localRules);
    setDirty(false);
  };

  const handleApplyTemplate = (templateId: string) => {
    applyPermissionTemplate(projectId, templateId);
    setDirty(false);
  };

  const handleClear = () => {
    clearPermissionRules(projectId);
    setLocalRules([]);
    setDirty(false);
  };

  return (
    <div className="space-y-3">
      {/* Templates */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-[10px] font-medium uppercase">Templates</label>
        <div className="flex flex-wrap gap-1.5">
          {permissionTemplates.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => handleApplyTemplate(t.id)}
              title={t.description}
            >
              <Copy className="mr-1 size-3" />
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Rules list */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-muted-foreground text-[10px] font-medium uppercase">
            Rules ({localRules.length})
          </label>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px]" onClick={handleAdd}>
              <Plus className="mr-0.5 size-2.5" /> Add
            </Button>
            {localRules.length > 0 && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-red-400" onClick={handleClear}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          {localRules.map((rule, i) => (
            <RuleRow key={i} rule={rule} index={i} onUpdate={handleUpdate} onRemove={handleRemove} />
          ))}
          {localRules.length === 0 && (
            <div className="text-muted-foreground py-3 text-center text-[10px]">
              No rules. Using default permission mode. Apply a template or add custom rules.
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleSave}>
            Save Rules
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setLocalRules(rules); setDirty(false); }}>
            Discard
          </Button>
        </div>
      )}

      {/* Info */}
      <div className="text-muted-foreground space-y-1 text-[9px]">
        <p><strong>Last rule wins.</strong> Rules are evaluated top-to-bottom; the last matching rule decides.</p>
        <p><strong>Tool:</strong> Read, Edit, Write, Bash, Glob, Grep, * (any)</p>
        <p><strong>Pattern:</strong> src/**, *.env, npm *, rm -rf * (globs supported)</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/PermissionRulesEditor.tsx
git commit -m "feat(permissions): add PermissionRulesEditor UI with template support and inline rule editing"
```

---

### Task 8: Wire Editor into NewSessionView

**Files:**
- Modify: `src/renderer/src/components/NewSessionView.tsx`

- [ ] **Step 1: Read the NewSessionView to find where permission mode is rendered**

Read `src/renderer/src/components/NewSessionView.tsx` and find the Quick Settings section where permission mode buttons (Default, Plan, Accept Edits, Bypass) are rendered.

- [ ] **Step 2: Add the permission rules editor below the mode buttons**

After the permission mode buttons, add a collapsible section showing the `PermissionRulesEditor`:

```tsx
import { PermissionRulesEditor } from '@/components/PermissionRulesEditor';

// ... inside the Quick Start form, after the permission mode buttons ...

{selectedProject && (
  <div className="mt-3">
    <button
      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px]"
      onClick={() => setShowRulesEditor(!showRulesEditor)}
    >
      <Shield className="size-3" />
      {projectRules.length > 0
        ? `${projectRules.length} permission rules active`
        : 'Configure permission rules'
      }
    </button>
    {showRulesEditor && (
      <div className="mt-2">
        <PermissionRulesEditor projectId={selectedProject.id} />
      </div>
    )}
  </div>
)}
```

Add state: `const [showRulesEditor, setShowRulesEditor] = useState(false);`

Get rules from store: `const projectRules = useZeusStore((s) => s.permissionRules[selectedProject?.id ?? ''] ?? []);`

- [ ] **Step 3: Pass projectId when starting Claude session**

Find where the `start_claude` payload is sent and add the `projectId`:

```typescript
payload: {
  type: 'start_claude',
  // ... existing fields ...
  projectId: selectedProject?.id,  // NEW
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/NewSessionView.tsx
git commit -m "feat(permissions): wire PermissionRulesEditor into NewSessionView with project-scoped rules"
```

---

### Task 9: Build, Typecheck, and Test

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: No new errors from permission files.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Manual smoke test**

1. Start the dev server: `npm run dev`
2. Open the app, go to Quick Start
3. Select a project → see "Configure permission rules" link
4. Click it → PermissionRulesEditor appears
5. Apply "Frontend Dev" template → rules populate
6. Save → rules persist
7. Start a Claude session with the project → Claude should auto-approve reads, auto-deny .env edits, ask for bash commands
8. Check the audit log in the DB: `sqlite3 ~/Library/Application\ Support/Zeus/zeus-dev.db "SELECT * FROM permission_audit_log LIMIT 10"`

- [ ] **Step 4: QA test with zeus_qa_run**

Run the QA agent to verify:
- Permission rules editor renders correctly
- Template application works
- Rules save/load correctly
- Approval flow still works for 'ask' rules

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(permissions): address issues found during testing"
```

---

## Summary

| Task | What | Files | Effort |
|------|------|-------|--------|
| 1 | Types | `permission-types.ts` | 5 min |
| 2 | Evaluator + templates | `permission-evaluator.ts` | 10 min |
| 3 | DB migration | `db.ts` | 10 min |
| 4 | Claude session intercept | `claude-session.ts` | 15 min |
| 5 | WebSocket channel | `types.ts`, `websocket.ts` | 10 min |
| 6 | Store slice | `useZeusStore.ts` | 10 min |
| 7 | Rules editor UI | `PermissionRulesEditor.tsx` | 15 min |
| 8 | NewSessionView wiring | `NewSessionView.tsx` | 10 min |
| 9 | Build + test | — | 15 min |

**Total: ~9 tasks, ~100 minutes**

The key architectural decision: **we intercept at `handleControlRequest`** — not at the WebSocket layer or the UI layer. This means:
- Zero latency for auto-approved/denied tools (no round-trip to frontend)
- The existing approval UI works unchanged for `ask` rules
- Audit logging happens in one place
- Rules are evaluated with relative paths (project-scoped)
- Templates are backwards-compatible with the old 4 permission modes
