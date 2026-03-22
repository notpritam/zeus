# MCP Playground — Design Spec

## Overview

Add an inspection-focused MCP Playground to Zeus: a top-level view that lets users browse every MCP server's exposed tools, input schemas, and server metadata. Tool discovery results are cached in SQLite for fast subsequent loads, with on-demand refresh.

## Motivation

Currently Zeus can register, health-check, enable/disable, and attach MCP servers to Claude sessions — but users never see **what tools a server exposes**. The health check sends a JSON-RPC `initialize` but never calls `tools/list`. This makes it impossible to know what capabilities are available without reading each server's source code.

## Architecture

**Approach:** Master-detail single-page explorer as a new top-level view (`/mcp-playground`).

- Left panel: server list with discover actions
- Right panel: selected server's metadata + expandable tool list with input schemas
- Discovery results cached in SQLite, refreshed on demand

## Data Model

### New Table: `mcp_tool_cache`

```sql
CREATE TABLE mcp_tool_cache (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  input_schema  TEXT NOT NULL DEFAULT '{}',
  UNIQUE(server_id, tool_name)
);
```

### New Table: `mcp_server_metadata`

```sql
CREATE TABLE mcp_server_metadata (
  server_id         TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  protocol_version  TEXT NOT NULL DEFAULT '',
  server_name       TEXT NOT NULL DEFAULT '',
  server_version    TEXT NOT NULL DEFAULT '',
  capabilities      TEXT NOT NULL DEFAULT '{}',
  discovered_at     TEXT NOT NULL
);
```

**Cascade behavior:** When an MCP server is removed via Settings, both `mcp_tool_cache` and `mcp_server_metadata` rows for that server are automatically deleted.

**Refresh strategy:** Discovering a server deletes its existing cache rows and reinserts fresh data.

### New Shared Types

```typescript
// In src/shared/types.ts

interface McpToolEntry {
  id: string;
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

interface McpServerMetadata {
  serverId: string;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: Record<string, unknown>;
  discoveredAt: string; // ISO 8601
}
```

## Discovery Service

New functions added to `mcp-registry.ts`:

### `discoverServerTools(serverId: string): Promise<{ metadata: McpServerMetadata; tools: McpToolEntry[] }>`

1. Look up server config from DB (command, args, env)
2. Spawn the MCP server process with stdio piping
3. Send JSON-RPC `initialize` request (protocol version `2024-11-05`)
4. Read `initialize` response → extract `serverInfo` and `capabilities`
5. Send JSON-RPC `tools/list` request
6. Read response → array of `{ name, description, inputSchema }`
7. Kill the spawned process
8. Delete existing `mcp_tool_cache` rows for this server
9. Delete existing `mcp_server_metadata` row for this server
10. Insert fresh metadata + tool rows
11. Return `{ metadata, tools }`

### `discoverAllServerTools(): Promise<Array<{ serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[]; error?: string }>>`

- Runs `discoverServerTools()` on all **enabled** servers in parallel via `Promise.allSettled`
- One failing server does not block others
- Returns results array with per-server error field for failures

### `getCachedTools(serverId?: string): { servers: Array<{ serverId, serverName, metadata?, tools }> }`

- Reads from `mcp_tool_cache` and `mcp_server_metadata` tables (no process spawning)
- If `serverId` provided, returns tools for that server only
- Otherwise returns all cached tools grouped by server

**Timeout:** 10 seconds per server discovery (longer than the 5s health check since `tools/list` may return large payloads).

## WebSocket Channel

Extend the existing `mcp` channel with new payload types:

### New Request Types

| Type | Payload | Description |
|------|---------|-------------|
| `discover_server` | `{ serverId: string }` | Spawn, discover, cache, return tools + metadata for one server |
| `discover_all` | `{}` | Bulk discovery on all enabled servers |
| `get_cached_tools` | `{ serverId?: string }` | Read from cache (no spawning) |

### New Response Types

| Type | Payload | Description |
|------|---------|-------------|
| `discovery_result` | `{ serverId, metadata: McpServerMetadata, tools: McpToolEntry[] }` | Single server discovery result |
| `discovery_all_result` | `{ results: Array<{ serverId, metadata, tools, error? }> }` | Bulk discovery results |
| `cached_tools` | `{ servers: Array<{ serverId, serverName, metadata?, tools }> }` | Cached data from DB |

### Usage Pattern

- **On Playground load:** send `get_cached_tools` → fast DB read, populate UI immediately
- **User clicks "Discover All":** send `discover_all` → slow (spawns processes), updates cache + UI on response
- **User clicks per-server "Refresh":** send `discover_server` → spawns one process, updates that server's cache + UI

## Frontend

### Zustand Store Additions

```typescript
// New state
mcpToolCache: Record<string, McpToolEntry[]>;       // keyed by serverId
mcpServerMetadata: Record<string, McpServerMetadata>; // keyed by serverId
mcpDiscovering: Record<string, boolean>;              // loading state per server

// New actions
fetchCachedTools(): void;              // sends get_cached_tools
discoverServer(serverId: string): void; // sends discover_server, sets discovering=true
discoverAllServers(): void;             // sends discover_all, sets all discovering=true
```

### New Route

`/mcp-playground` — accessible from sidebar with a new icon.

### Component Breakdown

#### McpPlaygroundView
- Top-level layout component
- Calls `fetchCachedTools()` on mount
- Master-detail split: `McpServerList` (left) + `McpServerDetail` (right)

#### McpServerList
- Lists all registered MCP servers (enabled and disabled)
- Each row shows: server name, source badge (zeus/claude), enabled/disabled status, tool count from cache, last discovered timestamp
- "Discover All" button at top with progress indicator
- Per-server "Refresh" icon button
- Spinner on servers currently being discovered (`mcpDiscovering[serverId]`)
- Click server to select → populates right panel
- Disabled servers shown grayed out (discoverable but marked)

#### McpServerDetail
- Displayed when a server is selected
- **Empty state:** "Click Refresh to discover this server's tools"
- **Header:** `McpMetadataCard` with server-level info
- **Body:** `McpToolAccordion` with expandable tool list

#### McpMetadataCard
- Server name + version (from `serverInfo`)
- Protocol version
- Capabilities rendered as tags (e.g., "tools", "resources", "prompts")
- Last discovered timestamp (relative, e.g., "2 hours ago")

#### McpToolAccordion
- List of tools, each expandable
- **Collapsed:** tool name + truncated first line of description
- **Expanded:** full description + `McpToolSchemaView` for input schema

#### McpToolSchemaView
- Renders a JSON Schema `inputSchema` as a readable property table
- Columns: property name, type, required (yes/no), description
- Handles nested objects by indentation
- Shows default values where defined

## Migration

**Schema version:** v15

Adds `mcp_tool_cache` and `mcp_server_metadata` tables as defined in the Data Model section.

## Testing

- Validator tests for `McpToolEntry` and `McpServerMetadata` types
- DB CRUD tests: insert, read, cascade delete for both new tables
- Discovery service: mock process spawning, verify JSON-RPC request/response parsing
- WebSocket: verify new payload types route correctly

## Future Extensions

This design intentionally supports future growth:

- **Interactive mode:** Add an "Execute" button per tool in `McpToolAccordion` → renders a form from `inputSchema` → sends the tool call → shows JSON response
- **Live mode:** Show tool calls happening in real-time during active Claude sessions
- **Resource/prompt inspection:** The `capabilities` field already captures whether a server supports resources/prompts — future tabs can discover those too
