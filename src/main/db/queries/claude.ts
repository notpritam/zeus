import crypto from "crypto";
import { eq, ne, desc, asc, lt, sql, and, inArray, like } from "drizzle-orm";
import { use, transaction } from "../transaction";
import { getRawSqlite } from "../client";
import { claudeSessions } from "../schema/claude-sessions.sql";
import { claudeEntries } from "../schema/claude-entries.sql";
import type { NormalizedEntry } from "../../services/claude-types";
import {
  validateNormalizedEntry,
  safeParseNormalizedEntry,
} from "../../../shared/validators";

// ─── Row Types ───

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

function mapClaudeRow(r: typeof claudeSessions.$inferSelect): ClaudeSessionRow {
  return {
    id: r.id,
    claudeSessionId: r.claudeSessionId,
    status: r.status,
    prompt: r.prompt,
    name: r.name,
    icon: r.icon,
    color: r.color,
    notificationSound: r.notificationSound === 1,
    workingDir: r.workingDir,
    qaTargetUrl: r.qaTargetUrl,
    permissionMode: r.permissionMode,
    model: r.model,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    deletedAt: r.deletedAt,
  };
}

// ─── Claude Sessions CRUD ───

export function insertClaudeSession(info: ClaudeSessionRow): void {
  use((db) =>
    db
      .insert(claudeSessions)
      .values({
        id: info.id,
        claudeSessionId: info.claudeSessionId,
        status: info.status,
        prompt: info.prompt,
        name: info.name,
        icon: info.icon,
        color: info.color,
        notificationSound: info.notificationSound ? 1 : 0,
        workingDir: info.workingDir,
        qaTargetUrl: info.qaTargetUrl,
        permissionMode: info.permissionMode,
        model: info.model,
        startedAt: info.startedAt,
        endedAt: info.endedAt,
      })
      .onConflictDoNothing()
      .run(),
  );
}

export function updateClaudeSessionQaTargetUrl(
  id: string,
  qaTargetUrl: string,
): void {
  use((db) =>
    db
      .update(claudeSessions)
      .set({ qaTargetUrl })
      .where(eq(claudeSessions.id, id))
      .run(),
  );
}

export function updateClaudeSessionId(
  id: string,
  claudeSessionId: string,
): void {
  use((db) =>
    db
      .update(claudeSessions)
      .set({ claudeSessionId })
      .where(eq(claudeSessions.id, id))
      .run(),
  );
}

export function updateClaudeSessionStatus(
  id: string,
  status: string,
  endedAt?: number,
): void {
  use((db) => {
    const updates: Partial<typeof claudeSessions.$inferInsert> = { status };
    if (endedAt != null) updates.endedAt = endedAt;
    db.update(claudeSessions)
      .set(updates)
      .where(eq(claudeSessions.id, id))
      .run();
  });
}

export function getAllClaudeSessions(): ClaudeSessionRow[] {
  return use((db) =>
    db
      .select()
      .from(claudeSessions)
      .where(ne(claudeSessions.status, "deleted"))
      .orderBy(desc(claudeSessions.startedAt))
      .all()
      .map(mapClaudeRow),
  );
}

export function getDeletedClaudeSessions(): ClaudeSessionRow[] {
  return use((db) =>
    db
      .select()
      .from(claudeSessions)
      .where(eq(claudeSessions.status, "deleted"))
      .orderBy(desc(claudeSessions.deletedAt))
      .all()
      .map(mapClaudeRow),
  );
}

export function updateClaudeSessionMeta(
  id: string,
  updates: { name?: string; color?: string | null },
): void {
  const sets: Partial<typeof claudeSessions.$inferInsert> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.color !== undefined) sets.color = updates.color;
  if (Object.keys(sets).length === 0) return;

  use((db) =>
    db
      .update(claudeSessions)
      .set(sets)
      .where(eq(claudeSessions.id, id))
      .run(),
  );
}

export function deleteClaudeSession(id: string): void {
  use((db) =>
    db
      .update(claudeSessions)
      .set({ status: "deleted", deletedAt: Date.now() })
      .where(eq(claudeSessions.id, id))
      .run(),
  );
}

export function restoreClaudeSession(id: string): void {
  use((db) =>
    db
      .update(claudeSessions)
      .set({ status: "completed", deletedAt: null })
      .where(
        and(
          eq(claudeSessions.id, id),
          eq(claudeSessions.status, "deleted"),
        ),
      )
      .run(),
  );
}

export function permanentlyDeleteClaudeSession(id: string): void {
  transaction((tx) => {
    tx.delete(claudeEntries)
      .where(eq(claudeEntries.sessionId, id))
      .run();
    tx.delete(claudeSessions)
      .where(eq(claudeSessions.id, id))
      .run();
  });
}

