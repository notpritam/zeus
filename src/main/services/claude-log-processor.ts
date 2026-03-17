// ClaudeLogProcessor — converts raw ClaudeJson stream messages into
// NormalizedEntry items that the UI can render directly.

import crypto from 'crypto';
import path from 'path';
import type {
  ClaudeJson,
  NormalizedEntry,
  ActionType,
  StreamEvent,
  ContentBlockDelta,
} from './claude-types';
import type { SessionActivity } from '../../shared/types';

export class ClaudeLogProcessor {
  // Map tool_use id → entry metadata for result matching
  private toolMap = new Map<string, { entryId: string; toolName: string; content: string; actionType: ActionType }>();

  // Streaming state — text & thinking
  private streamingText = '';
  private streamingThinking = '';
  private streamingEntryId: string | null = null;
  private thinkingEntryId: string | null = null;

  // Streaming state — tool_use (input_json_delta accumulation)
  private streamingToolId: string | null = null;
  private streamingToolName: string | null = null;
  private streamingToolInput = '';
  private streamingToolEntryId: string | null = null;

  // Activity tracking
  private _activity: SessionActivity = { state: 'starting' };
  private _activityCallback: ((activity: SessionActivity) => void) | null = null;

  constructor(private worktreePath: string) {}

  onActivity(cb: (activity: SessionActivity) => void): void {
    this._activityCallback = cb;
  }

  get activity(): SessionActivity {
    return this._activity;
  }

  private setActivity(activity: SessionActivity): void {
    const prev = this._activity;
    // Avoid emitting identical states
    if (prev.state === activity.state) {
      if (activity.state === 'tool_running' && prev.state === 'tool_running' && prev.toolName === activity.toolName) return;
      if (activity.state !== 'tool_running' && activity.state !== 'waiting_approval') return;
    }
    this._activity = activity;
    this._activityCallback?.(activity);
  }

  /** Process a raw ClaudeJson message → 0 or more NormalizedEntry items */
  process(msg: ClaudeJson): NormalizedEntry[] {
    const entries = this._process(msg);
    const now = new Date().toISOString();
    for (const entry of entries) {
      if (!entry.timestamp) entry.timestamp = now;
    }
    return entries;
  }

  private _process(msg: ClaudeJson): NormalizedEntry[] {
    switch (msg.type) {
      case 'assistant':
        // Skip — content is already handled by stream_event
        // (content_block_start/delta/stop). The assistant message
        // is redundant when using --include-partial-messages.
        return [];

      case 'user':
        // User messages are added optimistically by the renderer store.
        // But user messages also carry tool_result content blocks — extract those.
        return this.processUserMessage(msg);

      case 'tool_use':
        return this.processToolUse(msg);

      case 'tool_result':
        return this.processToolResult(msg);

      case 'stream_event':
        return this.processStreamEvent(msg);

      case 'result':
        return this.processResult(msg);

      case 'system':
        // System init — could extract model info; skip for now
        return [];

      case 'tool_progress': {
        // Tool progress updates (e.g., Bash producing incremental output)
        const progress = msg as { tool_use_id?: string; tool_name?: string; content?: string };
        const toolUseId = progress.tool_use_id;
        if (toolUseId) {
          const tracked = this.toolMap.get(toolUseId);
          if (tracked) {
            this.setActivity({ state: 'tool_running', toolName: tracked.toolName, description: progress.content || '' });
          }
        }
        return [];
      }

      case 'tool_use_summary': {
        // Summary emitted after tool completes (in non-streaming mode)
        const summary = msg as { tool_use_id?: string; tool_name?: string; summary?: string };
        const toolUseId = summary.tool_use_id;
        if (toolUseId) {
          const tracked = this.toolMap.get(toolUseId);
          if (tracked) {
            const status = 'success' as const;
            this.toolMap.delete(toolUseId);
            this.setActivity({ state: 'streaming' });
            return [{
              id: tracked.entryId,
              entryType: {
                type: 'tool_use',
                toolName: tracked.toolName,
                actionType: tracked.actionType,
                status,
              },
              content: tracked.content,
              metadata: { output: summary.summary || '' },
            }];
          }
        }
        return [];
      }

      case 'task_started': {
        // Subagent/background task started
        const task = msg as { task_id?: string; description?: string };
        return [{
          id: crypto.randomUUID(),
          entryType: { type: 'system_message' },
          content: `Task started: ${task.description || task.task_id || 'unknown'}`,
        }];
      }

      case 'task_notification':
      case 'task_progress': {
        // Background task updates — surface as system messages
        const task = msg as { task_id?: string; message?: string; progress?: string; content?: string };
        const text = task.message || task.progress || task.content || '';
        if (!text) return [];
        return [{
          id: crypto.randomUUID(),
          entryType: { type: 'system_message' },
          content: text,
        }];
      }

      case 'status': {
        // Session-level status updates
        const status = msg as { message?: string; status?: string };
        const text = status.message || status.status || '';
        if (!text) return [];
        return [{
          id: crypto.randomUUID(),
          entryType: { type: 'system_message' },
          content: text,
        }];
      }

      case 'rate_limit_event':
        // Rate limit info — could show in UI, skip for now
        return [];

      default:
        return [];
    }
  }

