import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  command: text("command").notNull(),
  args: text("args").default("[]"),
  env: text("env").default("{}"),
  source: text("source").default("zeus"),
  enabled: integer("enabled").default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const mcpProfiles = sqliteTable("mcp_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").default(""),
  isDefault: integer("is_default").default(0),
  createdAt: integer("created_at").notNull(),
});

export const mcpProfileServers = sqliteTable(
  "mcp_profile_servers",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => mcpProfiles.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.serverId] }),
    index("idx_mcp_profile_servers_profile").on(table.profileId),
  ],
);

export const sessionMcps = sqliteTable(
  "session_mcps",
  {
    sessionId: text("session_id").notNull(),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    status: text("status").default("attached"),
    attachedAt: integer("attached_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.serverId] }),
    index("idx_session_mcps_session").on(table.sessionId),
  ],
);
