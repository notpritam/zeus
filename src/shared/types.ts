// Shared types — used by both main process and renderer

// ─── Session ───

export type SessionStatus = 'active' | 'exited' | 'killed';

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
  channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude';
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
  type: 'status_update' | 'get_status' | 'toggle_power';
  powerBlock?: boolean;
  websocket?: boolean;
  tunnel?: string | null;
}

// ─── Claude Payloads ───

export interface ClaudeStartPayload {
  type: 'start_claude';
  prompt: string;
  workingDir?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  model?: string;
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

export type ClaudePayload =
  | ClaudeStartPayload
  | ClaudeResumePayload
  | ClaudeSendMessagePayload
  | ClaudeApproveToolPayload
  | ClaudeDenyToolPayload
  | ClaudeInterruptPayload
  | ClaudeStopPayload;
