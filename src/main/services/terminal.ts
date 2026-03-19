import * as pty from 'node-pty';
import crypto from 'crypto';

interface SessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}

const sessions = new Map<string, pty.IPty>();

export function createSession(
  options: SessionOptions,
  onOutput: (sessionId: string, data: string) => void,
  onExit: (sessionId: string, code: number) => void,
): { sessionId: string; shell: string } {
  const sessionId = crypto.randomUUID();
  const shell = process.env.SHELL || '/bin/zsh';
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: options.cwd ?? process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  });

  term.onData((data) => onOutput(sessionId, data));
  term.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    onExit(sessionId, exitCode);
  });

  sessions.set(sessionId, term);
  console.log(`[Zeus] Terminal session started: ${sessionId} (shell: ${shell})`);

  return { sessionId, shell };
}

export function writeToSession(sessionId: string, data: string): void {
  const term = sessions.get(sessionId);
  if (!term) throw new Error(`Session not found: ${sessionId}`);
  term.write(data);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const term = sessions.get(sessionId);
  if (!term) throw new Error(`Session not found: ${sessionId}`);
  // node-pty throws on zero/negative dimensions — clamp to safe minimums
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  term.resize(safeCols, safeRows);
}

export function destroySession(sessionId: string): void {
  const term = sessions.get(sessionId);
  if (term) {
    term.kill();
    sessions.delete(sessionId);
    console.log(`[Zeus] Terminal session destroyed: ${sessionId}`);
  }
}

export function destroyAllSessions(): void {
  for (const [id, term] of sessions) {
    term.kill();
    console.log(`[Zeus] Terminal session destroyed: ${id}`);
  }
  sessions.clear();
}

export function getSessionCount(): number {
  return sessions.size;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function getSessionPids(): Array<{ sessionId: string; pid: number }> {
  const result: Array<{ sessionId: string; pid: number }> = [];
  for (const [id, term] of sessions) {
    if (term.pid) result.push({ sessionId: id, pid: term.pid });
  }
  return result;
}
