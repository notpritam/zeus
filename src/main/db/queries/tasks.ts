import { eq, ne, desc, lt, and, inArray } from "drizzle-orm";
import { use } from "../transaction";
import { getRawSqlite } from "../client";
import { tasks } from "../schema/tasks.sql";
import type { TaskRecord, TaskStatus } from "../../../shared/types";

// ─── Tasks CRUD ───

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
  use((db) =>
    db
      .insert(tasks)
      .values({
        id: task.id,
        name: task.name,
        prompt: task.prompt,
        branch: task.branch,
        baseBranch: task.baseBranch,
        worktreeDir: task.worktreeDir,
        projectPath: task.projectPath,
        status: task.status,
        sessionId: task.sessionId,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .run(),
  );
}

export function updateTaskStatus(
  id: string,
  status: string,
  extra?: {
    sessionId?: string;
    prUrl?: string;
    diffSummary?: string;
    completedAt?: number;
  },
): void {
  const now = Date.now();
  const sets: Partial<typeof tasks.$inferInsert> = {
    status,
    updatedAt: now,
  };

  if (extra?.sessionId !== undefined) sets.sessionId = extra.sessionId;
  if (extra?.prUrl !== undefined) sets.prUrl = extra.prUrl;
  if (extra?.diffSummary !== undefined) sets.diffSummary = extra.diffSummary;
  if (extra?.completedAt !== undefined) sets.completedAt = extra.completedAt;

  use((db) =>
    db.update(tasks).set(sets).where(eq(tasks.id, id)).run(),
  );
}

export function getTask(id: string): TaskRecord | null {
  const row = use((db) =>
    db.select().from(tasks).where(eq(tasks.id, id)).get(),
  );
  return row ? rowToTaskRecord(row) : null;
}

export function getAllTasks(projectPath?: string): TaskRecord[] {
  return use((db) => {
    if (projectPath) {
      return db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectPath, projectPath),
            ne(tasks.status, "discarded"),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .all()
        .map(rowToTaskRecord);
    }
    return db
      .select()
      .from(tasks)
      .where(ne(tasks.status, "discarded"))
      .orderBy(desc(tasks.createdAt))
      .all()
      .map(rowToTaskRecord);
  });
}

export function deleteTask(id: string): void {
  use((db) =>
    db.delete(tasks).where(eq(tasks.id, id)).run(),
  );
}

export function pruneOldTasks(maxAgeDays = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  use((db) => {
    const result = db
      .delete(tasks)
      .where(
        and(
          inArray(tasks.status, ["discarded", "merged", "archived"]),
          lt(tasks.updatedAt, cutoff),
        ),
      )
      .run();
    if (result.changes > 0) {
      console.log(`[Zeus DB] Pruned ${result.changes} old task(s)`);
    }
  });
}

function rowToTaskRecord(row: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    branch: row.branch,
    baseBranch: row.baseBranch,
    worktreeDir: row.worktreeDir,
    projectPath: row.projectPath,
    status: row.status as TaskStatus,
    sessionId: row.sessionId || null,
    prUrl: row.prUrl || null,
    diffSummary: row.diffSummary || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt || null,
  };
}
