// ============================================================
// Runtime validators for NormalizedEntry and all nested types.
// Used at DB boundaries (read/write) to guarantee type safety.
// ============================================================

import type {
  NormalizedEntry,
  NormalizedEntryType,
  ActionType,
  ToolStatus,
  FileChange,
} from './types';

// ─── Validation Result ───

export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(path: string, message: string, value?: unknown): ValidationResult {
  return { valid: false, errors: [{ path, message, value }] };
}

function merge(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors);
  return { valid: errors.length === 0, errors };
}

// ─── Primitive Checks ───

function isString(v: unknown, path: string): ValidationResult {
  return typeof v === 'string' ? ok() : fail(path, `expected string, got ${typeof v}`, v);
}

function isNumber(v: unknown, path: string): ValidationResult {
  return typeof v === 'number' && !Number.isNaN(v) ? ok() : fail(path, `expected number, got ${typeof v}`, v);
}

function isOptionalString(v: unknown, path: string): ValidationResult {
  return v === undefined || v === null || typeof v === 'string' ? ok() : fail(path, `expected string|undefined, got ${typeof v}`, v);
}

function isOptionalNumber(v: unknown, path: string): ValidationResult {
  return v === undefined || v === null || (typeof v === 'number' && !Number.isNaN(v)) ? ok() : fail(path, `expected number|undefined, got ${typeof v}`, v);
}

// ─── FileChange ───

const FILE_CHANGE_ACTIONS = new Set(['write', 'edit', 'delete']);

export function validateFileChange(v: unknown, path: string): ValidationResult {
  if (!v || typeof v !== 'object') return fail(path, 'expected object');
  const fc = v as Record<string, unknown>;
  if (!FILE_CHANGE_ACTIONS.has(fc.action as string)) {
    return fail(`${path}.action`, `expected write|edit|delete, got ${fc.action}`, fc.action);
  }
  switch (fc.action) {
    case 'write':
      return isString(fc.content, `${path}.content`);
    case 'edit':
      return merge(
        isString(fc.oldString, `${path}.oldString`),
        isString(fc.newString, `${path}.newString`),
      );
    case 'delete':
      return ok();
    default:
      return fail(`${path}.action`, `unknown action ${fc.action}`);
  }
}

// ─── ActionType ───

const ACTION_TYPES = new Set([
  'file_read', 'file_edit', 'command_run', 'search',
  'web_fetch', 'task_create', 'plan_presentation',
  'mcp_tool', 'other',
]);

export function validateActionType(v: unknown, path: string): ValidationResult {
  if (!v || typeof v !== 'object') return fail(path, 'expected object');
  const a = v as Record<string, unknown>;

  if (!ACTION_TYPES.has(a.action as string)) {
    return fail(`${path}.action`, `unknown action type: ${a.action}`, a.action);
  }

  switch (a.action) {
    case 'file_read':
      return isString(a.path, `${path}.path`);

    case 'file_edit':
      return merge(
        isString(a.path, `${path}.path`),
        // changes is optional in the shared type
        a.changes !== undefined && a.changes !== null
          ? Array.isArray(a.changes)
            ? merge(...(a.changes as unknown[]).map((c, i) => validateFileChange(c, `${path}.changes[${i}]`)))
            : fail(`${path}.changes`, 'expected array')
          : ok(),
      );

    case 'command_run':
      return merge(
        isString(a.command, `${path}.command`),
        isOptionalNumber(a.exitCode, `${path}.exitCode`),
        isOptionalString(a.output, `${path}.output`),
      );

    case 'search':
      return isString(a.query, `${path}.query`);

    case 'web_fetch':
      return isString(a.url, `${path}.url`);

    case 'task_create':
      return isString(a.description, `${path}.description`);

    case 'plan_presentation':
      return isString(a.plan, `${path}.plan`);

    case 'mcp_tool':
      return merge(
        isString(a.server, `${path}.server`),
        isString(a.method, `${path}.method`),
        isString(a.input, `${path}.input`),
      );

    case 'other':
      return isString(a.description, `${path}.description`);

    default:
      return fail(`${path}.action`, `unhandled action: ${a.action}`);
  }
}

