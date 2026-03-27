import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const subagentEntries = sqliteTable(
  "subagent_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subagentId: text("subagent_id").notNull(),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    timestamp: integer("timestamp").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (table) => [
    index("idx_subagent_entries_agent").on(table.subagentId, table.seq),
  ],
);
