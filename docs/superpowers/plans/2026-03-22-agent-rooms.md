# Agent Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-agent coordination layer where agents share a "room," communicate through a group chat, and are orchestrated by a PM agent — all fully async, non-blocking.

**Architecture:** Rooms are backed by 4 new SQLite tables (`rooms`, `room_agents`, `room_messages`, `room_read_cursors`). A `room-manager.ts` service handles all CRUD/lifecycle. Agents get room tools via a `zeus-room` MCP server (workers) or `zeus-bridge` proxy tools (PM). Zeus drives PM turns by injecting user messages when room events occur. The renderer adds a `RoomView` that displays the group chat feed and an agent sidebar.

**Tech Stack:** Electron, better-sqlite3, node-pty, WebSocket (ws), MCP (stdio), React, Zustand, Tailwind CSS.

**Design Doc:** `docs/plans/agent-rooms-design.md` + `docs/plans/agent-rooms-qa.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/shared/room-types.ts` | Type definitions for Room, RoomAgent, RoomMessage, RoomReadCursor, and all room-related payloads |
| `src/main/services/room-manager.ts` | Room CRUD, agent lifecycle (spawn/dismiss/pause/resume), message posting, read cursor management |
| `src/main/services/room-injection.ts` | PM turn injection — state machine, event batching, trigger logic, worker nudging |
| `src/main/mcp/zeus-room.ts` | MCP server exposing room tools to spawned room-aware agents |
| `src/renderer/src/components/RoomView.tsx` | Main room UI — group chat feed with message input |
| `src/renderer/src/components/RoomAgentSidebar.tsx` | Agent list with live status, spawn/dismiss controls |
| `src/renderer/src/components/RoomMessage.tsx` | Individual room message rendering (system, directive, finding, question, etc.) |

### Modified Files

| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `'room'` to WsEnvelope channel union |
| `src/main/services/db.ts` | Migration v14: create 4 room tables + indexes; add room CRUD functions |
| `src/main/services/claude-session.ts` | Add `turnState` property, room-related `SessionOptions` fields, inject `zeus-room` MCP in `buildArgs()` |
| `src/main/mcp/zeus-bridge.ts` | Add `room_create` + proxy tools (`room_spawn_agent`, `room_post_message`, etc.) |
| `src/main/services/websocket.ts` | Add `handleRoom()` channel handler, wire room agents, broadcast room events |
| `electron.vite.config.ts` | Add `mcp-zeus-room` build entry |
| `src/renderer/src/stores/useZeusStore.ts` | Add room state slice (rooms, activeRoomId, roomMessages, roomAgents) + actions |
| `src/renderer/src/components/App.tsx` | Add `'room'` view mode, render RoomView |
| `src/renderer/src/components/RightPanel.tsx` | Add `'room'` tab option |
| `src/renderer/src/components/SessionSidebar.tsx` | Show rooms section |

---

## Phase 1: Foundation (Data + Types + Room Manager)

### Task 1: Shared Room Types

**Files:**
- Create: `src/shared/room-types.ts`

- [ ] **Step 1: Create room-types.ts with all type definitions**

```typescript
// src/shared/room-types.ts

// ---- Room ----

export type RoomStatus = 'active' | 'paused' | 'completed';

export interface Room {
  roomId: string;
  name: string;
  task: string;
  pmAgentId: string | null;
  status: RoomStatus;
  tokenBudget: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

// ---- Room Agent ----

export type RoomAgentStatus =
  | 'spawning'
  | 'running'
  | 'idle'
  | 'done'
  | 'paused'
  | 'dismissed'
  | 'dead';

export interface RoomAgent {
  agentId: string;
  roomId: string;
  role: string;
  claudeSessionId: string | null;
  model: string | null;
  status: RoomAgentStatus;
  roomAware: boolean;
  prompt: string;
  result: string | null;
  tokensUsed: number;
  spawnedBy: string | null;
  workingDir: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Room Message ----

export type RoomMessageType =
  | 'system'
  | 'directive'
  | 'finding'
  | 'question'
  | 'status_update'
  | 'signal_done'
  | 'error';

export interface RoomMessage {
  messageId: string;
  roomId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  type: RoomMessageType;
  content: string;
  mentions: string[]; // agent_ids
  metadata: unknown;
  seq: number;
  timestamp: string; // ISO 8601
}

// ---- Read Cursor ----

export interface RoomReadCursor {
  agentId: string;
  roomId: string;
  lastSeq: number;
  updatedAt: string;
}

// ---- MCP Tool Inputs ----

export interface RoomCreateInput {
  name: string;
  task: string;
}

export interface RoomSpawnAgentInput {
  role: string;
  model?: string;
  prompt: string;
  roomAware?: boolean; // default true
  permissionMode?: string;
  workingDir?: string;
}

export interface RoomDismissAgentInput {
  agentId: string;
}

export interface RoomPauseAgentInput {
  agentId: string;
}

export interface RoomResumeAgentInput {
  agentId: string;
}

export interface RoomPostMessageInput {
  message: string;
  type?: RoomMessageType;
  to?: string; // agentId
}

export interface RoomReadMessagesInput {
  since?: number; // seq number
  limit?: number; // default 50
}

export interface RoomListAgentsInput {}

export interface RoomGetAgentStateInput {
  agentId: string;
}

export interface RoomGetAgentLogInput {
  agentId: string;
  limit?: number;
}

export interface RoomSignalDoneInput {
  summary: string;
}

export interface RoomReplacePmInput {
  newModel?: string;
  newPrompt?: string;
}

export interface RoomCompleteInput {
  summary: string;
}

// ---- WebSocket Payloads (Server → Client) ----

export interface RoomCreatedPayload {
  type: 'room_created';
  room: Room;
}

export interface RoomUpdatedPayload {
  type: 'room_updated';
  room: Room;
}

export interface RoomAgentJoinedPayload {
  type: 'room_agent_joined';
  agent: RoomAgent;
}

export interface RoomAgentUpdatedPayload {
  type: 'room_agent_updated';
  agent: RoomAgent;
}

export interface RoomMessagePayload {
  type: 'room_message';
  message: RoomMessage;
}

export interface RoomCompletedPayload {
  type: 'room_completed';
  room: Room;
  summary: string;
}

export interface RoomListPayload {
  type: 'room_list';
  rooms: Room[];
}

export interface RoomDetailPayload {
  type: 'room_detail';
  room: Room;
  agents: RoomAgent[];
  messages: RoomMessage[];
}

export type RoomWsPayload =
  | RoomCreatedPayload
  | RoomUpdatedPayload
  | RoomAgentJoinedPayload
  | RoomAgentUpdatedPayload
  | RoomMessagePayload
  | RoomCompletedPayload
  | RoomListPayload
  | RoomDetailPayload;

// ---- WebSocket Payloads (Client → Server) ----

export interface CreateRoomRequest {
  type: 'create_room';
  name: string;
  task: string;
  sessionId: string; // PM's claude session ID
}

export interface SpawnAgentRequest {
  type: 'spawn_agent';
  roomId: string;
  role: string;
  prompt: string;
  model?: string;
  roomAware?: boolean;
  permissionMode?: string;
  workingDir?: string;
}

export interface DismissAgentRequest {
  type: 'dismiss_agent';
  roomId: string;
  agentId: string;
}

export interface PostRoomMessageRequest {
  type: 'post_message';
  roomId: string;
  message: string;
  messageType?: RoomMessageType;
}

export interface ListRoomsRequest {
  type: 'list_rooms';
}

export interface GetRoomRequest {
  type: 'get_room';
  roomId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/room-types.ts
git commit -m "feat(rooms): add shared type definitions for agent rooms"
```

---

### Task 2: Database Migration (v14)

**Files:**
- Modify: `src/main/services/db.ts`

- [ ] **Step 1: Read current db.ts to find migration insertion point**

Read `src/main/services/db.ts` — find where migrations are defined (look for `version: 13`) and the CRUD function section.

- [ ] **Step 2: Add migration v14 — create room tables and indexes**

Add after the `if (currentVersion < 13)` block, before the `database.pragma(\`user_version = ...\`)` line. Also update `SCHEMA_VERSION` from 13 to 14:

```typescript
if (currentVersion < 14) {
  const migrate14 = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id      TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        task         TEXT NOT NULL,
        pm_agent_id  TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        token_budget INTEGER,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_agents (
        agent_id          TEXT PRIMARY KEY,
        room_id           TEXT NOT NULL,
        role              TEXT NOT NULL,
        claude_session_id TEXT,
        model             TEXT,
        status            TEXT NOT NULL DEFAULT 'spawning',
        room_aware        INTEGER NOT NULL DEFAULT 1,
        prompt            TEXT NOT NULL,
        result            TEXT,
        tokens_used       INTEGER NOT NULL DEFAULT 0,
        spawned_by        TEXT,
        working_dir       TEXT,
        last_activity_at  TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_messages (
        message_id    TEXT PRIMARY KEY,
        room_id       TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id   TEXT,
        type          TEXT NOT NULL,
        content       TEXT NOT NULL,
        mentions      TEXT NOT NULL DEFAULT '[]',
        metadata      TEXT,
        seq           INTEGER NOT NULL,
        timestamp     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_read_cursors (
        agent_id    TEXT NOT NULL,
        room_id     TEXT NOT NULL,
        last_seq    INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (agent_id, room_id)
      );

      CREATE INDEX IF NOT EXISTS idx_room_agents_room ON room_agents(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_agents_session ON room_agents(claude_session_id);
      CREATE INDEX IF NOT EXISTS idx_room_messages_room_seq ON room_messages(room_id, seq);
      CREATE INDEX IF NOT EXISTS idx_room_messages_to ON room_messages(to_agent_id);
    `);
  });
  migrate14();
}
```

**IMPORTANT:** Also update `const SCHEMA_VERSION = 13` → `const SCHEMA_VERSION = 14` at the top of `db.ts`.

- [ ] **Step 3: Add room CRUD functions to db.ts**

Add these DB functions after the existing permission functions:

```typescript
// ---- Room CRUD ----

export function insertRoom(room: {
  roomId: string; name: string; task: string;
  status?: string; tokenBudget?: number | null;
}): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO rooms (room_id, name, task, status, token_budget, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(room.roomId, room.name, room.task, room.status || 'active', room.tokenBudget ?? null, now, now);
}

export function updateRoomPmAgent(roomId: string, pmAgentId: string): void {
  getDb().prepare(`UPDATE rooms SET pm_agent_id = ?, updated_at = ? WHERE room_id = ?`)
    .run(pmAgentId, new Date().toISOString(), roomId);
}

export function updateRoomStatus(roomId: string, status: string): void {
  getDb().prepare(`UPDATE rooms SET status = ?, updated_at = ? WHERE room_id = ?`)
    .run(status, new Date().toISOString(), roomId);
}

export function getRoom(roomId: string): Record<string, unknown> | undefined {
  return getDb().prepare(`SELECT * FROM rooms WHERE room_id = ?`).get(roomId) as Record<string, unknown> | undefined;
}

