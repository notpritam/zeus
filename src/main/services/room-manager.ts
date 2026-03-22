// src/main/services/room-manager.ts
// Core service for Agent Room CRUD, agent lifecycle, message posting, and read cursor management.

import { randomUUID } from 'crypto';
import {
  getDb,
  insertRoom,
  updateRoomPmAgent,
  updateRoomStatus,
  getRoom,
  getAllRooms,
  insertRoomAgent,
  updateRoomAgentStatus,
  updateRoomAgentSession,
  updateRoomAgentResult,
  updateRoomAgentActivity,
  updateRoomAgentTokens,
  getRoomAgent,
  getRoomAgents,
  getRoomAgentBySession,
  getOrphanedRoomAgents,
  insertRoomMessage,
  getRoomMessages,
  getDirectedUnreadForAgent,
  updateReadCursor,
} from './db';
import type {
  Room,
  RoomAgent,
  RoomAgentStatus,
  RoomMessage,
  RoomMessageType,
} from '../../shared/room-types';

// ─── Config Constants ───

const ROOM_LIMITS = {
  maxAgentsPerRoom: 8,
  maxTotalAgents: 15,
  maxActiveRooms: 5,
};

// ─── ID Generators ───

function makeRoomId(): string {
  return `room-${randomUUID().slice(0, 8)}`;
}

function makePmId(): string {
  return `pm-${randomUUID().slice(0, 8)}`;
}

function makeAgentId(): string {
  return `agent-${randomUUID().slice(0, 8)}`;
}

function makeMessageId(): string {
  return `msg-${randomUUID().slice(0, 8)}`;
}

// ─── Row-to-Type Converters ───

