import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const subagentSessions = sqliteTable(
  "subagent_sessions",
  {
    id: text("id").primaryKey(),
    parentSessionId: text("parent_session_id").notNull(),
    parentSessionType: text("parent_session_type").notNull().default("claude"),
    name: text("name"),
    task: text("task").notNull(),
    targetUrl: text("target_url"),
    status: text("status").notNull().default("running"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    claudeSessionId: text("claude_session_id"),
    lastMessageId: text("last_message_id"),
    workingDir: text("working_dir"),
    subagentType: text("subagent_type").notNull().default("qa"),
    cli: text("cli").notNull().default("claude"),
  },
  (table) => [
    index("idx_subagent_parent").on(table.parentSessionId),
    index("idx_subagent_started").on(table.startedAt),
    index("idx_subagent_type").on(table.subagentType),
  ],
);