export function getAllRooms(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM rooms ORDER BY created_at DESC`).all() as Record<string, unknown>[];
}

export function insertRoomAgent(agent: {
  agentId: string; roomId: string; role: string;
  claudeSessionId?: string | null; model?: string | null;
  status?: string; roomAware?: boolean; prompt: string;
  spawnedBy?: string | null; workingDir?: string | null;
}): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO room_agents (agent_id, room_id, role, claude_session_id, model, status, room_aware, prompt, spawned_by, working_dir, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.agentId, agent.roomId, agent.role,
    agent.claudeSessionId ?? null, agent.model ?? null,
    agent.status || 'spawning', agent.roomAware !== false ? 1 : 0,
    agent.prompt, agent.spawnedBy ?? null,
    agent.workingDir ?? null, now, now
  );
}

export function updateRoomAgentStatus(agentId: string, status: string): void {
  getDb().prepare(`UPDATE room_agents SET status = ?, updated_at = ? WHERE agent_id = ?`)
    .run(status, new Date().toISOString(), agentId);
}

export function updateRoomAgentSession(agentId: string, claudeSessionId: string): void {
  getDb().prepare(`UPDATE room_agents SET claude_session_id = ?, updated_at = ? WHERE agent_id = ?`)
    .run(claudeSessionId, new Date().toISOString(), agentId);
}

export function updateRoomAgentResult(agentId: string, result: string): void {
  getDb().prepare(`UPDATE room_agents SET result = ?, updated_at = ? WHERE agent_id = ?`)
    .run(result, new Date().toISOString(), agentId);
}

export function updateRoomAgentActivity(agentId: string): void {
  getDb().prepare(`UPDATE room_agents SET last_activity_at = ?, updated_at = ? WHERE agent_id = ?`)
    .run(new Date().toISOString(), new Date().toISOString(), agentId);
}

export function updateRoomAgentTokens(agentId: string, tokensUsed: number): void {
  getDb().prepare(`UPDATE room_agents SET tokens_used = ?, updated_at = ? WHERE agent_id = ?`)
    .run(tokensUsed, new Date().toISOString(), agentId);
}

export function getRoomAgent(agentId: string): Record<string, unknown> | undefined {
  return getDb().prepare(`SELECT * FROM room_agents WHERE agent_id = ?`).get(agentId) as Record<string, unknown> | undefined;
}

export function getRoomAgents(roomId: string): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM room_agents WHERE room_id = ? ORDER BY created_at`).all(roomId) as Record<string, unknown>[];
}

export function getRoomAgentBySession(claudeSessionId: string): Record<string, unknown> | undefined {
  return getDb().prepare(`SELECT * FROM room_agents WHERE claude_session_id = ?`).get(claudeSessionId) as Record<string, unknown> | undefined;
}

export function getOrphanedRoomAgents(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM room_agents WHERE status IN ('running', 'spawning')`).all() as Record<string, unknown>[];
}

export function insertRoomMessage(msg: {
  messageId: string; roomId: string; fromAgentId?: string | null;
  toAgentId?: string | null; type: string; content: string;
  mentions?: string[]; metadata?: unknown;
}): { seq: number } {
  const now = new Date().toISOString();
  const mentionsJson = JSON.stringify(msg.mentions || []);
  const metadataJson = msg.metadata ? JSON.stringify(msg.metadata) : null;

  const result = getDb().transaction(() => {
    const seqRow = getDb().prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM room_messages WHERE room_id = ?`
    ).get(msg.roomId) as { next_seq: number };

    getDb().prepare(`
      INSERT INTO room_messages (message_id, room_id, from_agent_id, to_agent_id, type, content, mentions, metadata, seq, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.messageId, msg.roomId, msg.fromAgentId ?? null,
      msg.toAgentId ?? null, msg.type, msg.content,
      mentionsJson, metadataJson, seqRow.next_seq, now
    );

    return { seq: seqRow.next_seq };
  })();

  return result;
}

export function getRoomMessages(roomId: string, since?: number, limit?: number): Record<string, unknown>[] {
  const lim = limit || 50;
  if (since !== undefined) {
    return getDb().prepare(
      `SELECT * FROM room_messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
    ).all(roomId, since, lim) as Record<string, unknown>[];
  }
  return getDb().prepare(
    `SELECT * FROM room_messages WHERE room_id = ? ORDER BY seq ASC LIMIT ?`
  ).all(roomId, lim) as Record<string, unknown>[];
}

export function getUnreadMessagesForAgent(roomId: string, agentId: string): number {
  const cursor = getDb().prepare(
    `SELECT last_seq FROM room_read_cursors WHERE agent_id = ? AND room_id = ?`
  ).get(agentId, roomId) as { last_seq: number } | undefined;

  const lastSeq = cursor?.last_seq ?? 0;
  const row = getDb().prepare(
    `SELECT COUNT(*) as count FROM room_messages WHERE room_id = ? AND seq > ?`
  ).get(roomId, lastSeq) as { count: number };

  return row.count;
}

export function getDirectedUnreadForAgent(roomId: string, agentId: string): number {
  const cursor = getDb().prepare(
    `SELECT last_seq FROM room_read_cursors WHERE agent_id = ? AND room_id = ?`
  ).get(agentId, roomId) as { last_seq: number } | undefined;

  const lastSeq = cursor?.last_seq ?? 0;
  const row = getDb().prepare(
    `SELECT COUNT(*) as count FROM room_messages WHERE room_id = ? AND seq > ? AND (to_agent_id = ? OR mentions LIKE ?)`
  ).get(roomId, lastSeq, agentId, `%${agentId}%`) as { count: number };

  return row.count;
}

