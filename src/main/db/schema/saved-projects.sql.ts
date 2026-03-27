import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const savedProjects = sqliteTable("saved_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  addedAt: integer("added_at").notNull(),
});
