import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const permissionRules = sqliteTable(
  "permission_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull().default("Custom"),
    rules: text("rules").notNull().default("[]"),
    isTemplate: integer("is_template").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_pr_project").on(table.projectId),
  ],
);

export const permissionAuditLog = sqliteTable(
  "permission_audit_log",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    projectId: text("project_id"),
    toolName: text("tool_name").notNull(),
    pattern: text("pattern").notNull(),
    action: text("action").notNull(),
    ruleMatched: text("rule_matched"),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [
    index("idx_pal_session").on(table.sessionId, table.timestamp),
    index("idx_pal_project").on(table.projectId, table.timestamp),
  ],
);
