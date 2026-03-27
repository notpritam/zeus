import z from "zod";
import { BusEvent } from "../event";

export const PermissionEvents = {
  RulesUpdated: BusEvent.define("permission.rules_updated", z.object({ projectId: z.string(), rules: z.unknown() })),
  TemplateList: BusEvent.define("permission.template_list", z.object({ templates: z.unknown() })),
  AuditLog: BusEvent.define("permission.audit_log", z.object({
    sessionId: z.string(), entries: z.unknown(), total: z.number(),
  })),
  Error: BusEvent.define("permission.error", z.object({ message: z.string() })),
};
