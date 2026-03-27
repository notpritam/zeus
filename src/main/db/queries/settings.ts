import { eq, desc } from "drizzle-orm";
import { use } from "../transaction";
import { savedProjects } from "../schema/saved-projects.sql";
import type { SavedProject } from "../../../shared/types";

// ─── Saved Projects CRUD ───

export function insertProject(project: SavedProject): void {
  use((db) =>
    db
      .insert(savedProjects)
      .values({
        id: project.id,
        name: project.name,
        path: project.path,
        addedAt: project.addedAt,
      })
      .onConflictDoNothing()
      .run(),
  );
}

export function getAllProjects(): SavedProject[] {
  return use((db) =>
    db
      .select()
      .from(savedProjects)
      .orderBy(desc(savedProjects.addedAt))
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        path: r.path,
        addedAt: r.addedAt,
      })),
  );
}

export function deleteProject(id: string): void {
  use((db) =>
    db
      .delete(savedProjects)
      .where(eq(savedProjects.id, id))
      .run(),
  );
}
