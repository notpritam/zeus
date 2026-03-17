import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import type { SessionRecord, SavedProject } from '../../shared/types';
import type { NormalizedEntry } from '../services/claude-types';
import { validateNormalizedEntry, safeParseNormalizedEntry } from '../../shared/validators';

let db: Database.Database | null = null;

// ─── Schema & Migrations ───

const SCHEMA_VERSION = 6;

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;

  if (currentVersion < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS claude_sessions (
        id                TEXT PRIMARY KEY,
        claude_session_id TEXT,
        status            TEXT NOT NULL DEFAULT 'running',
        prompt            TEXT NOT NULL,
        name              TEXT,
        notification_sound INTEGER DEFAULT 1,
        working_dir       TEXT,
        permission_mode   TEXT,
        model             TEXT,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_cs_started ON claude_sessions(started_at);

      CREATE TABLE IF NOT EXISTS claude_entries (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        entry_type  TEXT NOT NULL,
        content     TEXT NOT NULL DEFAULT '',
        metadata    TEXT,
        timestamp   TEXT,
        seq         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ce_session ON claude_entries(session_id, seq);

      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id          TEXT PRIMARY KEY,
        shell       TEXT NOT NULL,
        status      TEXT NOT NULL,
        cols        INTEGER NOT NULL,
        rows        INTEGER NOT NULL,
        cwd         TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        exit_code   INTEGER
      );
    `);
  }

  if (currentVersion < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS saved_projects (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        path      TEXT NOT NULL UNIQUE,
        added_at  INTEGER NOT NULL
      );
    `);
  }

  if (currentVersion < 3) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS qa_agent_sessions (
        id                  TEXT PRIMARY KEY,
        parent_session_id   TEXT NOT NULL,
        parent_session_type TEXT NOT NULL,
        task                TEXT NOT NULL,
        target_url          TEXT,
        status              TEXT NOT NULL DEFAULT 'running',
        started_at          INTEGER NOT NULL,
        ended_at            INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_qa_parent ON qa_agent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_qa_started ON qa_agent_sessions(started_at);

      CREATE TABLE IF NOT EXISTS qa_agent_entries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        qa_agent_id   TEXT NOT NULL,
        kind          TEXT NOT NULL,
        data          TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        seq           INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_qae_agent ON qa_agent_entries(qa_agent_id, seq);
    `);
  }

  if (currentVersion < 4) {
    database.exec(`ALTER TABLE qa_agent_sessions ADD COLUMN name TEXT`);
  }

  if (currentVersion < 5) {
    database.exec(`ALTER TABLE claude_sessions ADD COLUMN color TEXT`);
  }

  if (currentVersion < 6) {
    database.exec(`ALTER TABLE claude_sessions ADD COLUMN icon TEXT`);
  }

  database.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// ─── Lifecycle ───

export function initDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'zeus.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  console.log(`[Zeus DB] Opened ${dbPath}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Zeus DB] Closed');
  }
}

// ─── Crash Recovery ───

export function markStaleSessionsErrored(): void {
  if (!db) return;
  const result = db
    .prepare(`UPDATE claude_sessions SET status = 'error', ended_at = ? WHERE status = 'running'`)
    .run(Date.now());
  if (result.changes > 0) {
    console.log(`[Zeus DB] Marked ${result.changes} stale Claude session(s) as error`);
  }
}

// ─── Cleanup ───

export function pruneOldSessions(maxAgeDays = 30): void {
  if (!db) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  db.prepare(
    `DELETE FROM claude_entries WHERE session_id IN (SELECT id FROM claude_sessions WHERE started_at < ?)`,
  ).run(cutoff);
  db.prepare(`DELETE FROM claude_sessions WHERE started_at < ?`).run(cutoff);
  db.prepare(`DELETE FROM terminal_sessions WHERE started_at < ?`).run(cutoff);
  db.prepare(
    `DELETE FROM qa_agent_entries WHERE qa_agent_id IN (SELECT id FROM qa_agent_sessions WHERE started_at < ?)`,
  ).run(cutoff);
  db.prepare(`DELETE FROM qa_agent_sessions WHERE started_at < ?`).run(cutoff);
}

// ─── Claude Sessions CRUD ───

export interface ClaudeSessionRow {
  id: string;
  claudeSessionId: string | null;
  status: string;
  prompt: string;
  name: string | null;
  icon: string | null;
  color: string | null;
  notificationSound: boolean;
  workingDir: string | null;
  permissionMode: string | null;
  model: string | null;
  startedAt: number;
  endedAt: number | null;
}

