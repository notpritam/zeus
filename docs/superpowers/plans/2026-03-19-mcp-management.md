# MCP Management System — Design Document

**Date:** 2026-03-19
**Branch:** `feat/mcp-management`
**Status:** Approved (design phase complete)

---

## Overview

Add a full MCP server lifecycle management system to Zeus. Users can register, health-check, organize into profiles, and selectively attach MCP servers to Claude sessions — all managed from the mobile/web UI.

## Design Decisions (User-Approved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Inventory + per-session selection | Inventory is prerequisite for selection |
| Storage | SQLite (Approach B) | Long-term: relational data, migrations pattern exists |
| Import source | Zeus-owned registry + sync from `~/.claude/mcp.json` | Zeus is the superset |
| Health check | On-demand only | No background polling, simple |
| Health method | MCP `initialize` handshake | Binary healthy/unhealthy, no tool discovery |
| UI — Right panel | Session-contextual MCP status | Shows MCPs attached to active session + live status |
| UI — Settings tab | Global registry CRUD, profiles, import | Full management, not session-specific |
| Session selection | Profiles as presets + individual overrides | Flexible without complexity |
| Unhealthy at start | Warn but allow | Non-blocking, user stays in control |

## Data Model (SQLite v11)

### `mcp_servers` — The registry

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  command TEXT NOT NULL,
  args TEXT DEFAULT '[]',       -- JSON string[]
  env TEXT DEFAULT '{}',        -- JSON Record<string, string>
  source TEXT DEFAULT 'zeus',   -- 'zeus' | 'claude'
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `mcp_profiles` — Named presets

```sql
CREATE TABLE mcp_profiles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### `mcp_profile_servers` — Join table

```sql
CREATE TABLE mcp_profile_servers (
  profile_id TEXT NOT NULL REFERENCES mcp_profiles(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, server_id)
);
```

### `session_mcps` — Per-session MCP tracking

```sql
CREATE TABLE session_mcps (
  session_id TEXT NOT NULL REFERENCES claude_sessions(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'attached',  -- 'attached' | 'active' | 'failed'
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, server_id)
);
```

Tracks which MCPs were attached to each Claude session and their runtime status. Updated when:
- Session starts → all resolved MCPs inserted with `status='attached'`
- MCP responds to health check during session → `status='active'`
- MCP fails or times out → `status='failed'`

**Note:** `zeus-bridge` is always injected automatically — not stored in this registry.

## Backend Service (`src/main/services/mcp-registry.ts`)

### CRUD Operations
- `getMcpServers()` → all servers
- `getMcpServer(id)` → single server
- `addMcpServer({ name, command, args?, env? })` → register
- `updateMcpServer(id, partial)` → edit
- `removeMcpServer(id)` → delete (cascades from profiles)
- `toggleMcpServer(id, enabled)` → enable/disable

### Profile Operations
- `getProfiles()` → all profiles with server lists
- `getProfile(id)` → single profile
- `createProfile(name, description?, serverIds)` → new profile
- `updateProfile(id, partial)` → edit
- `deleteProfile(id)` → delete
- `setDefaultProfile(id)` → mark default (unsets previous)

### Import
- `importFromClaude()` → reads `~/.claude/mcp.json`, merges new servers with `source='claude'`
- Returns `{ imported: string[], skipped: string[] }`

### Health Check
- `checkServerHealth(id)` → `{ healthy: boolean, error?: string, latencyMs: number }`
- `checkAllHealth()` → `Record<serverId, HealthResult>`
- **Mechanism:** Spawn server binary, send MCP `initialize` JSON-RPC over stdin, 5s timeout, kill process.

### Session Resolution
- `resolveSessionMcps(profileId?, serverIds?, excludeIds?)` → final `McpServerConfig[]`
  1. Start with profile servers (or default profile)
  2. Add `serverIds`
  3. Remove `excludeIds`
  4. Return resolved list

### Session MCP Tracking
- `attachSessionMcps(sessionId, serverIds)` → insert rows into `session_mcps`
- `updateSessionMcpStatus(sessionId, serverId, status)` → update status to 'active' | 'failed'
- `getSessionMcps(sessionId)` → `SessionMcpRecord[]` with joined server details + status

## WebSocket Channel: `mcp`

### Client → Server

| `type` | Payload |
|--------|---------|
| `get_servers` | — |
| `add_server` | `{ name, command, args?, env? }` |
| `update_server` | `{ id, ...partial }` |
| `remove_server` | `{ id }` |
| `toggle_server` | `{ id, enabled }` |
| `health_check` | `{ id? }` (omit id = check all) |
| `import_claude` | — |
| `get_profiles` | — |
| `create_profile` | `{ name, description?, serverIds }` |
| `update_profile` | `{ id, name?, description?, serverIds? }` |
| `delete_profile` | `{ id }` |
| `set_default_profile` | `{ id }` |
| `get_session_mcps` | `{ sessionId }` |

### Server → Client

| `type` | Payload |
|--------|---------|
| `servers_list` | `McpServerRecord[]` |
| `server_added` | `McpServerRecord` |
| `server_updated` | `McpServerRecord` |
| `server_removed` | `{ id }` |
| `health_result` | `{ id, healthy, error?, latencyMs }` |
| `health_results` | `Record<id, HealthResult>` |
| `import_result` | `{ imported[], skipped[] }` |
| `profiles_list` | `McpProfileRecord[]` (with nested servers) |
| `profile_created` | `McpProfileRecord` |
| `profile_updated` | `McpProfileRecord` |
| `profile_deleted` | `{ id }` |
| `session_mcps` | `SessionMcpRecord[]` (server details + runtime status) |
| `session_mcp_status` | `{ sessionId, serverId, status }` (live status update) |
| `mcp_error` | `{ type: string, message: string, serverId?: string }` (operation failure) |

### Error Handling

All MCP channel operations that can fail (add, update, delete, health-check, import) respond with `mcp_error` on failure:
```typescript
{ type: 'mcp_error', message: string, serverId?: string }
```
The client should display these as toast notifications or inline error messages.

### Session Start Integration

Extend `ClaudeStartPayload` with:
```typescript
mcpProfileId?: string;
mcpServerIds?: string[];    // additive
mcpExcludeIds?: string[];   // subtractive
```

At session start:
1. Resolve MCP list via `resolveSessionMcps()`
2. Health-check resolved set
3. Broadcast `health_warning` if any unhealthy (non-blocking)
4. Pass resolved MCPs to `buildArgs()` alongside `zeus-bridge`

### Integration with `buildArgs()` — EXTEND, do not rewrite

**File:** `src/main/services/claude-session.ts` lines 226-270

The existing `buildArgs()` already builds the `mcpServers` object and passes it via `--mcp-config`. The current code path:

```
Regular sessions:  mcpServers['zeus-bridge'] = { command: 'node', args: [bridgePath] }
Subagent sessions: iterate this.options.mcpServers, inject ZEUS_QA_AGENT_ID + ZEUS_WS_URL
Final:             args.push('--mcp-config', JSON.stringify({ mcpServers }))
```

**What we extend (not rewrite):** In the `!isSubagent` branch (line 257), after adding `zeus-bridge`, also merge in any user-selected external MCPs from the registry:

```typescript
// Existing: always add zeus-bridge
mcpServers['zeus-bridge'] = { command: 'node', args: [bridgePath] };