function rowToRoom(row: Record<string, unknown>): Room {
  return {
    roomId: row.room_id as string,
    name: row.name as string,
    task: row.task as string,
    pmAgentId: (row.pm_agent_id as string) ?? null,
    status: row.status as Room['status'],
    tokenBudget: (row.token_budget as number) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToAgent(row: Record<string, unknown>): RoomAgent {
  return {
    agentId: row.agent_id as string,
    roomId: row.room_id as string,
    role: row.role as string,
    claudeSessionId: (row.claude_session_id as string) ?? null,
    model: (row.model as string) ?? null,
    status: row.status as RoomAgentStatus,
    roomAware: (row.room_aware as number) === 1,
    prompt: row.prompt as string,
    result: (row.result as string) ?? null,
    tokensUsed: (row.tokens_used as number) ?? 0,
    spawnedBy: (row.spawned_by as string) ?? null,
    workingDir: (row.working_dir as string) ?? null,
    lastActivityAt: (row.last_activity_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToMessage(row: Record<string, unknown>): RoomMessage {
  let mentions: string[] = [];
  try {
    const raw = row.mentions as string | null;
    if (raw) {
      mentions = JSON.parse(raw) as string[];
    }
  } catch {
    mentions = [];
  }

  let metadata: unknown = null;
  try {
    const raw = row.metadata as string | null;
    if (raw) {
      metadata = JSON.parse(raw);
    }
  } catch {
    metadata = null;
  }

  return {
    messageId: row.message_id as string,
    roomId: row.room_id as string,
    fromAgentId: (row.from_agent_id as string) ?? null,
    toAgentId: (row.to_agent_id as string) ?? null,
    type: row.type as RoomMessageType,
    content: row.content as string,
    mentions,
    metadata,
    seq: row.seq as number,
    timestamp: row.timestamp as string,
  };
}

// ─── Mention Resolution ───

export function resolveMentions(
  content: string,
  roomAgents: RoomAgent[],
  toAgentId?: string
): string[] {
  const mentionedIds = new Set<string>();

  // Always include the explicit target
  if (toAgentId) {
    mentionedIds.add(toAgentId);
  }

  // Scan content for @<role> patterns (case-insensitive)
  const mentionPattern = /@(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(content)) !== null) {
    const mentionedRole = match[1].toLowerCase();
    for (const agent of roomAgents) {
      if (agent.role.toLowerCase() === mentionedRole) {
        mentionedIds.add(agent.agentId);
      }
    }
  }

  return Array.from(mentionedIds);
}

// ─── Event System ───

type RoomEventHandler = (event: { type: string; data: unknown }) => void;
let eventHandler: RoomEventHandler | null = null;

export function setRoomEventHandler(handler: RoomEventHandler): void {
  eventHandler = handler;
}

function emitRoomEvent(type: string, data: unknown): void {
  if (eventHandler) {
    eventHandler({ type, data });
  }
}

// ─── Room CRUD ───

export function createRoom(params: {
  name: string;
  task: string;
  pmPrompt?: string;
}): { roomId: string; agentId: string } {
  // Check active rooms limit
  const activeRooms = getAllRooms()
    .map(rowToRoom)
    .filter((r) => r.status === 'active');
  if (activeRooms.length >= ROOM_LIMITS.maxActiveRooms) {
    throw new Error(
      `Cannot create room: active room limit (${ROOM_LIMITS.maxActiveRooms}) reached`
    );
  }

  const roomId = makeRoomId();
  const agentId = makePmId();
  const now = new Date().toISOString();

  // Wrap all three operations in a single transaction
  const database = getDb();
  const createTx = database.transaction(() => {
    insertRoom({
      room_id: roomId,
      name: params.name,
      task: params.task,
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    insertRoomAgent({
      agent_id: agentId,
      room_id: roomId,
      role: 'pm',
      status: 'spawning',
      room_aware: 1,
      prompt: params.pmPrompt ?? `You are the Project Manager for room "${params.name}". Task: ${params.task}`,
      created_at: now,
      updated_at: now,
    });

    updateRoomPmAgent(roomId, agentId);
  });

  createTx();

  // Post system message (outside transaction — not critical)
  postSystemMessage(roomId, `Room "${params.name}" created. PM agent assigned.`);

  // Emit event
  const room = getRoom(roomId);
  if (room) {
    emitRoomEvent('room_created', { room: rowToRoom(room) });
  }

  return { roomId, agentId };
}

export function listRooms(): Room[] {
  return getAllRooms().map(rowToRoom);
}

export function getRoomDetail(
  roomId: string
): { room: Room; agents: RoomAgent[]; messages: RoomMessage[] } | null {
  const roomRow = getRoom(roomId);
  if (!roomRow) return null;

  const room = rowToRoom(roomRow);
  const agents = getRoomAgents(roomId).map(rowToAgent);
  const messages = getRoomMessages(roomId).map(rowToMessage);

  return { room, agents, messages };
}

export function completeRoom(roomId: string, summary: string): void {
  // Dismiss all active agents
  const agents = getRoomAgents(roomId).map(rowToAgent);
  const activeStatuses: RoomAgentStatus[] = ['spawning', 'running', 'idle', 'paused'];
  for (const agent of agents) {
    if (activeStatuses.includes(agent.status)) {
      updateRoomAgentStatus(agent.agentId, 'dismissed');
    }
  }

  // Update room status
  updateRoomStatus(roomId, 'completed');

  // Post system message
  postSystemMessage(roomId, `Room completed. Summary: ${summary}`);

  // Emit event
  const roomRow = getRoom(roomId);
  if (roomRow) {
    emitRoomEvent('room_completed', { room: rowToRoom(roomRow), summary });
  }
}

// ─── Agent Lifecycle ───

export function registerAgent(params: {
  roomId: string;
  role: string;
  prompt: string;
  model?: string;
  roomAware?: boolean;
  spawnedBy?: string;
  workingDir?: string;
}): { agentId: string } {
  // Check per-room agent cap
  const roomAgents = getRoomAgents(params.roomId).map(rowToAgent);
  const activeRoomAgents = roomAgents.filter((a) =>
    ['spawning', 'running', 'idle', 'paused'].includes(a.status)
  );
  if (activeRoomAgents.length >= ROOM_LIMITS.maxAgentsPerRoom) {
    throw new Error(
      `Cannot register agent: per-room limit (${ROOM_LIMITS.maxAgentsPerRoom}) reached`
    );
  }

  // Check global agent cap — count ALL active agents across ALL rooms
  const allRooms = getAllRooms().map(rowToRoom);
  let totalActiveAgents = 0;
  for (const room of allRooms) {
    const agents = getRoomAgents(room.roomId).map(rowToAgent);
    totalActiveAgents += agents.filter((a) =>
      ['spawning', 'running', 'idle', 'paused'].includes(a.status)
    ).length;
  }
  if (totalActiveAgents >= ROOM_LIMITS.maxTotalAgents) {
    throw new Error(
      `Cannot register agent: global agent limit (${ROOM_LIMITS.maxTotalAgents}) reached`
    );
  }

  const agentId = makeAgentId();
  const now = new Date().toISOString();

  insertRoomAgent({
    agent_id: agentId,
    room_id: params.roomId,
    role: params.role,
    model: params.model ?? null,
    status: 'spawning',
    room_aware: params.roomAware !== false ? 1 : 0,
    prompt: params.prompt,
    spawned_by: params.spawnedBy ?? null,
    working_dir: params.workingDir ?? null,
    created_at: now,
    updated_at: now,
  });

  // Post system message
  postSystemMessage(
    params.roomId,
    `Agent "${params.role}" (${agentId}) joined the room.`
  );

  // Emit event
  const agentRow = getRoomAgent(agentId);
  if (agentRow) {
    emitRoomEvent('room_agent_joined', { agent: rowToAgent(agentRow) });
  }

  return { agentId };
}

export function updateAgentStatus(agentId: string, status: RoomAgentStatus): void {
  updateRoomAgentStatus(agentId, status);

  const agentRow = getRoomAgent(agentId);
  if (agentRow) {
    emitRoomEvent('room_agent_updated', { agent: rowToAgent(agentRow) });
  }
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
  const agentRow = getRoomAgent(agentId);
  if (!agentRow) return;

  const currentTokens = (agentRow.tokens_used as number) ?? 0;
  updateRoomAgentTokens(agentId, currentTokens + tokens);
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

// ─── Messages ───

export function postMessage(params: {
  roomId: string;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  type: RoomMessageType;
  content: string;
  metadata?: unknown;
}): RoomMessage {
  // Resolve mentions
  const roomAgents = getRoomAgents(params.roomId).map(rowToAgent);
  const mentions = resolveMentions(
    params.content,
    roomAgents,
    params.toAgentId ?? undefined
  );

  const messageId = makeMessageId();
  const now = new Date().toISOString();

  const { seq } = insertRoomMessage({
    message_id: messageId,
    room_id: params.roomId,
    from_agent_id: params.fromAgentId ?? null,
    to_agent_id: params.toAgentId ?? null,
    type: params.type,
    content: params.content,
    mentions: JSON.stringify(mentions),
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    timestamp: now,
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
    timestamp: now,
  };

  emitRoomEvent('room_message', { message });

  return message;
}

function postSystemMessage(roomId: string, content: string): void {
  postMessage({
    roomId,
    fromAgentId: null,
    toAgentId: null,
    type: 'system',
    content,
  });
}

export function readMessages(
  roomId: string,
  agentId: string,
  since?: number,
  limit?: number
): RoomMessage[] {
  const rows = getRoomMessages(roomId, since, limit);
  const messages = rows.map(rowToMessage);

  // Auto-update read cursor to the highest seq in the returned messages
  if (messages.length > 0) {
    const maxSeq = messages[messages.length - 1].seq;
    updateReadCursor(agentId, roomId, maxSeq);
  }

  return messages;
}

export function hasUnreadDirected(roomId: string, agentId: string): boolean {
  return getDirectedUnreadForAgent(roomId, agentId) > 0;
}

// ─── System Prompt Builder ───

export function buildRoomSystemPrompt(params: {
  roomId: string;
  agentId: string;
  role: string;
  task: string;
  isPm: boolean;
  agents: RoomAgent[];
}): string {
  const agentList = params.agents
    .filter((a) => a.agentId !== params.agentId)
    .map((a) => `  - ${a.role} (${a.agentId}) [${a.status}]`)
    .join('\n');

  const pmTools = [
    'room_spawn_agent — Spawn a new worker agent into the room',
    'room_dismiss_agent — Dismiss an agent from the room',
    'room_post_message — Post a message to the room (use @role to mention)',
    'room_read_messages — Read recent messages from the room',
    'room_list_agents — List all agents in the room',
    'room_get_agent_state — Get detailed state of an agent',
    'room_signal_done — Signal that the task is complete',
    'room_complete — Complete the room with a summary',
  ];

  const workerTools = [
    'room_post_message — Post a message to the room (use @role to mention)',
    'room_read_messages — Read recent messages from the room',
    'room_list_agents — List all agents in the room',
    'room_signal_done — Signal that your work is done',
  ];

  const tools = params.isPm ? pmTools : workerTools;

  return [
    `## Agent Room Context`,
    ``,
    `You are operating inside an Agent Room.`,
    `- **Room:** ${params.task}`,
    `- **Your Role:** ${params.role} (${params.agentId})`,
    `- **Room ID:** ${params.roomId}`,
    ``,
    `### Other Agents in Room`,
    agentList || '  (none)',
    ``,
    `### Available Room Tools`,
    ...tools.map((t) => `  - ${t}`),
    ``,
    `### Communication Guidelines`,
    `- Use @role to mention specific agents in messages.`,
    `- Check for unread messages periodically with room_read_messages.`,
    `- Post findings, status updates, and questions to keep the team informed.`,
    params.isPm
      ? `- As PM, coordinate the team: assign tasks, review results, and decide when to complete the room.`
      : `- Report your findings back to the PM when done.`,
  ].join('\n');
}

// ─── Orphan Recovery ───

export function reconcileOrphanedAgents(): { count: number } {
  const orphaned = getOrphanedRoomAgents().map(rowToAgent);
  let count = 0;

  for (const agent of orphaned) {
    updateRoomAgentStatus(agent.agentId, 'dead');
    count++;

    // Post system message in the agent's room
    postSystemMessage(
      agent.roomId,
      `Agent "${agent.role}" (${agent.agentId}) marked as dead (orphaned recovery).`
    );
  }

  return { count };
}
