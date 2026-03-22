# MCP Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inspection-focused MCP Playground view that discovers and displays each MCP server's tools, input schemas, and metadata, with cached results in SQLite.

**Architecture:** New DB tables cache tool discovery results. A discovery service spawns MCP servers via stdio, sends JSON-RPC initialize + tools/list, and persists results. The frontend adds a new top-level ViewMode with master-detail layout showing servers on the left and tool details on the right.

**Tech Stack:** TypeScript, better-sqlite3, node-pty/child_process, React, Zustand, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-22-mcp-playground-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/shared/types.ts` | Add `McpToolEntry`, `McpServerMetadata` interfaces and new `McpPayload` variants |
| Modify | `src/main/services/db.ts` | Enable `PRAGMA foreign_keys`, migration v15, CRUD for new tables |
| Modify | `src/main/services/mcp-registry.ts` | Add `JsonRpcStdioReader`, `discoverServerTools()`, `discoverAllServerTools()`, `getCachedTools()` |
| Modify | `src/main/services/websocket.ts` | Add `discover_server`, `discover_all`, `get_cached_tools` cases to `handleMcp()` |
| Modify | `src/renderer/src/stores/useZeusStore.ts` | Add MCP playground state, actions, and response handlers |
| Create | `src/renderer/src/components/McpPlaygroundView.tsx` | Top-level playground layout (master-detail) |
| Modify | `src/renderer/src/App.tsx` | Add `'mcp-playground'` to ViewMode rendering |
| Modify | `src/renderer/src/components/SessionSidebar.tsx` | Add MCP Playground navigation entry |

---

### Task 1: Shared Types — McpToolEntry, McpServerMetadata, McpPayload additions

**Files:**
- Modify: `src/shared/types.ts:651-720`

- [ ] **Step 1: Add McpToolEntry and McpServerMetadata interfaces**

After the `McpHealthResult` interface (line 689), add:

```typescript
export interface McpToolEntry {
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerMetadata {
  serverId: string;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: Record<string, unknown>;
  discoveredAt: string;
}
```

- [ ] **Step 2: Add new McpPayload variants**

In the `McpPayload` union type (line 691-720), add these new request variants after line 705 (`get_session_mcps`):

```typescript
  | { type: 'discover_server'; serverId: string }
  | { type: 'discover_all' }
  | { type: 'get_cached_tools'; serverId?: string }
```

And these response variants after line 719 (`session_mcp_status`):

```typescript
  | { type: 'discovery_result'; serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[] }
  | { type: 'discovery_all_result'; results: Array<{ serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[] } | { serverId: string; error: string }> }
  | { type: 'cached_tools'; servers: Array<{ serverId: string; serverName: string; metadata?: McpServerMetadata; tools: McpToolEntry[] }> }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit --project src/shared/tsconfig.json 2>&1 | head -20`

If there's no shared tsconfig, run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to the new types.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(mcp-playground): add McpToolEntry, McpServerMetadata types and McpPayload variants"
```

---

### Task 2: Database — PRAGMA foreign_keys, migration v15, CRUD functions

**Files:**
- Modify: `src/main/services/db.ts:18,355-361` (SCHEMA_VERSION, initDatabase)
- Modify: `src/main/services/db.ts:348` (after migration v14, add v15)
- Modify: `src/main/services/db.ts:1324-1327` (near deleteMcpServer, add new CRUD)

- [ ] **Step 1: Enable PRAGMA foreign_keys in initDatabase**

In `initDatabase()` (line 355-361), add `db.pragma('foreign_keys = ON')` after the WAL pragma and before `runMigrations`:

```typescript
export function initDatabase(): void {
  const dbPath = zeusEnv.dbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  console.log(`[Zeus DB] Opened ${dbPath}`);
}
```

- [ ] **Step 2: Bump SCHEMA_VERSION to 15**

Change line 18 from `const SCHEMA_VERSION = 14;` to `const SCHEMA_VERSION = 15;`.

- [ ] **Step 3: Add migration v15**

After the `migrate14()` call (line 347) and before `database.pragma('user_version = ...')` (line 350), add:

```typescript
  if (currentVersion < 15) {
    const migrate15 = database.transaction(() => {
      // Clean up orphaned rows from before FK enforcement
      database.exec(`
        DELETE FROM mcp_profile_servers WHERE server_id NOT IN (SELECT id FROM mcp_servers);
        DELETE FROM mcp_profile_servers WHERE profile_id NOT IN (SELECT id FROM mcp_profiles);
        DELETE FROM session_mcps WHERE server_id NOT IN (SELECT id FROM mcp_servers);
      `);

      database.exec(`
        CREATE TABLE IF NOT EXISTS mcp_tool_cache (
          server_id     TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
          tool_name     TEXT NOT NULL,
          description   TEXT NOT NULL DEFAULT '',
          input_schema  TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (server_id, tool_name)
        );

