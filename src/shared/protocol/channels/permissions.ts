import z from "zod";

// ─── Client → Server ───

export const PermissionsGetRules = z.object({
  type: z.literal("get_rules"),
  projectId: z.string(),
});

export const PermissionsSetRules = z.object({
  type: z.literal("set_rules"),
  projectId: z.string(),
  rules: z.unknown(),
});

export const PermissionsApplyTemplate = z.object({
  type: z.literal("apply_template"),
  projectId: z.string(),
  templateId: z.string(),
});

export const PermissionsGetTemplates = z.object({
  type: z.literal("get_templates"),
});

export const PermissionsGetAuditLog = z.object({
  type: z.literal("get_audit_log"),
  sessionId: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export const PermissionsClearRules = z.object({
  type: z.literal("clear_rules"),
  projectId: z.string(),
});

export const PermissionsIncoming = z.discriminatedUnion("type", [
  PermissionsGetRules,
  PermissionsSetRules,
  PermissionsApplyTemplate,
  PermissionsGetTemplates,
  PermissionsGetAuditLog,
  PermissionsClearRules,
]);
export type PermissionsIncoming = z.infer<typeof PermissionsIncoming>;

// ─── Server → Client ───

export const PermissionsRulesUpdated = z.object({
  type: z.literal("rules_updated"),
  projectId: z.string(),
  rules: z.unknown(),
});

export const PermissionsTemplatesList = z.object({
  type: z.literal("templates_list"),
  templates: z.unknown(),
});

export const PermissionsAuditLog = z.object({
  type: z.literal("audit_log"),
  sessionId: z.string().optional(),
  entries: z.unknown(),
  total: z.number(),
});

export const PermissionsError = z.object({
  type: z.literal("permissions_error"),
  message: z.string(),
});

export const PermissionsOutgoing = z.discriminatedUnion("type", [
  PermissionsRulesUpdated,
  PermissionsTemplatesList,
  PermissionsAuditLog,
  PermissionsError,
]);
export type PermissionsOutgoing = z.infer<typeof PermissionsOutgoing>;
