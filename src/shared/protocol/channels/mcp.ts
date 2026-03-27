import z from "zod";

// ─── Client → Server ───

export const McpGetServers = z.object({
  type: z.literal("get_servers"),
});

export const McpAddServer = z.object({
  type: z.literal("add_server"),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpUpdateServer = z.object({
  type: z.literal("update_server"),
  id: z.string(),
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpRemoveServer = z.object({
  type: z.literal("remove_server"),
  id: z.string(),
});

export const McpToggleServer = z.object({
  type: z.literal("toggle_server"),
  id: z.string(),
  enabled: z.boolean(),
});

export const McpHealthCheck = z.object({
  type: z.literal("health_check"),
  id: z.string().optional(),
});

export const McpImportClaude = z.object({
  type: z.literal("import_claude"),
});

export const McpGetProfiles = z.object({
  type: z.literal("get_profiles"),
});

export const McpCreateProfile = z.object({
  type: z.literal("create_profile"),
  name: z.string(),
  description: z.string().optional(),
  serverIds: z.array(z.string()).optional(),
});

export const McpUpdateProfile = z.object({
  type: z.literal("update_profile"),
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  serverIds: z.array(z.string()).optional(),
});

export const McpDeleteProfile = z.object({
  type: z.literal("delete_profile"),
  id: z.string(),
});

export const McpSetDefaultProfile = z.object({
  type: z.literal("set_default_profile"),
  id: z.string(),
});

export const McpGetSessionMcps = z.object({
  type: z.literal("get_session_mcps"),
  sessionId: z.string(),
});

export const McpIncoming = z.discriminatedUnion("type", [
  McpGetServers,
  McpAddServer,
  McpUpdateServer,
  McpRemoveServer,
  McpToggleServer,
  McpHealthCheck,
  McpImportClaude,
  McpGetProfiles,
  McpCreateProfile,
  McpUpdateProfile,
  McpDeleteProfile,
  McpSetDefaultProfile,
  McpGetSessionMcps,
]);
export type McpIncoming = z.infer<typeof McpIncoming>;

// ─── Server → Client ───

export const McpServersList = z.object({
  type: z.literal("servers_list"),
  servers: z.unknown(),
});

export const McpServerAdded = z.object({
  type: z.literal("server_added"),
  server: z.unknown(),
});

export const McpServerUpdated = z.object({
  type: z.literal("server_updated"),
  server: z.unknown(),
});

export const McpServerRemoved = z.object({
  type: z.literal("server_removed"),
  id: z.string(),
});

export const McpHealthResult = z.object({
  type: z.literal("health_result"),
  id: z.string(),
  healthy: z.boolean().optional(),
  error: z.string().optional(),
});

export const McpHealthResults = z.object({
  type: z.literal("health_results"),
  results: z.unknown(),
});

export const McpImportResult = z.object({
  type: z.literal("import_result"),
  imported: z.number().optional(),
  skipped: z.number().optional(),
  errors: z.unknown().optional(),
});

export const McpProfilesList = z.object({
  type: z.literal("profiles_list"),
  profiles: z.unknown(),
});

export const McpProfileCreated = z.object({
  type: z.literal("profile_created"),
  profile: z.unknown(),
});

export const McpProfileUpdated = z.object({
  type: z.literal("profile_updated"),
  profile: z.unknown(),
});

export const McpProfileDeleted = z.object({
  type: z.literal("profile_deleted"),
  id: z.string(),
});

export const McpSessionMcps = z.object({
  type: z.literal("session_mcps"),
  sessionId: z.string(),
  mcps: z.unknown(),
});

export const McpError = z.object({
  type: z.literal("mcp_error"),
  message: z.string(),
});

export const McpOutgoing = z.discriminatedUnion("type", [
  McpServersList,
  McpServerAdded,
  McpServerUpdated,
  McpServerRemoved,
  McpHealthResult,
  McpHealthResults,
  McpImportResult,
  McpProfilesList,
  McpProfileCreated,
  McpProfileUpdated,
  McpProfileDeleted,
  McpSessionMcps,
  McpError,
]);
export type McpOutgoing = z.infer<typeof McpOutgoing>;