        CREATE TABLE IF NOT EXISTS mcp_server_metadata (
          server_id         TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
          protocol_version  TEXT NOT NULL DEFAULT '',
          server_name       TEXT NOT NULL DEFAULT '',
          server_version    TEXT NOT NULL DEFAULT '',
          capabilities      TEXT NOT NULL DEFAULT '{}',
          discovered_at     TEXT NOT NULL
        );
      `);
    });
    migrate15();
  }
```

- [ ] **Step 4: Add CRUD functions for mcp_tool_cache and mcp_server_metadata**

After the `deleteMcpServer` function (line 1327), add:

```typescript
// ─── MCP Tool Cache & Metadata CRUD ───

export function saveMcpDiscovery(
  serverId: string,
  metadata: { protocolVersion: string; serverName: string; serverVersion: string; capabilities: Record<string, unknown> },
  tools: Array<{ toolName: string; description: string; inputSchema: Record<string, unknown> }>,
): void {
  if (!db) return;
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    // Upsert metadata
    db!.prepare(`
      INSERT OR REPLACE INTO mcp_server_metadata
        (server_id, protocol_version, server_name, server_version, capabilities, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(serverId, metadata.protocolVersion, metadata.serverName, metadata.serverVersion, JSON.stringify(metadata.capabilities), now);
    // Replace tool cache
    db!.prepare(`DELETE FROM mcp_tool_cache WHERE server_id = ?`).run(serverId);
    const insertStmt = db!.prepare(`
      INSERT INTO mcp_tool_cache (server_id, tool_name, description, input_schema)
      VALUES (?, ?, ?, ?)
    `);
    for (const tool of tools) {
      insertStmt.run(serverId, tool.toolName, tool.description, JSON.stringify(tool.inputSchema));
    }
  });
  tx();
}

export function getMcpCachedTools(serverId?: string): Array<{
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  if (!db) return [];
  const rows = serverId
    ? db.prepare(`SELECT server_id, tool_name, description, input_schema FROM mcp_tool_cache WHERE server_id = ?`).all(serverId) as Array<{ server_id: string; tool_name: string; description: string; input_schema: string }>
    : db.prepare(`SELECT server_id, tool_name, description, input_schema FROM mcp_tool_cache`).all() as Array<{ server_id: string; tool_name: string; description: string; input_schema: string }>;
  return rows.map((r) => ({
    serverId: r.server_id,
    toolName: r.tool_name,
    description: r.description,
    inputSchema: JSON.parse(r.input_schema),
  }));
}

export function getMcpServerMetadataById(serverId: string): {
  serverId: string;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: Record<string, unknown>;
  discoveredAt: string;
} | null {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM mcp_server_metadata WHERE server_id = ?`).get(serverId) as { server_id: string; protocol_version: string; server_name: string; server_version: string; capabilities: string; discovered_at: string } | undefined;
  if (!row) return null;
  return {
    serverId: row.server_id,
    protocolVersion: row.protocol_version,
    serverName: row.server_name,
    serverVersion: row.server_version,
    capabilities: JSON.parse(row.capabilities),
    discoveredAt: row.discovered_at,
  };
}

export function getAllMcpServerMetadata(): Array<{
  serverId: string;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: Record<string, unknown>;
  discoveredAt: string;
}> {
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM mcp_server_metadata`).all() as Array<{ server_id: string; protocol_version: string; server_name: string; server_version: string; capabilities: string; discovered_at: string }>;
  return rows.map((row) => ({
    serverId: row.server_id,
    protocolVersion: row.protocol_version,
    serverName: row.server_name,
    serverVersion: row.server_version,
    capabilities: JSON.parse(row.capabilities),
    discoveredAt: row.discovered_at,
  }));
}
```

- [ ] **Step 5: Add the new DB imports to mcp-registry.ts**

In `src/main/services/mcp-registry.ts` (line 11-28), add these new imports from `./db`:

```typescript
  saveMcpDiscovery,
  getMcpCachedTools,
  getMcpServerMetadataById,
  getAllMcpServerMetadata,
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/db.ts src/main/services/mcp-registry.ts
git commit -m "feat(mcp-playground): add migration v15, FK enforcement, tool cache CRUD"
```

---

### Task 3: Discovery Service — JsonRpcStdioReader + discoverServerTools

**Files:**
- Modify: `src/main/services/mcp-registry.ts:162-224` (after existing health check)

- [ ] **Step 1: Add JsonRpcStdioReader class**

After the existing imports (line 29) in `mcp-registry.ts`, add:

```typescript
import type { McpToolEntry, McpServerMetadata } from '../../shared/types';

