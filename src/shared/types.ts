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

// ─── Theme Types ───

export interface ThemeMeta {
  id: string;
  name: string;
  author?: string;
  type: 'dark' | 'light';
  builtIn: boolean;
}

export interface ThemeFile extends ThemeMeta {
  colors: Record<string, string>;
}

export interface ZeusSettings {
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  activeThemeId: string;
  themes: ThemeMeta[];
}

export type SettingsPayload =
  | { type: 'get_settings' }
  | { type: 'settings_update'; settings: ZeusSettings }
  | { type: 'add_project'; name: string; path: string; createDir?: boolean }
  | { type: 'remove_project'; id: string }
  | { type: 'update_defaults'; defaults: Partial<ClaudeDefaults> }
  | { type: 'set_last_used_project'; id: string | null }
  | { type: 'settings_error'; message: string }
  | { type: 'set_theme'; themeId: string }
  | { type: 'get_theme_colors'; themeId: string }
  | { type: 'theme_colors'; theme: ThemeFile }
  | { type: 'refresh_themes' }
  | { type: 'open_themes_folder' };

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
  | { type: 'search_files'; query: string }
  | { type: 'search_files_result'; query: string; results: Array<{ path: string; name: string; type: 'file' | 'directory' }> }
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
  | { type: 'not_a_repo' }
  | { type: 'git_init'; workingDir: string }
  | { type: 'git_init_result'; success: boolean; error?: string };

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
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf';
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
  enableQA?: boolean;
  qaTargetUrl?: string;
}

export interface ClaudeResumePayload {
  type: 'resume_claude';
  claudeSessionId: string;
  prompt: string;
  workingDir?: string;
  name?: string | null;
  color?: string | null;
}

export interface ImageAttachment {
  filename: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  dataUrl: string; // data:image/png;base64,...
}

export interface ClaudeSendMessagePayload {
  type: 'send_message';
  content: string;
  files?: string[];
  images?: ImageAttachment[];
}

