# MCP Playground — Design Spec

## Overview

Add an inspection-focused MCP Playground to Zeus: a top-level view that lets users browse every MCP server's exposed tools, input schemas, and server metadata. Tool discovery results are cached in SQLite for fast subsequent loads, with on-demand refresh.

## Motivation

Currently Zeus can register, health-check, enable/disable, and attach MCP servers to Claude sessions — but users never see **what tools a server exposes**. The health check sends a JSON-RPC `initialize` but never calls `tools/list`. This makes it impossible to know what capabilities are available without reading each server's source code.

## Architecture

**Approach:** Master-detail single-page explorer as a new top-level view.

- Left panel: server list with discover actions
- Right panel: selected server's metadata + expandable tool list with input schemas
- Discovery results cached in SQLite, refreshed on demand

## Data Model

### Prerequisite: Enable Foreign Key Enforcement

The existing codebase never enables `PRAGMA foreign_keys`. This means all existing `ON DELETE CASCADE` clauses (on `mcp_profile_servers`, `session_mcps`) are silently not enforced. The migration must add `db.pragma('foreign_keys = ON')` in `initDatabase()` before running migrations. This fixes both the new tables and the pre-existing orphan issue.

### New Table: `mcp_tool_cache`

```sql
CREATE TABLE mcp_tool_cache (
  server_id     TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  input_schema  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (server_id, tool_name)
);
```

Uses a composite primary key `(server_id, tool_name)` — no surrogate `id` needed for a cache table.

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

**Cascade behavior:** When an MCP server is removed via Settings, both `mcp_tool_cache` and `mcp_server_metadata` rows for that server are automatically deleted (enforced by `PRAGMA foreign_keys = ON`).

**Refresh strategy:** Discovering a server deletes its existing cache rows and reinserts fresh data, all within a single `db.transaction()`.

### New Shared Types

```typescript
// In src/shared/types.ts

interface McpToolEntry {
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

### McpPayload Union Additions

Add the following variants to the existing `McpPayload` discriminated union in `src/shared/types.ts`:

```typescript
// New request variants
| { type: 'discover_server'; serverId: string }
| { type: 'discover_all' }
| { type: 'get_cached_tools'; serverId?: string }

// New response variants
| { type: 'discovery_result'; serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[] }
| { type: 'discovery_all_result'; results: Array<{ serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[]; error?: string }> }
| { type: 'cached_tools'; servers: Array<{ serverId: string; serverName: string; metadata?: McpServerMetadata; tools: McpToolEntry[] }> }
```

The existing `mcp_error` response type (with optional `serverId`) is reused for discovery failures.

## Discovery Service

New functions added to `mcp-registry.ts`:

### JSON-RPC Stdio Transport

Discovery communicates with MCP servers over stdio using newline-delimited JSON. A `JsonRpcStdioReader` utility is needed to handle:
- Buffering incoming `data` events (chunks may not align to message boundaries)
- Splitting on `\n` to extract complete lines
- Parsing each line as JSON and matching on `id` field for request/response correlation

This utility is reusable for future interactive mode.

### `discoverServerTools(serverId: string): Promise<{ metadata: McpServerMetadata; tools: McpToolEntry[] }>`

1. Look up server config from DB (command, args, env)
2. Spawn the MCP server process with `stdio: ['pipe', 'pipe', 'pipe']`
3. Send JSON-RPC `initialize` request (protocol version `2024-11-05`)
4. Read `initialize` response → extract `serverInfo` and `capabilities`
5. Send JSON-RPC `notifications/initialized` notification (no `id` field — required by MCP protocol before further requests)
6. Send JSON-RPC `tools/list` request
7. Read response → array of `{ name, description, inputSchema }`
8. Kill the spawned process
9. **In a single `db.transaction()`:**
   - Delete existing `mcp_tool_cache` rows for this server
   - Delete existing `mcp_server_metadata` row for this server
   - Insert fresh metadata row
   - Insert fresh tool rows
10. Return `{ metadata, tools }`

**Works on both enabled and disabled servers** — the goal is inspection, not session attachment.

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

Extend the existing `mcp` channel with new payload types (as defined in the McpPayload Union Additions above).

### New Request Types

| Type | Payload | Description |
|------|---------|-------------|
| `discover_server` | `{ serverId: string }` | Spawn, discover, cache, return tools + metadata for one server |
| `discover_all` | `{}` | Bulk discovery on all enabled servers |
| `get_cached_tools` | `{ serverId?: string }` | Read from cache (no spawning) |

### New Response Types

| Type | Payload | Description |
|------|---------|-------------|
| `discovery_result` | `{ serverId, metadata, tools }` | Single server discovery result |
| `discovery_all_result` | `{ results: Array<{ serverId, metadata, tools, error? }> }` | Bulk discovery results |
| `cached_tools` | `{ servers: Array<{ serverId, serverName, metadata?, tools }> }` | Cached data from DB |

**Error handling:** `discover_server` failures respond with the existing `mcp_error` type including `serverId`, so the frontend can show per-server error state and clear the loading spinner.

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

**Error handling:** The `mcp_error` handler (when `serverId` is present) must set `mcpDiscovering[serverId] = false` to clear the loading spinner on failure. The `discovery_result` and `discovery_all_result` handlers also clear discovering state on success.

### Navigation

Add `'mcp-playground'` to the `ViewMode` union type (currently `'terminal' | 'claude' | 'diff' | 'settings' | 'new-session' | 'room'`). Add a new branch in `App.tsx`'s conditional rendering to render `McpPlaygroundView`. Add a sidebar entry with an icon to navigate to this view mode. This follows the same pattern as `'room'`, `'settings'`, and `'new-session'`.

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

1. Add `PRAGMA foreign_keys = ON` to `initDatabase()` (before migrations run)
2. Create `mcp_tool_cache` table with composite PK `(server_id, tool_name)`
3. Create `mcp_server_metadata` table with PK `server_id`

## Testing

- Validator tests for `McpToolEntry` and `McpServerMetadata` types
- DB CRUD tests: insert, read, cascade delete for both new tables
- Verify `PRAGMA foreign_keys = ON` is active and cascades work
- Discovery service: mock process spawning, verify JSON-RPC request/response parsing including `notifications/initialized` step
- WebSocket: verify new payload types route correctly
- Zustand: verify `mcpDiscovering` resets on both success and error

## Future Extensions

This design intentionally supports future growth:

- **Interactive mode:** Add an "Execute" button per tool in `McpToolAccordion` → renders a form from `inputSchema` → sends the tool call → shows JSON response
- **Live mode:** Show tool calls happening in real-time during active Claude sessions
- **Resource/prompt inspection:** The `capabilities` field already captures whether a server supports resources/prompts — future tabs can discover those too
- **Combined health+discovery:** Extend health check to optionally call `tools/list` too, avoiding spawning the same server twice
