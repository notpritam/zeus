// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSession,
  markExited,
  markKilled,
  getSession,
  getAllSessions,
  getActiveSessions,
  clearCompleted,
} from '../services/sessions';

beforeEach(() => {
  // Clear all sessions by marking active ones as killed and clearing completed
  for (const s of getActiveSessions()) {
    markKilled(s.id);
  }
  clearCompleted();
});

describe('sessions registry', () => {
  it('registers a session with active status', () => {
    const record = registerSession('s1', '/bin/zsh', 80, 24, '/home');
    expect(record.id).toBe('s1');
    expect(record.shell).toBe('/bin/zsh');
    expect(record.status).toBe('active');
    expect(record.cols).toBe(80);
    expect(record.rows).toBe(24);
    expect(record.cwd).toBe('/home');
    expect(record.startedAt).toBeGreaterThan(0);
    expect(record.endedAt).toBeNull();
    expect(record.exitCode).toBeNull();
  });

  it('marks a session as exited', () => {
    registerSession('s2', '/bin/zsh', 80, 24, '/home');
    const result = markExited('s2', 0);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('exited');
    expect(result!.exitCode).toBe(0);
    expect(result!.endedAt).toBeGreaterThan(0);
  });

  it('marks a session as killed', () => {
    registerSession('s3', '/bin/zsh', 80, 24, '/home');
    const result = markKilled('s3');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('killed');
    expect(result!.endedAt).toBeGreaterThan(0);
    expect(result!.exitCode).toBeNull();
  });

  it('returns null when marking nonexistent session', () => {
    expect(markExited('nonexistent', 1)).toBeNull();
    expect(markKilled('nonexistent')).toBeNull();
  });

  it('getSession returns the session by id', () => {
    registerSession('s4', '/bin/bash', 120, 40, '/tmp');
    const s = getSession('s4');
    expect(s).toBeDefined();
    expect(s!.shell).toBe('/bin/bash');
  });

  it('getAllSessions returns all sessions', () => {
    registerSession('a1', '/bin/zsh', 80, 24, '/');
    registerSession('a2', '/bin/bash', 80, 24, '/');
    markExited('a2', 1);
    const all = getAllSessions();
    expect(all).toHaveLength(2);
  });

  it('getActiveSessions returns only active sessions', () => {
    registerSession('b1', '/bin/zsh', 80, 24, '/');
    registerSession('b2', '/bin/zsh', 80, 24, '/');
    markKilled('b2');
    const active = getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('b1');
  });

  it('clearCompleted removes non-active sessions', () => {
    registerSession('c1', '/bin/zsh', 80, 24, '/');
    registerSession('c2', '/bin/zsh', 80, 24, '/');
    registerSession('c3', '/bin/zsh', 80, 24, '/');
    markExited('c2', 0);
    markKilled('c3');
    clearCompleted();
    const all = getAllSessions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('c1');
  });
});