/**
 * Buffers newline-delimited JSON from a stdio stream and resolves
 * individual JSON-RPC messages matched by their `id` field.
 */
class JsonRpcStdioReader {
  private buffer = '';
  private pending = new Map<number, { resolve: (msg: unknown) => void; reject: (err: Error) => void }>();
  private nextId = 1;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!; // keep incomplete line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!.resolve(msg);
          this.pending.delete(msg.id);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  allocateId(): number {
    return this.nextId++;
  }

  waitForResponse(id: number, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC timeout waiting for id=${id}`));
        }
      }, timeoutMs);
    });
  }

  cancelAll(): void {
    for (const [id, { reject }] of this.pending) {
      reject(new Error('Reader cancelled'));
      this.pending.delete(id);
    }
  }
}
```

- [ ] **Step 2: Add discoverServerTools function**

After the `performHealthCheck` function (line 224), add:

```typescript
// ─── MCP Tool Discovery ───

const DISCOVERY_TIMEOUT = 10000;

export async function discoverServerTools(serverId: string): Promise<{ metadata: McpServerMetadata; tools: McpToolEntry[] }> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error(`MCP server not found: ${serverId}`);

  return new Promise((resolve, reject) => {
    const reader = new JsonRpcStdioReader();

    try {
      const proc = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const globalTimer = setTimeout(() => {
        reader.cancelAll();
        proc.kill('SIGKILL');
        reject(new Error(`Discovery timeout (${DISCOVERY_TIMEOUT / 1000}s)`));
      }, DISCOVERY_TIMEOUT);

      proc.on('error', (err) => {
        clearTimeout(globalTimer);
        reader.cancelAll();
        reject(err);
      });

      proc.stdout.on('data', (chunk: Buffer) => {
        reader.feed(chunk.toString());
      });

      // Step 1: Send initialize
      const initId = reader.allocateId();
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'zeus-discovery', version: '1.0' },
        },
      });
      proc.stdin.write(initRequest + '\n');

      reader.waitForResponse(initId, DISCOVERY_TIMEOUT)
        .then((initResponse: unknown) => {
          const initResult = (initResponse as { result?: { serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown>; protocolVersion?: string } }).result ?? {};

          // Step 2: Send initialized notification (no id)
          const initializedNotification = JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          });
          proc.stdin.write(initializedNotification + '\n');

          // Step 3: Send tools/list
          const toolsId = reader.allocateId();
          const toolsRequest = JSON.stringify({
            jsonrpc: '2.0',
            id: toolsId,
            method: 'tools/list',
            params: {},
          });
          proc.stdin.write(toolsRequest + '\n');

          return reader.waitForResponse(toolsId, DISCOVERY_TIMEOUT).then((toolsResponse: unknown) => {
            clearTimeout(globalTimer);
            proc.kill('SIGTERM');

            const toolsResult = (toolsResponse as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } }).result ?? {};
            const rawTools = toolsResult.tools ?? [];

            const metadata: McpServerMetadata = {
              serverId,
              protocolVersion: initResult.protocolVersion ?? '',
              serverName: initResult.serverInfo?.name ?? server.name,
              serverVersion: initResult.serverInfo?.version ?? '',
              capabilities: initResult.capabilities ?? {},
              discoveredAt: new Date().toISOString(),
            };

            const tools: McpToolEntry[] = rawTools.map((t) => ({
              serverId,
              toolName: t.name,
              description: t.description ?? '',
              inputSchema: t.inputSchema ?? {},
            }));

            // Persist to DB in a single transaction
            saveMcpDiscovery(
              serverId,
              { protocolVersion: metadata.protocolVersion, serverName: metadata.serverName, serverVersion: metadata.serverVersion, capabilities: metadata.capabilities },
              tools.map((t) => ({ toolName: t.toolName, description: t.description, inputSchema: t.inputSchema })),
            );

            resolve({ metadata, tools });
          });
        })
        .catch((err) => {
          clearTimeout(globalTimer);
          proc.kill('SIGKILL');
          reject(err);
        });
    } catch (err) {
      reject(err);
    }
  });
}
```

- [ ] **Step 3: Add discoverAllServerTools function**

Right after `discoverServerTools`, add:

```typescript
export async function discoverAllServerTools(): Promise<
  Array<{ serverId: string; metadata: McpServerMetadata; tools: McpToolEntry[] } | { serverId: string; error: string }>
> {
  const servers = getMcpServers().filter((s) => s.enabled);
  const results = await Promise.allSettled(
    servers.map((s) => discoverServerTools(s.id)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { serverId: servers[i].id, metadata: r.value.metadata, tools: r.value.tools };
    } else {
      return { serverId: servers[i].id, error: r.reason?.message ?? 'Unknown error' };
    }
  });
}
```

- [ ] **Step 4: Add getCachedTools function**

Right after `discoverAllServerTools`, add:

```typescript
export function getCachedToolsGrouped(serverId?: string): Array<{
  serverId: string;
  serverName: string;
  metadata?: McpServerMetadata;
  tools: McpToolEntry[];
}> {
  const servers = serverId ? [getMcpServer(serverId)].filter(Boolean) as McpServerRecord[] : getMcpServers();
  const allTools = getMcpCachedTools(serverId);
  const allMetadata = serverId
    ? [getMcpServerMetadataById(serverId)].filter(Boolean)
    : getAllMcpServerMetadata();
  const metadataMap = new Map(allMetadata.map((m) => [m!.serverId, m as McpServerMetadata]));
  const toolsByServer = new Map<string, McpToolEntry[]>();

  for (const tool of allTools) {
    if (!toolsByServer.has(tool.serverId)) toolsByServer.set(tool.serverId, []);
    toolsByServer.get(tool.serverId)!.push(tool);
  }

  return servers.map((s) => ({
    serverId: s.id,
    serverName: s.name,
    metadata: metadataMap.get(s.id),
    tools: toolsByServer.get(s.id) ?? [],
  }));
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/mcp-registry.ts
git commit -m "feat(mcp-playground): add JsonRpcStdioReader and tool discovery service"
```

---

### Task 4: WebSocket Handler — Discovery routes in handleMcp

**Files:**
- Modify: `src/main/services/websocket.ts:3245-3336` (inside `handleMcp` switch)

- [ ] **Step 1: Add import for new registry functions**

At the top of `websocket.ts`, find where `mcpRegistry` is imported (search for `import * as mcpRegistry` or individual imports). Ensure `discoverServerTools`, `discoverAllServerTools`, and `getCachedToolsGrouped` are accessible. Since `mcp-registry.ts` uses named exports, these should already be available if imported as `import * as mcpRegistry`.

Verify with: `grep -n 'mcpRegistry\|mcp-registry' src/main/services/websocket.ts | head -5`

- [ ] **Step 2: Add new cases to handleMcp switch**

In `handleMcp()` (line 3235-3336), add these cases before the closing `}` of the switch statement (before line 3332):

```typescript
      case 'discover_server': {
        try {
          const result = await mcpRegistry.discoverServerTools(payload.serverId);
          sendMcp({ type: 'discovery_result', serverId: payload.serverId, metadata: result.metadata, tools: result.tools });
        } catch (err) {
          sendMcp({ type: 'mcp_error', message: (err as Error).message, serverId: payload.serverId });
        }
        break;
      }
      case 'discover_all': {
        const results = await mcpRegistry.discoverAllServerTools();
        sendMcp({ type: 'discovery_all_result', results });
        break;
      }
      case 'get_cached_tools': {
        const servers = mcpRegistry.getCachedToolsGrouped(payload.serverId);
        sendMcp({ type: 'cached_tools', servers });
        break;
      }
```

Note: `discover_server` wraps in its own try/catch to send `mcp_error` with `serverId` on failure, so the frontend can clear the loading spinner for that specific server.

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(mcp-playground): add discover_server, discover_all, get_cached_tools WebSocket handlers"
```

---

### Task 5: Zustand Store — MCP Playground state, actions, and response handlers

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Import new types**

At the imports section (line 43-46), add `McpToolEntry` and `McpServerMetadata` to the import from `../../../shared/types`:

```typescript
import type {
  // ... existing imports ...
  McpToolEntry,
  McpServerMetadata,
} from '../../../shared/types';
```

- [ ] **Step 2: Add new state properties**

After the existing MCP state properties (line 164, after `mcpImportResult`), add:

```typescript
  // MCP Playground
  mcpToolCache: Record<string, McpToolEntry[]>;
  mcpServerMetadata: Record<string, McpServerMetadata>;
  mcpDiscovering: Record<string, boolean>;
```

- [ ] **Step 3: Add new action signatures**

After the existing `clearMcpImportResult` action signature (find it in the interface/type area near line 340), add:

```typescript
  fetchCachedTools: (serverId?: string) => void;
  discoverServer: (serverId: string) => void;
  discoverAllServers: () => void;
```

- [ ] **Step 4: Add initial state values**

After the existing MCP initial state (line 573, after `mcpImportResult: null`), add:

```typescript
  mcpToolCache: {},
  mcpServerMetadata: {},
  mcpDiscovering: {},
```

- [ ] **Step 5: Add action implementations**

After the existing `clearMcpImportResult` action (line 3394), add:

```typescript
  fetchCachedTools: (serverId) => {
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'get_cached_tools', serverId }, auth: '' });
  },

  discoverServer: (serverId) => {
    set({ mcpDiscovering: { ...get().mcpDiscovering, [serverId]: true } });
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'discover_server', serverId }, auth: '' });
  },

  discoverAllServers: () => {
    const allServers = get().mcpServers.filter((s) => s.enabled);
    const discovering: Record<string, boolean> = {};
    for (const s of allServers) discovering[s.id] = true;
    set({ mcpDiscovering: { ...get().mcpDiscovering, ...discovering } });
    zeusWs.send({ channel: 'mcp', sessionId: '', payload: { type: 'discover_all' }, auth: '' });
  },
