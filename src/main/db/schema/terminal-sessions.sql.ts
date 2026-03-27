import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const terminalSessions = sqliteTable("terminal_sessions", {
  id: text("id").primaryKey(),
  shell: text("shell").notNull(),
  status: text("status").notNull(),
  cols: integer("cols").notNull(),
  rows: integer("rows").notNull(),
  cwd: text("cwd").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  exitCode: integer("exit_code"),
  deletedAt: integer("deleted_at"),
});
