import crypto from 'crypto';
import Database from 'better-sqlite3';
import type { SessionRecord, SavedProject, TaskRecord, TaskStatus } from '../../shared/types';
import type { NormalizedEntry } from '../services/claude-types';
import type { PermissionRule } from '../../shared/permission-types';
import { validateNormalizedEntry, safeParseNormalizedEntry } from '../../shared/validators';
import { zeusEnv } from './env';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('[Zeus DB] Database not initialized');
  return db;
}

// ─── Schema & Migrations ───

const SCHEMA_VERSION = 14;

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

  if (currentVersion < 7) {
    database.exec(`ALTER TABLE qa_agent_sessions ADD COLUMN claude_session_id TEXT`);
    database.exec(`ALTER TABLE qa_agent_sessions ADD COLUMN last_message_id TEXT`);
    database.exec(`ALTER TABLE qa_agent_sessions ADD COLUMN working_dir TEXT`);
  }

  if (currentVersion < 8) {
    database.exec(`ALTER TABLE claude_sessions ADD COLUMN qa_target_url TEXT`);
  }

  if (currentVersion < 9) {
    database.exec(`ALTER TABLE claude_sessions ADD COLUMN deleted_at INTEGER`);
    database.exec(`ALTER TABLE terminal_sessions ADD COLUMN deleted_at INTEGER`);
  }

  if (currentVersion < 10) {
    // Rename qa_agent_sessions → subagent_sessions
    database.exec(`
      CREATE TABLE IF NOT EXISTS subagent_sessions (
        id                  TEXT PRIMARY KEY,
        parent_session_id   TEXT NOT NULL,
        parent_session_type TEXT NOT NULL DEFAULT 'claude',
        name                TEXT,
        task                TEXT NOT NULL,
        target_url          TEXT,
        status              TEXT NOT NULL DEFAULT 'running',
        started_at          INTEGER NOT NULL,
        ended_at            INTEGER,
        claude_session_id   TEXT,
        last_message_id     TEXT,
        working_dir         TEXT,
        subagent_type       TEXT NOT NULL DEFAULT 'qa',
        cli                 TEXT NOT NULL DEFAULT 'claude'
      );
      CREATE TABLE IF NOT EXISTS subagent_entries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        subagent_id   TEXT NOT NULL,
        kind          TEXT NOT NULL,
        data          TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        seq           INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Copy data if old tables exist
    const hasOldTable = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='qa_agent_sessions'"
    ).get();
    if (hasOldTable) {
      database.exec(`
        INSERT OR IGNORE INTO subagent_sessions
          (id, parent_session_id, parent_session_type, name, task, target_url,
           status, started_at, ended_at, claude_session_id, last_message_id,
           working_dir, subagent_type, cli)
        SELECT
          id, parent_session_id, parent_session_type, name, task, target_url,
          status, started_at, ended_at, claude_session_id, last_message_id,
          working_dir, 'qa', 'claude'
        FROM qa_agent_sessions;

        INSERT OR IGNORE INTO subagent_entries (id, subagent_id, kind, data, timestamp, seq)
        SELECT id, qa_agent_id, kind, data, timestamp, seq
        FROM qa_agent_entries;

        DROP TABLE IF EXISTS qa_agent_entries;
        DROP TABLE IF EXISTS qa_agent_sessions;
      `);
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_parent ON subagent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_subagent_started ON subagent_sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_subagent_type ON subagent_sessions(subagent_type);
      CREATE INDEX IF NOT EXISTS idx_subagent_entries_agent ON subagent_entries(subagent_id, seq);
    `);
  }

  if (currentVersion < 11) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id         TEXT PRIMARY KEY,
        name       TEXT UNIQUE NOT NULL,
        command    TEXT NOT NULL,
        args       TEXT DEFAULT '[]',
        env        TEXT DEFAULT '{}',
        source     TEXT DEFAULT 'zeus',
        enabled    INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_profiles (
        id          TEXT PRIMARY KEY,
        name        TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        is_default  INTEGER DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_profile_servers (
        profile_id TEXT NOT NULL REFERENCES mcp_profiles(id) ON DELETE CASCADE,
        server_id  TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        PRIMARY KEY (profile_id, server_id)
      );

      CREATE TABLE IF NOT EXISTS session_mcps (
        session_id  TEXT NOT NULL,
        server_id   TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        status      TEXT DEFAULT 'attached',
        attached_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, server_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_mcps_session ON session_mcps(session_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_profile_servers_profile ON mcp_profile_servers(profile_id);
    `);
  }

  if (currentVersion < 12) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        branch        TEXT NOT NULL,
        base_branch   TEXT NOT NULL,
        worktree_dir  TEXT NOT NULL,
        project_path  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'creating',
        session_id    TEXT,
        pr_url        TEXT,
        diff_summary  TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        completed_at  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
    `);
  }

  if (currentVersion < 13) {
    const migrate13 = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS permission_rules (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL,
          name        TEXT NOT NULL DEFAULT 'Custom',
          rules       TEXT NOT NULL DEFAULT '[]',
          is_template INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pr_project ON permission_rules(project_id);

        CREATE TABLE IF NOT EXISTS permission_audit_log (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          project_id  TEXT,
          tool_name   TEXT NOT NULL,
          pattern     TEXT NOT NULL,
          action      TEXT NOT NULL,
          rule_matched TEXT,
          timestamp   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pal_session ON permission_audit_log(session_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_pal_project ON permission_audit_log(project_id, timestamp);
      `);
    });
    migrate13();
  }

  if (currentVersion < 14) {
    const migrate14 = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          room_id      TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          task         TEXT NOT NULL,
          pm_agent_id  TEXT,
          status       TEXT NOT NULL DEFAULT 'active',
          token_budget INTEGER,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS room_agents (
          agent_id          TEXT PRIMARY KEY,
          room_id           TEXT NOT NULL,
          role              TEXT NOT NULL,
          claude_session_id TEXT,
          model             TEXT,
          status            TEXT NOT NULL DEFAULT 'spawning',
          room_aware        INTEGER NOT NULL DEFAULT 1,
          prompt            TEXT NOT NULL,
          result            TEXT,
          tokens_used       INTEGER NOT NULL DEFAULT 0,
          spawned_by        TEXT,
          working_dir       TEXT,
          last_activity_at  TEXT,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS room_messages (
          message_id    TEXT PRIMARY KEY,
          room_id       TEXT NOT NULL,
          from_agent_id TEXT,
          to_agent_id   TEXT,
          type          TEXT NOT NULL,
          content       TEXT NOT NULL,
          mentions      TEXT NOT NULL DEFAULT '[]',
          metadata      TEXT,
          seq           INTEGER NOT NULL,
          timestamp     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS room_read_cursors (
          agent_id    TEXT NOT NULL,
          room_id     TEXT NOT NULL,
          last_seq    INTEGER NOT NULL DEFAULT 0,
          updated_at  TEXT NOT NULL,
          PRIMARY KEY (agent_id, room_id)
        );

        CREATE INDEX IF NOT EXISTS idx_room_agents_room ON room_agents(room_id);
        CREATE INDEX IF NOT EXISTS idx_room_agents_session ON room_agents(claude_session_id);
        CREATE INDEX IF NOT EXISTS idx_room_messages_room_seq ON room_messages(room_id, seq);
        CREATE INDEX IF NOT EXISTS idx_room_messages_to ON room_messages(to_agent_id);
      `);
    });
    migrate14();
  }

  database.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// ─── Lifecycle ───

export function initDatabase(): void {
  const dbPath = zeusEnv.dbPath();
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

  // Permanently purge soft-deleted sessions older than 30 days
  db.prepare(
    `DELETE FROM claude_entries WHERE session_id IN (SELECT id FROM claude_sessions WHERE status = 'deleted' AND deleted_at < ?)`,
  ).run(cutoff);
  db.prepare(`DELETE FROM claude_sessions WHERE status = 'deleted' AND deleted_at < ?`).run(cutoff);
  db.prepare(`DELETE FROM terminal_sessions WHERE status = 'deleted' AND deleted_at < ?`).run(
    cutoff,
  );

  // Also prune very old non-deleted sessions
  db.prepare(
    `DELETE FROM claude_entries WHERE session_id IN (SELECT id FROM claude_sessions WHERE started_at < ?)`,
  ).run(cutoff);
  db.prepare(`DELETE FROM claude_sessions WHERE started_at < ?`).run(cutoff);
  db.prepare(`DELETE FROM terminal_sessions WHERE started_at < ?`).run(cutoff);
  db.prepare(
    `DELETE FROM subagent_entries WHERE subagent_id IN (SELECT id FROM subagent_sessions WHERE started_at < ?)`,
  ).run(cutoff);
  db.prepare(`DELETE FROM subagent_sessions WHERE started_at < ?`).run(cutoff);

  pruneOldTasks(maxAgeDays);
  pruneOldAuditLogs(maxAgeDays);
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
  qaTargetUrl: string | null;
  permissionMode: string | null;
  model: string | null;
  startedAt: number;
  endedAt: number | null;
  deletedAt: number | null;
}

export function insertClaudeSession(info: ClaudeSessionRow): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO claude_sessions (id, claude_session_id, status, prompt, name, icon, color, notification_sound, working_dir, qa_target_url, permission_mode, model, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    info.qaTargetUrl,
    info.permissionMode,
    info.model,
    info.startedAt,
    info.endedAt,
  );
}

