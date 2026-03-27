import z from "zod";
import { BusEvent } from "../event";

export const SystemEvents = {
  StatusUpdate: BusEvent.define("system.status_update", z.object({
    powerBlock: z.boolean(),
    websocket: z.boolean(),
    tunnel: z.string().nullable(),
  })),
  Error: BusEvent.define("system.error", z.object({
    sessionId: z.string(),
    message: z.string(),
  })),
  Pong: BusEvent.define("system.pong", z.object({})),
  SessionUpdated: BusEvent.define("system.session_updated", z.object({
    sessionId: z.string(),
    session: z.unknown(),
  })),
  SessionStarted: BusEvent.define("system.session_started", z.object({
    sessionId: z.string(),
    shell: z.string(),
    correlationId: z.string().optional(),
  })),
  SessionList: BusEvent.define("system.session_list", z.object({
    sessions: z.unknown(),
  })),
  TerminalSessionDeleted: BusEvent.define("system.terminal_session.deleted", z.object({
    deletedId: z.string(),
  })),
  TerminalSessionRestored: BusEvent.define("system.terminal_session.restored", z.object({
    sessionId: z.string(),
  })),
  TerminalSessionArchived: BusEvent.define("system.terminal_session.archived", z.object({
    archivedId: z.string(),
  })),
};
