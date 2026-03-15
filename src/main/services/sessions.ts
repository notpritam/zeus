import type { SessionRecord } from '../../shared/types';

const sessions = new Map<string, SessionRecord>();

export function registerSession(
  id: string,
  shell: string,
  cols: number,
  rows: number,
  cwd: string,
): SessionRecord {
  const record: SessionRecord = {
    id,
    shell,
    status: 'active',
    cols,
    rows,
    cwd,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
  };
  sessions.set(id, record);
  return record;
}

export function markExited(id: string, exitCode: number): SessionRecord | null {
  const record = sessions.get(id);
  if (!record) return null;
  record.status = 'exited';
  record.endedAt = Date.now();
  record.exitCode = exitCode;
  return record;
}

export function markKilled(id: string): SessionRecord | null {
  const record = sessions.get(id);
  if (!record) return null;
  record.status = 'killed';
  record.endedAt = Date.now();
  return record;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function getAllSessions(): SessionRecord[] {
  return Array.from(sessions.values());
}

export function getActiveSessions(): SessionRecord[] {
  return Array.from(sessions.values()).filter((s) => s.status === 'active');
}

export function clearCompleted(): void {
  for (const [id, record] of sessions) {
    if (record.status !== 'active') {
      sessions.delete(id);
    }
  }
}