```

- [ ] **Step 6: Add response handlers in the mcp subscription**

In the `mcp` channel subscriber (line 1659-1719), add these cases before the `mcp_error` case (line 1715):

```typescript
        case 'discovery_result':
          set({
            mcpToolCache: { ...get().mcpToolCache, [payload.serverId]: payload.tools },
            mcpServerMetadata: { ...get().mcpServerMetadata, [payload.serverId]: payload.metadata },
            mcpDiscovering: { ...get().mcpDiscovering, [payload.serverId]: false },
          });
          break;
        case 'discovery_all_result':
          {
            const toolCache = { ...get().mcpToolCache };
            const metadataMap = { ...get().mcpServerMetadata };
            const discovering = { ...get().mcpDiscovering };
            for (const entry of payload.results) {
              discovering[entry.serverId] = false;
              if ('error' in entry) continue;
              toolCache[entry.serverId] = entry.tools;
              metadataMap[entry.serverId] = entry.metadata;
            }
            set({ mcpToolCache: toolCache, mcpServerMetadata: metadataMap, mcpDiscovering: discovering });
          }
          break;
        case 'cached_tools':
          {
            const toolCache: Record<string, McpToolEntry[]> = {};
            const metadataMap: Record<string, McpServerMetadata> = {};
            for (const server of payload.servers) {
              toolCache[server.serverId] = server.tools;
              if (server.metadata) metadataMap[server.serverId] = server.metadata;
            }
            set({ mcpToolCache: { ...get().mcpToolCache, ...toolCache }, mcpServerMetadata: { ...get().mcpServerMetadata, ...metadataMap } });
          }
          break;