export function updateReadCursor(agentId: string, roomId: string, lastSeq: number): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO room_read_cursors (agent_id, room_id, last_seq, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (agent_id, room_id) DO UPDATE SET last_seq = ?, updated_at = ?
  `).run(agentId, roomId, lastSeq, now, lastSeq, now);
}

export function getReadCursor(agentId: string, roomId: string): number {
  const row = getDb().prepare(
    `SELECT last_seq FROM room_read_cursors WHERE agent_id = ? AND room_id = ?`
  ).get(agentId, roomId) as { last_seq: number } | undefined;
  return row?.last_seq ?? 0;
}
```

- [ ] **Step 4: Run typecheck to verify**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/db.ts
git commit -m "feat(rooms): add migration v14 with room tables and CRUD functions"
```

---

### Task 3: Add 'room' to WsEnvelope Channel

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add 'room' to WsEnvelope channel union**

Find the `WsEnvelope` interface in `src/shared/types.ts` and add `'room'` to the channel union:

```typescript
// Before:
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android' | 'mcp' | 'task' | 'permissions';

// After:
channel: 'terminal' | 'git' | 'control' | 'qa' | 'status' | 'claude' | 'settings' | 'files' | 'perf' | 'subagent' | 'android' | 'mcp' | 'task' | 'permissions' | 'room';
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(rooms): add 'room' channel to WsEnvelope"
```

---

### Task 4: Room Manager Service

**Files:**
- Create: `src/main/services/room-manager.ts`

This is the core orchestration service. It handles room CRUD, agent lifecycle, and message posting. It does NOT handle PM turn injection (that's `room-injection.ts` in Phase 3).

- [ ] **Step 1: Create room-manager.ts with Room CRUD and message utilities**

```typescript
// src/main/services/room-manager.ts

import { randomUUID } from 'crypto';
import {
  insertRoom, updateRoomPmAgent, updateRoomStatus, getRoom, getAllRooms,
  insertRoomAgent, updateRoomAgentStatus, updateRoomAgentSession,
  updateRoomAgentResult, updateRoomAgentActivity, updateRoomAgentTokens,
  getRoomAgent, getRoomAgents, getRoomAgentBySession,
  insertRoomMessage, getRoomMessages, updateReadCursor, getReadCursor,
  getDirectedUnreadForAgent, getOrphanedRoomAgents,
} from './db';
import type {
  Room, RoomAgent, RoomMessage, RoomAgentStatus, RoomMessageType,
} from '../../shared/room-types';

// ---- Config ----

const ROOM_LIMITS = {
  maxAgentsPerRoom: 8,
  maxTotalAgents: 15,
  maxActiveRooms: 5,
};

// ---- Helpers ----

function rowToRoom(row: Record<string, unknown>): Room {
  return {
    roomId: row.room_id as string,
    name: row.name as string,
    task: row.task as string,
    pmAgentId: row.pm_agent_id as string | null,
    status: row.status as Room['status'],
    tokenBudget: row.token_budget as number | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToAgent(row: Record<string, unknown>): RoomAgent {
  return {
    agentId: row.agent_id as string,
    roomId: row.room_id as string,
    role: row.role as string,
    claudeSessionId: row.claude_session_id as string | null,
    model: row.model as string | null,
    status: row.status as RoomAgentStatus,
    roomAware: (row.room_aware as number) === 1,
    prompt: row.prompt as string,
    result: row.result as string | null,
    tokensUsed: row.tokens_used as number,
    spawnedBy: row.spawned_by as string | null,
    workingDir: row.working_dir as string | null,
    lastActivityAt: row.last_activity_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToMessage(row: Record<string, unknown>): RoomMessage {
  return {
    messageId: row.message_id as string,
    roomId: row.room_id as string,
    fromAgentId: row.from_agent_id as string | null,
    toAgentId: row.to_agent_id as string | null,
    type: row.type as RoomMessageType,
    content: row.content as string,
    mentions: JSON.parse((row.mentions as string) || '[]'),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    seq: row.seq as number,
    timestamp: row.timestamp as string,
  };
}

// ---- Mention Resolution ----

function resolveMentions(content: string, roomAgents: RoomAgent[], toAgentId?: string): string[] {
  const mentionedIds = new Set<string>();

  // Always include explicit target
  if (toAgentId) mentionedIds.add(toAgentId);

  // Scan for @role patterns
  const mentionPattern = /@(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(content)) !== null) {
    const role = match[1].toLowerCase();
    for (const agent of roomAgents) {
      if (agent.role.toLowerCase() === role) {
        mentionedIds.add(agent.agentId);
      }
    }
  }

  return Array.from(mentionedIds);
}

// ---- Event Emitter for WebSocket Broadcasting ----

type RoomEventHandler = (event: { type: string; data: unknown }) => void;
let eventHandler: RoomEventHandler | null = null;

export function setRoomEventHandler(handler: RoomEventHandler): void {
  eventHandler = handler;
}

function emitRoomEvent(type: string, data: unknown): void {
  eventHandler?.({ type, data });
}

// ---- Room CRUD ----

export function createRoom(params: {
  name: string;
  task: string;
  pmSessionId: string;        // existing Claude session ID (envelope ID)
  pmClaudeSessionId?: string; // real Claude session ID
  pmModel?: string;
  pmPrompt?: string;
  workingDir?: string;
  tokenBudget?: number;
}): { roomId: string; agentId: string } {
  // Check limits
  const activeRooms = getAllRooms().filter(r => (r.status as string) === 'active');
  if (activeRooms.length >= ROOM_LIMITS.maxActiveRooms) {
    throw new Error(`Max active rooms (${ROOM_LIMITS.maxActiveRooms}) reached`);
  }

  const roomId = `room-${randomUUID().slice(0, 8)}`;
  const agentId = `pm-${randomUUID().slice(0, 8)}`;

  // All three ops in a single transaction (design doc §7.1)
  const { getDb } = require('./db');
  getDb().transaction(() => {
    // 1. Insert room (pm_agent_id = null initially)
    insertRoom({
      roomId,
      name: params.name,
      task: params.task,
      tokenBudget: params.tokenBudget ?? null,
    });

    // 2. Insert PM agent
    insertRoomAgent({
      agentId,
      roomId,
      role: 'pm',
      claudeSessionId: params.pmSessionId,
      model: params.pmModel ?? null,
      status: 'running',
      roomAware: true,
      prompt: params.pmPrompt || params.task,
      spawnedBy: null,
      workingDir: params.workingDir ?? null,
    });

    // 3. Update room with PM agent ID
    updateRoomPmAgent(roomId, agentId);
  })();

  // 4. Post system message
  postSystemMessage(roomId, `Room created. PM: pm. Task: "${params.task}"`);

  const room = rowToRoom(getRoom(roomId)!);
  emitRoomEvent('room_created', { room });

  return { roomId, agentId };
}

export function listRooms(): Room[] {
  return getAllRooms().map(rowToRoom);
}

export function getRoomDetail(roomId: string): {
  room: Room;
  agents: RoomAgent[];
  messages: RoomMessage[];
} | null {
  const row = getRoom(roomId);
  if (!row) return null;

  return {
    room: rowToRoom(row),
    agents: getRoomAgents(roomId).map(rowToAgent),
    messages: getRoomMessages(roomId, undefined, 100).map(rowToMessage),
  };
}

export function completeRoom(roomId: string, summary: string): void {
  // Dismiss all active agents
  const agents = getRoomAgents(roomId).map(rowToAgent);
  for (const agent of agents) {
    if (['running', 'spawning', 'idle'].includes(agent.status)) {
      updateRoomAgentStatus(agent.agentId, 'dismissed');
      emitRoomEvent('room_agent_updated', {
        agent: { ...agent, status: 'dismissed' },
      });
    }
  }

  updateRoomStatus(roomId, 'completed');
  postSystemMessage(roomId, `Room completed. Summary: ${summary}`);

  const room = rowToRoom(getRoom(roomId)!);
  emitRoomEvent('room_completed', { room, summary });
}

// ---- Agent Lifecycle ----

export function registerAgent(params: {
  roomId: string;
  role: string;
  model?: string;
  prompt: string;
  roomAware?: boolean;
  spawnedBy?: string;
  workingDir?: string;
}): { agentId: string } {
  // Check limits
  const roomAgents = getRoomAgents(params.roomId).map(rowToAgent);
  const activeAgents = roomAgents.filter(a =>
    ['running', 'spawning', 'idle'].includes(a.status)
  );
  if (activeAgents.length >= ROOM_LIMITS.maxAgentsPerRoom) {
    throw new Error(`Max agents per room (${ROOM_LIMITS.maxAgentsPerRoom}) reached`);
  }

  // Global agent cap across all rooms
  const allRooms = listRooms();
  let totalActive = 0;
  for (const r of allRooms) {
    const agents = listAgents(r.roomId);
    totalActive += agents.filter(a => ['running', 'spawning', 'idle'].includes(a.status)).length;
  }
  if (totalActive >= ROOM_LIMITS.maxTotalAgents) {
    throw new Error(`Max total agents across all rooms (${ROOM_LIMITS.maxTotalAgents}) reached`);
  }

  const agentId = `agent-${randomUUID().slice(0, 8)}`;

  insertRoomAgent({
    agentId,
    roomId: params.roomId,
    role: params.role,
    model: params.model ?? null,
    status: 'spawning',
    roomAware: params.roomAware !== false,
    prompt: params.prompt,
    spawnedBy: params.spawnedBy ?? null,
    workingDir: params.workingDir ?? null,
  });

  postSystemMessage(params.roomId, `Agent '${params.role}' (${agentId}) joined.`);

  const agent = rowToAgent(getRoomAgent(agentId)!);
  emitRoomEvent('room_agent_joined', { agent });

  return { agentId };
}

export function updateAgentStatus(agentId: string, status: RoomAgentStatus): void {
  updateRoomAgentStatus(agentId, status);
  const agent = rowToAgent(getRoomAgent(agentId)!);
  emitRoomEvent('room_agent_updated', { agent });
}

export function linkAgentSession(agentId: string, claudeSessionId: string): void {
  updateRoomAgentSession(agentId, claudeSessionId);
}

export function setAgentResult(agentId: string, result: string): void {
  updateRoomAgentResult(agentId, result);
}

export function setAgentActivity(agentId: string): void {
  updateRoomAgentActivity(agentId);
}

export function addAgentTokens(agentId: string, tokens: number): void {
  const agent = rowToAgent(getRoomAgent(agentId)!);
  updateRoomAgentTokens(agentId, agent.tokensUsed + tokens);
}

export function getAgentState(agentId: string): RoomAgent | null {
  const row = getRoomAgent(agentId);
  return row ? rowToAgent(row) : null;
}

export function listAgents(roomId: string): RoomAgent[] {
  return getRoomAgents(roomId).map(rowToAgent);
}

export function getAgentBySession(claudeSessionId: string): RoomAgent | null {
  const row = getRoomAgentBySession(claudeSessionId);
  return row ? rowToAgent(row) : null;
}

// ---- Messages ----

export function postMessage(params: {
  roomId: string;
  fromAgentId?: string;
  toAgentId?: string;
  type: RoomMessageType;
  content: string;
  metadata?: unknown;
}): RoomMessage {
  const roomAgents = getRoomAgents(params.roomId).map(rowToAgent);
  const mentions = resolveMentions(params.content, roomAgents, params.toAgentId);

  const messageId = `msg-${randomUUID().slice(0, 8)}`;
  const { seq } = insertRoomMessage({
    messageId,
    roomId: params.roomId,
    fromAgentId: params.fromAgentId ?? null,
    toAgentId: params.toAgentId ?? null,
    type: params.type,
    content: params.content,
    mentions,
    metadata: params.metadata,
  });

  const message: RoomMessage = {
    messageId,
    roomId: params.roomId,
    fromAgentId: params.fromAgentId ?? null,
    toAgentId: params.toAgentId ?? null,
    type: params.type,
    content: params.content,
    mentions,
    metadata: params.metadata ?? null,
    seq,
    timestamp: new Date().toISOString(),
  };

  emitRoomEvent('room_message', { message });

  return message;
}

function postSystemMessage(roomId: string, content: string): RoomMessage {
  return postMessage({
    roomId,
    type: 'system',
    content,
  });
}

export function readMessages(roomId: string, agentId: string, since?: number, limit?: number): RoomMessage[] {
  const cursor = since ?? getReadCursor(agentId, roomId);
  const rows = getRoomMessages(roomId, cursor, limit || 50);
  const messages = rows.map(rowToMessage);

  // Auto-update cursor
  if (messages.length > 0) {
    const maxSeq = messages[messages.length - 1].seq;
    updateReadCursor(agentId, roomId, maxSeq);
  }

  return messages;
}

export function hasUnreadDirected(roomId: string, agentId: string): boolean {
  return getDirectedUnreadForAgent(roomId, agentId) > 0;
}

// ---- System Prompt Builder ----

export function buildRoomSystemPrompt(params: {
  roomId: string;
  roomName: string;
  role: string;
  agentId: string;
  agents: RoomAgent[];
}): string {
  const agentList = params.agents
    .map(a => `- ${a.role} (${a.agentId}) — status: ${a.status}${a.agentId === params.agentId ? ' (that\'s you)' : ''}`)
    .join('\n');

  const isWorker = params.role !== 'pm';

  return `
--- ROOM CONTEXT ---
You are working in Room "${params.roomName}" (room_id: ${params.roomId}).
Your role: ${params.role}
Your agent ID: ${params.agentId}

Current agents in this room:
${agentList}

You have MCP tools for room communication:
- room_post_message(message, type?, to?) — post to room group chat
- room_read_messages(since?, limit?) — read room messages
- room_list_agents() — see all agents in the room
- room_get_agent_state(agentId) — check another agent's status
${isWorker ? '- room_signal_done(summary) — signal that your task is complete' : '- room_spawn_agent(role, prompt, model?, ...) — spawn a new agent\n- room_dismiss_agent(agentId) — dismiss an agent\n- room_complete(summary) — complete the room'}

IMPORTANT:
- After completing each significant step, call room_read_messages() to check for new directives or questions from other agents.
- If another agent asks you a question (message directed to you), respond via room_post_message().
${isWorker ? '- When your assigned task is fully complete, call room_signal_done() with a summary.' : '- You are the PM. Coordinate work, route information, and make decisions.'}
- All communication is visible to the entire room. There are no private messages.
--- END ROOM CONTEXT ---`.trim();
}

// ---- Orphan Recovery ----

export function reconcileOrphanedAgents(): { count: number } {
  const orphans = getOrphanedRoomAgents();
  for (const row of orphans) {
    updateRoomAgentStatus(row.agent_id as string, 'dead');
    const agent = rowToAgent(getRoomAgent(row.agent_id as string)!);

    postSystemMessage(
      agent.roomId,
      `Agent '${agent.role}' (${agent.agentId}) marked dead after Zeus restart.`
    );

    emitRoomEvent('room_agent_updated', { agent: { ...agent, status: 'dead' } });
  }

  // Post room-level system messages
  const affectedRooms = new Set(orphans.map(r => r.room_id as string));
  for (const roomId of affectedRooms) {
    const agents = orphans.filter(r => r.room_id === roomId);
    postSystemMessage(roomId, `Zeus restarted. ${agents.length} agent(s) need recovery.`);
  }

  return { count: orphans.length };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/room-manager.ts
git commit -m "feat(rooms): add room-manager service with CRUD, agent lifecycle, and messaging"
```

---

### Task 5: Zeus Room MCP Server

**Files:**
- Create: `src/main/mcp/zeus-room.ts`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: Read zeus-bridge.ts to understand MCP server pattern**

Read `src/main/mcp/zeus-bridge.ts` to understand the WebSocket connection pattern and tool registration.

- [ ] **Step 2: Create zeus-room.ts MCP server**

This MCP server is spawned as a child process by Claude CLI. It connects to Zeus via WebSocket and exposes room tools. The tool set depends on `ZEUS_AGENT_ROLE` env var.

```typescript
// src/main/mcp/zeus-room.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

// ---- Env ----
const ROOM_ID = process.env.ZEUS_ROOM_ID!;
const AGENT_ID = process.env.ZEUS_AGENT_ID!;
const AGENT_ROLE = process.env.ZEUS_AGENT_ROLE || 'worker'; // 'pm' | 'worker'
const WS_URL = process.env.ZEUS_WS_URL || 'ws://127.0.0.1:8888';

if (!ROOM_ID || !AGENT_ID) {
  console.error('zeus-room: ZEUS_ROOM_ID and ZEUS_AGENT_ID required');
  process.exit(1);
}

// ---- WS Connection ----
let ws: WebSocket | null = null;
let responseHandlers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve());
    ws.on('error', (err) => reject(err));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.responseId && responseHandlers.has(msg.responseId)) {
          const handler = responseHandlers.get(msg.responseId)!;
          responseHandlers.delete(msg.responseId);
          handler.resolve(msg.payload);
        }
      } catch { /* ignore parse errors */ }
    });
    ws.on('close', () => {
      // Reconnect after delay
      setTimeout(() => connectWs().catch(() => {}), 2000);
    });
  });
}

