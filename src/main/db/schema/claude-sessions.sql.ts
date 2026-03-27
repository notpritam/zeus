import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const claudeSessions = sqliteTable(
  "claude_sessions",
  {
    id: text("id").primaryKey(),
    claudeSessionId: text("claude_session_id"),
    status: text("status").notNull().default("running"),
    prompt: text("prompt").notNull(),
    name: text("name"),
    notificationSound: integer("notification_sound").default(1),
    workingDir: text("working_dir"),
    permissionMode: text("permission_mode"),
    model: text("model"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    color: text("color"),
    icon: text("icon"),
    qaTargetUrl: text("qa_target_url"),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("idx_cs_started").on(table.startedAt),
  ],
);