```

- [ ] **Step 7: Update mcp_error handler to clear discovering state**

Update the existing `mcp_error` case (line 1715-1717) to also clear discovering state:

```typescript
        case 'mcp_error':
          console.error('[MCP]', payload.message);
          if (payload.serverId) {
            set({ mcpDiscovering: { ...get().mcpDiscovering, [payload.serverId]: false } });
          }
          break;
```

- [ ] **Step 8: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(mcp-playground): add playground state, actions, and response handlers to Zustand store"
```

---

### Task 6: Frontend — McpPlaygroundView component

**Files:**
- Create: `src/renderer/src/components/McpPlaygroundView.tsx`

- [ ] **Step 1: Create the McpPlaygroundView component**

Create `src/renderer/src/components/McpPlaygroundView.tsx` with the full master-detail layout:

```tsx
import { useEffect, useState, useMemo } from 'react';
import { useZeusStore } from '@/stores/useZeusStore';
import type { McpServerRecord, McpToolEntry, McpServerMetadata } from '../../../shared/types';
import { RefreshCw, ChevronDown, ChevronRight, Puzzle, Server, Loader2, Search } from 'lucide-react';

// ─── McpToolSchemaView ───

function McpToolSchemaView({ schema }: { schema: Record<string, unknown> }) {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; default?: unknown }>;
  const required = (schema.required ?? []) as string[];
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return <span className="text-muted-foreground text-xs italic">No parameters</span>;
  }

  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-border border-b">
          <th className="py-1 pr-3 text-left font-medium">Name</th>
          <th className="py-1 pr-3 text-left font-medium">Type</th>
          <th className="py-1 pr-3 text-left font-medium">Required</th>
          <th className="py-1 text-left font-medium">Description</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, prop]) => (
          <tr key={name} className="border-border/50 border-b last:border-0">
            <td className="text-foreground py-1.5 pr-3 font-mono">{name}</td>
            <td className="text-muted-foreground py-1.5 pr-3">{String(prop.type ?? 'any')}</td>
            <td className="py-1.5 pr-3">
              {required.includes(name) ? (
                <span className="text-amber-400 text-[10px] font-semibold">YES</span>
              ) : (
                <span className="text-muted-foreground/50 text-[10px]">no</span>
              )}
            </td>
            <td className="text-muted-foreground py-1.5">
              {prop.description ?? ''}
              {prop.default !== undefined && (
                <span className="text-muted-foreground/60 ml-2">(default: {JSON.stringify(prop.default)})</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── McpToolAccordion ───

function McpToolAccordion({ tools }: { tools: McpToolEntry[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (toolName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  };

  if (tools.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm italic">No tools discovered</p>;
  }

  return (
    <div className="space-y-1">
      {tools.map((tool) => {
        const isOpen = expanded.has(tool.toolName);
        return (
          <div key={tool.toolName} className="border-border/50 rounded border">
            <button
              onClick={() => toggle(tool.toolName)}
              className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
            >
              {isOpen ? <ChevronDown className="text-muted-foreground size-3.5 shrink-0" /> : <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
              <span className="text-foreground text-sm font-medium font-mono">{tool.toolName}</span>
              <span className="text-muted-foreground truncate text-xs">{tool.description.split('\n')[0]}</span>
            </button>
            {isOpen && (
              <div className="border-border/50 border-t px-3 py-2">
                <p className="text-muted-foreground mb-2 text-xs whitespace-pre-wrap">{tool.description}</p>
                <McpToolSchemaView schema={tool.inputSchema} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── McpMetadataCard ───

function McpMetadataCard({ metadata }: { metadata: McpServerMetadata }) {
  const capabilities = Object.keys(metadata.capabilities);
  const discoveredDate = new Date(metadata.discoveredAt);
  const relativeTime = getRelativeTime(discoveredDate);

  return (
    <div className="bg-muted/30 border-border mb-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-base font-semibold">{metadata.serverName || 'Unknown Server'}</h3>
          {metadata.serverVersion && (
            <span className="text-muted-foreground text-xs">v{metadata.serverVersion}</span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">Protocol {metadata.protocolVersion || '—'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {capabilities.length > 0 ? (
          capabilities.map((cap) => (
            <span key={cap} className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium">
              {cap}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground text-xs italic">No capabilities reported</span>
        )}
      </div>
      <p className="text-muted-foreground/60 mt-2 text-[10px]">Discovered {relativeTime}</p>
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── McpServerList ───

function McpServerList({
  servers,
  selectedId,
  onSelect,
  toolCounts,
  metadata,
  discovering,
  onDiscover,
  onDiscoverAll,
}: {
  servers: McpServerRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolCounts: Record<string, number>;
  metadata: Record<string, McpServerMetadata>;
  discovering: Record<string, boolean>;
  onDiscover: (id: string) => void;
  onDiscoverAll: () => void;
}) {
  const anyDiscovering = Object.values(discovering).some(Boolean);

  return (
    <div className="border-border flex h-full flex-col border-r">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">MCP Servers</h2>
        <button
          onClick={onDiscoverAll}
          disabled={anyDiscovering}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors disabled:opacity-50"
          title="Discover all enabled servers"
        >
          {anyDiscovering ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Discover All
        </button>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-sm">No MCP servers registered</p>
        ) : (
          servers.map((server) => {
            const isSelected = server.id === selectedId;
            const isDiscovering = discovering[server.id];
            const count = toolCounts[server.id] ?? 0;
            const meta = metadata[server.id];

            return (
              <div
                key={server.id}
                onClick={() => onSelect(server.id)}
                className={`border-border/30 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors ${
                  isSelected ? 'bg-muted' : 'hover:bg-muted/50'
                } ${!server.enabled ? 'opacity-50' : ''}`}
              >
                <Server className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate text-sm font-medium">{server.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                      server.source === 'zeus' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {server.source}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[10px]">
                    {count > 0 && <span>{count} tool{count !== 1 ? 's' : ''}</span>}
                    {meta && <span>· {getRelativeTime(new Date(meta.discoveredAt))}</span>}
                    {!server.enabled && <span className="text-amber-400">disabled</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDiscover(server.id); }}
                  disabled={isDiscovering}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                  title="Refresh"
                >
                  {isDiscovering ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── McpServerDetail ───

function McpServerDetail({
  server,
  metadata,
  tools,
  searchQuery,
  onSearchChange,
}: {
  server: McpServerRecord | null;
  metadata?: McpServerMetadata;
  tools: McpToolEntry[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  // useMemo must be called before any early return (Rules of Hooks)
  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) => t.toolName.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [tools, searchQuery]);

  if (!server) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Puzzle className="text-muted-foreground/30 mx-auto mb-3 size-12" />
          <p className="text-muted-foreground text-sm">Select a server to view its tools</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">{server.name}</h2>
        <span className="text-muted-foreground text-xs">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {metadata && <McpMetadataCard metadata={metadata} />}

        {tools.length === 0 ? (
          <div className="text-center py-8">
            <RefreshCw className="text-muted-foreground/30 mx-auto mb-3 size-8" />
            <p className="text-muted-foreground text-sm">Click Refresh to discover this server's tools</p>
          </div>
        ) : (
          <>
            {/* Search bar */}
            {tools.length > 5 && (
              <div className="mb-3 flex items-center gap-2">
                <Search className="text-muted-foreground size-3.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Filter tools..."
                  className="bg-transparent text-foreground placeholder:text-muted-foreground/50 flex-1 border-none text-sm outline-none"
                />
              </div>
            )}
            <McpToolAccordion tools={filteredTools} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── McpPlaygroundView (main) ───

export default function McpPlaygroundView() {
  const mcpServers = useZeusStore((s) => s.mcpServers);
  const mcpToolCache = useZeusStore((s) => s.mcpToolCache);
  const mcpServerMetadata = useZeusStore((s) => s.mcpServerMetadata);
  const mcpDiscovering = useZeusStore((s) => s.mcpDiscovering);
  const fetchMcpServers = useZeusStore((s) => s.fetchMcpServers);
  const fetchCachedTools = useZeusStore((s) => s.fetchCachedTools);
  const discoverServer = useZeusStore((s) => s.discoverServer);
  const discoverAllServers = useZeusStore((s) => s.discoverAllServers);

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchMcpServers();
    fetchCachedTools();
  }, [fetchMcpServers, fetchCachedTools]);

  // Reset search when selecting a different server
  useEffect(() => {
    setSearchQuery('');
  }, [selectedServerId]);

  const selectedServer = mcpServers.find((s) => s.id === selectedServerId) ?? null;
  const selectedTools = selectedServerId ? mcpToolCache[selectedServerId] ?? [] : [];
  const selectedMeta = selectedServerId ? mcpServerMetadata[selectedServerId] : undefined;

  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [serverId, tools] of Object.entries(mcpToolCache)) {
      counts[serverId] = tools.length;
    }
    return counts;
  }, [mcpToolCache]);

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0">
        <McpServerList
          servers={mcpServers}
          selectedId={selectedServerId}
          onSelect={setSelectedServerId}
          toolCounts={toolCounts}
          metadata={mcpServerMetadata}
          discovering={mcpDiscovering}
          onDiscover={discoverServer}
          onDiscoverAll={discoverAllServers}
        />
      </div>
      <div className="min-w-0 flex-1">
        <McpServerDetail
          server={selectedServer}
          metadata={selectedMeta}
          tools={selectedTools}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/McpPlaygroundView.tsx
git commit -m "feat(mcp-playground): add McpPlaygroundView with master-detail layout"
```