  private processUserMessage(msg: ClaudeJson): NormalizedEntry[] {
    const userMsg = msg as {
      message?: { content?: unknown[] | string };
      tool_use_result?: unknown;
    };

    // Only interested in user messages that contain tool_result content blocks
    const content = userMsg.message?.content;
    if (!content || typeof content === 'string') return [];

    const entries: NormalizedEntry[] = [];
    for (const block of content) {
      const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
      if (b.type !== 'tool_result' || !b.tool_use_id) continue;

      const tracked = this.toolMap.get(b.tool_use_id);
      if (!tracked) continue;

      const status = b.is_error ? 'failed' : 'success';

      // Extract output: prefer structured tool_use_result, fall back to content block text
      let resultOutput = '';

      // Check structured tool_use_result first (contains stdout, file content, etc.)
      const structured = userMsg.tool_use_result as Record<string, unknown> | undefined;
      if (structured) {
        resultOutput = this.extractStructuredOutput(structured, tracked.toolName);
      }

      // Fall back to the tool_result content block text
      if (!resultOutput) {
        const raw = b.content;
        if (typeof raw === 'string') {
          resultOutput = raw;
        } else if (Array.isArray(raw)) {
          // Content can be an array of text/image blocks
          resultOutput = raw
            .map((item: { type?: string; text?: string }) =>
              item.type === 'text' ? item.text || '' : ''
            )
            .filter(Boolean)
            .join('\n');
        } else if (raw) {
          resultOutput = JSON.stringify(raw).slice(0, 5000);
        }
      }

      this.toolMap.delete(b.tool_use_id);
      this.setActivity({ state: 'streaming' });

      entries.push({
        id: tracked.entryId,
        entryType: {
          type: 'tool_use',
          toolName: tracked.toolName,
          actionType: tracked.actionType,
          status: status as 'success' | 'failed',
        },
        content: tracked.content,
        metadata: { output: resultOutput },
      });
    }

    return entries;
  }

  /** Extract meaningful text from the structured tool_use_result object */
  private extractStructuredOutput(result: Record<string, unknown>, toolName: string): string {
    // Bash tool: { stdout, stderr, interrupted }
    if (toolName === 'Bash') {
      const parts: string[] = [];
      if (result.stdout) parts.push(String(result.stdout));
      if (result.stderr) parts.push(String(result.stderr));
      return parts.join('\n').slice(0, 5000);
    }

    // Read tool: { type, file: { filePath, content, numLines } }
    if (toolName === 'Read') {
      const file = result.file as Record<string, unknown> | undefined;
      if (file?.content) return String(file.content).slice(0, 5000);
    }

    // Edit/Write tool: { filePath, structuredPatch, gitDiff }
    if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
      if (result.gitDiff) return String(result.gitDiff).slice(0, 5000);
      if (result.structuredPatch) return JSON.stringify(result.structuredPatch).slice(0, 5000);
    }

    // Glob: { filenames, numFiles }
    if (toolName === 'Glob') {
      const files = result.filenames as string[] | undefined;
      if (files) return files.join('\n').slice(0, 5000);
    }

    // Grep: { filenames, content, numMatches }
    if (toolName === 'Grep') {
      if (result.content) return String(result.content).slice(0, 5000);
      const files = result.filenames as string[] | undefined;
      if (files) return files.join('\n').slice(0, 5000);
    }

