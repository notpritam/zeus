import { eq, desc, asc, lt, sql, inArray } from "drizzle-orm";
import { use, transaction } from "../transaction";
import { getRawSqlite } from "../client";
import { subagentSessions } from "../schema/subagent-sessions.sql";
import { subagentEntries } from "../schema/subagent-entries.sql";

// ─── Row Types ───

export interface SubagentSessionRow {
  id: string;
  parentSessionId: string;
  parentSessionType: "terminal" | "claude";
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

export interface SubagentEntryRow {
  id?: number;
  subagentId: string;
  kind: string;
  data: string;
  timestamp: number;
  seq: number;
}

function mapSubagentRow(
  r: typeof subagentSessions.$inferSelect,
): SubagentSessionRow {
  return {
    id: r.id,
    parentSessionId: r.parentSessionId,
    parentSessionType: r.parentSessionType as "terminal" | "claude",
    name: r.name,
    task: r.task,
    targetUrl: r.targetUrl,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    claudeSessionId: r.claudeSessionId,
    lastMessageId: r.lastMessageId,
    workingDir: r.workingDir,
    subagentType: r.subagentType,
    cli: r.cli,
  };
}

// ─── Subagent Sessions CRUD ───

export function insertSubagentSession(info: SubagentSessionRow): void {
  use((db) =>
    db
      .insert(subagentSessions)
      .values({
        id: info.id,
        parentSessionId: info.parentSessionId,
        parentSessionType: info.parentSessionType,
        name: info.name,
        task: info.task,
        targetUrl: info.targetUrl,
        status: info.status,
        startedAt: info.startedAt,
        endedAt: info.endedAt,
        claudeSessionId: info.claudeSessionId ?? null,
        lastMessageId: info.lastMessageId ?? null,
        workingDir: info.workingDir ?? null,
        subagentType: info.subagentType,
        cli: info.cli,
      })
      .onConflictDoNothing()
      .run(),
  );
}

export function updateSubagentSessionStatus(
  id: string,
  status: string,
  endedAt?: number,
): void {
  use((db) => {
    const updates: Partial<typeof subagentSessions.$inferInsert> = { status };
    if (endedAt != null) updates.endedAt = endedAt;
    db.update(subagentSessions)
      .set(updates)
      .where(eq(subagentSessions.id, id))
      .run();
  });
}

export function updateSubagentResumeData(
  id: string,
  claudeSessionId: string | null,
  lastMessageId: string | null,
): void {
  use((db) =>
    db
      .update(subagentSessions)
      .set({ claudeSessionId, lastMessageId })
      .where(eq(subagentSessions.id, id))
      .run(),
  );
}

export function getSubagentSession(id: string): SubagentSessionRow | null {
  const row = use((db) =>
    db
      .select()
      .from(subagentSessions)
      .where(eq(subagentSessions.id, id))
      .get(),
  );
  return row ? mapSubagentRow(row) : null;
}

export function getSubagentSessionsByParent(
  parentSessionId: string,
): SubagentSessionRow[] {
  return use((db) =>
    db
      .select()
      .from(subagentSessions)
      .where(eq(subagentSessions.parentSessionId, parentSessionId))
      .orderBy(desc(subagentSessions.startedAt))
      .all()
      .map(mapSubagentRow),
  );
}

export function getAllSubagentSessions(): SubagentSessionRow[] {
  return use((db) =>
    db
      .select()
      .from(subagentSessions)
      .orderBy(desc(subagentSessions.startedAt))
      .all()
      .map(mapSubagentRow),
  );
}

export function deleteSubagentSession(id: string): void {
  transaction((tx) => {
    tx.delete(subagentEntries)
      .where(eq(subagentEntries.subagentId, id))
      .run();
    tx.delete(subagentSessions)
      .where(eq(subagentSessions.id, id))
      .run();
  });
}

export function clearSubagentEntries(subagentId: string): void {
  use((db) =>
    db
      .delete(subagentEntries)
      .where(eq(subagentEntries.subagentId, subagentId))
      .run(),
  );
}

export function deleteSubagentsByParent(parentSessionId: string): void {
  transaction((tx) => {
    // Get IDs of subagent sessions to delete their entries
    const ids = tx
      .select({ id: subagentSessions.id })
      .from(subagentSessions)
      .where(eq(subagentSessions.parentSessionId, parentSessionId))
      .all()
      .map((r) => r.id);

    if (ids.length > 0) {
      tx.delete(subagentEntries)
        .where(inArray(subagentEntries.subagentId, ids))
        .run();
    }
    tx.delete(subagentSessions)
      .where(eq(subagentSessions.parentSessionId, parentSessionId))
      .run();
  });
}

export function countSubagentsByParent(parentSessionId: string): number {
  const row = use((db) =>
    db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(subagentSessions)
      .where(eq(subagentSessions.parentSessionId, parentSessionId))
      .get(),
  );
  return row?.cnt ?? 0;
}

// ─── Subagent Entries CRUD ───

export function insertSubagentEntry(
  subagentId: string,
  kind: string,
  data: string,
  timestamp: number,
): void {
  use((db) => {
    const maxSeqRow = db
      .select({
        maxSeq: sql<number | null>`MAX(${subagentEntries.seq})`,
      })
      .from(subagentEntries)
      .where(eq(subagentEntries.subagentId, subagentId))
      .get();
    const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

    db.insert(subagentEntries)
      .values({ subagentId, kind, data, timestamp, seq: nextSeq })
      .run();
  });
}

export function getSubagentEntries(subagentId: string): SubagentEntryRow[] {
  return use((db) =>
    db
      .select()
      .from(subagentEntries)
      .where(eq(subagentEntries.subagentId, subagentId))
      .orderBy(asc(subagentEntries.seq))
      .all()
      .map((r) => ({
        id: r.id,
        subagentId: r.subagentId,
        kind: r.kind,
        data: r.data,
        timestamp: r.timestamp,
        seq: r.seq,
      })),
  );
}

export function markStaleSubagentsErrored(): void {
  use((db) => {
    const result = db
      .update(subagentSessions)
      .set({ status: "error", endedAt: Date.now() })
      .where(eq(subagentSessions.status, "running"))
      .run();
    if (result.changes > 0) {
      console.log(
        `[Zeus DB] Marked ${result.changes} stale subagent session(s) as error`,
      );
    }
  });
}

export function pruneOldSubagentSessions(maxAgeDays = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  transaction((tx) => {
    const oldIds = tx
      .select({ id: subagentSessions.id })
      .from(subagentSessions)
      .where(lt(subagentSessions.startedAt, cutoff))
      .all()
      .map((r) => r.id);

    if (oldIds.length > 0) {
      tx.delete(subagentEntries)
        .where(inArray(subagentEntries.subagentId, oldIds))
        .run();
      tx.delete(subagentSessions)
        .where(inArray(subagentSessions.id, oldIds))
        .run();
    }
  });
}