---

### Task 7: Navigation — Wire McpPlaygroundView into App + Sidebar

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts:51` (ViewMode type)
- Modify: `src/renderer/src/App.tsx:275-317,430-466` (ViewMode conditionals)
- Modify: `src/renderer/src/components/SessionSidebar.tsx:110,344` (ViewMode types in props)

- [ ] **Step 1: Add 'mcp-playground' to ViewMode**

In `src/renderer/src/stores/useZeusStore.ts` line 51, change:

```typescript
type ViewMode = 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session' | 'room';
```

to:

```typescript
type ViewMode = 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session' | 'room' | 'mcp-playground';
```

- [ ] **Step 2: Add McpPlaygroundView import to App.tsx**

Add at the top of `src/renderer/src/App.tsx` with the other component imports:

```typescript
import McpPlaygroundView from '@/components/McpPlaygroundView';
```

- [ ] **Step 3: Add mobile ViewMode conditional**

In `src/renderer/src/App.tsx`, in the mobile rendering section (around line 313), change:

```tsx
          ) : viewMode === 'room' ? (
            <RoomView />
          ) : (
```

to:

```tsx
          ) : viewMode === 'room' ? (
            <RoomView />
          ) : viewMode === 'mcp-playground' ? (
            <McpPlaygroundView />
          ) : (
```

- [ ] **Step 4: Add desktop ViewMode conditional**

In the desktop rendering section (around line 462), change:

```tsx
                ) : viewMode === 'room' ? (
                  <RoomView />
                ) : (
```

to:

```tsx
                ) : viewMode === 'room' ? (
                  <RoomView />
                ) : viewMode === 'mcp-playground' ? (
                  <McpPlaygroundView />
                ) : (
```

- [ ] **Step 5: Update SessionSidebar ViewMode types**

In `src/renderer/src/components/SessionSidebar.tsx`, update the ViewMode type string in the props (lines 110 and 344) to include `'mcp-playground'`:

Line 110:
```typescript
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session' | 'room' | 'mcp-playground';
```

Line 344:
```typescript
  viewMode: 'terminal' | 'claude' | 'diff' | 'settings' | 'new-session' | 'room' | 'mcp-playground';
```

- [ ] **Step 6: Add MCP Playground button to sidebar**

In `src/renderer/src/components/SessionSidebar.tsx`, find the bottom bar section (around line 917-929) where the settings button is. Add an MCP Playground button next to the settings button:

```tsx
      <div className="border-border bg-card flex items-center justify-between border-t px-4 py-3.5">
        <span className="text-muted-foreground/50 text-sm">
          {allClaude.length + allTerminal.length} session{allClaude.length + allTerminal.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            className={`flex size-8 items-center justify-center rounded transition-colors [-webkit-app-region:no-drag] ${
              viewMode === 'mcp-playground' ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => { useZeusStore.getState().setViewMode('mcp-playground'); }}
            title="MCP Playground"
          >
            <Puzzle className="size-4" />
          </button>
          <button
            className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded transition-colors [-webkit-app-region:no-drag]"
            onClick={onOpenSettings}
            title="Settings"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>
```

Add `Puzzle` to the lucide-react import at the top of the file.

- [ ] **Step 7: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 8: Verify the app builds**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts src/renderer/src/App.tsx src/renderer/src/components/SessionSidebar.tsx
git commit -m "feat(mcp-playground): wire McpPlaygroundView into navigation and sidebar"
```

---

### Task 8: Manual Integration Test

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the MCP Playground view loads**

Click the Puzzle icon in the sidebar. The MCP Playground view should load with the server list on the left. If no servers are registered, it should show "No MCP servers registered".

- [ ] **Step 3: Verify server discovery works**

Click "Refresh" on a server. After a few seconds, the tool list should populate on the right panel with tool names, descriptions, and input schemas.

- [ ] **Step 4: Verify "Discover All" works**

Click "Discover All". All enabled servers should show spinners, then populate with tools.

- [ ] **Step 5: Verify cache persistence**

Navigate away from the playground and come back. The previously discovered tools should still be visible (loaded from cache).

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(mcp-playground): address integration test findings"
```