// ─── ToolStatus ───

const TOOL_STATUS_STRINGS = new Set(['created', 'success', 'failed', 'timed_out']);
const TOOL_STATUS_OBJECTS = new Set(['denied', 'pending_approval']);

export function validateToolStatus(v: unknown, path: string): ValidationResult {
  if (typeof v === 'string') {
    return TOOL_STATUS_STRINGS.has(v)
      ? ok()
      : fail(path, `unknown status string: ${v}`, v);
  }
  if (v && typeof v === 'object') {
    const s = v as Record<string, unknown>;
    if (!TOOL_STATUS_OBJECTS.has(s.status as string)) {
      return fail(`${path}.status`, `expected denied|pending_approval, got ${s.status}`, s.status);
    }
    if (s.status === 'denied') {
      return isOptionalString(s.reason, `${path}.reason`);
    }
    if (s.status === 'pending_approval') {
      return isString(s.approvalId, `${path}.approvalId`);
    }
  }
  return fail(path, `expected string or {status:...} object, got ${typeof v}`, v);
}

// ─── NormalizedEntryType ───

const ENTRY_TYPES = new Set([
  'user_message', 'assistant_message', 'tool_use',
  'thinking', 'system_message', 'error_message',
  'loading', 'token_usage',
]);

export function validateNormalizedEntryType(v: unknown, path: string): ValidationResult {
  if (!v || typeof v !== 'object') return fail(path, 'expected object');
  const et = v as Record<string, unknown>;

  if (!ENTRY_TYPES.has(et.type as string)) {
    return fail(`${path}.type`, `unknown entry type: ${et.type}`, et.type);
  }

  switch (et.type) {
    case 'user_message':
    case 'assistant_message':
    case 'thinking':
    case 'system_message':
    case 'loading':
      return ok();

    case 'tool_use':
      return merge(
        isString(et.toolName, `${path}.toolName`),
        validateActionType(et.actionType, `${path}.actionType`),
        validateToolStatus(et.status, `${path}.status`),
      );

    case 'error_message': {
      const validErrorTypes = new Set(['setup_required', 'other']);
      return validErrorTypes.has(et.errorType as string)
        ? ok()
        : fail(`${path}.errorType`, `expected setup_required|other, got ${et.errorType}`, et.errorType);
    }

    case 'token_usage':
      return merge(
        isNumber(et.totalTokens, `${path}.totalTokens`),
        isNumber(et.contextWindow, `${path}.contextWindow`),
      );

    default:
      return fail(`${path}.type`, `unhandled type: ${et.type}`);
  }
}

// ─── NormalizedEntry ───

export function validateNormalizedEntry(v: unknown, path = 'entry'): ValidationResult {
  if (!v || typeof v !== 'object') return fail(path, 'expected object');
  const e = v as Record<string, unknown>;

  return merge(
    isString(e.id, `${path}.id`),
    isOptionalString(e.timestamp, `${path}.timestamp`),
    isString(e.content, `${path}.content`),
    validateNormalizedEntryType(e.entryType, `${path}.entryType`),
    // metadata is intentionally `unknown` — no shape validation
  );
}

// ─── Convenience ───

/**
 * Validate and assert at runtime. Throws on invalid data.
 * Use at DB boundaries for defense-in-depth.
 */
export function assertNormalizedEntry(v: unknown, context?: string): asserts v is NormalizedEntry {
  const result = validateNormalizedEntry(v);
  if (!result.valid) {
    const ctx = context ? ` (${context})` : '';
    const details = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid NormalizedEntry${ctx}:\n${details}`);
  }
}

/**
 * Non-throwing validation. Returns the entry cast to NormalizedEntry if valid, null otherwise.
 * Logs a warning on validation failure.
 */
export function safeParseNormalizedEntry(v: unknown, context?: string): NormalizedEntry | null {
  const result = validateNormalizedEntry(v);
  if (result.valid) return v as NormalizedEntry;
  const ctx = context ? ` (${context})` : '';
  console.warn(
    `[Zeus Validator] Invalid NormalizedEntry${ctx}:`,
    result.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
  );
  return null;
}