export function archiveClaudeSession(id: string): void {
  use((db) =>
    db
      .update(claudeSessions)
      .set({ status: "archived" })
      .where(eq(claudeSessions.id, id))
      .run(),
  );
}

// ─── Crash Recovery ───

export function markStaleSessionsErrored(): void {
  use((db) => {
    const result = db
      .update(claudeSessions)
      .set({ status: "error", endedAt: Date.now() })
      .where(eq(claudeSessions.status, "running"))
      .run();
    if (result.changes > 0) {
      console.log(
        `[Zeus DB] Marked ${result.changes} stale Claude session(s) as error`,
      );
    }
  });
}

// ─── Cleanup ───

export function pruneOldSessions(maxAgeDays = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  transaction((tx) => {
    // Permanently purge soft-deleted sessions older than 30 days
    const deletedIds = tx
      .select({ id: claudeSessions.id })
      .from(claudeSessions)
      .where(
        and(
          eq(claudeSessions.status, "deleted"),
          lt(claudeSessions.deletedAt, cutoff),
        ),
      )
      .all()
      .map((r) => r.id);

    if (deletedIds.length > 0) {
      tx.delete(claudeEntries)
        .where(inArray(claudeEntries.sessionId, deletedIds))
        .run();
      tx.delete(claudeSessions)
        .where(inArray(claudeSessions.id, deletedIds))
        .run();
    }

    // Also prune very old non-deleted sessions
    const oldIds = tx
      .select({ id: claudeSessions.id })
      .from(claudeSessions)
      .where(lt(claudeSessions.startedAt, cutoff))
      .all()
      .map((r) => r.id);

    if (oldIds.length > 0) {
      tx.delete(claudeEntries)
        .where(inArray(claudeEntries.sessionId, oldIds))
        .run();
      tx.delete(claudeSessions)
        .where(inArray(claudeSessions.id, oldIds))
        .run();
    }
  });
}

// ─── Claude Entries CRUD ───

export function upsertClaudeEntry(
  sessionId: string,
  entry: NormalizedEntry,
): void {
  // Runtime validation before persisting
  const validation = validateNormalizedEntry(entry);
  if (!validation.valid) {
    console.warn(
      `[Zeus DB] Skipping invalid entry for session ${sessionId.slice(-6)}:`,
      validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; "),
    );
    return;
  }

  use((db) => {
    // Get next seq for this session if inserting new
    const maxSeqRow = db
      .select({ maxSeq: sql<number | null>`MAX(${claudeEntries.seq})` })
      .from(claudeEntries)
      .where(eq(claudeEntries.sessionId, sessionId))
      .get();
    const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

    // Check if entry already exists (streaming update)
    const existing = db
      .select({ seq: claudeEntries.seq })
      .from(claudeEntries)
      .where(eq(claudeEntries.id, entry.id))
      .get();

    const seq = existing?.seq ?? nextSeq;

    db.insert(claudeEntries)
      .values({
        id: entry.id,
        sessionId,
        entryType: JSON.stringify(entry.entryType),
        content: entry.content,
        metadata:
          entry.metadata != null ? JSON.stringify(entry.metadata) : null,
        timestamp: entry.timestamp ?? null,
        seq,
      })
      .onConflictDoUpdate({
        target: claudeEntries.id,
        set: {
          entryType: JSON.stringify(entry.entryType),
          content: entry.content,
          metadata:
            entry.metadata != null ? JSON.stringify(entry.metadata) : null,
          timestamp: entry.timestamp ?? null,
          seq,
        },
      })
      .run();
  });
}

export function deleteClaudeEntriesForSession(sessionId: string): void {
  use((db) =>
    db
      .delete(claudeEntries)
      .where(eq(claudeEntries.sessionId, sessionId))
      .run(),
  );
}

export function getClaudeEntries(sessionId: string): NormalizedEntry[] {
  const rows = use((db) =>
    db
      .select()
      .from(claudeEntries)
      .where(eq(claudeEntries.sessionId, sessionId))
      .orderBy(asc(claudeEntries.seq))
      .all(),
  );

  const entries: NormalizedEntry[] = [];
  for (const r of rows) {
    const raw = {
      id: r.id,
      entryType: JSON.parse(r.entryType),
      content: r.content,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      timestamp: r.timestamp ?? undefined,
    };
    const parsed = safeParseNormalizedEntry(
      raw,
      `db-read:${sessionId.slice(-6)}:${r.id.slice(-6)}`,
    );
    if (parsed) entries.push(parsed);
  }
  return entries;
}