    // Generic fallback: stringify the result
    try {
      const str = JSON.stringify(result);
      if (str && str !== '{}') return str.slice(0, 5000);
    } catch { /* ignore */ }
    return '';
  }

  private processToolUse(msg: ClaudeJson): NormalizedEntry[] {
    const toolMsg = msg as Record<string, unknown>;
    const toolName = (toolMsg.tool_name || toolMsg.name) as string;
    const toolId = toolMsg.id as string;

    // If this tool was already emitted via stream_event content_block_stop, skip
    if (toolId && this.toolMap.has(toolId)) {
      return [];
    }

    const actionType = this.extractActionType(toolName, toolMsg);
    const content = this.generateToolContent(toolName, toolMsg);
    const entryId = crypto.randomUUID();

    // Store for later tool_result matching
    if (toolId) {
      this.toolMap.set(toolId, { entryId, toolName, content, actionType });
    }

    this.setActivity({ state: 'tool_running', toolName, description: content });

    return [{
      id: entryId,
      entryType: { type: 'tool_use', toolName, actionType, status: 'created' },
      content,
    }];
  }

  private processToolResult(msg: ClaudeJson): NormalizedEntry[] {
    const resultMsg = msg as {
      tool_use_id?: string;
      result?: unknown;
      content?: unknown;
      is_error?: boolean;
    };

    const toolUseId = resultMsg.tool_use_id;
    if (!toolUseId) {
      this.setActivity({ state: 'streaming' });
      return [];
    }

    const tracked = this.toolMap.get(toolUseId);
    if (!tracked) {
      this.setActivity({ state: 'streaming' });
      return [];
    }

    const status = resultMsg.is_error ? 'failed' : 'success';
    // Claude SDK may use either 'result' or 'content' for the output
    const raw = resultMsg.result ?? resultMsg.content ?? '';
    const resultOutput = typeof raw === 'string'
      ? raw
      : JSON.stringify(raw).slice(0, 2000);

    this.toolMap.delete(toolUseId);
    this.setActivity({ state: 'streaming' });

    return [{
      id: tracked.entryId,
      entryType: {
        type: 'tool_use',
        toolName: tracked.toolName,
        actionType: tracked.actionType,
        status: status as 'success' | 'failed',
      },
      content: tracked.content,
      metadata: { output: resultOutput },
    }];
  }

  private processStreamEvent(msg: ClaudeJson): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];
    const event = (msg as { event: StreamEvent }).event;

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'text') {
          this.streamingText = (block as { text?: string }).text || '';
          this.streamingEntryId = crypto.randomUUID();
          this.setActivity({ state: 'streaming' });
          entries.push({
            id: this.streamingEntryId,
            entryType: { type: 'assistant_message' },
            content: this.streamingText,
          });
        } else if (block.type === 'thinking') {
          this.streamingThinking = (block as { thinking?: string }).thinking || '';
          this.thinkingEntryId = crypto.randomUUID();
          this.setActivity({ state: 'thinking' });
          entries.push({
            id: this.thinkingEntryId,
            entryType: { type: 'thinking' },
            content: this.streamingThinking,
          });
        } else if (block.type === 'tool_use') {
          const toolBlock = block as { id: string; name: string };
          this.streamingToolId = toolBlock.id;
          this.streamingToolName = toolBlock.name;
          this.streamingToolInput = '';
          this.streamingToolEntryId = crypto.randomUUID();
          this.setActivity({ state: 'tool_running', toolName: toolBlock.name });
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta as ContentBlockDelta;
        if (delta.type === 'text_delta' && this.streamingEntryId) {
          this.streamingText += delta.text;
          entries.push({
            id: this.streamingEntryId,
            entryType: { type: 'assistant_message' },
            content: this.streamingText,
          });
        } else if (delta.type === 'thinking_delta' && this.thinkingEntryId) {
          this.streamingThinking += delta.thinking;
          entries.push({
            id: this.thinkingEntryId,
            entryType: { type: 'thinking' },
            content: this.streamingThinking,
          });
        } else if (delta.type === 'input_json_delta' && this.streamingToolEntryId) {
          this.streamingToolInput += delta.partial_json;
        }
        break;
      }

      case 'content_block_stop': {
        // Finalize any streaming text/thinking block
        this.streamingEntryId = null;
        this.thinkingEntryId = null;
        this.streamingText = '';
        this.streamingThinking = '';

        // Finalize any streaming tool_use block — emit the complete tool entry
        if (this.streamingToolEntryId && this.streamingToolName) {
          const toolName = this.streamingToolName;
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(this.streamingToolInput);
          } catch { /* partial/empty JSON — use raw string */ }

          const actionType = this.extractActionType(toolName, parsedInput);
          const content = this.generateToolContent(toolName, parsedInput);

          if (this.streamingToolId) {
            this.toolMap.set(this.streamingToolId, {
              entryId: this.streamingToolEntryId,
              toolName,
              content,
              actionType,
            });
          }

          entries.push({
            id: this.streamingToolEntryId,
            entryType: { type: 'tool_use', toolName, actionType, status: 'created' },
            content,
          });

          this.streamingToolId = null;
          this.streamingToolName = null;
          this.streamingToolInput = '';
          this.streamingToolEntryId = null;
        }
        break;
      }
    }

    return entries;
  }

  private processResult(msg: ClaudeJson): NormalizedEntry[] {
    this.setActivity({ state: 'idle' });
    const result = msg as { model_usage?: Record<string, Record<string, number>> };
    if (!result.model_usage) return [];

    const usage = Object.values(result.model_usage)[0];
    if (!usage) return [];

    return [
      {
        id: crypto.randomUUID(),
        entryType: {
          type: 'token_usage',
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          contextWindow: 200_000,
        },
        content: '',
      },
    ];
  }

  private extractActionType(toolName: string, msg: Record<string, unknown>): ActionType {
    switch (toolName) {
      case 'Read':
        return { action: 'file_read', path: this.relativePath(msg.file_path as string) };

      case 'Edit':
      case 'MultiEdit':
      case 'Write':
        return {
          action: 'file_edit',
          path: this.relativePath((msg.file_path || msg.path) as string),
          changes:
            msg.old_string !== undefined
              ? [
                  {
                    action: 'edit',
                    oldString: msg.old_string as string,
                    newString: msg.new_string as string,
                  },
                ]
              : msg.content !== undefined
                ? [{ action: 'write', content: msg.content as string }]
                : [],
        };

      case 'Bash':
        return { action: 'command_run', command: (msg.command as string) || '' };

      case 'Grep':
      case 'Glob':
        return { action: 'search', query: ((msg.pattern || msg.query) as string) || '' };

      case 'WebFetch':
        return { action: 'web_fetch', url: (msg.url as string) || '' };

      case 'WebSearch':
        return { action: 'web_fetch', url: (msg.query as string) || '' };

      case 'Task':
      case 'Agent':
        return {
          action: 'task_create',
          description: ((msg.description || msg.prompt) as string) || '',
        };

      case 'ExitPlanMode':
        return { action: 'plan_presentation', plan: (msg.plan as string) || '' };

      default:
        if (toolName.startsWith('mcp__')) {
          return { action: 'other', description: `MCP: ${toolName}` };
        }
        return { action: 'other', description: toolName };
    }
  }

  private generateToolContent(toolName: string, msg: Record<string, unknown>): string {
    switch (toolName) {
      case 'Read':
        return `Reading ${this.relativePath(msg.file_path as string)}`;
      case 'Edit':
        return `Editing ${this.relativePath((msg.file_path || msg.path) as string)}`;
      case 'Write':
        return `Writing ${this.relativePath((msg.file_path || msg.path) as string)}`;
      case 'Bash':
        return `$ ${msg.command}`;
      case 'Grep':
        return `Searching for "${msg.pattern}"`;
      case 'Glob':
        return `Finding files: ${msg.pattern}`;
      case 'WebFetch':
        return `Fetching ${msg.url}`;
      case 'Task':
      case 'Agent':
        return `Spawning agent: ${msg.description || msg.prompt}`;
      default:
        return toolName;
    }
  }

  private relativePath(filePath: string | undefined): string {
    if (!filePath) return '';
    return path.relative(this.worktreePath, filePath) || filePath;
  }

}