export function updateClaudeSessionQaTargetUrl(id: string, qaTargetUrl: string): void {
  if (!db) return;
  db.prepare(`UPDATE claude_sessions SET qa_target_url = ? WHERE id = ?`).run(qaTargetUrl, id);
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
  qa_target_url: string | null;
  permission_mode: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  deleted_at: number | null;
}

export function getAllClaudeSessions(): ClaudeSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM claude_sessions WHERE status != 'deleted' ORDER BY started_at DESC`)
    .all() as ClaudeSessionDbRow[];
  return rows.map(mapClaudeRow);
}

export function getDeletedClaudeSessions(): ClaudeSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM claude_sessions WHERE status = 'deleted' ORDER BY deleted_at DESC`)
    .all() as ClaudeSessionDbRow[];
  return rows.map(mapClaudeRow);
}

function mapClaudeRow(r: ClaudeSessionDbRow): ClaudeSessionRow {
  return {
    id: r.id,
    claudeSessionId: r.claude_session_id,
    status: r.status,
    prompt: r.prompt,
    name: r.name,
    icon: r.icon,
    color: r.color,
    notificationSound: r.notification_sound === 1,
    workingDir: r.working_dir,
    qaTargetUrl: r.qa_target_url,
    permissionMode: r.permission_mode,
    model: r.model,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    deletedAt: r.deleted_at,
  };
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
  // Soft-delete: mark as deleted with timestamp for recovery
  db.prepare(`UPDATE claude_sessions SET status = 'deleted', deleted_at = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
}

export function restoreClaudeSession(id: string): void {
  if (!db) return;
  db.prepare(
    `UPDATE claude_sessions SET status = 'completed', deleted_at = NULL WHERE id = ? AND status = 'deleted'`,
  ).run(id);
}

export function permanentlyDeleteClaudeSession(id: string): void {
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
 * Paginated variant — returns the last `limit` entries before `beforeSeq`.
 * Used for incremental "scroll-up" loading.
 * If `beforeSeq` is undefined, returns the most recent `limit` entries.
 * Returns entries in ascending seq order (oldest first) along with totalCount.
 */
export function getClaudeEntriesPaginated(
  sessionId: string,
  limit: number,
  beforeSeq?: number,
): { entries: NormalizedEntry[]; totalCount: number; oldestSeq: number | null } {
  if (!db) return { entries: [], totalCount: 0, oldestSeq: null };

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM claude_entries WHERE session_id = ?`)
    .get(sessionId) as { cnt: number };
  const totalCount = countRow.cnt;

  let rows: ClaudeEntryDbRow[];
  if (beforeSeq !== undefined) {
    // Load `limit` entries with seq < beforeSeq, ordered newest-first, then reverse
    rows = db
      .prepare(
        `SELECT * FROM claude_entries WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(sessionId, beforeSeq, limit) as ClaudeEntryDbRow[];
    rows.reverse(); // back to ascending order
  } else {
    // Load the most recent `limit` entries
    rows = db
      .prepare(
        `SELECT * FROM claude_entries WHERE session_id = ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(sessionId, limit) as ClaudeEntryDbRow[];
    rows.reverse();
  }

  const entries: NormalizedEntry[] = [];
  let oldestSeq: number | null = null;
  for (const r of rows) {
    if (oldestSeq === null || r.seq < oldestSeq) oldestSeq = r.seq;
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
  return { entries, totalCount, oldestSeq };
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

/**
 * Copy all entries from previous sessions sharing the same Claude session ID
 * into a newly-resumed session. This preserves full conversation history in the
 * DB so that `getClaudeEntries(newSessionId)` returns the complete timeline.
 *
 * Each copied entry gets a new ID (prefixed with `h-`) since `id` is the global
 * PRIMARY KEY — the originals in older sessions remain untouched.
 */
export function copyClaudeEntriesForResume(claudeSessionId: string, toSessionId: string): number {
  if (!db) return 0;

  // Find all previous Zeus session IDs that share this Claude session ID
  // (excluding the new one we just created), ordered by started_at
  const prevSessions = db
    .prepare(
      `SELECT id FROM claude_sessions
       WHERE claude_session_id = ? AND id != ?
       ORDER BY started_at ASC`,
    )
    .all(claudeSessionId, toSessionId) as Array<{ id: string }>;

  if (prevSessions.length === 0) return 0;

  const prevIds = prevSessions.map((s) => s.id);

  // Collect all entries across previous sessions, ordered chronologically
  const placeholders = prevIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, entry_type, content, metadata, timestamp
       FROM claude_entries
       WHERE session_id IN (${placeholders})
       ORDER BY seq ASC`,
    )
    .all(...prevIds) as Array<{
    id: string;
    entry_type: string;
    content: string;
    metadata: string | null;
    timestamp: string | null;
  }>;

  // Deduplicate by original ID: keep last occurrence (latest streaming update)
  const entryMap = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    entryMap.set(row.id, row);
  }

  const uniqueEntries = Array.from(entryMap.values());
  if (uniqueEntries.length === 0) return 0;

  // Insert copies with new IDs (prefix `h-` for "history") so we don't
  // collide with the originals that still live under previous session_ids.
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO claude_entries (id, session_id, entry_type, content, metadata, timestamp, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const copyAll = db.transaction(() => {
    let seq = 0;
    for (const entry of uniqueEntries) {
      insertStmt.run(
        `h-${toSessionId.slice(-8)}-${seq}`,
        toSessionId,
        entry.entry_type,
        entry.content,
        entry.metadata,
        entry.timestamp,
        seq,
      );
      seq++;
    }
    return seq;
  });

  const count = copyAll();
  console.log(
    `[Zeus DB] Copied ${count} history entries into resumed session ${toSessionId.slice(-6)} from ${prevIds.length} prior session(s)`,
  );
  return count;
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
  deleted_at: number | null;
}

export function getAllTerminalSessions(): SessionRecord[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM terminal_sessions WHERE status != 'deleted' ORDER BY started_at DESC`)
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
  // Soft-delete: mark as deleted with timestamp for recovery
  db.prepare(`UPDATE terminal_sessions SET status = 'deleted', deleted_at = ? WHERE id = ?`).run(
    Date.now(),
    id,
  );
}

export function restoreTerminalSession(id: string): void {
  if (!db) return;
  db.prepare(
    `UPDATE terminal_sessions SET status = 'killed', deleted_at = NULL WHERE id = ? AND status = 'deleted'`,
  ).run(id);
}

export function permanentlyDeleteTerminalSession(id: string): void {
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

// ─── Subagent Sessions CRUD ───

export interface SubagentSessionRow {
  id: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name: string | null;
  task: string;
  targetUrl: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  claudeSessionId?: string | null;
  lastMessageId?: string | null;
  workingDir?: string | null;
  subagentType: string;
  cli: string;
}

interface SubagentSessionDbRow {
  id: string;
  parent_session_id: string;
  parent_session_type: string;
  name: string | null;
  task: string;
  target_url: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  claude_session_id: string | null;
  last_message_id: string | null;
  working_dir: string | null;
  subagent_type: string;
  cli: string;
}

export function insertSubagentSession(info: SubagentSessionRow): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO subagent_sessions (id, parent_session_id, parent_session_type, name, task, target_url, status, started_at, ended_at, claude_session_id, last_message_id, working_dir, subagent_type, cli)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    info.claudeSessionId ?? null,
    info.lastMessageId ?? null,
    info.workingDir ?? null,
    info.subagentType,
    info.cli,
  );
}

export function updateSubagentSessionStatus(
  id: string,
  status: string,
  endedAt?: number,
): void {
  if (!db) return;
  if (endedAt != null) {
    db.prepare(`UPDATE subagent_sessions SET status = ?, ended_at = ? WHERE id = ?`).run(
      status,
      endedAt,
      id,
    );
  } else {
    db.prepare(`UPDATE subagent_sessions SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function updateSubagentResumeData(
  id: string,
  claudeSessionId: string | null,
  lastMessageId: string | null,
): void {
  if (!db) return;
  db.prepare(`UPDATE subagent_sessions SET claude_session_id = ?, last_message_id = ? WHERE id = ?`).run(
    claudeSessionId,
    lastMessageId,
    id,
  );
}

export function getSubagentSession(id: string): SubagentSessionRow | null {
  if (!db) return null;
  const r = db.prepare(`SELECT * FROM subagent_sessions WHERE id = ?`).get(id) as SubagentSessionDbRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    parentSessionId: r.parent_session_id,
    parentSessionType: r.parent_session_type as 'terminal' | 'claude',
    name: r.name,
    task: r.task,
    targetUrl: r.target_url,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    claudeSessionId: r.claude_session_id,
    lastMessageId: r.last_message_id,
    workingDir: r.working_dir,
    subagentType: r.subagent_type,
    cli: r.cli,
  };
}

export function getSubagentSessionsByParent(parentSessionId: string): SubagentSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM subagent_sessions WHERE parent_session_id = ? ORDER BY started_at DESC`)
    .all(parentSessionId) as SubagentSessionDbRow[];
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
    claudeSessionId: r.claude_session_id,
    lastMessageId: r.last_message_id,
    workingDir: r.working_dir,
    subagentType: r.subagent_type,
    cli: r.cli,
  }));
}

