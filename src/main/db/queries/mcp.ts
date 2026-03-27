import { eq, asc } from "drizzle-orm";
import { use, transaction } from "../transaction";
import { getRawSqlite } from "../client";
import {
  mcpServers,
  mcpProfiles,
  mcpProfileServers,
  sessionMcps,
} from "../schema/mcp-servers.sql";

// ─── Mapped Row Type ───

interface McpServerMapped {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: "zeus" | "claude";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function mapMcpServerRow(
  r: typeof mcpServers.$inferSelect,
): McpServerMapped {
  return {
    id: r.id,
    name: r.name,
    command: r.command,
    args: JSON.parse(r.args || "[]") as string[],
    env: JSON.parse(r.env || "{}") as Record<string, string>,
    source: r.source as "zeus" | "claude",
    enabled: r.enabled === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── MCP Servers CRUD ───

export function getMcpServers(): McpServerMapped[] {
  return use((db) =>
    db
      .select()
      .from(mcpServers)
      .orderBy(asc(mcpServers.name))
      .all()
      .map(mapMcpServerRow),
  );
}

export function getMcpServer(id: string): McpServerMapped | null {
  const r = use((db) =>
    db.select().from(mcpServers).where(eq(mcpServers.id, id)).get(),
  );
  return r ? mapMcpServerRow(r) : null;
}

export function getMcpServerByName(name: string): McpServerMapped | null {
  const r = use((db) =>
    db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.name, name))
      .get(),
  );
  return r ? mapMcpServerRow(r) : null;
}

export function insertMcpServer(server: {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  source?: string;
}): void {
  const now = Date.now();
  use((db) =>
    db
      .insert(mcpServers)
      .values({
        id: server.id,
        name: server.name,
        command: server.command,
        args: JSON.stringify(server.args ?? []),
        env: JSON.stringify(server.env ?? {}),
        source: server.source ?? "zeus",
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run(),
  );
}

export function updateMcpServer(
  id: string,
  updates: {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
  },
): void {
  const sets: Partial<typeof mcpServers.$inferInsert> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.command !== undefined) sets.command = updates.command;
  if (updates.args !== undefined) sets.args = JSON.stringify(updates.args);
  if (updates.env !== undefined) sets.env = JSON.stringify(updates.env);
  if (updates.enabled !== undefined) sets.enabled = updates.enabled ? 1 : 0;
  if (Object.keys(sets).length === 0) return;

  sets.updatedAt = Date.now();

  use((db) =>
    db.update(mcpServers).set(sets).where(eq(mcpServers.id, id)).run(),
  );
}

export function deleteMcpServer(id: string): void {
  use((db) =>
    db.delete(mcpServers).where(eq(mcpServers.id, id)).run(),
  );
}

export function toggleMcpServer(id: string, enabled: boolean): void {
  use((db) =>
    db
      .update(mcpServers)
      .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
      .where(eq(mcpServers.id, id))
      .run(),
  );
}

// ─── MCP Profiles CRUD ───

export function getMcpProfiles() {
  return use((db) => {
    const profiles = db
      .select()
      .from(mcpProfiles)
      .orderBy(asc(mcpProfiles.name))
      .all();

    return profiles.map((p) => {
      const serverIds = db
        .select({ serverId: mcpProfileServers.serverId })
        .from(mcpProfileServers)
        .where(eq(mcpProfileServers.profileId, p.id))
        .all();
      const servers = serverIds
        .map((s) => {
          const srv = db
            .select()
            .from(mcpServers)
            .where(eq(mcpServers.id, s.serverId))
            .get();
          return srv ? mapMcpServerRow(srv) : null;
        })
        .filter((s): s is McpServerMapped => s !== null);
      return {
        id: p.id,
        name: p.name,
        description: p.description || "",
        isDefault: p.isDefault === 1,
        servers,
        createdAt: p.createdAt,
      };
    });
  });
}

export function getMcpProfile(id: string) {
  return use((db) => {
    const p = db
      .select()
      .from(mcpProfiles)
      .where(eq(mcpProfiles.id, id))
      .get();
    if (!p) return null;

    const serverIds = db
      .select({ serverId: mcpProfileServers.serverId })
      .from(mcpProfileServers)
      .where(eq(mcpProfileServers.profileId, p.id))
      .all();
    const servers = serverIds
      .map((s) => {
        const srv = db
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.id, s.serverId))
          .get();
        return srv ? mapMcpServerRow(srv) : null;
      })
      .filter((s): s is McpServerMapped => s !== null);
    return {
      id: p.id,
      name: p.name,
      description: p.description || "",
      isDefault: p.isDefault === 1,
      servers,
      createdAt: p.createdAt,
    };
  });
}