export function insertClaudeSession(info: ClaudeSessionRow): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO claude_sessions (id, claude_session_id, status, prompt, name, icon, color, notification_sound, working_dir, permission_mode, model, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    info.id,
    info.claudeSessionId,
    info.status,
    info.prompt,
    info.name,
    info.icon,
    info.color,
    info.notificationSound ? 1 : 0,
    info.workingDir,
    info.permissionMode,
    info.model,
    info.startedAt,
    info.endedAt,
  );
}

export function updateClaudeSessionId(id: string, claudeSessionId: string): void {
  if (!db) return;
  db.prepare(`UPDATE claude_sessions SET claude_session_id = ? WHERE id = ?`).run(
    claudeSessionId,
    id,
  );
}

export function updateClaudeSessionStatus(
  id: string,
  status: string,
  endedAt?: number,
): void {
  if (!db) return;
  if (endedAt != null) {
    db.prepare(`UPDATE claude_sessions SET status = ?, ended_at = ? WHERE id = ?`).run(
      status,
      endedAt,
      id,
    );
  } else {
    db.prepare(`UPDATE claude_sessions SET status = ? WHERE id = ?`).run(status, id);
  }
}

interface ClaudeSessionDbRow {
  id: string;
  claude_session_id: string | null;
  status: string;
  prompt: string;
  name: string | null;
  icon: string | null;
  color: string | null;
  notification_sound: number;
  working_dir: string | null;
  permission_mode: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
}

export function getAllClaudeSessions(): ClaudeSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM claude_sessions ORDER BY started_at DESC`)
    .all() as ClaudeSessionDbRow[];
  return rows.map((r) => ({
    id: r.id,
    claudeSessionId: r.claude_session_id,
    status: r.status,
    prompt: r.prompt,
    name: r.name,
    icon: r.icon,
    color: r.color,
    notificationSound: r.notification_sound === 1,
    workingDir: r.working_dir,
    permissionMode: r.permission_mode,
    model: r.model,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }));
}

export function updateClaudeSessionMeta(
  id: string,
  updates: { name?: string; color?: string | null },
): void {
  if (!db) return;
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    sets.push('color = ?');
    values.push(updates.color);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE claude_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteClaudeSession(id: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM claude_entries WHERE session_id = ?`).run(id);
  db.prepare(`DELETE FROM claude_sessions WHERE id = ?`).run(id);
}

export function archiveClaudeSession(id: string): void {
  if (!db) return;
  db.prepare(`UPDATE claude_sessions SET status = 'archived' WHERE id = ?`).run(id);
}

// ─── Claude Entries CRUD ───