function sendRequest(channel: string, type: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('WebSocket not connected'));
    }

    const responseId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    responseHandlers.set(responseId, { resolve, reject });

    ws.send(JSON.stringify({
      channel,
      sessionId: ROOM_ID,
      payload: { ...payload, type, agentId: AGENT_ID, roomId: ROOM_ID },
      auth: '',
      responseId,
    }));

    // Timeout after 30s
    setTimeout(() => {
      if (responseHandlers.has(responseId)) {
        responseHandlers.delete(responseId);
        reject(new Error('Request timed out'));
      }
    }, 30000);
  });
}

// ---- Tool Definitions ----

const WORKER_TOOLS = [
  {
    name: 'room_post_message',
    description: 'Post a message to the room group chat. All agents can see it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Message content (markdown supported)' },
        type: {
          type: 'string',
          enum: ['directive', 'finding', 'question', 'status_update', 'error'],
          description: 'Message type (default: finding)',
        },
        to: { type: 'string', description: 'Target agent ID for directed message (still visible to all)' },
      },
      required: ['message'],
    },
  },
  {
    name: 'room_read_messages',
    description: 'Read new messages from the room. Auto-advances your read cursor.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: { type: 'number', description: 'Read messages after this seq number (default: your cursor)' },
        limit: { type: 'number', description: 'Max messages to return (default: 50)' },
      },
    },
  },
  {
    name: 'room_list_agents',
    description: 'List all agents in the room with their current status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'room_get_agent_state',
    description: 'Get detailed state of a specific agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent ID to inspect' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'room_signal_done',
    description: 'Signal that your assigned task is complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Summary of what you accomplished' },
      },
      required: ['summary'],
    },
  },
];

const PM_ONLY_TOOLS = [
  {
    name: 'room_spawn_agent',
    description: 'Spawn a new agent in the room. Returns immediately — agent boots in background.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        role: { type: 'string', description: 'Agent role (e.g., architect, tester, qa, reviewer)' },
        model: { type: 'string', description: 'Claude model (default: claude-sonnet-4-6)' },
        prompt: { type: 'string', description: 'Task instructions for the agent' },
        roomAware: { type: 'boolean', description: 'Give agent room tools (default: true). False = isolated.' },
        permissionMode: { type: 'string', description: 'Permission mode (default: bypassPermissions)' },
        workingDir: { type: 'string', description: 'Working directory (default: PM working dir)' },
      },
      required: ['role', 'prompt'],
    },
  },
  {
    name: 'room_dismiss_agent',
    description: 'Dismiss an agent from the room.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID to dismiss' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'room_pause_agent',
    description: 'Pause an agent (can be resumed later).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID to pause' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'room_resume_agent',
    description: 'Resume a paused agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID to resume' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'room_get_agent_log',
    description: 'Get the full conversation log of an agent (tool calls, thinking, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        limit: { type: 'number', description: 'Max entries (default: 50)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'room_replace_pm',
    description: 'Replace the PM with a new session (different model or prompt).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        newModel: { type: 'string', description: 'New model for PM' },
        newPrompt: { type: 'string', description: 'New instructions for PM' },
      },
    },
  },
  {
    name: 'room_complete',
    description: 'Complete the room. Dismisses all agents, marks room as completed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Final summary of room output' },
      },
      required: ['summary'],
    },
  },
];

// ---- MCP Server ----

const server = new Server(
  { name: 'zeus-room', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = AGENT_ROLE === 'pm'
    ? [...WORKER_TOOLS, ...PM_ONLY_TOOLS]
    : WORKER_TOOLS;
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await sendRequest('room', name, args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

// ---- Main ----

async function main(): Promise<void> {
  await connectWs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('zeus-room failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Add mcp-zeus-room to build config**

In `electron.vite.config.ts`, add to the `rollupOptions.input`:

```typescript
// Before:
input: {
  index: 'src/main/index.ts',
  'mcp-qa-server': 'src/main/mcp/qa-server.ts',
  'mcp-zeus-bridge': 'src/main/mcp/zeus-bridge.ts',
  'mcp-android-qa-extras': 'src/main/mcp/android-qa-extras.ts',
}

// After:
input: {
  index: 'src/main/index.ts',
  'mcp-qa-server': 'src/main/mcp/qa-server.ts',
  'mcp-zeus-bridge': 'src/main/mcp/zeus-bridge.ts',
  'mcp-android-qa-extras': 'src/main/mcp/android-qa-extras.ts',
  'mcp-zeus-room': 'src/main/mcp/zeus-room.ts',
}
```

- [ ] **Step 4: Run typecheck and build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/zeus-room.ts electron.vite.config.ts
git commit -m "feat(rooms): add zeus-room MCP server with PM and worker tool sets"
```

---

### Task 6: Zeus Bridge — Room Proxy Tools

**Files:**
- Modify: `src/main/mcp/zeus-bridge.ts`

The PM session uses `zeus-bridge` (already injected) to create rooms and orchestrate. We add `room_create` and proxy tools so the PM can operate without restarting.

- [ ] **Step 1: Read zeus-bridge.ts fully**

Read `src/main/mcp/zeus-bridge.ts` to understand the existing tool registration and WebSocket request pattern.

- [ ] **Step 2: Add room tools to zeus-bridge.ts**

Add these tools to the `ListToolsRequestSchema` handler and their implementations to `CallToolRequestSchema`:

**New tools on zeus-bridge:**
- `room_create` — create a new room (PM = calling session)
- `room_spawn_agent` — proxy to room-manager
- `room_post_message` — proxy to room-manager
- `room_read_messages` — proxy to room-manager
- `room_list_agents` — proxy to room-manager
- `room_dismiss_agent` — proxy to room-manager
- `room_complete` — proxy to room-manager

All proxy tools send a `channel: 'room'` WebSocket message and await the response.

```typescript
// Add to the tools array in ListToolsRequestSchema handler:
{
  name: 'room_create',
  description: 'Create a new agent room. You become the PM (Project Manager).',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Room name' },
      task: { type: 'string', description: 'Task description for the room' },
    },
    required: ['name', 'task'],
  },
},
{
  name: 'room_spawn_agent',
  description: 'Spawn a new agent in your room. Returns immediately.',
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'Agent role' },
      model: { type: 'string', description: 'Model (default: claude-sonnet-4-6)' },
      prompt: { type: 'string', description: 'Agent instructions' },
      roomAware: { type: 'boolean', description: 'Give room tools (default: true)' },
      permissionMode: { type: 'string' },
      workingDir: { type: 'string' },
    },
    required: ['role', 'prompt'],
  },
},
{
  name: 'room_post_message',
  description: 'Post a message to your room group chat.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      type: { type: 'string', enum: ['directive', 'finding', 'question', 'status_update', 'error'] },
      to: { type: 'string', description: 'Target agent ID' },
    },
    required: ['message'],
  },
},
{
  name: 'room_read_messages',
  description: 'Read messages from your room.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'number' },
      limit: { type: 'number' },
    },
  },
},
{
  name: 'room_list_agents',
  description: 'List agents in your room.',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'room_dismiss_agent',
  description: 'Dismiss an agent from your room.',
  inputSchema: {
    type: 'object',
    properties: { agentId: { type: 'string' } },
    required: ['agentId'],
  },
},
{
  name: 'room_complete',
  description: 'Complete the room.',
  inputSchema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
  },
},

// In CallToolRequestSchema handler, add cases:
// All room_* tools route through:
// sendRequest('room', toolName, { ...args, sessionId: ZEUS_SESSION_ID })
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/zeus-bridge.ts
git commit -m "feat(rooms): add room proxy tools to zeus-bridge MCP server"
```

---

### Task 7: WebSocket — Room Channel Handler

**Files:**
- Modify: `src/main/services/websocket.ts`

- [ ] **Step 1: Read websocket.ts to find the channel dispatch switch**

Find the main `ws.on('message', ...)` handler that dispatches to `handleControl`, `handleClaude`, etc.

- [ ] **Step 2: Add handleRoom function and wire it into the dispatch**

Add a `handleRoom(ws, envelope)` function that handles:
- Client → Server requests: `create_room`, `spawn_agent`, `dismiss_agent`, `post_message`, `list_rooms`, `get_room`
- MCP proxy requests from `zeus-bridge` and `zeus-room`: `room_create`, `room_spawn_agent`, `room_post_message`, `room_read_messages`, `room_list_agents`, `room_get_agent_state`, `room_dismiss_agent`, `room_signal_done`, `room_complete`, `room_get_agent_log`, `room_pause_agent`, `room_resume_agent`

```typescript
// Import room-manager at top of websocket.ts
import * as roomManager from './room-manager';
import type { RoomWsPayload } from '../../shared/room-types';

// In the init function, wire the event handler:
roomManager.setRoomEventHandler((event) => {
  broadcastEnvelope({
    channel: 'room',
    sessionId: '',
    payload: { type: event.type, ...event.data },
    auth: '',
  });
});

// Add to the channel dispatch:
case 'room':
  handleRoom(ws, envelope);
  break;
```

The `handleRoom` function routes MCP tool calls from `zeus-room` and `zeus-bridge` to `room-manager.ts`, and returns results via `responseId`. It also handles agent spawning by creating `ClaudeSession` instances with room context.

Key implementation details:
- `room_spawn_agent` creates a `ClaudeSession`, wires it similar to `wireSubagent()`, and registers it in `room-manager`
- `room_signal_done` updates agent status and posts the system message
- All responses use the `responseId` pattern from `zeus-bridge`

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(rooms): add room channel handler to WebSocket service"
```

---

## Phase 2: Spawn & Lifecycle

### Task 8: ClaudeSession — turnState and Room Options

**Files:**
- Modify: `src/main/services/claude-session.ts`

- [ ] **Step 1: Read claude-session.ts to understand current state tracking**

Read the `ClaudeSession` class, focusing on `_isRunning`, the event handlers, and `buildArgs()`.

