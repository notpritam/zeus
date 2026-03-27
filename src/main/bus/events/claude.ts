import z from "zod";
import { BusEvent } from "../event";

export const ClaudeEvents = {
  EntryAdded: BusEvent.define("claude.entry.added", z.object({
    sessionId: z.string(),
    entry: z.unknown(),
  })),
  SessionStarted: BusEvent.define("claude.session.started", z.object({
    sessionId: z.string(),
    info: z.unknown(),
  })),
  SessionActivity: BusEvent.define("claude.session.activity", z.object({
    sessionId: z.string(),
    activity: z.unknown(),
  })),
  ApprovalNeeded: BusEvent.define("claude.approval.needed", z.object({
    sessionId: z.string(),
    approvalId: z.string(),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
    toolUseId: z.string().optional(),
  })),
  ApprovalResolved: BusEvent.define("claude.approval.resolved", z.object({
    sessionId: z.string(),
    approvalId: z.string(),
  })),
  ClaudeSessionId: BusEvent.define("claude.session.claude_id", z.object({
    sessionId: z.string(),
    claudeSessionId: z.string(),
  })),
  TurnComplete: BusEvent.define("claude.turn.complete", z.object({
    sessionId: z.string(),
    result: z.unknown(),
  })),
  Done: BusEvent.define("claude.done", z.object({
    sessionId: z.string(),
  })),
  Error: BusEvent.define("claude.error", z.object({
    sessionId: z.string(),
    message: z.string(),
  })),
  QueueUpdated: BusEvent.define("claude.queue.updated", z.object({
    sessionId: z.string(),
    queue: z.array(z.object({ id: z.string(), content: z.string() })),
  })),
  QueueDrained: BusEvent.define("claude.queue.drained", z.object({
    sessionId: z.string(),
    msgId: z.string(),
  })),
  SessionList: BusEvent.define("claude.session.list", z.object({
    sessions: z.unknown(),
  })),
  SessionUpdated: BusEvent.define("claude.session.updated", z.object({
    sessionId: z.string(),
    info: z.unknown(),
  })),
  SessionDeleted: BusEvent.define("claude.session.deleted", z.object({
    deletedId: z.string(),
  })),
  SessionRestored: BusEvent.define("claude.session.restored", z.object({
    sessionId: z.string(),
  })),
  SessionArchived: BusEvent.define("claude.session.archived", z.object({
    archivedId: z.string(),
  })),
  PermissionAutoResolved: BusEvent.define("claude.permission.auto_resolved", z.object({
    sessionId: z.string(),
    toolName: z.string(),
    pattern: z.string(),
    action: z.string(),
  })),
  EntriesPaginated: BusEvent.define("claude.entries.paginated", z.object({
    sessionId: z.string(),
    entries: z.unknown(),
    oldestSeq: z.number().nullable(),
    totalCount: z.number(),
    hasMore: z.boolean(),
  })),
  HistoryCleared: BusEvent.define("claude.history.cleared", z.object({
    sessionId: z.string(),
  })),
  DeletedSessionsList: BusEvent.define("claude.deleted_sessions.list", z.object({
    sessions: z.unknown(),
  })),
};