export interface ClaudeApproveToolPayload {
  type: 'approve_tool';
  approvalId: string;
  updatedInput?: Record<string, unknown>;
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

export interface ClaudeUpdateSessionPayload {
  type: 'update_claude_session';
  name?: string;
  color?: string | null; // null to clear
}

export interface ClaudeSessionUpdatedPayload {
  type: 'claude_session_updated';
  sessionId: string;
  name?: string;
  color?: string | null;
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
  | ClaudeHistoryPayload
  | ClaudeUpdateSessionPayload
  | ClaudeSessionUpdatedPayload
;

// ─── Claude UI Types (renderer-side) ───

export type ClaudeSessionStatus = 'running' | 'done' | 'error' | 'archived';

// Fine-grained activity state for a running session
export type SessionActivity =
  | { state: 'idle' }
  | { state: 'thinking' }
  | { state: 'streaming' }
  | { state: 'tool_running'; toolName: string; description: string }
  | { state: 'waiting_approval'; toolName: string }
  | { state: 'starting' };

export type SessionIconName =
  | 'sparkles' | 'star' | 'flame' | 'gem' | 'hexagon' | 'pentagon' | 'triangle' | 'orbit'
  | 'atom' | 'rocket' | 'leaf' | 'moon' | 'sun' | 'waves' | 'wind' | 'snowflake'
  | 'bolt' | 'crown' | 'diamond' | 'target' | 'compass' | 'anchor' | 'feather' | 'ghost';

export const SESSION_ICON_NAMES: SessionIconName[] = [
  'sparkles', 'star', 'flame', 'gem', 'hexagon', 'pentagon', 'triangle', 'orbit',
  'atom', 'rocket', 'leaf', 'moon', 'sun', 'waves', 'wind', 'snowflake',
  'bolt', 'crown', 'diamond', 'target', 'compass', 'anchor', 'feather', 'ghost',
];

export const SESSION_ICON_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#a78bfa',
  '#f472b6', '#e879f9', '#c084fc', '#38bdf8',
];

export interface ClaudeSessionInfo {
  id: string; // envelope sessionId (client-generated)
  claudeSessionId: string | null; // real Claude session ID (from stream)
  status: ClaudeSessionStatus;
  prompt: string;
  name?: string;
  icon?: SessionIconName; // auto-assigned random icon
  color?: string; // hex color for sidebar card accent
  notificationSound?: boolean;
  enableGitWatcher?: boolean;
  enableQA?: boolean;
  workingDir?: string;
  startedAt: number;
  qaAgentCount?: number;
  permissionMode?: PermissionMode;
  model?: string;
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

export type FileChange =
  | { action: 'write'; content: string }
  | { action: 'edit'; oldString: string; newString: string }
  | { action: 'delete' };

export type ActionType =
  | { action: 'file_read'; path: string }
  | { action: 'file_edit'; path: string; changes?: FileChange[] }
  | { action: 'command_run'; command: string; exitCode?: number; output?: string }
  | { action: 'search'; query: string }
  | { action: 'web_fetch'; url: string }
  | { action: 'task_create'; description: string; agentName?: string; agentType?: string }
  | { action: 'plan_presentation'; plan: string }
  | { action: 'mcp_tool'; server: string; method: string; input: string }
  | { action: 'other'; description: string };

// ─── Performance / System Monitor Types ───

export interface ProcessMetric {
  pid: number;
  name: string;
  cpu: number; // percentage
  memory: number; // bytes
  type: 'electron' | 'claude' | 'terminal' | 'qa' | 'other';
  sessionId?: string;
}

export interface SystemMetrics {
  cpu: {
    usage: number; // 0-100 percentage
    cores: number;
  };
  memory: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usage: number; // 0-100 percentage
  };
  uptime: number; // system uptime in seconds
  loadAvg: [number, number, number]; // 1m, 5m, 15m
  processes: ProcessMetric[];
  snapshot: {
    peakCpu: number;
    peakMemory: number;
    monitoringSince: number; // timestamp
    totalProcessesSpawned: number;
  };
  pollInterval: number; // current interval in ms
}

export type PerfPayload =
  | { type: 'get_perf' }
  | { type: 'perf_update'; metrics: SystemMetrics }
  | { type: 'set_poll_interval'; intervalMs: number }
  | { type: 'start_monitoring' }
  | { type: 'stop_monitoring' };

// ─── QA / PinchTab Types ───

export interface QaInstanceInfo {
  instanceId: string;
  profileId?: string;
  headless: boolean;
}

export interface QaTabInfo {
  tabId: string;
  url: string;
  title: string;
}

export interface QaSnapshotNode {
  ref: string;
  role: string;
  name: string;
  children?: QaSnapshotNode[];
}

// ─── QA Agent ───

/** @deprecated — QA agents now use NormalizedEntry directly. Kept for migration reference. */
export type QaAgentLogEntry =
  | { kind: 'tool_call'; tool: string; args: string; timestamp: number }
  | { kind: 'tool_result'; tool: string; summary: string; success: boolean; timestamp: number; imageData?: string }
  | { kind: 'text'; content: string; timestamp: number }
  | { kind: 'error'; message: string; timestamp: number }
  | { kind: 'user_message'; content: string; timestamp: number }
  | { kind: 'thinking'; content: string; timestamp: number }
  | { kind: 'status'; message: string; timestamp: number };

export type QaAgentStatus = 'running' | 'stopped' | 'error';

export interface QaAgentSessionInfo {
  qaAgentId: string;
  parentSessionId: string;        // terminal or claude session id
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;
  status: QaAgentStatus;
  startedAt: number;
}

export type QaPayload =
  // Client → Server
  | { type: 'start_qa' }
  | { type: 'stop_qa' }
  | { type: 'get_qa_status' }
  | { type: 'launch_instance'; headless?: boolean }
  | { type: 'stop_instance'; instanceId: string }
  | { type: 'navigate'; url: string }
  | { type: 'snapshot'; filter?: 'interactive' | 'full' }
  | { type: 'screenshot' }
  | { type: 'action'; kind: string; ref?: string; value?: string; key?: string }
  | { type: 'text' }
  | { type: 'list_tabs' }
  // Server → Client
  | { type: 'qa_status'; running: boolean; instances: QaInstanceInfo[] }
  | { type: 'qa_started' }
  | { type: 'qa_stopped' }
  | { type: 'instance_launched'; instance: QaInstanceInfo }
  | { type: 'instance_stopped'; instanceId: string }
  | { type: 'tabs_list'; tabs: QaTabInfo[] }
  | { type: 'snapshot_result'; nodes: QaSnapshotNode[]; raw?: string }
  | { type: 'screenshot_result'; dataUrl: string }
  | { type: 'action_result'; success: boolean; message?: string }
  | { type: 'text_result'; text: string }
  | { type: 'navigate_result'; url: string; title: string }
  // Server → Client (CDP observability)
  | { type: 'cdp_console'; logs: Array<{ level: string; message: string; timestamp: number }> }
  | { type: 'cdp_network'; requests: Array<{ url: string; method: string; status: number; duration: number; failed: boolean; error?: string }> }
  | { type: 'cdp_error'; errors: Array<{ message: string; stack: string; timestamp: number }> }
  // Client → Server (QA Agent)
  | { type: 'start_qa_agent'; task: string; name?: string; workingDir: string; targetUrl?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude' }
  | { type: 'stop_qa_agent'; qaAgentId: string }
  | { type: 'qa_agent_message'; qaAgentId: string; text: string }
  | { type: 'list_qa_agents'; parentSessionId: string }
  | { type: 'get_qa_agent_entries'; qaAgentId: string }
  | { type: 'delete_qa_agent'; qaAgentId: string; parentSessionId: string }
  | { type: 'clear_qa_agent_entries'; qaAgentId: string }
  // Server → Client (QA Agent)
  | { type: 'qa_agent_started'; qaAgentId: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; task: string; targetUrl?: string }
  | { type: 'qa_agent_stopped'; qaAgentId: string; parentSessionId: string }
  | { type: 'qa_agent_deleted'; qaAgentId: string; parentSessionId: string }
  | { type: 'qa_agent_entry'; qaAgentId: string; parentSessionId: string; entry: NormalizedEntry }
  | { type: 'qa_agent_list'; parentSessionId: string; agents: QaAgentSessionInfo[] }
  | { type: 'qa_agent_entries'; qaAgentId: string; entries: NormalizedEntry[] }
  | { type: 'qa_error'; message: string };