export function insertMcpProfile(profile: {
  id: string;
  name: string;
  description?: string;
  serverIds: string[];
}): void {
  transaction((tx) => {
    const now = Date.now();
    tx.insert(mcpProfiles)
      .values({
        id: profile.id,
        name: profile.name,
        description: profile.description ?? "",
        isDefault: 0,
        createdAt: now,
      })
      .run();

    for (const sid of profile.serverIds) {
      tx.insert(mcpProfileServers)
        .values({ profileId: profile.id, serverId: sid })
        .run();
    }
  });
}

export function updateMcpProfile(
  id: string,
  updates: {
    name?: string;
    description?: string;
    serverIds?: string[];
  },
): void {
  transaction((tx) => {
    if (updates.name !== undefined) {
      tx.update(mcpProfiles)
        .set({ name: updates.name })
        .where(eq(mcpProfiles.id, id))
        .run();
    }
    if (updates.description !== undefined) {
      tx.update(mcpProfiles)
        .set({ description: updates.description })
        .where(eq(mcpProfiles.id, id))
        .run();
    }
    if (updates.serverIds !== undefined) {
      tx.delete(mcpProfileServers)
        .where(eq(mcpProfileServers.profileId, id))
        .run();
      for (const sid of updates.serverIds) {
        tx.insert(mcpProfileServers)
          .values({ profileId: id, serverId: sid })
          .run();
      }
    }
  });
}

export function deleteMcpProfile(id: string): void {
  use((db) =>
    db.delete(mcpProfiles).where(eq(mcpProfiles.id, id)).run(),
  );
}

export function setDefaultMcpProfile(id: string): void {
  transaction((tx) => {
    tx.update(mcpProfiles).set({ isDefault: 0 }).run();
    tx.update(mcpProfiles)
      .set({ isDefault: 1 })
      .where(eq(mcpProfiles.id, id))
      .run();
  });
}

// ─── Session MCPs ───

export function attachSessionMcps(
  sessionId: string,
  serverIds: string[],
): void {
  const now = Date.now();
  use((db) => {
    for (const sid of serverIds) {
      db.insert(sessionMcps)
        .values({
          sessionId,
          serverId: sid,
          status: "attached",
          attachedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

export function updateSessionMcpStatus(
  sessionId: string,
  serverId: string,
  status: string,
): void {
  use((db) =>
    db
      .update(sessionMcps)
      .set({ status })
      .where(
        eq(sessionMcps.sessionId, sessionId),
      )
      .run(),
  );
}

export function getSessionMcps(sessionId: string) {
  // Use raw SQL for the JOIN query which is more readable this way
  const sqlite = getRawSqlite();
  const rows = sqlite
    .prepare(
      `
    SELECT sm.session_id, sm.server_id, sm.status, sm.attached_at,
           ms.name, ms.command, ms.args, ms.env
    FROM session_mcps sm
    JOIN mcp_servers ms ON ms.id = sm.server_id
    WHERE sm.session_id = ?
    ORDER BY sm.attached_at
  `,
    )
    .all(sessionId) as Array<{
    session_id: string;
    server_id: string;
    status: string;
    attached_at: number;
    name: string;
    command: string;
    args: string;
    env: string;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    serverId: r.server_id,
    serverName: r.name,
    command: r.command,
    args: JSON.parse(r.args || "[]") as string[],
    env: JSON.parse(r.env || "{}") as Record<string, string>,
    status: r.status as "attached" | "active" | "failed",
    attachedAt: r.attached_at,
  }));
}
