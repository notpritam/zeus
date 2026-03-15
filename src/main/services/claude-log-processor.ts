// ClaudeLogProcessor — converts raw ClaudeJson stream messages into
// NormalizedEntry items that the UI can render directly.

import crypto from 'crypto';
import path from 'path';
import type {
  ClaudeJson,
  NormalizedEntry,
  ActionType,
  ContentItem,
  StreamEvent,
  ContentBlockDelta,
} from './claude-types';

export class ClaudeLogProcessor {
  // Map tool_use id → entry metadata for result matching
  private toolMap = new Map<string, { entryId: string; toolName: string; content: string }>();

  // Streaming state
  private streamingText = '';
  private streamingThinking = '';
  private streamingEntryId: string | null = null;
  private thinkingEntryId: string | null = null;

  constructor(private worktreePath: string) {}

  /** Process a raw ClaudeJson message → 0 or more NormalizedEntry items */
  process(msg: ClaudeJson): NormalizedEntry[] {
    switch (msg.type) {
      case 'assistant':
        return this.processAssistant(msg);

      case 'user':
        if (!(msg as { isReplay?: boolean }).isReplay) {
          return [
            {
              id: crypto.randomUUID(),
              entryType: { type: 'user_message' },
              content: this.extractMessageText(msg),
            },
          ];
        }
        return [];

      case 'tool_use':
        return [this.processToolUse(msg)];

      case 'tool_result':
        return this.processToolResult(msg);

      case 'stream_event':
        return this.processStreamEvent(msg);

      case 'result':
        return this.processResult(msg);

      case 'system':
        // System init — could extract model info; skip for now
        return [];

      default:
        return [];
    }
  }

  private processAssistant(msg: ClaudeJson): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];
    const message = (msg as { message?: { content?: ContentItem[] | string } }).message;
    if (!message?.content) return entries;

    const content = message.content;
    if (typeof content === 'string') {
      entries.push({
        id: crypto.randomUUID(),
        entryType: { type: 'assistant_message' },
        content,
      });
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text') {
          entries.push({
            id: crypto.randomUUID(),
            entryType: { type: 'assistant_message' },
            content: item.text,
          });
        } else if (item.type === 'thinking') {
          entries.push({
            id: crypto.randomUUID(),
            entryType: { type: 'thinking' },
            content: item.thinking,
          });
        } else if (item.type === 'tool_use') {
          entries.push(
            this.processToolUse({
              type: 'tool_use',
              id: item.id,
              tool_name: item.name,
              ...(typeof item.input === 'object' && item.input !== null ? item.input : {}),
            } as ClaudeJson),
          );
        }
      }
    }

    return entries;
  }

  private processToolUse(msg: ClaudeJson): NormalizedEntry {
    const toolMsg = msg as Record<string, unknown>;
    const toolName = (toolMsg.tool_name || toolMsg.name) as string;
    const toolId = toolMsg.id as string;
    const actionType = this.extractActionType(toolName, toolMsg);
    const content = this.generateToolContent(toolName, toolMsg);
    const entryId = crypto.randomUUID();

    // Store for later tool_result matching
    if (toolId) {
      this.toolMap.set(toolId, { entryId, toolName, content });
    }

    return {
      id: entryId,
      entryType: { type: 'tool_use', toolName, actionType, status: 'created' },
      content,
    };
  }

  private processToolResult(): NormalizedEntry[] {
    // Tool results update status of existing tool_use entries.
    // The UI should match by tool_use id and patch the status.
    // For now we don't emit new entries — the session emits 'entry_update' events.
    return [];
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
          entries.push({
            id: this.streamingEntryId,
            entryType: { type: 'assistant_message' },
            content: this.streamingText,
          });
        } else if (block.type === 'thinking') {
          this.streamingThinking = (block as { thinking?: string }).thinking || '';
          this.thinkingEntryId = crypto.randomUUID();
          entries.push({
            id: this.thinkingEntryId,
            entryType: { type: 'thinking' },
            content: this.streamingThinking,
          });
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
        }
        break;
      }

      case 'content_block_stop':
        this.streamingEntryId = null;
        this.thinkingEntryId = null;
        this.streamingText = '';
        this.streamingThinking = '';
        break;
    }

    return entries;
  }

  private processResult(msg: ClaudeJson): NormalizedEntry[] {
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

  private extractMessageText(msg: ClaudeJson): string {
    const message = (msg as { message?: { content?: ContentItem[] | string } }).message;
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join('\n');
    }
    return '';
  }
}
