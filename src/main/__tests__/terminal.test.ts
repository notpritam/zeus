// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createSession,
  writeToSession,
  resizeSession,
  destroySession,
  destroyAllSessions,
  getSessionCount,
  hasSession,
} from '../services/terminal';

afterEach(() => {
  destroyAllSessions();
});

describe('terminal service', () => {
  it('creates a session and returns sessionId and shell', () => {
    const onOutput = vi.fn();
    const onExit = vi.fn();

    const { sessionId, shell } = createSession({}, onOutput, onExit);

    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeof shell).toBe('string');
    expect(hasSession(sessionId)).toBe(true);
    expect(getSessionCount()).toBe(1);
  });

  it('writes data to a session without throwing', () => {
    const onOutput = vi.fn();
    const onExit = vi.fn();

    const { sessionId } = createSession({}, onOutput, onExit);
    expect(() => writeToSession(sessionId, 'echo hello\n')).not.toThrow();
  });

  it('throws when writing to a nonexistent session', () => {
    expect(() => writeToSession('nonexistent', 'data')).toThrow('Session not found');
  });

  it('resizes a session without throwing', () => {
    const onOutput = vi.fn();
    const onExit = vi.fn();

    const { sessionId } = createSession({}, onOutput, onExit);
    expect(() => resizeSession(sessionId, 120, 40)).not.toThrow();
  });

  it('throws when resizing a nonexistent session', () => {
    expect(() => resizeSession('nonexistent', 80, 24)).toThrow('Session not found');
  });

  it('destroys a session', () => {
    const onOutput = vi.fn();
    const onExit = vi.fn();

    const { sessionId } = createSession({}, onOutput, onExit);
    expect(hasSession(sessionId)).toBe(true);

    destroySession(sessionId);
    expect(hasSession(sessionId)).toBe(false);
    expect(getSessionCount()).toBe(0);
  });

  it('destroys all sessions', () => {
    const onOutput = vi.fn();
    const onExit = vi.fn();

    createSession({}, onOutput, onExit);
    createSession({}, onOutput, onExit);
    expect(getSessionCount()).toBe(2);

    destroyAllSessions();
    expect(getSessionCount()).toBe(0);
  });

  it('receives output from PTY', async () => {
    const outputReceived = new Promise<void>((resolve) => {
      const onOutput = () => resolve();
      const onExit = vi.fn();
      const { sessionId } = createSession({}, onOutput, onExit);
      // Send a command to guarantee output
      writeToSession(sessionId, 'echo pty-test\n');
    });

    await outputReceived;
  }, 5000);
});
