import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    branch: text("branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    worktreeDir: text("worktree_dir").notNull(),
    projectPath: text("project_path").notNull(),
    status: text("status").notNull().default("creating"),
    sessionId: text("session_id"),
    prUrl: text("pr_url"),
    diffSummary: text("diff_summary"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_project").on(table.projectPath),
    index("idx_tasks_session").on(table.sessionId),
  ],
);
