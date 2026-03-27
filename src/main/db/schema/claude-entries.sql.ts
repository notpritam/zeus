import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const claudeEntries = sqliteTable(
  "claude_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    entryType: text("entry_type").notNull(),
    content: text("content").notNull().default(""),
    metadata: text("metadata"),
    timestamp: text("timestamp"),
    seq: integer("seq").notNull(),
  },
  (table) => [
    index("idx_ce_session").on(table.sessionId, table.seq),
  ],
);
