// ============================================================
// Types for Claude Code SDK stream-json protocol
// Adapted from vibe-kanban's Rust types into TypeScript
// ============================================================

import crypto from 'crypto';

// --- Permission Modes ---
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

// --- Messages App → Claude (stdin) ---

export interface SDKControlRequest {
  type: 'control_request';
  request_id: string;
  request: SDKControlRequestType;
}

export type SDKControlRequestType =
  | { subtype: 'initialize'; hooks?: Record<string, unknown[]> }
  | { subtype: 'set_permission_mode'; mode: PermissionMode }
  | { subtype: 'interrupt' };

export interface ControlResponseMessage {
  type: 'control_response';
  response: ControlResponseType;
}

export type ControlResponseType =
  | { subtype: 'success'; request_id: string; response?: unknown }
  | { subtype: 'error'; request_id: string; error?: string };

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string; // raw base64 string (no data: prefix)
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface UserMessage {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput: unknown; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export interface PermissionUpdate {
  type: 'setMode' | 'addRules' | 'removeRules' | 'clearRules';
  mode?: PermissionMode;
  destination?: 'session' | 'userSettings' | 'projectSettings' | 'localSettings';
  rules?: { tool_name: string; rule_content?: string }[];
}

// --- Messages Claude → App (stdout) ---

export type ClaudeJson =
  | ClaudeSystemMsg
  | ClaudeAssistantMsg
  | ClaudeUserMsg
  | ClaudeToolUseMsg
  | ClaudeToolResultMsg
  | ClaudeStreamEventMsg
  | ClaudeResultMsg
  | ClaudeControlRequestMsg
  | ClaudeRateLimitMsg
  | ClaudeStatusMsg
  | ClaudeToolProgressMsg
  | ClaudeTaskNotificationMsg
  | ClaudeTaskStartedMsg
  | ClaudeTaskProgressMsg
  | ClaudeToolUseSummaryMsg
  | ClaudeHookProgressMsg
  | ClaudeFilesPersistedMsg
  | { type: string; [key: string]: unknown }; // catch-all

export interface ClaudeSystemMsg {
  type: 'system';
  subtype?: string;
  session_id?: string;
  cwd?: string;
  model?: string;
  tools?: unknown[];
  slash_commands?: string[];
  agents?: string[];
  apiKeySource?: string;
}

export interface ClaudeAssistantMsg {
  type: 'assistant';
  session_id?: string;
  uuid?: string;
  message: ClaudeMessage;
}

export interface ClaudeUserMsg {
  type: 'user';
  session_id?: string;
  uuid?: string;
  message: ClaudeMessage;
  isSynthetic?: boolean;
  isReplay?: boolean;
  /** Structured tool output data — the actual parsed result from Claude Code's built-in tools */
  tool_use_result?: unknown;
}

export interface ClaudeToolUseMsg {
  type: 'tool_use';
  id: string;
  tool_name: string;
  session_id?: string;
  [key: string]: unknown; // tool-specific fields (file_path, command, etc.)
}

export interface ClaudeToolResultMsg {
  type: 'tool_result';
  session_id?: string;
  tool_use_id?: string;
  result: unknown;
  is_error?: boolean;
}

export interface ClaudeStreamEventMsg {
  type: 'stream_event';
  session_id?: string;
  uuid?: string;
  parent_tool_use_id?: string;
  event: StreamEvent;
}

export type StreamEvent =
  | { type: 'message_start'; message: ClaudeMessage }
  | { type: 'content_block_start'; index: number; content_block: ContentItem }
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta?: { stop_reason?: string }; usage?: TokenUsage }
  | { type: 'message_stop' };

export type ContentBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string }
  | { type: 'input_json_delta'; partial_json: string };

export interface ClaudeResultMsg {
  type: 'result';
  session_id?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  result?: unknown;
  error?: string;
  model_usage?: Record<string, ModelUsage>;
  usage?: TokenUsage;
}

