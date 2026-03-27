import crypto from "crypto";
import { eq, desc, lt, sql } from "drizzle-orm";
import { use } from "../transaction";
import { getRawSqlite } from "../client";
import {
  permissionRules,
  permissionAuditLog,
} from "../schema/permission-rules.sql";
import type { PermissionRule } from "../../../shared/permission-types";

// ─── Permission Rules ───

export function getPermissionRules(projectId: string): PermissionRule[] {
  const row = use((db) =>
    db
      .select({ rules: permissionRules.rules })
      .from(permissionRules)
      .where(eq(permissionRules.projectId, projectId))
      .orderBy(desc(permissionRules.updatedAt))
      .limit(1)
      .get(),
  );
  if (!row) return [];
  try {
    return JSON.parse(row.rules);
  } catch {
    return [];
  }
}

export function setPermissionRules(
  projectId: string,
  rules: PermissionRule[],
  name = "Custom",
  isTemplate = false,
): void {
  use((db) => {
    const existing = db
      .select({ id: permissionRules.id })
      .from(permissionRules)
      .where(eq(permissionRules.projectId, projectId))
      .limit(1)
      .get();

    const now = Date.now();
    if (existing) {
      db.update(permissionRules)
        .set({
          rules: JSON.stringify(rules),
          name,
          isTemplate: isTemplate ? 1 : 0,
          updatedAt: now,
        })
        .where(eq(permissionRules.id, existing.id))
        .run();
    } else {
      const id = crypto.randomUUID();
      db.insert(permissionRules)
        .values({
          id,
          projectId,
          name,
          rules: JSON.stringify(rules),
          isTemplate: isTemplate ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  });
}

export function clearPermissionRules(projectId: string): void {
  use((db) =>
    db
      .delete(permissionRules)
      .where(eq(permissionRules.projectId, projectId))
      .run(),
  );
}

// ─── Permission Audit Log ───

export function insertAuditEntry(entry: {
  id: string;
  sessionId: string;
  projectId: string | null;
  toolName: string;
  pattern: string;
  action: string;
  ruleMatched: string | null;
  timestamp: number;
}): void {
  use((db) =>
    db
      .insert(permissionAuditLog)
      .values({
        id: entry.id,
        sessionId: entry.sessionId,
        projectId: entry.projectId,
        toolName: entry.toolName,
        pattern: entry.pattern,
        action: entry.action,
        ruleMatched: entry.ruleMatched,
        timestamp: entry.timestamp,
      })
      .run(),
  );
}

export function getAuditLog(
  sessionId: string,
  limit = 100,
  offset = 0,
): { entries: Record<string, unknown>[]; total: number } {
  // Use raw SQL for OFFSET which Drizzle handles differently
  const sqlite = getRawSqlite();
  const total = (
    sqlite
      .prepare(
        "SELECT COUNT(*) as count FROM permission_audit_log WHERE session_id = ?",
      )
      .get(sessionId) as { count: number }
  ).count;
  const entries = sqlite
    .prepare(
      "SELECT * FROM permission_audit_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
    )
    .all(sessionId, limit, offset) as Record<string, unknown>[];
  return { entries, total };
}

export function pruneOldAuditLogs(maxAgeDays = 30): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  use((db) =>
    db
      .delete(permissionAuditLog)
      .where(lt(permissionAuditLog.timestamp, cutoff))
      .run(),
  );
}
