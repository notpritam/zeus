// Shared types — used by both main process and renderer

// ─── Permission Mode ───

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

// ─── Settings Types ───

export interface SavedProject {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface ClaudeDefaults {
  permissionMode: PermissionMode;
  model: string;
  notificationSound: boolean;
}

export interface ZeusSettings {
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
}

export type SettingsPayload =
  | { type: 'get_settings' }
  | { type: 'settings_update'; settings: ZeusSettings }
  | { type: 'add_project'; name: string; path: string }
  | { type: 'remove_project'; id: string }
  | { type: 'update_defaults'; defaults: Partial<ClaudeDefaults> }
  | { type: 'set_last_used_project'; id: string | null }
  | { type: 'settings_error'; message: string };

// ─── File Tree Types ───

export interface FileTreeEntry {
  name: string;        // "App.tsx"
  path: string;        // relative: "src/renderer/src/App.tsx"
  type: 'file' | 'directory';
  size?: number;       // bytes, files only
}

export type FilesPayload =
  | { type: 'start_watching'; workingDir: string }
  | { type: 'stop_watching' }
  | { type: 'list_directory'; dirPath: string }
  | { type: 'directory_listing'; dirPath: string; entries: FileTreeEntry[] }
  | { type: 'read_file'; filePath: string }
  | { type: 'read_file_result'; filePath: string; content: string; language: string }
  | { type: 'read_file_error'; filePath: string; error: string }
  | { type: 'save_file'; filePath: string; content: string }
  | { type: 'save_file_result'; filePath: string; success: boolean; error?: string }
  | { type: 'files_changed'; directories: string[] }
  | { type: 'files_connected' }
  | { type: 'files_error'; message: string };

// ─── Git Payloads ───

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'MM' | 'AM' | 'UU';

export interface GitFileChange {
  file: string;
  status: GitFileStatus;
  oldFile?: string;
}

export interface GitStatusData {
  branch: string;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  ahead: number;
  behind: number;
}

export type GitPayload =
  | { type: 'start_watching'; workingDir: string }
  | { type: 'stop_watching' }
  | { type: 'git_connected' }
  | { type: 'git_disconnected' }
  | { type: 'git_heartbeat' }
  | { type: 'git_status'; data: GitStatusData }
  | { type: 'git_stage'; files: string[] }
  | { type: 'git_unstage'; files: string[] }
  | { type: 'git_stage_all' }
  | { type: 'git_unstage_all' }
  | { type: 'git_discard'; files: string[] }
  | { type: 'git_file_contents'; file: string; staged: boolean }
  | { type: 'git_file_contents_result'; file: string; staged: boolean; original: string; modified: string; language: string }
  | { type: 'git_file_contents_error'; file: string; error: string }
  | { type: 'git_save_file'; file: string; content: string }
  | { type: 'git_save_file_result'; file: string; success: boolean; error?: string }
  | { type: 'git_commit'; message: string }
  | { type: 'git_commit_result'; success: boolean; error?: string; commitHash?: string }
  | { type: 'refresh' }
  | { type: 'git_error'; message: string }
  | { type: 'not_a_repo' };

// ─── Session ───

export type SessionStatus = 'active' | 'exited' | 'killed' | 'archived';

export interface SessionRecord {
  id: string;
  shell: string;
  status: SessionStatus;
  cols: number;
  rows: number;
  cwd: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
}

// ─── WebSocket Envelope ───

export interface WsEnvelope {
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files';
  sessionId: string;
  payload: unknown;
  auth: string;
}

// ─── Terminal Payloads ───

export interface TerminalInputPayload {
  type: 'input';
  data: string;
}

export interface TerminalOutputPayload {
  type: 'output';
  data: string;
}

export interface TerminalResizePayload {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalExitPayload {
  type: 'exit';
  code: number;
}

export type TerminalPayload =
  | TerminalInputPayload
  | TerminalOutputPayload
  | TerminalResizePayload
  | TerminalExitPayload;

// ─── Control Payloads ───

export interface StartSessionPayload {
  type: 'start_session';
  cols?: number;
  rows?: number;
}

export interface StopSessionPayload {
  type: 'stop_session';
}

export interface SessionStartedPayload {
  type: 'session_started';
  sessionId: string;
  shell: string;
}

export interface ListSessionsPayload {
  type: 'list_sessions';
}

export interface SessionListPayload {
  type: 'session_list';
  sessions: SessionRecord[];
}

export interface SessionUpdatedPayload {
  type: 'session_updated';
  session: SessionRecord;
}

export interface ErrorPayload {
  type: 'error';
  message: string;
}

export type ControlPayload =
  | StartSessionPayload
  | StopSessionPayload
  | SessionStartedPayload
  | ListSessionsPayload
  | SessionListPayload
  | SessionUpdatedPayload
  | ErrorPayload;

// ─── Status Payloads ───

export interface StatusPayload {
  type: 'status_update' | 'get_status' | 'toggle_power' | 'toggle_tunnel';
  powerBlock?: boolean;
  websocket?: boolean;
  tunnel?: string | null;
}

// ─── Claude Payloads ───

export interface ClaudeStartPayload {
  type: 'start_claude';
  prompt: string;
  workingDir?: string;
  permissionMode?: PermissionMode;
  model?: string;
  sessionName?: string;
  notificationSound?: boolean;
  enableGitWatcher?: boolean;
}

export interface ClaudeResumePayload {
  type: 'resume_claude';
  claudeSessionId: string;
  prompt: string;
  workingDir?: string;
}

export interface ClaudeSendMessagePayload {
  type: 'send_message';
  content: string;
}

export interface ClaudeApproveToolPayload {
  type: 'approve_tool';
  approvalId: string;
}

export interface ClaudeDenyToolPayload {
  type: 'deny_tool';
  approvalId: string;
  reason?: string;
}

export interface ClaudeInterruptPayload {
  type: 'interrupt';
}

export interface ClaudeStopPayload {
  type: 'stop_claude';
}

export interface ClaudeListSessionsPayload {
  type: 'list_claude_sessions';
}

export interface ClaudeSessionListPayload {
  type: 'claude_session_list';
  sessions: ClaudeSessionInfo[];
}

export interface ClaudeGetHistoryPayload {
  type: 'get_claude_history';
}

export interface ClaudeHistoryPayload {
  type: 'claude_history';
  entries: NormalizedEntry[];
}

export type ClaudePayload =
  | ClaudeStartPayload
  | ClaudeResumePayload
  | ClaudeSendMessagePayload
  | ClaudeApproveToolPayload
  | ClaudeDenyToolPayload
  | ClaudeInterruptPayload
  | ClaudeStopPayload
  | ClaudeListSessionsPayload
  | ClaudeSessionListPayload
  | ClaudeGetHistoryPayload
  | ClaudeHistoryPayload;

// ─── Claude UI Types (renderer-side) ───

export type ClaudeSessionStatus = 'running' | 'done' | 'error' | 'archived';

export interface ClaudeSessionInfo {
  id: string; // envelope sessionId (client-generated)
  claudeSessionId: string | null; // real Claude session ID (from stream)
  status: ClaudeSessionStatus;
  prompt: string;
  name?: string;
  notificationSound?: boolean;
  enableGitWatcher?: boolean;
  workingDir?: string;
  startedAt: number;
}

export interface ClaudeApprovalInfo {
  approvalId: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
}

// NormalizedEntry types (mirroring main process, used by renderer to render)

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
  | { action: 'file_edit'; path: string }
  | { action: 'command_run'; command: string }
  | { action: 'search'; query: string }
  | { action: 'web_fetch'; url: string }
  | { action: 'task_create'; description: string }
  | { action: 'plan_presentation'; plan: string }
  | { action: 'other'; description: string };
