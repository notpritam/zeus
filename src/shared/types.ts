// Shared types — used by both main process and renderer

// ─── Permission Mode ───

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export type { PermissionsPayload } from './permission-types';

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
  autoTunnel: boolean;
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
  | { type: 'open_themes_folder' }
  | { type: 'set_auto_tunnel'; enabled: boolean };

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
  | { type: 'scan_by_extension'; ext: string }
  | { type: 'scan_by_extension_result'; ext: string; results: Array<{ path: string; name: string }> }
  | { type: 'files_connected' }
  | { type: 'files_error'; message: string };

// ─── Git Payloads ───

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'MM' | 'AM' | 'UU';

export interface GitFileChange {
  file: string;
  status: GitFileStatus;
  oldFile?: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: string;          // e.g. "origin/main"
  isRemoteOnly?: boolean;   // true if only exists on remote
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
  | { type: 'git_init_result'; success: boolean; error?: string }
  // Branch operations
  | { type: 'git_list_branches' }
  | { type: 'git_branches_result'; branches: GitBranchInfo[] }
  | { type: 'git_checkout'; branch: string }
  | { type: 'git_checkout_result'; success: boolean; branch?: string; error?: string }
  | { type: 'git_create_branch'; branch: string; checkout?: boolean }
  | { type: 'git_create_branch_result'; success: boolean; branch?: string; error?: string }
  | { type: 'git_delete_branch'; branch: string; force?: boolean }
  | { type: 'git_delete_branch_result'; success: boolean; error?: string }
  // Remote operations
  | { type: 'git_push'; force?: boolean }
  | { type: 'git_push_result'; success: boolean; error?: string }
  | { type: 'git_pull' }
  | { type: 'git_pull_result'; success: boolean; error?: string }
  | { type: 'git_fetch' }
  | { type: 'git_fetch_result'; success: boolean; error?: string };

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
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android' | 'mcp' | 'task' | 'permissions';
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
  cwd?: string;           // working directory, defaults to $HOME
  correlationId?: string;  // echoed back in session_started for request matching
}

export interface StopSessionPayload {
  type: 'stop_session';
}