export function getAllSubagentSessions(): SubagentSessionRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM subagent_sessions ORDER BY started_at DESC`)
    .all() as SubagentSessionDbRow[];
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
    claudeSessionId: r.claude_session_id,
    lastMessageId: r.last_message_id,
    workingDir: r.working_dir,
    subagentType: r.subagent_type,
    cli: r.cli,
  }));
}

export function deleteSubagentSession(id: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM subagent_entries WHERE subagent_id = ?`).run(id);
  db.prepare(`DELETE FROM subagent_sessions WHERE id = ?`).run(id);
}

export function clearSubagentEntries(subagentId: string): void {
  if (!db) return;
  db.prepare(`DELETE FROM subagent_entries WHERE subagent_id = ?`).run(subagentId);
}

export function deleteSubagentsByParent(parentSessionId: string): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM subagent_entries WHERE subagent_id IN (SELECT id FROM subagent_sessions WHERE parent_session_id = ?)`,
  ).run(parentSessionId);
  db.prepare(`DELETE FROM subagent_sessions WHERE parent_session_id = ?`).run(parentSessionId);
}

export function countSubagentsByParent(parentSessionId: string): number {
  if (!db) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM subagent_sessions WHERE parent_session_id = ?`)
    .get(parentSessionId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

// ─── Subagent Entries CRUD ───

export interface SubagentEntryRow {
  id?: number;
  subagentId: string;
  kind: string;
  data: string; // JSON stringified entry
  timestamp: number;
  seq: number;
}

interface SubagentEntryDbRow {
  id: number;
  subagent_id: string;
  kind: string;
  data: string;
  timestamp: number;
  seq: number;
}

export function insertSubagentEntry(subagentId: string, kind: string, data: string, timestamp: number): void {
  if (!db) return;
  const maxSeq = db
    .prepare(`SELECT MAX(seq) as max_seq FROM subagent_entries WHERE subagent_id = ?`)
    .get(subagentId) as { max_seq: number | null } | undefined;
  const nextSeq = (maxSeq?.max_seq ?? -1) + 1;

  db.prepare(
    `INSERT INTO subagent_entries (subagent_id, kind, data, timestamp, seq) VALUES (?, ?, ?, ?, ?)`,
  ).run(subagentId, kind, data, timestamp, nextSeq);
}

export function getSubagentEntries(subagentId: string): SubagentEntryRow[] {
  if (!db) return [];
  const rows = db
    .prepare(`SELECT * FROM subagent_entries WHERE subagent_id = ? ORDER BY seq ASC`)
    .all(subagentId) as SubagentEntryDbRow[];
  return rows.map((r) => ({
    id: r.id,
    subagentId: r.subagent_id,
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

export function markStaleSubagentsErrored(): void {
  if (!db) return;
  const result = db
    .prepare(`UPDATE subagent_sessions SET status = 'error', ended_at = ? WHERE status = 'running'`)
    .run(Date.now());
  if (result.changes > 0) {
    console.log(`[Zeus DB] Marked ${result.changes} stale subagent session(s) as error`);
  }
}

// ─── MCP Servers CRUD ───

export interface McpServerDbRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  source: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function mapMcpServerRow(r: McpServerDbRow) {
  return {
    id: r.id,
    name: r.name,
    command: r.command,
    args: JSON.parse(r.args || '[]') as string[],
    env: JSON.parse(r.env || '{}') as Record<string, string>,
    source: r.source as 'zeus' | 'claude',
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getMcpServers() {
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM mcp_servers ORDER BY name`).all() as McpServerDbRow[];
  return rows.map(mapMcpServerRow);
}

export function getMcpServer(id: string) {
  if (!db) return null;
  const r = db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`).get(id) as McpServerDbRow | undefined;
  return r ? mapMcpServerRow(r) : null;
}

export function getMcpServerByName(name: string) {
  if (!db) return null;
  const r = db.prepare(`SELECT * FROM mcp_servers WHERE name = ?`).get(name) as McpServerDbRow | undefined;
  return r ? mapMcpServerRow(r) : null;
}

export function insertMcpServer(server: { id: string; name: string; command: string; args?: string[]; env?: Record<string, string>; source?: string }) {
  if (!db) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, command, args, env, source, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    server.id,
    server.name,
    server.command,
    JSON.stringify(server.args ?? []),
    JSON.stringify(server.env ?? {}),
    server.source ?? 'zeus',
    now,
    now,
  );
}

export function updateMcpServer(id: string, updates: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }) {
  if (!db) return;
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.command !== undefined) { sets.push('command = ?'); vals.push(updates.command); }
  if (updates.args !== undefined) { sets.push('args = ?'); vals.push(JSON.stringify(updates.args)); }
  if (updates.env !== undefined) { sets.push('env = ?'); vals.push(JSON.stringify(updates.env)); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); vals.push(updates.enabled ? 1 : 0); }

  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);

  db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteMcpServer(id: string) {
  if (!db) return;
  db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id);
}

export function toggleMcpServer(id: string, enabled: boolean) {
  if (!db) return;
  db.prepare(`UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, Date.now(), id);
}

// ─── MCP Profiles CRUD ───

export interface McpProfileDbRow {
  id: string;
  name: string;
  description: string;
  is_default: number;
  created_at: number;
}

export function getMcpProfiles() {
  if (!db) return [];
  const profiles = db.prepare(`SELECT * FROM mcp_profiles ORDER BY name`).all() as McpProfileDbRow[];
  return profiles.map((p) => {
    const serverIds = db!
      .prepare(`SELECT server_id FROM mcp_profile_servers WHERE profile_id = ?`)
      .all(p.id) as Array<{ server_id: string }>;
    const servers = serverIds
      .map((s) => getMcpServer(s.server_id))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      isDefault: p.is_default === 1,
      servers,
      createdAt: p.created_at,
    };
  });
}

export function getMcpProfile(id: string) {
  if (!db) return null;
  const p = db.prepare(`SELECT * FROM mcp_profiles WHERE id = ?`).get(id) as McpProfileDbRow | undefined;
  if (!p) return null;
  const serverIds = db
    .prepare(`SELECT server_id FROM mcp_profile_servers WHERE profile_id = ?`)
    .all(p.id) as Array<{ server_id: string }>;
  const servers = serverIds.map((s) => getMcpServer(s.server_id)).filter((s): s is NonNullable<typeof s> => s !== null);
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    isDefault: p.is_default === 1,
    servers,
    createdAt: p.created_at,
  };
}

export function insertMcpProfile(profile: { id: string; name: string; description?: string; serverIds: string[] }) {
  if (!db) return;
  const now = Date.now();
  db.transaction(() => {
    db!.prepare(
      `INSERT INTO mcp_profiles (id, name, description, is_default, created_at) VALUES (?, ?, ?, 0, ?)`
    ).run(profile.id, profile.name, profile.description ?? '', now);

    const stmt = db!.prepare(`INSERT INTO mcp_profile_servers (profile_id, server_id) VALUES (?, ?)`);
    for (const sid of profile.serverIds) {
      stmt.run(profile.id, sid);
    }
  })();
}

export function updateMcpProfile(id: string, updates: { name?: string; description?: string; serverIds?: string[] }) {
  if (!db) return;
  db.transaction(() => {
    if (updates.name !== undefined) {
      db!.prepare(`UPDATE mcp_profiles SET name = ? WHERE id = ?`).run(updates.name, id);
    }
    if (updates.description !== undefined) {
      db!.prepare(`UPDATE mcp_profiles SET description = ? WHERE id = ?`).run(updates.description, id);
    }
    if (updates.serverIds !== undefined) {
      db!.prepare(`DELETE FROM mcp_profile_servers WHERE profile_id = ?`).run(id);
      const stmt = db!.prepare(`INSERT INTO mcp_profile_servers (profile_id, server_id) VALUES (?, ?)`);
      for (const sid of updates.serverIds) {
        stmt.run(id, sid);
      }
    }
  })();
}

export function deleteMcpProfile(id: string) {
  if (!db) return;
  db.prepare(`DELETE FROM mcp_profiles WHERE id = ?`).run(id);
}

export function setDefaultMcpProfile(id: string) {
  if (!db) return;
  db.transaction(() => {
    db!.prepare(`UPDATE mcp_profiles SET is_default = 0`).run();
    db!.prepare(`UPDATE mcp_profiles SET is_default = 1 WHERE id = ?`).run(id);
  })();
}

// ─── Session MCPs ───

export function attachSessionMcps(sessionId: string, serverIds: string[]) {
  if (!db) return;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO session_mcps (session_id, server_id, status, attached_at) VALUES (?, ?, 'attached', ?)`
  );
  for (const sid of serverIds) {
    stmt.run(sessionId, sid, now);
  }
}

export function updateSessionMcpStatus(sessionId: string, serverId: string, status: string) {
  if (!db) return;
  db.prepare(`UPDATE session_mcps SET status = ? WHERE session_id = ? AND server_id = ?`).run(status, sessionId, serverId);
}

export function getSessionMcps(sessionId: string) {
  if (!db) return [];
  const rows = db.prepare(`
    SELECT sm.session_id, sm.server_id, sm.status, sm.attached_at,
           ms.name, ms.command, ms.args, ms.env
    FROM session_mcps sm
    JOIN mcp_servers ms ON ms.id = sm.server_id
    WHERE sm.session_id = ?
    ORDER BY sm.attached_at
  `).all(sessionId) as Array<{
    session_id: string;
    server_id: string;
    status: string;
    attached_at: number;
    name: string;
    command: string;
    args: string;
    env: string;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    serverId: r.server_id,
    serverName: r.name,
    command: r.command,
    args: JSON.parse(r.args || '[]') as string[],
    env: JSON.parse(r.env || '{}') as Record<string, string>,
    status: r.status as 'attached' | 'active' | 'failed',
    attachedAt: r.attached_at,
  }));
}