- [ ] **Step 2: Add turnState property**

```typescript
// Add private property:
private _turnState: 'idle' | 'processing' | 'waiting_approval' = 'idle';

// Add getter:
get turnState() { return this._turnState; }

// Wire state transitions in existing event handlers:
// In start() after sendUserMessage:      this._turnState = 'processing';
// In sendMessage():                      this._turnState = 'processing';
// On 'result' event:                     this._turnState = 'idle';
// On 'approval_needed' (control_request): this._turnState = 'waiting_approval';
// On approveTool/denyTool:               this._turnState = 'processing';
// On 'done' / 'error':                  this._turnState = 'idle';
```

- [ ] **Step 3: Add room options to SessionOptions**

```typescript
// Extend SessionOptions:
interface SessionOptions {
  // ... existing fields ...
  roomId?: string;
  agentId?: string;
  agentRole?: string;     // 'pm' | 'worker'
  roomAware?: boolean;    // default true
  systemPromptAppend?: string; // room context to append
}
```

- [ ] **Step 4: Inject zeus-room MCP in buildArgs()**

In `buildArgs()`, after the `zeus-bridge` injection block, add:

```typescript
// Room MCP injection for room-aware agents
if (this.options.roomId && this.options.roomAware !== false && !this.options.subagentId) {
  const roomPath = path.resolve(app.getAppPath(), 'out/main/mcp-zeus-room.mjs');
  mcpServers['zeus-room'] = {
    command: 'node',
    args: [roomPath],
    env: {
      ZEUS_ROOM_ID: this.options.roomId,
      ZEUS_AGENT_ID: this.options.agentId || '',
      ZEUS_AGENT_ROLE: this.options.agentRole || 'worker',
      ZEUS_WS_URL: wsUrl,
    },
  };
}
```

- [ ] **Step 5: Append room system prompt**

In `start()`, before `sendUserMessage(prompt)`, if `this.options.systemPromptAppend` is set, append it to the prompt:

```typescript
const fullPrompt = this.options.systemPromptAppend
  ? `${prompt}\n\n${this.options.systemPromptAppend}`
  : prompt;
// then: sendUserMessage(fullPrompt)
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/main/services/claude-session.ts
git commit -m "feat(rooms): add turnState, room options, and zeus-room MCP injection to ClaudeSession"
```

---

### Task 9: Room Agent Spawning in WebSocket

**Files:**
- Modify: `src/main/services/websocket.ts`

This task implements the actual agent spawn logic in `handleRoom`. When `room_spawn_agent` is called, we create a `ClaudeSession` with room context and wire it up.

- [ ] **Step 1: Implement wireRoomAgent function**

```typescript
function wireRoomAgent(
  agentId: string,
  roomId: string,
  session: ClaudeSession,
  roomAware: boolean
): void {
  // Track the session
  // Similar pattern to wireSubagent but simpler — no deferred response

  session.on('session_id', (claudeSessionId: string) => {
    roomManager.linkAgentSession(agentId, claudeSessionId);
    roomManager.updateAgentStatus(agentId, 'running');
  });

  session.on('entry', (entries: NormalizedEntry[]) => {
    // Update last activity
    roomManager.setAgentActivity(agentId);

    // Track token usage
    for (const entry of entries) {
      if (entry.entryType.type === 'token_usage') {
        roomManager.addAgentTokens(agentId, entry.entryType.totalTokens);
      }
    }

    // Broadcast entries for the agent's individual session view
    for (const entry of entries) {
      broadcastEnvelope({
        channel: 'claude',
        sessionId: session.zeusSessionId,
        payload: { type: 'claude_entry_added', sessionId: session.zeusSessionId, entry },
        auth: '',
      });
    }
  });

  session.on('result', () => {
    // Check for unread directed messages (Layer 2 nudge)
    if (roomAware && roomManager.hasUnreadDirected(roomId, agentId)) {
      // Inject follow-up turn
      session.sendMessage('You have unread room messages directed at you. Call room_read_messages() before continuing.');
    }
  });

  session.on('done', () => {
    const agent = roomManager.getAgentState(agentId);
    if (agent && agent.status === 'running') {
      // If agent didn't signal done, capture last assistant message
      if (!roomAware) {
        // Isolated agent — capture result from last entry
        const entries = getClaudeEntries(session.zeusSessionId);
        const lastAssistant = [...entries].reverse().find(
          e => e.entryType.type === 'assistant_message'
        );
        if (lastAssistant) {
          roomManager.setAgentResult(agentId, lastAssistant.content);
        }
        roomManager.postMessage({
          roomId,
          type: 'system',
          content: `Isolated agent '${agent.role}' finished.`,
        });
      }
      roomManager.updateAgentStatus(agentId, 'done');
    }
  });

  session.on('error', (err: Error) => {
    roomManager.updateAgentStatus(agentId, 'dead');
    roomManager.setAgentResult(agentId, `Error: ${err.message}`);
    roomManager.postMessage({
      roomId,
      type: 'error',
      content: `Agent '${roomManager.getAgentState(agentId)?.role}' crashed: ${err.message}`,
    });
    // Trigger immediate PM injection for agent crash
    roomInjection.onAgentStatusChange(roomId, agentId, 'dead', err.message);
  });
}
```

- [ ] **Step 2: Implement spawn_agent handler in handleRoom**

```typescript
// In handleRoom, case 'room_spawn_agent':
const { role, model, prompt, roomAware, permissionMode, workingDir } = payload;
const pmAgent = roomManager.getAgentState(payload.agentId);
const room = roomManager.getRoomDetail(payload.roomId);
if (!room) throw new Error('Room not found');

// Register agent
const { agentId: newAgentId } = roomManager.registerAgent({
  roomId: payload.roomId,
  role,
  model,
  prompt,
  roomAware: roomAware !== false,
  spawnedBy: payload.agentId,
  workingDir: workingDir || pmAgent?.workingDir || undefined,
});

// Build room system prompt
const roomPrompt = roomAware !== false
  ? roomManager.buildRoomSystemPrompt({
      roomId: payload.roomId,
      roomName: room.room.name,
      role,
      agentId: newAgentId,
      agents: room.agents,
    })
  : undefined;

// Create Claude session
const sessionId = randomUUID();
const session = new ClaudeSession({
  workingDir: workingDir || pmAgent?.workingDir || process.cwd(),
  permissionMode: permissionMode || 'bypassPermissions',
  model: model || 'claude-sonnet-4-6',
  zeusSessionId: sessionId,
  roomId: payload.roomId,
  agentId: newAgentId,
  agentRole: 'worker',
  roomAware: roomAware !== false,
  systemPromptAppend: roomPrompt,
});

// Persist to DB
insertClaudeSession({
  id: sessionId,
  prompt,
  workingDir: workingDir || pmAgent?.workingDir || process.cwd(),
  permissionMode: permissionMode || 'bypassPermissions',
  model: model || 'claude-sonnet-4-6',
  startedAt: Date.now(),
  status: 'running',
});

// Wire and start
wireRoomAgent(newAgentId, payload.roomId, session, roomAware !== false);
await session.start(prompt);

// Return immediately
sendResponse(ws, envelope.responseId, { agentId: newAgentId, status: 'spawning' });
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(rooms): implement room agent spawning with session wiring"
```

---

## Phase 3: PM Turn Injection

### Task 10: Room Injection Service

**Files:**
- Create: `src/main/services/room-injection.ts`

- [ ] **Step 1: Create room-injection.ts**

This module watches for room events and injects user turns into the PM's Claude session when appropriate.