export function getClaudeEntriesPaginated(
  sessionId: string,
  limit: number,
  beforeSeq?: number,
): { entries: NormalizedEntry[]; totalCount: number; oldestSeq: number | null } {
  return use((db) => {
    const countRow = db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(claudeEntries)
      .where(eq(claudeEntries.sessionId, sessionId))
      .get();
    const totalCount = countRow?.cnt ?? 0;

    let rows: (typeof claudeEntries.$inferSelect)[];
    if (beforeSeq !== undefined) {
      rows = db
        .select()
        .from(claudeEntries)
        .where(
          and(
            eq(claudeEntries.sessionId, sessionId),
            lt(claudeEntries.seq, beforeSeq),
          ),
        )
        .orderBy(desc(claudeEntries.seq))
        .limit(limit)
        .all();
      rows.reverse();
    } else {
      rows = db
        .select()
        .from(claudeEntries)
        .where(eq(claudeEntries.sessionId, sessionId))
        .orderBy(desc(claudeEntries.seq))
        .limit(limit)
        .all();
      rows.reverse();
    }

    const entries: NormalizedEntry[] = [];
    let oldestSeq: number | null = null;
    for (const r of rows) {
      if (oldestSeq === null || r.seq < oldestSeq) oldestSeq = r.seq;
      const raw = {
        id: r.id,
        entryType: JSON.parse(r.entryType),
        content: r.content,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        timestamp: r.timestamp ?? undefined,
      };
      const parsed = safeParseNormalizedEntry(
        raw,
        `db-read:${sessionId.slice(-6)}:${r.id.slice(-6)}`,
      );
      if (parsed) entries.push(parsed);
    }
    return { entries, totalCount, oldestSeq };
  });
}

/**
 * Finalize all tool_use entries stuck at "created" -> "success" for a completed session.
 */
export function finalizeCreatedToolEntries(sessionId: string): void {
  // Use raw SQL for the LIKE-based query which is hard to express in Drizzle
  const sqlite = getRawSqlite();
  const rows = sqlite
    .prepare(
      `SELECT id, entry_type FROM claude_entries WHERE session_id = ? AND entry_type LIKE '%"status":"created"%'`,
    )
    .all(sessionId) as Array<{ id: string; entry_type: string }>;

  if (rows.length === 0) return;

  const stmt = sqlite.prepare(
    `UPDATE claude_entries SET entry_type = ? WHERE id = ?`,
  );
  const update = sqlite.transaction(() => {
    for (const row of rows) {
      const entryType = JSON.parse(row.entry_type);
      if (entryType.type === "tool_use" && entryType.status === "created") {
        entryType.status = "success";
        stmt.run(JSON.stringify(entryType), row.id);
      }
    }
  });
  update();
  console.log(
    `[Zeus DB] Finalized ${rows.length} stale tool entries for session ${sessionId.slice(-6)}`,
  );
}

/**
 * Copy all entries from previous sessions sharing the same Claude session ID
 * into a newly-resumed session.
 */
export function copyClaudeEntriesForResume(
  claudeSessionId: string,
  toSessionId: string,
): number {
  const sqlite = getRawSqlite();

  // Find all previous Zeus session IDs that share this Claude session ID
  const prevSessions = sqlite
    .prepare(
      `SELECT id FROM claude_sessions
       WHERE claude_session_id = ? AND id != ?
       ORDER BY started_at ASC`,
    )
    .all(claudeSessionId, toSessionId) as Array<{ id: string }>;

  if (prevSessions.length === 0) return 0;

  const prevIds = prevSessions.map((s) => s.id);

  // Collect all entries across previous sessions, ordered chronologically
  const placeholders = prevIds.map(() => "?").join(",");
  const rows = sqlite
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

  const insertStmt = sqlite.prepare(
    `INSERT OR IGNORE INTO claude_entries (id, session_id, entry_type, content, metadata, timestamp, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const copyAll = sqlite.transaction(() => {
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

/**
 * On startup, finalize tool entries for all completed sessions that still have "created" status.
 */
export function finalizeAllCompletedSessions(): void {
  const sqlite = getRawSqlite();
  const sessions = sqlite
    .prepare(`SELECT id FROM claude_sessions WHERE status != 'running'`)
    .all() as Array<{ id: string }>;

  let total = 0;
  for (const s of sessions) {
    const rows = sqlite
      .prepare(
        `SELECT id, entry_type FROM claude_entries WHERE session_id = ? AND entry_type LIKE '%"status":"created"%'`,
      )
      .all(s.id) as Array<{ id: string; entry_type: string }>;

    if (rows.length === 0) continue;

    const stmt = sqlite.prepare(
      `UPDATE claude_entries SET entry_type = ? WHERE id = ?`,
    );
    for (const row of rows) {
      const entryType = JSON.parse(row.entry_type);
      if (entryType.type === "tool_use" && entryType.status === "created") {
        entryType.status = "success";
        stmt.run(JSON.stringify(entryType), row.id);
        total++;
      }
    }
  }

  if (total > 0) {
    console.log(
      `[Zeus DB] Finalized ${total} stale tool entries across ${sessions.length} completed sessions`,
    );
  }
}