export function upsertClaudeEntry(sessionId: string, entry: NormalizedEntry): void {
  if (!db) return;

  // Runtime validation before persisting
  const validation = validateNormalizedEntry(entry);
  if (!validation.valid) {
    console.warn(
      `[Zeus DB] Skipping invalid entry for session ${sessionId.slice(-6)}:`,
      validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    );
    return;
  }

  // Get next seq for this session if inserting new
  const maxSeq = db
    .prepare(`SELECT MAX(seq) as max_seq FROM claude_entries WHERE session_id = ?`)
    .get(sessionId) as { max_seq: number | null } | undefined;
  const nextSeq = (maxSeq?.max_seq ?? -1) + 1;

  // Check if entry already exists (streaming update)
  const existing = db
    .prepare(`SELECT seq FROM claude_entries WHERE id = ?`)
    .get(entry.id) as { seq: number } | undefined;

  const seq = existing?.seq ?? nextSeq;

  db.prepare(
    `INSERT OR REPLACE INTO claude_entries (id, session_id, entry_type, content, metadata, timestamp, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    sessionId,
    JSON.stringify(entry.entryType),
    entry.content,
    entry.metadata != null ? JSON.stringify(entry.metadata) : null,
    entry.timestamp ?? null,
    seq,
  );
}

interface ClaudeEntryDbRow {
  id: string;
  session_id: string;
  entry_type: string;
  content: string;
  metadata: string | null;
  timestamp: string | null;
  seq: number;
}

export function getClaudeEntries(sessionId: string): NormalizedEntry[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM claude_entries WHERE session_id = ? ORDER BY seq ASC`)
    .all(sessionId) as ClaudeEntryDbRow[];

  const entries: NormalizedEntry[] = [];
  for (const r of rows) {
    const raw = {
      id: r.id,
      entryType: JSON.parse(r.entry_type),
      content: r.content,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      timestamp: r.timestamp ?? undefined,
    };
    const parsed = safeParseNormalizedEntry(raw, `db-read:${sessionId.slice(-6)}:${r.id.slice(-6)}`);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

/**
 * Finalize all tool_use entries stuck at "created" → "success" for a completed session.
 * This is a safety net for cases where tool_result messages weren't persisted during streaming.
 */
export function finalizeCreatedToolEntries(sessionId: string): void {
  if (!db) return;
  const rows = db
    .prepare(
      `SELECT id, entry_type FROM claude_entries WHERE session_id = ? AND entry_type LIKE '%"status":"created"%'`,
    )
    .all(sessionId) as Array<{ id: string; entry_type: string }>;

  if (rows.length === 0) return;

  const stmt = db.prepare(`UPDATE claude_entries SET entry_type = ? WHERE id = ?`);
  const update = db.transaction(() => {
    for (const row of rows) {
      const entryType = JSON.parse(row.entry_type);
      if (entryType.type === 'tool_use' && entryType.status === 'created') {
        entryType.status = 'success';
        stmt.run(JSON.stringify(entryType), row.id);
      }
    }
  });
  update();
  console.log(`[Zeus DB] Finalized ${rows.length} stale tool entries for session ${sessionId.slice(-6)}`);
}

// ─── Terminal Sessions CRUD ───

export function insertTerminalSession(record: SessionRecord): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO terminal_sessions (id, shell, status, cols, rows, cwd, started_at, ended_at, exit_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.shell,
    record.status,
    record.cols,
    record.rows,
    record.cwd,
    record.startedAt,
    record.endedAt,
    record.exitCode,
  );
}

export function updateTerminalSession(
  id: string,
  updates: Partial<Pick<SessionRecord, 'status' | 'endedAt' | 'exitCode'>>,
): void {
  if (!db) return;
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.status != null) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.endedAt != null) {
    sets.push('ended_at = ?');
    values.push(updates.endedAt);
  }
  if (updates.exitCode != null) {
    sets.push('exit_code = ?');
    values.push(updates.exitCode);
  }

  if (sets.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE terminal_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

interface TerminalSessionDbRow {
  id: string;
  shell: string;
  status: string;
  cols: number;
  rows: number;
  cwd: string;
  started_at: number;
  ended_at: number | null;
  exit_code: number | null;
}

export function getAllTerminalSessions(): SessionRecord[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM terminal_sessions ORDER BY started_at DESC`)
    .all() as TerminalSessionDbRow[];
  return rows.map((r) => ({
    id: r.id,
    shell: r.shell,
    status: r.status as SessionRecord['status'],
    cols: r.cols,
    rows: r.rows,
    cwd: r.cwd,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    exitCode: r.exit_code,
  }));
}

export function deleteTerminalSession(id: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM terminal_sessions WHERE id = ?`).run(id);
}

export function archiveTerminalSession(id: string): void {
  if (!db) return;
  db.prepare(`UPDATE terminal_sessions SET status = 'archived' WHERE id = ?`).run(id);
}

// ─── Saved Projects CRUD ───

interface SavedProjectDbRow {
  id: string;
  name: string;
  path: string;
  added_at: number;
}

export function insertProject(project: SavedProject): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO saved_projects (id, name, path, added_at) VALUES (?, ?, ?, ?)`,
  ).run(project.id, project.name, project.path, project.addedAt);
}

export function getAllProjects(): SavedProject[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM saved_projects ORDER BY added_at DESC`)
    .all() as SavedProjectDbRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    addedAt: r.added_at,
  }));
}

export function deleteProject(id: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM saved_projects WHERE id = ?`).run(id);
}

// ─── QA Agent Sessions CRUD ───

export interface QaAgentSessionRow {
  id: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name: string | null;
  task: string;
  targetUrl: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
}

interface QaAgentSessionDbRow {
  id: string;
  parent_session_id: string;
  parent_session_type: string;
  name: string | null;
  task: string;
  target_url: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
}

export function insertQaAgentSession(info: QaAgentSessionRow): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO qa_agent_sessions (id, parent_session_id, parent_session_type, name, task, target_url, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    info.id,
    info.parentSessionId,
    info.parentSessionType,
    info.name,
    info.task,
    info.targetUrl,
    info.status,
    info.startedAt,
    info.endedAt,
  );
}

export function updateQaAgentSessionStatus(
  id: string,
  status: string,
  endedAt?: number,
): void {
  if (!db) return;
  if (endedAt != null) {
    db.prepare(`UPDATE qa_agent_sessions SET status = ?, ended_at = ? WHERE id = ?`).run(
      status,
      endedAt,
      id,
    );
  } else {
    db.prepare(`UPDATE qa_agent_sessions SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function getQaAgentSessionsByParent(parentSessionId: string): QaAgentSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM qa_agent_sessions WHERE parent_session_id = ? ORDER BY started_at DESC`)
    .all(parentSessionId) as QaAgentSessionDbRow[];
  return rows.map((r) => ({
    id: r.id,
    parentSessionId: r.parent_session_id,
    parentSessionType: r.parent_session_type as 'terminal' | 'claude',
    name: r.name,
    task: r.task,
    targetUrl: r.target_url,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }));
}

export function getAllQaAgentSessions(): QaAgentSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM qa_agent_sessions ORDER BY started_at DESC`)
    .all() as QaAgentSessionDbRow[];
  return rows.map((r) => ({
    id: r.id,
    parentSessionId: r.parent_session_id,
    parentSessionType: r.parent_session_type as 'terminal' | 'claude',
    name: r.name,
    task: r.task,
    targetUrl: r.target_url,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }));
}

