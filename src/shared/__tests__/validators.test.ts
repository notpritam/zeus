// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  validateNormalizedEntry,
  validateNormalizedEntryType,
  validateActionType,
  validateToolStatus,
  validateFileChange,
  assertNormalizedEntry,
  safeParseNormalizedEntry,
} from '../validators';

// ─── ActionType ───

describe('validateActionType', () => {
  it('accepts valid file_read', () => {
    const r = validateActionType({ action: 'file_read', path: 'src/main.ts' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid file_edit with changes', () => {
    const r = validateActionType({
      action: 'file_edit',
      path: 'src/main.ts',
      changes: [{ action: 'edit', oldString: 'a', newString: 'b' }],
    }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts file_edit without changes (optional)', () => {
    const r = validateActionType({ action: 'file_edit', path: 'src/main.ts' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid command_run', () => {
    const r = validateActionType({ action: 'command_run', command: 'ls -la' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts command_run with optional fields', () => {
    const r = validateActionType({ action: 'command_run', command: 'ls', exitCode: 0, output: 'files' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid search', () => {
    const r = validateActionType({ action: 'search', query: 'TODO' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid web_fetch', () => {
    const r = validateActionType({ action: 'web_fetch', url: 'https://example.com' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid task_create', () => {
    const r = validateActionType({ action: 'task_create', description: 'Explore codebase' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid plan_presentation', () => {
    const r = validateActionType({ action: 'plan_presentation', plan: '1. Do this\n2. Then that' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid mcp_tool', () => {
    const r = validateActionType({
      action: 'mcp_tool',
      server: 'zeus-bridge',
      method: 'zeus_qa_start',
      input: '{"task":"test"}',
    }, 'test');
    expect(r.valid).toBe(true);
  });

  it('accepts valid other', () => {
    const r = validateActionType({ action: 'other', description: 'Custom tool' }, 'test');
    expect(r.valid).toBe(true);
  });

  it('rejects unknown action', () => {
    const r = validateActionType({ action: 'teleport' }, 'test');
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe('test.action');
  });

  it('rejects null', () => {
    const r = validateActionType(null, 'test');
    expect(r.valid).toBe(false);
  });

  it('rejects file_read without path', () => {
    const r = validateActionType({ action: 'file_read' }, 'test');
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe('test.path');
  });

  it('rejects mcp_tool missing server', () => {
    const r = validateActionType({ action: 'mcp_tool', method: 'x', input: '' }, 'test');
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path.includes('server'))).toBe(true);
  });

  it('rejects command_run with non-number exitCode', () => {
    const r = validateActionType({ action: 'command_run', command: 'ls', exitCode: 'zero' }, 'test');
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe('test.exitCode');
  });
});

// ─── FileChange ───

describe('validateFileChange', () => {
  it('accepts write', () => {
    expect(validateFileChange({ action: 'write', content: 'hello' }, 'fc').valid).toBe(true);
  });

  it('accepts edit', () => {
    expect(validateFileChange({ action: 'edit', oldString: 'a', newString: 'b' }, 'fc').valid).toBe(true);
  });

  it('accepts delete', () => {
    expect(validateFileChange({ action: 'delete' }, 'fc').valid).toBe(true);
  });

  it('rejects unknown action', () => {
    expect(validateFileChange({ action: 'rename' }, 'fc').valid).toBe(false);
  });

  it('rejects edit missing newString', () => {
    const r = validateFileChange({ action: 'edit', oldString: 'a' }, 'fc');
    expect(r.valid).toBe(false);
  });
});

// ─── ToolStatus ───

describe('validateToolStatus', () => {
  it.each(['created', 'success', 'failed', 'timed_out'])('accepts string status "%s"', (s) => {
    expect(validateToolStatus(s, 'ts').valid).toBe(true);
  });

  it('accepts denied with reason', () => {
    const r = validateToolStatus({ status: 'denied', reason: 'not allowed' }, 'ts');
    expect(r.valid).toBe(true);
  });

  it('accepts denied without reason', () => {
    const r = validateToolStatus({ status: 'denied' }, 'ts');
    expect(r.valid).toBe(true);
  });

  it('accepts pending_approval', () => {
    const r = validateToolStatus({ status: 'pending_approval', approvalId: 'abc-123' }, 'ts');
    expect(r.valid).toBe(true);
  });

  it('rejects pending_approval without approvalId', () => {
    const r = validateToolStatus({ status: 'pending_approval' }, 'ts');
    expect(r.valid).toBe(false);
  });

  it('rejects unknown string status', () => {
    expect(validateToolStatus('running', 'ts').valid).toBe(false);
  });

  it('rejects number', () => {
    expect(validateToolStatus(42, 'ts').valid).toBe(false);
  });
});

// ─── NormalizedEntryType ───

describe('validateNormalizedEntryType', () => {
  it('accepts user_message', () => {
    expect(validateNormalizedEntryType({ type: 'user_message' }, 'et').valid).toBe(true);
  });

  it('accepts assistant_message', () => {
    expect(validateNormalizedEntryType({ type: 'assistant_message' }, 'et').valid).toBe(true);
  });

  it('accepts thinking', () => {
    expect(validateNormalizedEntryType({ type: 'thinking' }, 'et').valid).toBe(true);
  });

  it('accepts system_message', () => {
    expect(validateNormalizedEntryType({ type: 'system_message' }, 'et').valid).toBe(true);
  });

  it('accepts loading', () => {
    expect(validateNormalizedEntryType({ type: 'loading' }, 'et').valid).toBe(true);
  });

  it('accepts error_message with valid errorType', () => {
    expect(validateNormalizedEntryType({ type: 'error_message', errorType: 'setup_required' }, 'et').valid).toBe(true);
    expect(validateNormalizedEntryType({ type: 'error_message', errorType: 'other' }, 'et').valid).toBe(true);
  });

  it('rejects error_message with invalid errorType', () => {
    expect(validateNormalizedEntryType({ type: 'error_message', errorType: 'fatal' }, 'et').valid).toBe(false);
  });

  it('accepts token_usage', () => {
    const r = validateNormalizedEntryType({ type: 'token_usage', totalTokens: 5000, contextWindow: 200000 }, 'et');
    expect(r.valid).toBe(true);
  });

  it('rejects token_usage with string tokens', () => {
    const r = validateNormalizedEntryType({ type: 'token_usage', totalTokens: 'many', contextWindow: 200000 }, 'et');
    expect(r.valid).toBe(false);
  });

  it('accepts tool_use with all fields', () => {
    const r = validateNormalizedEntryType({
      type: 'tool_use',
      toolName: 'Bash',
      actionType: { action: 'command_run', command: 'ls' },
      status: 'success',
    }, 'et');
    expect(r.valid).toBe(true);
  });

  it('accepts tool_use with mcp_tool action', () => {
    const r = validateNormalizedEntryType({
      type: 'tool_use',
      toolName: 'mcp__zeus-bridge__zeus_qa_start',
      actionType: { action: 'mcp_tool', server: 'zeus-bridge', method: 'zeus_qa_start', input: '{}' },
      status: 'created',
    }, 'et');
    expect(r.valid).toBe(true);
  });

  it('rejects tool_use with missing toolName', () => {
    const r = validateNormalizedEntryType({
      type: 'tool_use',
      actionType: { action: 'command_run', command: 'ls' },
      status: 'success',
    }, 'et');
    expect(r.valid).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(validateNormalizedEntryType({ type: 'magic' }, 'et').valid).toBe(false);
  });
});

// ─── NormalizedEntry (full) ───

describe('validateNormalizedEntry', () => {
  const validUserMessage = {
    id: 'abc-123',
    entryType: { type: 'user_message' },
    content: 'Hello Claude',
    timestamp: '2026-03-17T10:00:00Z',
  };

  const validToolUse = {
    id: 'tool-456',
    entryType: {
      type: 'tool_use',
      toolName: 'Read',
      actionType: { action: 'file_read', path: 'src/main.ts' },
      status: 'success',
    },
    content: 'Reading src/main.ts',
    metadata: { output: 'file contents here' },
    timestamp: '2026-03-17T10:01:00Z',
  };

  const validMcpToolUse = {
    id: 'mcp-789',
    entryType: {
      type: 'tool_use',
      toolName: 'mcp__plugin_context7_context7__query-docs',
      actionType: {
        action: 'mcp_tool',
        server: 'plugin_context7_context7',
        method: 'query-docs',
        input: '{"libraryId":"react","query":"hooks"}',
      },
      status: 'success',
    },
    content: 'query-docs',
    metadata: { output: '{"results":[...]}' },
  };

  const validAssistantMessage = {
    id: 'asst-001',
    entryType: { type: 'assistant_message' },
    content: 'Here is my response with markdown.',
  };

  const validTokenUsage = {
    id: 'tok-002',
    entryType: { type: 'token_usage', totalTokens: 50000, contextWindow: 200000 },
    content: '',
  };

  it('accepts valid user_message entry', () => {
    expect(validateNormalizedEntry(validUserMessage).valid).toBe(true);
  });

  it('accepts valid tool_use entry', () => {
    expect(validateNormalizedEntry(validToolUse).valid).toBe(true);
  });

  it('accepts valid mcp_tool entry', () => {
    expect(validateNormalizedEntry(validMcpToolUse).valid).toBe(true);
  });

  it('accepts valid assistant_message entry', () => {
    expect(validateNormalizedEntry(validAssistantMessage).valid).toBe(true);
  });

  it('accepts valid token_usage entry', () => {
    expect(validateNormalizedEntry(validTokenUsage).valid).toBe(true);
  });

  it('accepts entry without timestamp (optional)', () => {
    const e = { id: 'no-ts', entryType: { type: 'thinking' }, content: 'hmm...' };
    expect(validateNormalizedEntry(e).valid).toBe(true);
  });

  it('rejects entry without id', () => {
    const e = { entryType: { type: 'user_message' }, content: 'hi' };
    const r = validateNormalizedEntry(e);
    expect(r.valid).toBe(false);
    expect(r.errors.some(err => err.path.includes('id'))).toBe(true);
  });

  it('rejects entry without content', () => {
    const e = { id: 'x', entryType: { type: 'user_message' } };
    const r = validateNormalizedEntry(e);
    expect(r.valid).toBe(false);
    expect(r.errors.some(err => err.path.includes('content'))).toBe(true);
  });

  it('rejects entry without entryType', () => {
    const e = { id: 'x', content: 'hi' };
    const r = validateNormalizedEntry(e);
    expect(r.valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validateNormalizedEntry(null).valid).toBe(false);
  });

  it('rejects string', () => {
    expect(validateNormalizedEntry('not an entry').valid).toBe(false);
  });

  it('collects multiple errors', () => {
    const e = { id: 123, entryType: { type: 'tool_use' }, content: null };
    const r = validateNormalizedEntry(e);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(1);
  });
});

// ─── assertNormalizedEntry ───

describe('assertNormalizedEntry', () => {
  it('does not throw for valid entry', () => {
    expect(() =>
      assertNormalizedEntry({
        id: 'ok',
        entryType: { type: 'user_message' },
        content: 'hello',
      }),
    ).not.toThrow();
  });

  it('throws for invalid entry with details', () => {
    expect(() => assertNormalizedEntry(null, 'test-ctx')).toThrow(/Invalid NormalizedEntry \(test-ctx\)/);
  });

  it('includes path details in thrown error', () => {
    try {
      assertNormalizedEntry({ id: 'x', entryType: { type: 'unknown_type' }, content: 'hi' }, 'ctx');
    } catch (e: unknown) {
      expect((e as Error).message).toContain('entryType.type');
    }
  });
});

// ─── safeParseNormalizedEntry ───

describe('safeParseNormalizedEntry', () => {
  it('returns entry for valid data', () => {
    const e = { id: 'ok', entryType: { type: 'thinking' }, content: '...' };
    const result = safeParseNormalizedEntry(e);
    expect(result).toEqual(e);
  });

  it('returns null for invalid data', () => {
    expect(safeParseNormalizedEntry(null)).toBeNull();
  });

  it('returns null for partial data', () => {
    expect(safeParseNormalizedEntry({ id: 'x' })).toBeNull();
  });
});

// ─── Round-trip simulation (DB write → read) ───

describe('round-trip: serialize → deserialize → validate', () => {
  const entries = [
    {
      id: 'rt-1',
      entryType: { type: 'user_message' as const },
      content: 'hello',
      timestamp: '2026-03-17T10:00:00Z',
    },
    {
      id: 'rt-2',
      entryType: {
        type: 'tool_use' as const,
        toolName: 'Bash',
        actionType: { action: 'command_run' as const, command: 'npm test' },
        status: 'success' as const,
      },
      content: '$ npm test',
      metadata: { output: 'All tests passed' },
    },
    {
      id: 'rt-3',
      entryType: {
        type: 'tool_use' as const,
        toolName: 'mcp__zeus-bridge__zeus_session_start',
        actionType: {
          action: 'mcp_tool' as const,
          server: 'zeus-bridge',
          method: 'zeus_session_start',
          input: '{"prompt":"hello"}',
        },
        status: { status: 'pending_approval' as const, approvalId: 'ap-999' },
      },
      content: 'zeus_session_start',
      metadata: { output: '' },
    },
    {
      id: 'rt-4',
      entryType: { type: 'token_usage' as const, totalTokens: 15000, contextWindow: 200000 },
      content: '',
    },
    {
      id: 'rt-5',
      entryType: { type: 'error_message' as const, errorType: 'setup_required' as const },
      content: 'API key not found',
    },
  ];

  for (const entry of entries) {
    it(`round-trips ${entry.entryType.type} (${entry.id})`, () => {
      // Simulate DB write: JSON.stringify entryType and metadata
      const dbEntryType = JSON.stringify(entry.entryType);
      const dbMetadata = 'metadata' in entry ? JSON.stringify(entry.metadata) : null;

      // Simulate DB read: JSON.parse
      const restored = {
        id: entry.id,
        entryType: JSON.parse(dbEntryType),
        content: entry.content,
        metadata: dbMetadata ? JSON.parse(dbMetadata) : undefined,
        timestamp: 'timestamp' in entry ? entry.timestamp : undefined,
      };

      const result = validateNormalizedEntry(restored);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error('Validation errors:', result.errors);
      }
    });
  }
});