```typescript
// src/main/services/room-injection.ts

import type { ClaudeSession } from './claude-session';
import type { RoomMessage, Room } from '../../shared/room-types';
import * as roomManager from './room-manager';

// ---- Types ----

interface PendingInjection {
  roomId: string;
  events: InjectionEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

interface InjectionEvent {
  priority: 'immediate' | 'normal' | 'low';
  summary: string;
  timestamp: number;
}

// ---- State ----

// Map roomId → PM session reference
const pmSessions = new Map<string, ClaudeSession>();
const pendingInjections = new Map<string, PendingInjection>();
const BATCH_WINDOW_MS = 5000;

// ---- Public API ----

export function registerPmSession(roomId: string, session: ClaudeSession): void {
  pmSessions.set(roomId, session);
}

export function unregisterPmSession(roomId: string): void {
  pmSessions.delete(roomId);
  const pending = pendingInjections.get(roomId);
  if (pending?.timer) clearTimeout(pending.timer);
  pendingInjections.delete(roomId);
}

/**
 * Called when a room message is posted. Determines if and when to inject a PM turn.
 */
export function onRoomMessage(message: RoomMessage): void {
  const room = roomManager.getRoomDetail(message.roomId);
  if (!room) return;

  const pmAgentId = room.room.pmAgentId;
  if (!pmAgentId) return;

  // Don't inject for PM's own messages
  if (message.fromAgentId === pmAgentId) return;

  // Don't inject for agent-to-agent chatter (unless PM is mentioned)
  const pmMentioned = message.mentions.includes(pmAgentId) ||
                      message.toAgentId === pmAgentId;

  let priority: InjectionEvent['priority'] = 'normal';
  let shouldInject = false;

  switch (message.type) {
    case 'question':
      if (pmMentioned) {
        priority = 'immediate';
        shouldInject = true;
      }
      break;
    case 'error':
      priority = 'immediate';
      shouldInject = true;
      break;
    case 'signal_done':
      shouldInject = true;
      break;
    case 'finding':
      shouldInject = true;
      break;
    case 'system':
      // Check for specific system events
      if (message.content.includes('finished') || message.content.includes('crashed') || message.content.includes('failed')) {
        shouldInject = true;
      }
      // "All agents done" detection
      const agents = roomManager.listAgents(message.roomId);
      const activeAgents = agents.filter(a =>
        ['running', 'spawning'].includes(a.status) && a.agentId !== pmAgentId
      );
      if (activeAgents.length === 0 && agents.length > 1) {
        priority = 'immediate';
        shouldInject = true;
      }
      break;
    default:
      // Agent-to-agent chatter — no injection
      break;
  }

  if (!shouldInject) return;

  const event: InjectionEvent = {
    priority,
    summary: formatEventSummary(message, room.agents),
    timestamp: Date.now(),
  };

  if (priority === 'immediate') {
    flushInjection(message.roomId, [event]);
  } else {
    queueInjection(message.roomId, event);
  }
}

/**
 * Called when an agent status changes (for spawn failure, crash detection).
 */
export function onAgentStatusChange(roomId: string, agentId: string, status: string, error?: string): void {
  if (status === 'dead') {
    const agent = roomManager.getAgentState(agentId);
    const summary = `Agent '${agent?.role || agentId}' died${error ? ': ' + error : ''}`;
    flushInjection(roomId, [{
      priority: 'immediate',
      summary,
      timestamp: Date.now(),
    }]);
  }
}

// ---- Internal ----

function queueInjection(roomId: string, event: InjectionEvent): void {
  let pending = pendingInjections.get(roomId);
  if (!pending) {
    pending = { roomId, events: [], timer: null };
    pendingInjections.set(roomId, pending);
  }

  pending.events.push(event);

  // Reset batch timer
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    const events = pending!.events.splice(0);
    pending!.timer = null;
    if (events.length > 0) {
      flushInjection(roomId, events);
    }
  }, BATCH_WINDOW_MS);
}

function flushInjection(roomId: string, events: InjectionEvent[]): void {
  const session = pmSessions.get(roomId);
  if (!session) return;

  // Clear any pending batch for this room
  const pending = pendingInjections.get(roomId);
  if (pending) {
    // Include any other pending events
    events = [...events, ...pending.events.splice(0)];
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
  }

  // Check PM turn state
  if (session.turnState !== 'idle') {
    // Queue for later — will be delivered when PM goes idle
    if (!pending) {
      pendingInjections.set(roomId, { roomId, events, timer: null });
    } else {
      pending.events.push(...events);
    }

    // Watch for idle transition
    const onIdle = (): void => {
      session.removeListener('result', onIdle);
      session.removeListener('done', onIdle);
      const p = pendingInjections.get(roomId);
      if (p && p.events.length > 0) {
        const e = p.events.splice(0);
        flushInjection(roomId, e);
      }
    };
    session.once('result', onIdle);
    session.once('done', onIdle);
    return;
  }

  // Build injection message
  const summaries = events.map(e => `- ${e.summary}`).join('\n');
  const injectionText = `Room update (auto):\n${summaries}\n\nCheck room_read_messages() for full content. Decide next steps.`;

  // Inject user turn
  session.sendMessage(injectionText);
}

function formatEventSummary(
  message: RoomMessage,
  agents: Array<{ agentId: string; role: string }>
): string {
  const agentRole = agents.find(a => a.agentId === message.fromAgentId)?.role || 'unknown';

  switch (message.type) {
    case 'signal_done':
      return `@${agentRole} signaled done: "${message.content.slice(0, 80)}"`;
    case 'finding':
      return `@${agentRole} posted finding: "${message.content.slice(0, 80)}" (${message.content.length} chars)`;
    case 'question':
      return `@${agentRole} asks: "${message.content.slice(0, 80)}"`;
    case 'error':
      return `@${agentRole} error: "${message.content.slice(0, 80)}"`;
    case 'system':
      return message.content.slice(0, 100);
    default:
      return `@${agentRole}: ${message.type} — "${message.content.slice(0, 60)}"`;
  }
}

// ---- Zombie Detection ----

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
let zombieInterval: ReturnType<typeof setInterval> | null = null;

export function startZombieDetection(): void {
  if (zombieInterval) return;
  zombieInterval = setInterval(() => {
    const rooms = roomManager.listRooms().filter(r => r.status === 'active');
    for (const room of rooms) {
      const agents = roomManager.listAgents(room.roomId);
      for (const agent of agents) {
        if (agent.status !== 'running' || agent.role === 'pm') continue;
        if (!agent.lastActivityAt) continue;

        const idleMs = Date.now() - new Date(agent.lastActivityAt).getTime();
        if (idleMs > IDLE_THRESHOLD_MS) {
          roomManager.postMessage({
            roomId: room.roomId,
            type: 'system',
            content: `Agent '${agent.role}' (${agent.agentId}) appears idle (no activity for ${Math.round(idleMs / 60000)}m)`,
          });
        }
      }
    }
  }, 60000); // Check every minute
}

export function stopZombieDetection(): void {
  if (zombieInterval) {
    clearInterval(zombieInterval);
    zombieInterval = null;
  }
}
```

- [ ] **Step 2: Wire room-injection into websocket.ts**

In `websocket.ts`, after room messages are posted via `room-manager`, call `roomInjection.onRoomMessage(message)`.

In the `handleRoom` function, after `roomManager.postMessage(...)`:

```typescript
import * as roomInjection from './room-injection';

// After postMessage returns a message:
roomInjection.onRoomMessage(message);

// When creating a room, register PM session:
roomInjection.registerPmSession(roomId, pmSession);

// On room complete or PM death:
roomInjection.unregisterPmSession(roomId);

// On app startup:
roomInjection.startZombieDetection();
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/room-injection.ts src/main/services/websocket.ts
git commit -m "feat(rooms): add PM turn injection with batching, priorities, and zombie detection"
```

---

## Phase 4: Renderer — Room UI

### Task 11: Room State in Zustand Store

**Files:**
- Modify: `src/renderer/src/stores/useZeusStore.ts`

- [ ] **Step 1: Read the store to find the state interface and actions pattern**

Read `src/renderer/src/stores/useZeusStore.ts` — find where state slices are defined and where WebSocket listeners are wired.

- [ ] **Step 2: Add room state slice**

Add to the state interface:

```typescript
// Room state
rooms: Room[];
activeRoomId: string | null;
roomMessages: Record<string, RoomMessage[]>;  // roomId → messages
roomAgents: Record<string, RoomAgent[]>;       // roomId → agents
```

Initialize in `create()`:

```typescript
rooms: [],
activeRoomId: null,
roomMessages: {},
roomAgents: {},
```

- [ ] **Step 3: Add room WebSocket listener in connect()**

```typescript
zeusWs.on('room', (envelope) => {
  const payload = envelope.payload as RoomWsPayload;

  switch (payload.type) {
    case 'room_created': {
      set(s => ({ rooms: [...s.rooms, payload.room] }));
      break;
    }
    case 'room_updated': {
      set(s => ({
        rooms: s.rooms.map(r => r.roomId === payload.room.roomId ? payload.room : r),
      }));
      break;
    }
    case 'room_agent_joined': {
      set(s => ({
        roomAgents: {
          ...s.roomAgents,
          [payload.agent.roomId]: [
            ...(s.roomAgents[payload.agent.roomId] || []),
            payload.agent,
          ],
        },
      }));
      break;
    }
    case 'room_agent_updated': {
      set(s => ({
        roomAgents: {
          ...s.roomAgents,
          [payload.agent.roomId]: (s.roomAgents[payload.agent.roomId] || []).map(
            a => a.agentId === payload.agent.agentId ? payload.agent : a
          ),
        },
      }));
      break;
    }
    case 'room_message': {
      set(s => ({
        roomMessages: {
          ...s.roomMessages,
          [payload.message.roomId]: [
            ...(s.roomMessages[payload.message.roomId] || []),
            payload.message,
          ],
        },
      }));
      break;
    }
    case 'room_completed': {
      set(s => ({
        rooms: s.rooms.map(r => r.roomId === payload.room.roomId ? payload.room : r),
      }));
      break;
    }
    case 'room_list': {
      set({ rooms: payload.rooms });
      break;
    }
    case 'room_detail': {
      set(s => ({
        rooms: s.rooms.some(r => r.roomId === payload.room.roomId)
          ? s.rooms.map(r => r.roomId === payload.room.roomId ? payload.room : r)
          : [...s.rooms, payload.room],
        roomAgents: { ...s.roomAgents, [payload.room.roomId]: payload.agents },
        roomMessages: { ...s.roomMessages, [payload.room.roomId]: payload.messages },
      }));
      break;
    }
  }
});
```

- [ ] **Step 4: Add room actions**

```typescript
// Room actions
selectRoom: (roomId: string | null) => {
  set({ activeRoomId: roomId });
  if (roomId) {
    zeusWs.send({
      channel: 'room',
      sessionId: roomId,
      payload: { type: 'get_room', roomId },
      auth: '',
    });
  }
},

createRoom: (name: string, task: string, sessionId: string) => {
  zeusWs.send({
    channel: 'room',
    sessionId: '',
    payload: { type: 'create_room', name, task, sessionId },
    auth: '',
  });
},

spawnRoomAgent: (roomId: string, role: string, prompt: string, model?: string, roomAware?: boolean) => {
  zeusWs.send({
    channel: 'room',
    sessionId: roomId,
    payload: { type: 'spawn_agent', roomId, role, prompt, model, roomAware },
    auth: '',
  });
},

dismissRoomAgent: (roomId: string, agentId: string) => {
  zeusWs.send({
    channel: 'room',
    sessionId: roomId,
    payload: { type: 'dismiss_agent', roomId, agentId },
    auth: '',
  });
},

postRoomMessage: (roomId: string, message: string, msgType?: string) => {
  zeusWs.send({
    channel: 'room',
    sessionId: roomId,
    payload: { type: 'post_message', roomId, message, messageType: msgType || 'directive' },
    auth: '',
  });
},

fetchRooms: () => {
  zeusWs.send({
    channel: 'room',
    sessionId: '',
    payload: { type: 'list_rooms' },
    auth: '',
  });
},
```

- [ ] **Step 5: Add room list request on connect**

In the `_connected` handler, add:

```typescript
zeusWs.send({ channel: 'room', sessionId: '', payload: { type: 'list_rooms' }, auth: '' });
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/useZeusStore.ts
git commit -m "feat(rooms): add room state slice and actions to Zustand store"
```

---

### Task 12: RoomMessage Component

**Files:**
- Create: `src/renderer/src/components/RoomMessage.tsx`

- [ ] **Step 1: Create RoomMessage.tsx**

```tsx
// src/renderer/src/components/RoomMessage.tsx

import { Bot, User, AlertCircle, CheckCircle, HelpCircle, FileText, Activity, Terminal } from 'lucide-react';
import { Markdown } from './Markdown';
import type { RoomMessage as RoomMessageType, RoomAgent } from '../../../shared/room-types';

const TYPE_CONFIG: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  system:        { icon: Terminal,     color: 'text-zinc-500',  label: 'SYSTEM' },
  directive:     { icon: User,         color: 'text-blue-400',  label: 'directive' },
  finding:       { icon: FileText,     color: 'text-green-400', label: 'finding' },
  question:      { icon: HelpCircle,   color: 'text-yellow-400',label: 'question' },
  status_update: { icon: Activity,     color: 'text-purple-400',label: 'status' },
  signal_done:   { icon: CheckCircle,  color: 'text-emerald-400',label: 'done' },
  error:         { icon: AlertCircle,  color: 'text-red-400',   label: 'error' },
};

const ROLE_ICONS: Record<string, string> = {
  pm: '★',
  architect: '🏗',
  tester: '🧪',
  qa: '🔍',
  reviewer: '📋',
  frontend: '🎨',
  backend: '⚙️',
};

interface RoomMessageProps {
  message: RoomMessageType;
  agents: RoomAgent[];
}

export function RoomMessageItem({ message, agents }: RoomMessageProps): JSX.Element {
  const config = TYPE_CONFIG[message.type] || TYPE_CONFIG.system;
  const fromAgent = agents.find(a => a.agentId === message.fromAgentId);
  const toAgent = agents.find(a => a.agentId === message.toAgentId);
  const Icon = config.icon;

  // System messages are compact
  if (message.type === 'system') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-zinc-500">
        <Terminal className="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    );
  }

  const roleIcon = fromAgent ? (ROLE_ICONS[fromAgent.role] || '🤖') : '🤖';
  const roleName = fromAgent?.role || 'unknown';

  return (
    <div className="px-4 py-3 hover:bg-zinc-800/30 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{roleIcon}</span>
        <span className="text-sm font-medium text-zinc-200">{roleName}</span>
        {toAgent && (
          <>
            <span className="text-xs text-zinc-500">→</span>
            <span className="text-xs text-zinc-400">@{toAgent.role}</span>
          </>
        )}
        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${config.color} bg-zinc-800`}>
          {config.label}
        </span>
        <span className="text-xs text-zinc-600">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Content */}
      <div className="pl-6 text-sm text-zinc-300">
        <Markdown content={message.content} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/RoomMessage.tsx