// ─── Tasks ───

export function insertTask(task: {
  id: string;
  name: string;
  prompt: string;
  branch: string;
  baseBranch: string;
  worktreeDir: string;
  projectPath: string;
  status: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}): void {
  if (!db) return;
  db.prepare(`
    INSERT INTO tasks (id, name, prompt, branch, base_branch, worktree_dir, project_path, status, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, task.name, task.prompt, task.branch, task.baseBranch, task.worktreeDir, task.projectPath, task.status, task.sessionId, task.createdAt, task.updatedAt);
}

export function updateTaskStatus(id: string, status: string, extra?: { sessionId?: string; prUrl?: string; diffSummary?: string; completedAt?: number }): void {
  if (!db) return;
  const now = Date.now();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];

  if (extra?.sessionId !== undefined) { updates.push('session_id = ?'); params.push(extra.sessionId); }
  if (extra?.prUrl !== undefined) { updates.push('pr_url = ?'); params.push(extra.prUrl); }
  if (extra?.diffSummary !== undefined) { updates.push('diff_summary = ?'); params.push(extra.diffSummary); }
  if (extra?.completedAt !== undefined) { updates.push('completed_at = ?'); params.push(extra.completedAt); }

  params.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function getTask(id: string): TaskRecord | null {
  if (!db) return null;
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToTaskRecord(row) : null;
}

export function getAllTasks(projectPath?: string): TaskRecord[] {
  if (!db) return [];
  const query = projectPath
    ? db.prepare("SELECT * FROM tasks WHERE project_path = ? AND status != 'discarded' ORDER BY created_at DESC")
    : db.prepare("SELECT * FROM tasks WHERE status != 'discarded' ORDER BY created_at DESC");
  const rows = (projectPath ? query.all(projectPath) : query.all()) as Record<string, unknown>[];
  return rows.map(rowToTaskRecord);
}

export function deleteTask(id: string): void {
  if (!db) return;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function pruneOldTasks(maxAgeDays = 30): void {
  if (!db) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = db.prepare(
    `DELETE FROM tasks WHERE status IN ('discarded', 'merged', 'archived') AND updated_at < ?`,
  ).run(cutoff);
  if (result.changes > 0) {
    console.log(`[Zeus DB] Pruned ${result.changes} old task(s)`);
  }
}

function rowToTaskRecord(row: Record<string, unknown>): TaskRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    prompt: row.prompt as string,
    branch: row.branch as string,
    baseBranch: row.base_branch as string,
    worktreeDir: row.worktree_dir as string,
    projectPath: row.project_path as string,
    status: row.status as TaskStatus,
    sessionId: (row.session_id as string) || null,
    prUrl: (row.pr_url as string) || null,
    diffSummary: (row.diff_summary as string) || null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    completedAt: (row.completed_at as number) || null,
  };
}

// ─── Permission Rules ───

export function getPermissionRules(projectId: string): PermissionRule[] {
  const database = getDb();
  const row = database.prepare(
    'SELECT rules FROM permission_rules WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(projectId) as { rules: string } | undefined;
  if (!row) return [];
  try { return JSON.parse(row.rules); } catch { return []; }
}

export function setPermissionRules(projectId: string, rules: PermissionRule[], name = 'Custom', isTemplate = false): void {
  const database = getDb();
  const existing = database.prepare(
    'SELECT id FROM permission_rules WHERE project_id = ? LIMIT 1'
  ).get(projectId) as { id: string } | undefined;
  const now = Date.now();
  if (existing) {
    database.prepare(
      'UPDATE permission_rules SET rules = ?, name = ?, is_template = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(rules), name, isTemplate ? 1 : 0, now, existing.id);
  } else {
    const id = crypto.randomUUID();
    database.prepare(
      'INSERT INTO permission_rules (id, project_id, name, rules, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, name, JSON.stringify(rules), isTemplate ? 1 : 0, now, now);
  }
}

export function clearPermissionRules(projectId: string): void {
  const database = getDb();
  database.prepare('DELETE FROM permission_rules WHERE project_id = ?').run(projectId);
}

// ─── Permission Audit Log ───

export function insertAuditEntry(entry: {
  id: string; sessionId: string; projectId: string | null;
  toolName: string; pattern: string; action: string;
  ruleMatched: string | null; timestamp: number;
}): void {
  const database = getDb();
  database.prepare(
    `INSERT INTO permission_audit_log (id, session_id, project_id, tool_name, pattern, action, rule_matched, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entry.id, entry.sessionId, entry.projectId, entry.toolName, entry.pattern, entry.action, entry.ruleMatched, entry.timestamp);
}

export function getAuditLog(sessionId: string, limit = 100, offset = 0): { entries: any[]; total: number } {
  const database = getDb();
  const total = (database.prepare(
    'SELECT COUNT(*) as count FROM permission_audit_log WHERE session_id = ?'
  ).get(sessionId) as { count: number }).count;
  const entries = database.prepare(
    'SELECT * FROM permission_audit_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset);
  return { entries, total };
}

export function pruneOldAuditLogs(maxAgeDays = 30): void {
  const database = getDb();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  database.prepare('DELETE FROM permission_audit_log WHERE timestamp < ?').run(cutoff);
}

// ─── Agent Rooms CRUD ───

export function insertRoom(room: {
  room_id: string;
  name: string;
  task: string;
  pm_agent_id?: string | null;
  status?: string;
  token_budget?: number | null;
  created_at: string;
  updated_at: string;
}): void {
  const database = getDb();
  database.prepare(
    `INSERT INTO rooms (room_id, name, task, pm_agent_id, status, token_budget, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    room.room_id,
    room.name,
    room.task,
    room.pm_agent_id ?? null,
    room.status ?? 'active',
    room.token_budget ?? null,
    room.created_at,
    room.updated_at,
  );
}

export function updateRoomPmAgent(roomId: string, pmAgentId: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE rooms SET pm_agent_id = ?, updated_at = ? WHERE room_id = ?'
  ).run(pmAgentId, now, roomId);
}

export function updateRoomStatus(roomId: string, status: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE rooms SET status = ?, updated_at = ? WHERE room_id = ?'
  ).run(status, now, roomId);
}

export function getRoom(roomId: string): Record<string, unknown> | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getAllRooms(): Record<string, unknown>[] {
  const database = getDb();
  return database.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all() as Record<string, unknown>[];
}

// ─── Room Agents CRUD ───

export function insertRoomAgent(agent: {
  agent_id: string;
  room_id: string;
  role: string;
  claude_session_id?: string | null;
  model?: string | null;
  status?: string;
  room_aware?: number;
  prompt: string;
  result?: string | null;
  tokens_used?: number;
  spawned_by?: string | null;
  working_dir?: string | null;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
}): void {
  const database = getDb();
  database.prepare(
    `INSERT INTO room_agents (agent_id, room_id, role, claude_session_id, model, status, room_aware, prompt, result, tokens_used, spawned_by, working_dir, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    agent.agent_id,
    agent.room_id,
    agent.role,
    agent.claude_session_id ?? null,
    agent.model ?? null,
    agent.status ?? 'spawning',
    agent.room_aware ?? 1,
    agent.prompt,
    agent.result ?? null,
    agent.tokens_used ?? 0,
    agent.spawned_by ?? null,
    agent.working_dir ?? null,
    agent.last_activity_at ?? null,
    agent.created_at,
    agent.updated_at,
  );
}

export function updateRoomAgentStatus(agentId: string, status: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE room_agents SET status = ?, updated_at = ? WHERE agent_id = ?'
  ).run(status, now, agentId);
}

export function updateRoomAgentSession(agentId: string, claudeSessionId: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE room_agents SET claude_session_id = ?, updated_at = ? WHERE agent_id = ?'
  ).run(claudeSessionId, now, agentId);
}

export function updateRoomAgentResult(agentId: string, result: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE room_agents SET result = ?, updated_at = ? WHERE agent_id = ?'
  ).run(result, now, agentId);
}

