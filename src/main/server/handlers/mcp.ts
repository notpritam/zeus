import type { HandlerContext } from "../router";
import type { McpPayload } from "../../../shared/types";
import * as mcpRegistry from "../../services/mcp-registry";
import { Log } from "../../log/log";

const log = Log.create({ service: "handler:mcp" });

export async function handleMcp(ctx: HandlerContext): Promise<void> {
  const { envelope } = ctx;
  const payload = envelope.payload as McpPayload;

  const sendMcp = (p: McpPayload): void =>
    ctx.send({
      channel: "mcp",
      sessionId: envelope.sessionId,
      payload: p,
      auth: "",
    });

  const broadcastMcp = (p: McpPayload): void =>
    ctx.broadcast({
      channel: "mcp",
      sessionId: envelope.sessionId,
      payload: p,
      auth: "",
    });

  try {
    switch (payload.type) {
      case "get_servers": {
        const servers = mcpRegistry.listServers();
        sendMcp({ type: "servers_list", servers });
        break;
      }
      case "add_server": {
        const server = mcpRegistry.addServer({
          name: payload.name,
          command: payload.command,
          args: payload.args,
          env: payload.env,
        });
        if (server) broadcastMcp({ type: "server_added", server });
        break;
      }
      case "update_server": {
        const { id, ...updates } = payload;
        const server = mcpRegistry.updateServer(id, updates);
        if (server) broadcastMcp({ type: "server_updated", server });
        break;
      }
      case "remove_server": {
        mcpRegistry.removeServer(payload.id);
        broadcastMcp({ type: "server_removed", id: payload.id });
        break;
      }
      case "toggle_server": {
        const server = mcpRegistry.toggleServer(payload.id, payload.enabled);
        if (server) broadcastMcp({ type: "server_updated", server });
        break;
      }
      case "health_check": {
        if (payload.id) {
          const result = await mcpRegistry.checkServerHealth(payload.id);
          sendMcp({ type: "health_result", id: payload.id, ...result });
        } else {
          const results = await mcpRegistry.checkAllHealth();
          sendMcp({ type: "health_results", results });
        }
        break;
      }
      case "import_claude": {
        const result = mcpRegistry.importFromClaude();
        broadcastMcp({ type: "import_result", ...result });
        // Also send updated server list
        const servers = mcpRegistry.listServers();
        broadcastMcp({ type: "servers_list", servers });
        break;
      }
      case "get_profiles": {
        const profiles = mcpRegistry.listProfiles();
        sendMcp({ type: "profiles_list", profiles });
        break;
      }
      case "create_profile": {
        const profile = mcpRegistry.createProfile({
          name: payload.name,
          description: payload.description,
          serverIds: payload.serverIds,
        });
        if (profile) broadcastMcp({ type: "profile_created", profile });
        break;
      }
      case "update_profile": {
        const { id, ...updates } = payload;
        const profile = mcpRegistry.updateProfile(id, updates);
        if (profile) broadcastMcp({ type: "profile_updated", profile });
        break;
      }
      case "delete_profile": {
        mcpRegistry.removeProfile(payload.id);
        broadcastMcp({ type: "profile_deleted", id: payload.id });
        break;
      }
      case "set_default_profile": {
        mcpRegistry.setDefault(payload.id);
        // Re-send full profiles list so all clients see updated default
        const profiles = mcpRegistry.listProfiles();
        broadcastMcp({ type: "profiles_list", profiles });
        break;
      }
      case "get_session_mcps": {
        const mcps = mcpRegistry.getSessionMcps(payload.sessionId);
        sendMcp({ type: "session_mcps", sessionId: payload.sessionId, mcps });
        break;
      }
    }
  } catch (err) {
    sendMcp({ type: "mcp_error", message: (err as Error).message });
  }
}
