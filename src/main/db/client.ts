import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { Log } from "../log/log";

const log = Log.create({ service: "db" });

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function initDatabase(dbPath: string): void {
  log.info("opening database", { path: dbPath });

  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -64000");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });

  // Run migrations inline (same approach as current db.ts)
  runMigrations(sqlite);

  log.info("database ready");
}

export function getClient(): BetterSQLite3Database<typeof schema> {
  if (!db) throw new Error("[Zeus DB] Database not initialized");
  return db;
}

export function getRawSqlite(): Database.Database {
  if (!sqlite) throw new Error("[Zeus DB] Database not initialized");
  return sqlite;
}

export function closeDatabase(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
  log.info("database closed");
}

// ─── Schema & Migrations ───
// Ported from src/main/services/db.ts — idempotent, version-gated migrations.
// This ensures existing databases with data upgrade correctly.

const SCHEMA_VERSION = 13;

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma("user_version", { simple: true }) as number;

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
    // Rename qa_agent_sessions -> subagent_sessions
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
    const hasOldTable = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='qa_agent_sessions'",
      )
      .get();
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

  database.pragma(`user_version = ${SCHEMA_VERSION}`);
}