export function updateRoomAgentActivity(agentId: string): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE room_agents SET last_activity_at = ?, updated_at = ? WHERE agent_id = ?'
  ).run(now, now, agentId);
}

export function updateRoomAgentTokens(agentId: string, tokensUsed: number): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    'UPDATE room_agents SET tokens_used = ?, updated_at = ? WHERE agent_id = ?'
  ).run(tokensUsed, now, agentId);
}

export function getRoomAgent(agentId: string): Record<string, unknown> | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM room_agents WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getRoomAgents(roomId: string): Record<string, unknown>[] {
  const database = getDb();
  return database.prepare('SELECT * FROM room_agents WHERE room_id = ? ORDER BY created_at ASC').all(roomId) as Record<string, unknown>[];
}

export function getRoomAgentBySession(claudeSessionId: string): Record<string, unknown> | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM room_agents WHERE claude_session_id = ?').get(claudeSessionId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getOrphanedRoomAgents(): Record<string, unknown>[] {
  const database = getDb();
  return database.prepare(
    "SELECT * FROM room_agents WHERE status IN ('running', 'spawning')"
  ).all() as Record<string, unknown>[];
}

// ─── Room Messages CRUD ───

export function insertRoomMessage(msg: {
  message_id: string;
  room_id: string;
  from_agent_id?: string | null;
  to_agent_id?: string | null;
  type: string;
  content: string;
  mentions?: string;
  metadata?: string | null;
  timestamp: string;
}): { seq: number } {
  const database = getDb();
  let seq = 0;

  const insertTx = database.transaction(() => {
    const maxRow = database.prepare(
      'SELECT MAX(seq) as max_seq FROM room_messages WHERE room_id = ?'
    ).get(msg.room_id) as { max_seq: number | null } | undefined;
    seq = (maxRow?.max_seq ?? 0) + 1;

    database.prepare(
      `INSERT INTO room_messages (message_id, room_id, from_agent_id, to_agent_id, type, content, mentions, metadata, seq, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      msg.message_id,
      msg.room_id,
      msg.from_agent_id ?? null,
      msg.to_agent_id ?? null,
      msg.type,
      msg.content,
      msg.mentions ?? '[]',
      msg.metadata ?? null,
      seq,
      msg.timestamp,
    );
  });

  insertTx();
  return { seq };
}

export function getRoomMessages(roomId: string, since?: number, limit = 50): Record<string, unknown>[] {
  const database = getDb();
  if (since !== undefined) {
    return database.prepare(
      'SELECT * FROM room_messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
    ).all(roomId, since, limit) as Record<string, unknown>[];
  }
  return database.prepare(
    'SELECT * FROM room_messages WHERE room_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(roomId, limit) as Record<string, unknown>[];
}

export function getUnreadMessagesForAgent(roomId: string, agentId: string): number {
  const database = getDb();
  const cursor = getReadCursor(agentId, roomId);
  const row = database.prepare(
    'SELECT COUNT(*) as cnt FROM room_messages WHERE room_id = ? AND seq > ?'
  ).get(roomId, cursor) as { cnt: number };
  return row.cnt;
}

export function getDirectedUnreadForAgent(roomId: string, agentId: string): number {
  const database = getDb();
  const cursor = getReadCursor(agentId, roomId);
  const row = database.prepare(
    `SELECT COUNT(*) as cnt FROM room_messages
     WHERE room_id = ? AND seq > ?
     AND (to_agent_id = ? OR mentions LIKE ?)`
  ).get(roomId, cursor, agentId, `%${agentId}%`) as { cnt: number };
  return row.cnt;
}

// ─── Room Read Cursors ───

export function updateReadCursor(agentId: string, roomId: string, lastSeq: number): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO room_read_cursors (agent_id, room_id, last_seq, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (agent_id, room_id) DO UPDATE SET last_seq = ?, updated_at = ?`
  ).run(agentId, roomId, lastSeq, now, lastSeq, now);
}

export function getReadCursor(agentId: string, roomId: string): number {
  const database = getDb();
  const row = database.prepare(
    'SELECT last_seq FROM room_read_cursors WHERE agent_id = ? AND room_id = ?'
  ).get(agentId, roomId) as { last_seq: number } | undefined;
  return row?.last_seq ?? 0;
}