export interface SessionStartedPayload {
  type: 'session_started';
  sessionId: string;
  shell: string;
  correlationId?: string;  // echoed from start_session
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
  type: 'status_update' | 'get_status' | 'toggle_power' | 'toggle_tunnel' | 'stop_tunnel';
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
  mcpProfileId?: string;
  mcpServerIds?: string[];
  mcpExcludeIds?: string[];
  projectId?: string;  // for loading permission rules
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

export type ClaudeSessionStatus = 'running' | 'done' | 'error' | 'archived' | 'deleted';

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
  qaTargetUrl?: string; // auto-detected or user-set QA target URL
  startedAt: number;
  subagentCount?: number;
  permissionMode?: PermissionMode;
  model?: string;
  deletedAt?: number; // timestamp when soft-deleted (null if active)
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

// ─── Subagent Types ───

export type SubagentType = 'qa' | 'plan_reviewer' | 'android_qa';
export type SubagentCli = 'claude';

// ─── Android QA Types ───

export interface AndroidDeviceInfo {
  deviceId: string;      // e.g. "emulator-5554"
  avdName: string;       // e.g. "Pixel_9"
  status: 'running' | 'offline' | 'booting';
  apiLevel?: number;     // e.g. 35
  platform: 'android';
}

export interface LogcatEntry {
  timestamp: number;     // Unix ms — use Date.now() at parse time
  pid: number;
  tid: number;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  message: string;
}

export interface AndroidViewNode {
  className: string;
  text?: string;
  resourceId?: string;
  contentDescription?: string;
  bounds: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  children?: AndroidViewNode[];
}

export type AndroidPayload =
  // Client → Server
  | { type: 'start_emulator'; avdName?: string }
  | { type: 'stop_emulator' }
  | { type: 'list_devices' }
  | { type: 'get_android_status' }
  | { type: 'screenshot' }
  | { type: 'view_hierarchy' }
  | { type: 'install_apk'; apkPath: string }
  | { type: 'launch_app'; appId: string }
  // Server → Client
  | { type: 'android_status'; running: boolean; devices: AndroidDeviceInfo[] }
  | { type: 'emulator_started'; device: AndroidDeviceInfo }
  | { type: 'emulator_stopped' }
  | { type: 'devices_list'; devices: AndroidDeviceInfo[]; avds: string[] }
  | { type: 'screenshot_result'; dataUrl: string }
  | { type: 'view_hierarchy_result'; nodes: AndroidViewNode[]; raw?: string }
  | { type: 'app_launched'; appId: string }
  | { type: 'apk_installed'; apkPath: string }
  | { type: 'logcat_entries'; entries: LogcatEntry[] }
  | { type: 'android_error'; message: string };

// ─── QA Agent ───

// QA agents use NormalizedEntry directly — no separate entry type needed.

export type SubagentStatus = 'running' | 'stopped' | 'error';

export interface SubagentSessionInfo {
  subagentId: string;
  subagentType: SubagentType;
  cli: SubagentCli;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;
  status: SubagentStatus;
  startedAt: number;
}

export type QaBrowserPayload =
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
  // QA flows (browser-domain)
  | { type: 'list_qa_flows' }
  | { type: 'qa_flows_list'; flows: import('./qa-flow-types').FlowSummary[] }
  | { type: 'qa_error'; message: string };

// ─── MCP Management Types ───

export interface McpServerRecord {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'zeus' | 'claude';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface McpProfileRecord {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  servers: McpServerRecord[];
  createdAt: number;
}

export interface SessionMcpRecord {
  sessionId: string;
  serverId: string;
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'attached' | 'active' | 'failed';
  attachedAt: number;
}

export interface McpHealthResult {
  healthy: boolean;
  error?: string;
  latencyMs: number;
}

export type McpPayload =
  // Client → Server
  | { type: 'get_servers' }
  | { type: 'add_server'; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'update_server'; id: string; name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }
  | { type: 'remove_server'; id: string }
  | { type: 'toggle_server'; id: string; enabled: boolean }
  | { type: 'health_check'; id?: string }
  | { type: 'import_claude' }
  | { type: 'get_profiles' }
  | { type: 'create_profile'; name: string; description?: string; serverIds: string[] }
  | { type: 'update_profile'; id: string; name?: string; description?: string; serverIds?: string[] }
  | { type: 'delete_profile'; id: string }
  | { type: 'set_default_profile'; id: string }
  | { type: 'get_session_mcps'; sessionId: string }
  // Server → Client
  | { type: 'servers_list'; servers: McpServerRecord[] }
  | { type: 'server_added'; server: McpServerRecord }
  | { type: 'server_updated'; server: McpServerRecord }
  | { type: 'server_removed'; id: string }
  | { type: 'health_result'; id: string; healthy: boolean; error?: string; latencyMs: number }
  | { type: 'health_results'; results: Record<string, McpHealthResult> }
  | { type: 'import_result'; imported: string[]; skipped: string[] }
  | { type: 'profiles_list'; profiles: McpProfileRecord[] }
  | { type: 'profile_created'; profile: McpProfileRecord }
  | { type: 'profile_updated'; profile: McpProfileRecord }
  | { type: 'profile_deleted'; id: string }
  | { type: 'session_mcps'; sessionId: string; mcps: SessionMcpRecord[] }
  | { type: 'session_mcp_status'; sessionId: string; serverId: string; status: 'attached' | 'active' | 'failed' }
  | { type: 'mcp_error'; message: string; serverId?: string };

// ─── Task / Worktree Types ───

export type TaskStatus = 'creating' | 'running' | 'completed' | 'merged' | 'pr_created' | 'archived' | 'discarded' | 'error';

export interface TaskRecord {
  id: string;
  name: string;
  prompt: string;
  branch: string;           // e.g. "zeus/a1b2-add-dark-mode"
  baseBranch: string;       // e.g. "main"
  worktreeDir: string;      // absolute: "/Users/foo/myapp/.worktrees/a1b2-add-dark-mode"
  projectPath: string;      // absolute: "/Users/foo/myapp"
  status: TaskStatus;
  sessionId: string | null; // linked Claude session envelope ID
  prUrl: string | null;
  diffSummary: string | null;  // "3 files, +120 -15"
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type TaskPayload =
  // Client → Server
  | { type: 'create_task'; name: string; prompt: string; projectPath: string; baseBranch?: string; permissionMode?: PermissionMode; model?: string }
  | { type: 'list_tasks' }
  | { type: 'get_task'; taskId: string }
  | { type: 'continue_task'; taskId: string; prompt: string }
  | { type: 'merge_task'; taskId: string }
  | { type: 'create_pr'; taskId: string; title?: string; body?: string }
  | { type: 'archive_task'; taskId: string }
  | { type: 'unarchive_task'; taskId: string }
  | { type: 'discard_task'; taskId: string }
  | { type: 'get_task_diff'; taskId: string }
  // Server → Client
  | { type: 'task_created'; task: TaskRecord }
  | { type: 'task_updated'; task: TaskRecord }
  | { type: 'task_list'; tasks: TaskRecord[] }
  | { type: 'task_deleted'; taskId: string }
  | { type: 'task_diff'; taskId: string; diff: string; summary: string }
  | { type: 'task_error'; message: string; taskId?: string };

export type SubagentPayload =
  // Client → Server
  | { type: 'start_subagent'; subagentType: SubagentType; cli: SubagentCli; inputs: Record<string, string>; workingDir: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; responseId?: string }
  | { type: 'stop_subagent'; subagentId: string }
  | { type: 'subagent_message'; subagentId: string; text: string }
  | { type: 'list_subagents'; parentSessionId: string }
  | { type: 'get_subagent_entries'; subagentId: string }
  | { type: 'delete_subagent'; subagentId: string; parentSessionId: string }
  | { type: 'clear_subagent_entries'; subagentId: string }
  // Server → Client
  | { type: 'subagent_started'; subagentId: string; subagentType: SubagentType; cli: SubagentCli; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; task: string; targetUrl?: string }
  | { type: 'subagent_stopped'; subagentId: string; parentSessionId: string }
  | { type: 'subagent_deleted'; subagentId: string; parentSessionId: string }
  | { type: 'subagent_entry'; subagentId: string; parentSessionId: string; entry: NormalizedEntry }
  | { type: 'subagent_list'; parentSessionId: string; agents: SubagentSessionInfo[] }
  | { type: 'subagent_entries'; subagentId: string; entries: NormalizedEntry[] }
  | { type: 'subagent_error'; message: string }
  // External subagent registration
  | { type: 'register_external_subagent'; subagentType: SubagentType; task: string; targetUrl?: string; parentSessionId: string; parentSessionType: 'terminal' | 'claude'; name?: string; responseId?: string }
  | { type: 'register_external_subagent_response'; subagentId: string; responseId?: string }
  | { type: 'external_subagent_entry'; subagentId: string; entry: unknown }
  | { type: 'external_subagent_done'; subagentId: string; status?: string }
  | { type: 'start_subagent_response'; responseId?: string; subagentId: string; status: string; summary: string };
