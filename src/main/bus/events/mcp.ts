import z from "zod";
import { BusEvent } from "../event";

export const McpEvents = {
  ServerList: BusEvent.define("mcp.server_list", z.object({ servers: z.unknown() })),
  ServerAdded: BusEvent.define("mcp.server_added", z.object({ server: z.unknown() })),
  ServerUpdated: BusEvent.define("mcp.server_updated", z.object({ server: z.unknown() })),
  ServerRemoved: BusEvent.define("mcp.server_removed", z.object({ id: z.string() })),
  HealthResult: BusEvent.define("mcp.health_result", z.object({ results: z.unknown() })),
  ProfileList: BusEvent.define("mcp.profile_list", z.object({ profiles: z.unknown() })),
  ProfileAdded: BusEvent.define("mcp.profile_added", z.object({ profile: z.unknown() })),
  ProfileUpdated: BusEvent.define("mcp.profile_updated", z.object({ profile: z.unknown() })),
  ProfileRemoved: BusEvent.define("mcp.profile_removed", z.object({ id: z.string() })),
  SessionMcpList: BusEvent.define("mcp.session_mcp_list", z.object({ sessionId: z.string(), mcps: z.unknown() })),
  ImportResult: BusEvent.define("mcp.import_result", z.object({ imported: z.array(z.string()), skipped: z.array(z.string()) })),
  Error: BusEvent.define("mcp.error", z.object({ message: z.string() })),
};
