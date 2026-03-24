// src/shared/room-types.ts
// All Agent Room types — single source of truth for the multi-agent coordination layer

import type { NormalizedEntry, PermissionMode } from './types';

// ─── Agent Persona ───

export interface AgentPersona {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Core Data Types ───

export type RoomStatus = 'active' | 'paused' | 'completed';

export interface Room {
  roomId: string;
  name: string;
  task: string;
  pmAgentId: string | null;
  status: RoomStatus;
  tokenBudget: number | null;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export type RoomAgentStatus = 'spawning' | 'running' | 'idle' | 'done' | 'paused' | 'dismissed' | 'dead';

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
  spawnedBy: string | null;       // agentId of the spawning agent
  workingDir: string | null;
  lastActivityAt: string | null;  // ISO 8601
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
}

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
  mentions: string[];        // agentIds mentioned in the message
  metadata: unknown;
  seq: number;               // monotonically increasing per room
  timestamp: string;         // ISO 8601
}

export interface RoomReadCursor {
  agentId: string;
  roomId: string;
  lastSeq: number;
  updatedAt: string;         // ISO 8601
}

// ─── MCP Tool Input Types ───

export interface RoomCreateInput {
  name: string;
  task: string;
}

export interface RoomSpawnAgentInput {
  role: string;
  model?: string;
  prompt?: string;              // optional if personaId provided
  personaId?: string;           // reference to AgentPersona template
  roomAware?: boolean;          // default true
  permissionMode?: PermissionMode;
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
  to?: string;                  // target agentId
}

export interface RoomReadMessagesInput {
  since?: number;               // seq number to read from
  limit?: number;               // default 50
}

export type RoomListAgentsInput = Record<string, never>;

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

// ─── WebSocket Payloads (Server → Client) ───

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

export interface RoomAgentEntryPayload {
  type: 'room_agent_entry';
  roomId: string;
  agentId: string;
  zeusSessionId: string;
  entry: NormalizedEntry;
}

export interface RoomAgentActivityPayload {
  type: 'room_agent_activity';
  roomId: string;
  agentId: string;
  activity: unknown;
}

export interface RoomAutoNavigatePayload {
  type: 'room_auto_navigate';
  roomId: string;
}

export type RoomWsPayload =
  | RoomCreatedPayload
  | RoomUpdatedPayload
  | RoomAgentJoinedPayload
  | RoomAgentUpdatedPayload
  | RoomMessagePayload
  | RoomCompletedPayload
  | RoomListPayload
  | RoomDetailPayload
  | RoomAgentEntryPayload
  | RoomAgentActivityPayload
  | RoomAutoNavigatePayload;

// ─── WebSocket Payloads (Client → Server) ───

export interface CreateRoomRequest {
  type: 'create_room';
  name: string;
  task: string;
  sessionId: string;
}

export interface SpawnAgentRequest {
  type: 'spawn_agent';
  roomId: string;
  role: string;
  prompt: string;
  model?: string;
  roomAware?: boolean;
  permissionMode?: PermissionMode;
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

export type RoomClientPayload =
  | CreateRoomRequest
  | SpawnAgentRequest
  | DismissAgentRequest
  | PostRoomMessageRequest
  | ListRoomsRequest
  | GetRoomRequest;
