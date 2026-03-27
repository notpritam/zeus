import { eq, ne, desc, lt } from "drizzle-orm";
import { use } from "../transaction";
import { terminalSessions } from "../schema/terminal-sessions.sql";
import type { SessionRecord } from "../../../shared/types";

// ─── Terminal Sessions CRUD ───

export function insertTerminalSession(record: SessionRecord): void {
  use((db) =>
    db
      .insert(terminalSessions)
      .values({
        id: record.id,
        shell: record.shell,
        status: record.status,
        cols: record.cols,
        rows: record.rows,
        cwd: record.cwd,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        exitCode: record.exitCode,
      })
      .onConflictDoNothing()
      .run(),
  );
}

export function updateTerminalSession(
  id: string,
  updates: Partial<Pick<SessionRecord, "status" | "endedAt" | "exitCode">>,
): void {
  const sets: Partial<typeof terminalSessions.$inferInsert> = {};
  if (updates.status != null) sets.status = updates.status;
  if (updates.endedAt != null) sets.endedAt = updates.endedAt;
  if (updates.exitCode != null) sets.exitCode = updates.exitCode;
  if (Object.keys(sets).length === 0) return;

  use((db) =>
    db
      .update(terminalSessions)
      .set(sets)
      .where(eq(terminalSessions.id, id))
      .run(),
  );
}

export function getAllTerminalSessions(): SessionRecord[] {
  return use((db) =>
    db
      .select()
      .from(terminalSessions)
      .where(ne(terminalSessions.status, "deleted"))
      .orderBy(desc(terminalSessions.startedAt))
      .all()
      .map((r) => ({
        id: r.id,
        shell: r.shell,
        status: r.status as SessionRecord["status"],
        cols: r.cols,
        rows: r.rows,
        cwd: r.cwd,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        exitCode: r.exitCode,
      })),
  );
}

export function deleteTerminalSession(id: string): void {
  use((db) =>
    db
      .update(terminalSessions)
      .set({ status: "deleted", deletedAt: Date.now() })
      .where(eq(terminalSessions.id, id))
      .run(),
  );
}

export function restoreTerminalSession(id: string): void {
  use((db) =>
    db
      .update(terminalSessions)
      .set({ status: "killed", deletedAt: null })
      .where(
        eq(terminalSessions.id, id),
      )
      .run(),
  );
}

export function permanentlyDeleteTerminalSession(id: string): void {
  use((db) =>
    db
      .delete(terminalSessions)
      .where(eq(terminalSessions.id, id))
      .run(),
  );
}

export function archiveTerminalSession(id: string): void {
  use((db) =>
    db
      .update(terminalSessions)
      .set({ status: "archived" })
      .where(eq(terminalSessions.id, id))
      .run(),
  );
}

export function pruneOldTerminalSessions(maxAgeDays = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  use((db) => {
    db.delete(terminalSessions)
      .where(lt(terminalSessions.startedAt, cutoff))
      .run();
  });
}