git commit -m "feat(rooms): add RoomMessage component with type-based styling"
```

---

### Task 13: RoomAgentSidebar Component

**Files:**
- Create: `src/renderer/src/components/RoomAgentSidebar.tsx`

- [ ] **Step 1: Create RoomAgentSidebar.tsx**

```tsx
// src/renderer/src/components/RoomAgentSidebar.tsx

import { Plus, X, Pause, Play } from 'lucide-react';
import type { RoomAgent, Room } from '../../../shared/room-types';
import { useZeusStore } from '../stores/useZeusStore';
import { useState } from 'react';

const STATUS_COLORS: Record<string, string> = {
  spawning:  'text-yellow-400',
  running:   'text-green-400',
  idle:      'text-zinc-400',
  done:      'text-emerald-400',
  paused:    'text-orange-400',
  dismissed: 'text-zinc-600',
  dead:      'text-red-400',
};

const ROLE_ICONS: Record<string, string> = {
  pm: '★',
  architect: '🏗',
  tester: '🧪',
  qa: '🔍',
  reviewer: '📋',
  frontend: '🎨',
  backend: '⚙️',
};

interface RoomAgentSidebarProps {
  room: Room;
  agents: RoomAgent[];
  onAgentClick?: (agent: RoomAgent) => void;
}