export function deleteQaAgentSession(id: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM qa_agent_entries WHERE qa_agent_id = ?`).run(id);
  db.prepare(`DELETE FROM qa_agent_sessions WHERE id = ?`).run(id);
}

export function deleteQaAgentsByParent(parentSessionId: string): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM qa_agent_entries WHERE qa_agent_id IN (SELECT id FROM qa_agent_sessions WHERE parent_session_id = ?)`,
  ).run(parentSessionId);
  db.prepare(`DELETE FROM qa_agent_sessions WHERE parent_session_id = ?`).run(parentSessionId);
}

export function countQaAgentsByParent(parentSessionId: string): number {
  if (!db) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM qa_agent_sessions WHERE parent_session_id = ?`)
    .get(parentSessionId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

// ─── QA Agent Entries CRUD ───

export interface QaAgentEntryRow {
  id?: number;
  qaAgentId: string;
  kind: string;
  data: string; // JSON stringified entry
  timestamp: number;
  seq: number;
}

interface QaAgentEntryDbRow {
  id: number;
  qa_agent_id: string;
  kind: string;
  data: string;
  timestamp: number;
  seq: number;
}

export function insertQaAgentEntry(qaAgentId: string, kind: string, data: string, timestamp: number): void {
  if (!db) return;
  const maxSeq = db
    .prepare(`SELECT MAX(seq) as max_seq FROM qa_agent_entries WHERE qa_agent_id = ?`)
    .get(qaAgentId) as { max_seq: number | null } | undefined;
  const nextSeq = (maxSeq?.max_seq ?? -1) + 1;

  db.prepare(
    `INSERT INTO qa_agent_entries (qa_agent_id, kind, data, timestamp, seq) VALUES (?, ?, ?, ?, ?)`,
  ).run(qaAgentId, kind, data, timestamp, nextSeq);
}

export function getQaAgentEntries(qaAgentId: string): QaAgentEntryRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM qa_agent_entries WHERE qa_agent_id = ? ORDER BY seq ASC`)
    .all(qaAgentId) as QaAgentEntryDbRow[];
  return rows.map((r) => ({
    id: r.id,
    qaAgentId: r.qa_agent_id,
    kind: r.kind,
    data: r.data,
    timestamp: r.timestamp,
    seq: r.seq,
  }));
}

/**
 * On startup, finalize tool entries for all completed sessions that still have "created" status.
 * This fixes sessions where tool_result messages weren't persisted during streaming.
 */
export function finalizeAllCompletedSessions(): void {
  if (!db) return;
  // Get all non-running sessions
  const sessions = db
    .prepare(`SELECT id FROM claude_sessions WHERE status != 'running'`)
    .all() as Array<{ id: string }>;

  let total = 0;
  for (const s of sessions) {
    const rows = db!
      .prepare(
        `SELECT id, entry_type FROM claude_entries WHERE session_id = ? AND entry_type LIKE '%"status":"created"%'`,
      )
      .all(s.id) as Array<{ id: string; entry_type: string }>;

    if (rows.length === 0) continue;

    const stmt = db!.prepare(`UPDATE claude_entries SET entry_type = ? WHERE id = ?`);
    for (const row of rows) {
      const entryType = JSON.parse(row.entry_type);
      if (entryType.type === 'tool_use' && entryType.status === 'created') {
        entryType.status = 'success';
        stmt.run(JSON.stringify(entryType), row.id);
        total++;
      }
    }
  }

  if (total > 0) {
    console.log(`[Zeus DB] Finalized ${total} stale tool entries across ${sessions.length} completed sessions`);
  }
}

export function markStaleQaAgentsErrored(): void {
  if (!db) return;
  const result = db
    .prepare(`UPDATE qa_agent_sessions SET status = 'error', ended_at = ? WHERE status = 'running'`)
    .run(Date.now());
  if (result.changes > 0) {
    console.log(`[Zeus DB] Marked ${result.changes} stale QA agent session(s) as error`);
  }
}