// NEW: merge external MCPs from registry (resolved via profile + overrides)
if (this.options.mcpServers) {
  for (const mcp of this.options.mcpServers) {
    mcpServers[mcp.name] = { command: mcp.command, args: mcp.args, env: mcp.env };
  }
}
```

The `SessionOptions.mcpServers` field already exists (used by subagents). Regular sessions will now also populate it via `resolveSessionMcps()` in `websocket.ts` before calling `createSession()`.

## UI Components

### Right Panel Tab — Session MCP Status (`McpPanel.tsx`)

**Context:** Bound to the active Claude session. Shows MCPs attached to *this* session and their live status.

**When a session is active:**
```
┌─────────────────────────────┐
│ Session MCPs            [⟳]    │  ← refresh health of session MCPs
├─────────────────────────────┤
│ ● zeus-bridge        always on │  ← always present, not from registry
│ ● obsidian-mcp-tools active    │  ← attached & responding
│ ✕ figma-mcp          failed    │  ← attached but died mid-session
│ ○ slack-mcp          attached  │  ← attached, not yet checked
├─────────────────────────────┤
│ Profile used: Coding           │  ← which profile was used at start
│ Attached: 3 servers            │
│ [Manage MCPs ⚙]               │  ← opens Settings MCP tab
└─────────────────────────────┘
```

**When no session is active:**
```
┌─────────────────────────────┐
│ Session MCPs                    │
├─────────────────────────────┤
│                                 │
│   No active session.            │
│   Start a Claude session to     │
│   see attached MCP servers.     │
│                                 │
│ [Manage MCPs ⚙]               │  ← still accessible
└─────────────────────────────┘
```

**Status indicators:**
- `●` green = `active` (responded to health check during session)
- `○` grey = `attached` (assigned at start, not yet verified)
- `✕` red = `failed` (unreachable or errored)

### Settings View Tab — Global MCP Management (`SettingsView.tsx` → 'mcp' tab)

**Full-width management view. Not session-specific — manages the global registry.**

**Servers section:**
- Table: Name, Command, Source (zeus/claude), Enabled, Actions (edit/delete/health-check)
- "Add Server" form: name, command, args, env fields
- "Import from Claude Config" button with results summary
- Health-check individual or all servers

**Profiles section:**
- Profile list with server count badges
- Create/edit profile: name, description, multi-select servers
- Set default toggle (star icon)
- Delete with confirmation

### Session Start Integration

New MCP step in the session start flow:
- Profile dropdown (pre-selects default)
- Resolved MCP list from selected profile
- Per-server toggles to override (add/remove individual servers)
- Health badges next to each server
- Yellow warning banner if any are unhealthy: "2 servers unreachable — session will start but these MCPs may not work"
- Start button always enabled (warn but allow)

## Implementation Plan

### Step 1: Types & Schema
- Add MCP types to `src/shared/types.ts`
- Add `mcp` channel to `WsEnvelope`
- Add DB migration v11 in `db.ts`

### Step 2: Backend Service
- Create `src/main/services/mcp-registry.ts`
- CRUD, profiles, import, health-check, session resolution

### Step 3: WebSocket Routing
- Add `mcp` channel handler in `websocket.ts`
- Route all MCP messages to registry service

### Step 4: Zustand Store
- Add MCP slice to `useZeusStore.ts`
- State: servers, profiles, health results
- Actions: fetch, add, update, delete, health-check, import

### Step 5: Right Panel Tab
- Create `McpPanel.tsx`
- Add 'mcp' to right panel tab union
- Wire into `RightPanel.tsx` with icon

### Step 6: Settings View Tab
- Add 'mcp' tab to `SettingsView.tsx`
- Full CRUD UI for servers and profiles

### Step 7: Session Start Integration
- Extend `ClaudeStartPayload` with MCP fields
- Update `buildArgs()` to merge external MCPs with zeus-bridge
- Add MCP selection step to session start UI

### Step 8: Testing & Polish
- Test import from `~/.claude/mcp.json`
- Test health-check flow
- Test session start with profiles + overrides
- QA run for UI verification