export function RoomAgentSidebar({ room, agents, onAgentClick }: RoomAgentSidebarProps): JSX.Element {
  const { dismissRoomAgent, spawnRoomAgent } = useZeusStore();
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [spawnRole, setSpawnRole] = useState('');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnModel, setSpawnModel] = useState('claude-sonnet-4-6');

  const handleSpawn = (): void => {
    if (!spawnRole.trim() || !spawnPrompt.trim()) return;
    spawnRoomAgent(room.roomId, spawnRole, spawnPrompt, spawnModel);
    setSpawnRole('');
    setSpawnPrompt('');
    setShowSpawnForm(false);
  };

  const activeCount = agents.filter(a =>
    ['running', 'spawning', 'idle'].includes(a.status)
  ).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Agents ({activeCount} active)
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {agents.map(agent => (
          <button
            key={agent.agentId}
            onClick={() => onAgentClick?.(agent)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 transition-colors text-left"
          >
            <span className="text-sm">{ROLE_ICONS[agent.role] || '🤖'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-200 truncate">{agent.role}</div>
              <div className="text-xs text-zinc-500 truncate">{agent.model || 'default'}</div>
            </div>
            <span className={`text-xs ${STATUS_COLORS[agent.status] || 'text-zinc-500'}`}>
              {agent.status}
            </span>
            {agent.status === 'running' && agent.role !== 'pm' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismissRoomAgent(room.roomId, agent.agentId);
                }}
                className="p-0.5 hover:bg-zinc-700 rounded text-zinc-500 hover:text-red-400"
                title="Dismiss agent"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </button>
        ))}
      </div>

      {/* Spawn form */}
      {showSpawnForm ? (
        <div className="border-t border-zinc-800 p-3 space-y-2">
          <input
            value={spawnRole}
            onChange={e => setSpawnRole(e.target.value)}
            placeholder="Role (e.g., architect)"
            className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600"
          />
          <textarea
            value={spawnPrompt}
            onChange={e => setSpawnPrompt(e.target.value)}
            placeholder="Agent instructions..."
            rows={3}
            className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 resize-none"
          />
          <select
            value={spawnModel}
            onChange={e => setSpawnModel(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
          >
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleSpawn}
              disabled={!spawnRole.trim() || !spawnPrompt.trim()}
              className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white"
            >
              Spawn
            </button>
            <button
              onClick={() => setShowSpawnForm(false)}
              className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-zinc-800 p-2 space-y-1">
          {room.status === 'active' && (
            <button
              onClick={() => setShowSpawnForm(true)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            >
              <Plus className="w-3 h-3" /> Spawn Agent
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/RoomAgentSidebar.tsx
git commit -m "feat(rooms): add RoomAgentSidebar component with agent list and spawn form"
```

---

### Task 14: RoomView Component

**Files:**
- Create: `src/renderer/src/components/RoomView.tsx`

- [ ] **Step 1: Create RoomView.tsx**

This is the main room view — group chat feed on the left, agent sidebar on the right.

```tsx
// src/renderer/src/components/RoomView.tsx

import { useRef, useEffect, useState } from 'react';
import { Send, ArrowDown } from 'lucide-react';
import { useZeusStore } from '../stores/useZeusStore';
import { RoomMessageItem } from './RoomMessage';
import { RoomAgentSidebar } from './RoomAgentSidebar';
import type { RoomAgent } from '../../../shared/room-types';

export function RoomView(): JSX.Element | null {
  const {
    activeRoomId, rooms, roomMessages, roomAgents,
    postRoomMessage, selectClaudeSession,
  } = useZeusStore();

  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const room = rooms.find(r => r.roomId === activeRoomId);
  const messages = activeRoomId ? (roomMessages[activeRoomId] || []) : [];
  const agents = activeRoomId ? (roomAgents[activeRoomId] || []) : [];

  // Auto-scroll
  useEffect(() => {
    if (!userScrolled) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, userScrolled]);

  const handleScroll = (): void => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setUserScrolled(scrollHeight - scrollTop - clientHeight > 100);
  };

  const handleSend = (): void => {
    if (!input.trim() || !activeRoomId) return;
    postRoomMessage(activeRoomId, input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAgentClick = (agent: RoomAgent): void => {
    // Open agent's individual Claude session view
    if (agent.claudeSessionId) {
      selectClaudeSession(agent.claudeSessionId);
    }
  };

  if (!room || !activeRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        No room selected
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">{room.name}</h2>
            <p className="text-xs text-zinc-500 truncate max-w-md">{room.task}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              room.status === 'active' ? 'bg-green-900/30 text-green-400' :
              room.status === 'completed' ? 'bg-zinc-800 text-zinc-400' :
              'bg-yellow-900/30 text-yellow-400'
            }`}>
              {room.status}
            </span>
            <span className="text-xs text-zinc-500">
              {agents.filter(a => ['running', 'spawning'].includes(a.status)).length} agents active
            </span>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
            >
              {showSidebar ? 'Hide' : 'Show'} Agents
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          <div className="py-2">
            {messages.map(msg => (
              <RoomMessageItem key={msg.messageId} message={msg} agents={agents} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Scroll to bottom */}
        {userScrolled && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                setUserScrolled(false);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-full text-xs text-zinc-300 shadow-lg"
            >
              <ArrowDown className="w-3 h-3" /> New messages
            </button>
          </div>
        )}

        {/* Input */}
        {room.status === 'active' && (
          <div className="border-t border-zinc-800 p-3">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type directive to agents..."
                rows={1}
                className="flex-1 px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Agent Sidebar */}
      {showSidebar && (
        <div className="w-56 border-l border-zinc-800 bg-zinc-900/30">
          <RoomAgentSidebar
            room={room}
            agents={agents}
            onAgentClick={handleAgentClick}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/RoomView.tsx
git commit -m "feat(rooms): add RoomView component with group chat feed and agent sidebar"
```

---

### Task 15: Wire RoomView into App Layout

**Files:**
- Modify: `src/renderer/src/components/App.tsx`
- Modify: `src/renderer/src/components/SessionSidebar.tsx`
- Modify: `src/renderer/src/components/RightPanel.tsx`

- [ ] **Step 1: Read App.tsx to understand view mode routing**

Read `src/renderer/src/components/App.tsx` — find where `viewMode` is checked to render different views.

- [ ] **Step 2: Add 'room' to viewMode type and render RoomView**

In the `viewMode` type (in `useZeusStore.ts` or wherever defined), add `'room'`.

In `App.tsx`, add the import and render case:

```tsx
import { RoomView } from './RoomView';

// In the view switch:
{viewMode === 'room' && <RoomView />}
```

- [ ] **Step 3: Add rooms section to SessionSidebar**

Read `SessionSidebar.tsx` and add a rooms section below the Claude sessions list:

```tsx
// After the Claude sessions section:
{rooms.filter(r => r.status === 'active').length > 0 && (
  <div className="mt-4">
    <div className="px-3 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">
      Rooms
    </div>
    {rooms.filter(r => r.status === 'active').map(room => (
      <button
        key={room.roomId}
        onClick={() => {
          selectRoom(room.roomId);
          setViewMode('room');
        }}
        className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-800/50 ${
          activeRoomId === room.roomId ? 'bg-zinc-800' : ''
        }`}
      >
        <div className="text-zinc-200 truncate">{room.name}</div>
        <div className="text-xs text-zinc-500">
          {(roomAgents[room.roomId] || []).filter(a => a.status === 'running').length} agents
        </div>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/App.tsx src/renderer/src/components/SessionSidebar.tsx
git commit -m "feat(rooms): wire RoomView into app layout with sidebar room list"
```

---

## Phase 5: Resource Limits & Polish

### Task 16: Agent Caps and Token Tracking

**Files:**
- Modify: `src/main/services/room-manager.ts`
- Modify: `src/main/services/websocket.ts`

- [ ] **Step 1: Verify agent caps are working**

Both per-room and global caps are already in `registerAgent` (Task 4). Verify by checking that `room_spawn_agent` returns error payloads when limits are hit. The MCP tool result should include `{ error: "max_agents_reached", limit: N }`.

- [ ] **Step 2: Wire token tracking in wireRoomAgent**

Already handled in Task 9 — the `entry` handler checks for `token_usage` entries and calls `addAgentTokens`. Verify this works by checking that `room_list_agents` responses include `tokensUsed`.

- [ ] **Step 3: Add token budget warning logic**

In `room-injection.ts`, add a check after token updates:

```typescript
export function checkTokenBudget(roomId: string): void {
  const room = roomManager.getRoomDetail(roomId);
  if (!room || !room.room.tokenBudget) return;

  const totalTokens = room.agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const pct = totalTokens / room.room.tokenBudget;

  if (pct >= 1.0) {
    roomManager.postMessage({
      roomId,
      type: 'system',
      content: `Room token budget exceeded: ${totalTokens} / ${room.room.tokenBudget} tokens (100%)`,
    });
  } else if (pct >= 0.8) {
    roomManager.postMessage({
      roomId,
      type: 'system',
      content: `Room token budget 80% consumed: ${totalTokens} / ${room.room.tokenBudget} tokens`,
    });
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/room-manager.ts src/main/services/room-injection.ts src/main/services/websocket.ts
git commit -m "feat(rooms): add agent caps, token tracking, and budget warnings"
```

---

### Task 17: PM Death Detection and Recovery

**Files:**
- Modify: `src/main/services/websocket.ts`
- Modify: `src/main/services/room-manager.ts`

- [ ] **Step 1: Add PM death handling in wireRoomAgent**

When the PM's session emits `done` or `error`, check if it's the PM and trigger recovery:

```typescript
// In wireRoomAgent, on 'done' event:
if (agent.role === 'pm') {
  // Try resume first
  const resumeResult = await tryResumePmSession(roomId, session);
  if (!resumeResult) {
    // Mark PM as dead and post system message
    roomManager.updateAgentStatus(agentId, 'dead');
    roomManager.postMessage({
      roomId,
      type: 'system',
      content: 'PM session ended. Resume from UI to continue room orchestration.',
    });
    roomInjection.unregisterPmSession(roomId);
  }
}
```

- [ ] **Step 2: Add resumePm function to room-manager**

```typescript
export function buildPmResumeContext(roomId: string): string {
  const room = getRoomDetail(roomId);
  if (!room) return '';

  const agentList = room.agents
    .map(a => `- ${a.role} (${a.agentId}): status=${a.status}${a.result ? ', result: ' + a.result.slice(0, 100) : ''}`)
    .join('\n');

  const recentMessages = room.messages.slice(-50)
    .map(m => `[${m.type}] ${m.fromAgentId ? room.agents.find(a => a.agentId === m.fromAgentId)?.role || m.fromAgentId : 'SYSTEM'}: ${m.content.slice(0, 200)}`)
    .join('\n');

  return `You are resuming as PM for room "${room.room.name}".
Task: ${room.room.task}

Current agents:
${agentList}

Recent room messages:
${recentMessages}

Continue orchestrating. Check room_read_messages() for full context.`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/websocket.ts src/main/services/room-manager.ts
git commit -m "feat(rooms): add PM death detection and resume context builder"
```

---

### Task 18: Agent Pause/Resume

**Files:**
- Modify: `src/main/services/websocket.ts`
- Modify: `src/main/services/room-manager.ts`

- [ ] **Step 1: Implement pause_agent handler**

```typescript
// In handleRoom, case 'room_pause_agent':
const agent = roomManager.getAgentState(payload.agentId);
if (!agent) throw new Error('Agent not found');

// Find the Claude session and kill it (save resume data)
const session = activeSessions.get(agent.claudeSessionId);
if (session) {
  session.kill();
  // Store resume data on agent
  roomManager.updateAgentStatus(payload.agentId, 'paused');
}

roomManager.postMessage({
  roomId: payload.roomId,
  type: 'system',
  content: `Agent '${agent.role}' (${agent.agentId}) paused.`,
});
```

- [ ] **Step 2: Implement resume_agent handler**

```typescript
// In handleRoom, case 'room_resume_agent':
const agent = roomManager.getAgentState(payload.agentId);
if (!agent || agent.status !== 'paused') throw new Error('Agent not found or not paused');

// Resume via new ClaudeSession with resume options
const newSession = new ClaudeSession({
  workingDir: agent.workingDir || process.cwd(),
  resumeSessionId: agent.claudeSessionId,
  roomId: agent.roomId,
  agentId: agent.agentId,
  agentRole: agent.role === 'pm' ? 'pm' : 'worker',
  roomAware: agent.roomAware,
});

wireRoomAgent(agent.agentId, agent.roomId, newSession, agent.roomAware);
await newSession.start('You were paused. Check room_read_messages() for updates since you were away.');

roomManager.updateAgentStatus(payload.agentId, 'running');
roomManager.postMessage({
  roomId: payload.roomId,
  type: 'system',
  content: `Agent '${agent.role}' (${agent.agentId}) resumed.`,
});
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/websocket.ts src/main/services/room-manager.ts
git commit -m "feat(rooms): implement agent pause and resume"
```

---

### Task 19: Orphan Recovery on Startup

**Files:**
- Modify: `src/main/services/websocket.ts` (or main startup file)

- [ ] **Step 1: Call reconcileOrphanedAgents on app startup**

In the WebSocket service initialization (or main process startup), after DB is ready:

```typescript
import { reconcileOrphanedAgents } from './room-manager';

// On startup, after DB init:
const { count } = reconcileOrphanedAgents();
if (count > 0) {
  console.log(`[rooms] Reconciled ${count} orphaned agents after restart`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/websocket.ts
git commit -m "feat(rooms): reconcile orphaned room agents on Zeus startup"
```

---

### Task 20: Final Build and Verification

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: Run full build**

```bash
npm run build
```

- [ ] **Step 3: Fix any build errors**

Address any type errors or build issues discovered.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(rooms): resolve build errors for agent rooms feature"
```

---

### Task 21: PM Auto-Pause on Inactivity

**Files:**
- Modify: `src/main/services/room-injection.ts`

- [ ] **Step 1: Add PM inactivity detection to zombie detection loop**

In the `startZombieDetection` interval, add PM auto-pause logic:

```typescript
// After the worker zombie check loop, add PM auto-pause:
const PM_IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// Check PM inactivity
for (const room of rooms) {
  const pmAgent = agents.find(a => a.role === 'pm' && a.status === 'running');
  if (!pmAgent || !pmAgent.lastActivityAt) continue;

  const pmIdleMs = Date.now() - new Date(pmAgent.lastActivityAt).getTime();
  if (pmIdleMs > PM_IDLE_THRESHOLD_MS) {
    // Auto-pause all running agents to prevent unmonitored token burn
    const runningAgents = roomManager.listAgents(room.roomId)
      .filter(a => a.status === 'running' && a.agentId !== pmAgent.agentId);

    for (const agent of runningAgents) {
      roomManager.updateAgentStatus(agent.agentId, 'paused');
    }

    roomManager.postMessage({
      roomId: room.roomId,
      type: 'system',
      content: `PM idle for ${Math.round(pmIdleMs / 60000)}m. All ${runningAgents.length} running agents auto-paused to prevent unmonitored token burn.`,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/room-injection.ts
git commit -m "feat(rooms): add PM auto-pause on 15m inactivity"
```

---

### Task 22: Unit Tests for Room Manager

**Files:**
- Create: `src/main/__tests__/room-manager.test.ts`

- [ ] **Step 1: Create room-manager.test.ts**

Test the following:
- Room creation (returns roomId + agentId, PM is registered)
- Agent registration (respects per-room and global caps)
- Message posting (seq increments, mentions resolved)
- Read cursor semantics (auto-advance, only new messages returned)
- Mention resolution (`@architect` → correct agentId)
- System prompt building (PM vs worker tools listed)
- Room completion (all agents dismissed, status updated)
- Orphan recovery (running agents marked dead)

```typescript
// Key test structure:
import { initDatabase } from '../services/db';
import * as roomManager from '../services/room-manager';

beforeEach(() => {
  // Init in-memory test database
  initDatabase(); // needs mock or in-memory mode
});

describe('room-manager', () => {
  describe('createRoom', () => {
    it('creates room and PM agent in single transaction', () => { ... });
    it('throws when max active rooms exceeded', () => { ... });
  });

  describe('registerAgent', () => {
    it('creates agent with spawning status', () => { ... });
    it('throws when per-room agent limit exceeded', () => { ... });
    it('throws when global agent limit exceeded', () => { ... });
  });

  describe('postMessage', () => {
    it('increments seq per room', () => { ... });
    it('resolves @mentions to agent IDs', () => { ... });
    it('includes toAgentId in mentions', () => { ... });
  });

  describe('readMessages', () => {
    it('returns messages since cursor', () => { ... });
    it('auto-advances read cursor', () => { ... });
    it('respects limit parameter', () => { ... });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- --testPathPattern=room-manager
```

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/room-manager.test.ts
git commit -m "test(rooms): add unit tests for room-manager service"
```

---

### Task 23: Unit Tests for Room Injection

**Files:**
- Create: `src/main/__tests__/room-injection.test.ts`

- [ ] **Step 1: Create room-injection.test.ts**

Test the following:
- Event classification (which message types trigger injection, which don't)
- Priority levels (question→@pm = immediate, finding = normal, agent-to-agent = no injection)
- Batching (multiple events within 5s window → single injection)
- Immediate bypass (errors skip batch window)
- Turn state gating (injection queued when PM is processing, delivered when idle)
- PM auto-pause after 15m inactivity

```typescript
describe('room-injection', () => {
  describe('onRoomMessage', () => {
    it('does not inject for PM own messages', () => { ... });
    it('injects immediately for PM-directed questions', () => { ... });
    it('injects immediately for agent errors', () => { ... });
    it('batches findings within 5s window', () => { ... });
    it('does not inject for agent-to-agent chatter', () => { ... });
  });

  describe('turn state gating', () => {
    it('queues injection when PM is processing', () => { ... });
    it('flushes queued events when PM goes idle', () => { ... });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- --testPathPattern=room-injection
```

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/room-injection.test.ts
git commit -m "test(rooms): add unit tests for room injection service"
```

---

## Deferred Items (Future Tasks)

These items from the design doc are intentionally deferred to keep the initial implementation focused:

- **Context window overflow mitigation**: Proactive PM token tracking at 80%/95% thresholds (design doc §12.4)
- **Message summarization for PM respawn**: Summarize 200+ messages on respawn (design doc §12.4)
- **Max turn count**: Optional per-agent turn limit before PM alert (design doc §12.3)
- **Room archival**: Completed rooms as read-only archives with search/filter
- **Configurable thresholds**: UI for idle timeout, max turns, token budget settings
- **Tasks table `room_id` column**: Link rooms to git worktree tasks (design doc §7.4)

---

## Verification Checklist

After implementation, verify each capability:

1. **Room Creation**: PM session can call `room_create` via `zeus-bridge` and get `{ roomId, agentId }`
2. **Agent Spawning**: PM can call `room_spawn_agent` — agent boots, appears in sidebar, messages appear in feed
3. **Message Flow**: Agents post messages via `room_post_message`, visible in room feed and to other agents
4. **Read Cursors**: `room_read_messages` returns only new messages, cursor advances automatically
5. **PM Injection**: When agents post findings or signal done, PM gets auto-injected turn
6. **Batching**: Multiple rapid events result in single batched PM injection
7. **Zombie Detection**: Idle agents trigger system warnings after 5 minutes
8. **Agent Caps**: Spawning beyond limits returns error
9. **UI**: Room appears in sidebar, messages render correctly, agents show live status
10. **Agent Click-through**: Clicking agent in sidebar opens their individual session view