export interface ClaudeControlRequestMsg {
  type: 'control_request';
  request_id: string;
  request: ControlRequestType;
}

export type ControlRequestType =
  | {
      subtype: 'can_use_tool';
      tool_name: string;
      input: unknown;
      permission_suggestions?: PermissionUpdate[];
      tool_use_id?: string;
    }
  | {
      subtype: 'hook_callback';
      callback_id: string;
      input: unknown;
      tool_use_id?: string;
    };

export interface ClaudeRateLimitMsg {
  type: 'rate_limit_event';
  session_id?: string;
  rate_limit_info?: unknown;
}

// --- Additional SDK message types (discovered from official SDK reference) ---

export interface ClaudeStatusMsg {
  type: 'status';
  session_id?: string;
  status?: string;
  message?: string;
}

export interface ClaudeToolProgressMsg {
  type: 'tool_progress';
  session_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  progress?: string;
  content?: string;
}

export interface ClaudeTaskNotificationMsg {
  type: 'task_notification';
  session_id?: string;
  task_id?: string;
  status?: string;
  message?: string;
}

export interface ClaudeTaskStartedMsg {
  type: 'task_started';
  session_id?: string;
  task_id?: string;
  description?: string;
}

export interface ClaudeTaskProgressMsg {
  type: 'task_progress';
  session_id?: string;
  task_id?: string;
  progress?: string;
  content?: string;
}

export interface ClaudeToolUseSummaryMsg {
  type: 'tool_use_summary';
  session_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  summary?: string;
}

export interface ClaudeHookProgressMsg {
  type: 'hook_progress';
  session_id?: string;
  hook_event_name?: string;
  progress?: string;
}

export interface ClaudeFilesPersistedMsg {
  type: 'files_persisted';
  session_id?: string;
  files?: string[];
}

// --- Shared Sub-types ---

export interface ClaudeMessage {
  id?: string;
  type?: string;
  role: string;
  model?: string;
  content: ContentItem[] | string;
  stop_reason?: string;
}

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ModelUsage extends TokenUsage {
  model?: string;
  total_cost_usd?: number;
}

// --- Normalized Entry Types (for UI) ---

export interface NormalizedEntry {
  id: string;
  timestamp?: string;
  entryType: NormalizedEntryType;
  content: string;
  metadata?: unknown;
}

export type NormalizedEntryType =
  | { type: 'user_message' }
  | { type: 'assistant_message' }
  | { type: 'tool_use'; toolName: string; actionType: ActionType; status: ToolStatus }
  | { type: 'thinking' }
  | { type: 'system_message' }
  | { type: 'error_message'; errorType: 'setup_required' | 'other' }
  | { type: 'loading' }
  | { type: 'token_usage'; totalTokens: number; contextWindow: number };

export type ToolStatus =
  | 'created'
  | 'success'
  | 'failed'
  | 'timed_out'
  | { status: 'denied'; reason?: string }
  | { status: 'pending_approval'; approvalId: string };

export type ActionType =
  | { action: 'file_read'; path: string }
  | { action: 'file_edit'; path: string; changes: FileChange[] }
  | { action: 'command_run'; command: string; exitCode?: number; output?: string }
  | { action: 'search'; query: string }
  | { action: 'web_fetch'; url: string }
  | { action: 'task_create'; description: string }
  | { action: 'plan_presentation'; plan: string }
  | { action: 'other'; description: string };

export type FileChange =
  | { action: 'write'; content: string }
  | { action: 'edit'; oldString: string; newString: string }
  | { action: 'delete' };

// --- Helper factories ---

export function makeControlRequest(request: SDKControlRequestType): SDKControlRequest {
  return { type: 'control_request', request_id: crypto.randomUUID(), request };
}

export function makeControlResponse(requestId: string, response: unknown): ControlResponseMessage {
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response },
  };
}

export function makeUserMessage(content: string | ContentBlock[]): UserMessage {
  return { type: 'user', message: { role: 'user', content } };
}
