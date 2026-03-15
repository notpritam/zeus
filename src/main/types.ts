// WebSocket envelope per CLAUDE.md spec
export interface WsEnvelope {
  channel: 'terminal' | 'git' | 'control' | 'qa';
  sessionId: string;
  payload: unknown;
  auth: string;
}

// Terminal payloads
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

// Control payloads
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

export interface ErrorPayload {
  type: 'error';
  message: string;
}

export type ControlPayload =
  | StartSessionPayload
  | StopSessionPayload
  | SessionStartedPayload
  | ErrorPayload;
