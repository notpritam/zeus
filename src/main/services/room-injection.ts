// src/main/services/room-injection.ts
// PM turn injection service — watches for room events and injects user turns
// into the PM's Claude session to wake it up when agents post findings,
// signal done, ask questions, or encounter errors.

import type { ClaudeSession } from './claude-session';
import type { RoomMessage, RoomAgent, RoomAgentStatus } from '../../shared/room-types';
import * as roomManager from './room-manager';

// ─── Types ───

interface InjectionEvent {
  priority: 'immediate' | 'normal' | 'low';
  summary: string;
  timestamp: number;
}

interface PendingInjection {
  roomId: string;
  events: InjectionEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── State ───

const pmSessions = new Map<string, ClaudeSession>();       // roomId → PM session
const pendingInjections = new Map<string, PendingInjection>();
const BATCH_WINDOW_MS = 5000;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;         // 5 minutes for worker agents
const PM_IDLE_THRESHOLD_MS = 15 * 60 * 1000;     // 15 minutes for PM
const ZOMBIE_CHECK_INTERVAL_MS = 60 * 1000;      // 60 seconds

let zombieInterval: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───

/**
 * Register a PM session for injection. Called when a PM agent's Claude session
 * is started so the injection service can send follow-up messages to it.
 */
export function registerPmSession(roomId: string, session: ClaudeSession): void {
  pmSessions.set(roomId, session);

  // Listen for session end so we clean up
  session.on('done', () => {
    unregisterPmSession(roomId);
  });

  console.log(`[RoomInjection] PM session registered for room ${roomId}`);
}

/**
 * Unregister a PM session and clean up any pending injection timers.
 */
export function unregisterPmSession(roomId: string): void {
  pmSessions.delete(roomId);

  const pending = pendingInjections.get(roomId);
  if (pending?.timer) {
    clearTimeout(pending.timer);
  }
  pendingInjections.delete(roomId);

  console.log(`[RoomInjection] PM session unregistered for room ${roomId}`);
}

/**
 * Called when any room message is posted. Determines whether the PM should
 * be woken up and, if so, queues or immediately flushes an injection.
 */
export function onRoomMessage(message: RoomMessage): void {
  const { roomId, fromAgentId, type, content } = message;

  // Get the room to find PM agent ID
  const detail = roomManager.getRoomDetail(roomId);
  if (!detail) return;

  const pmAgentId = detail.room.pmAgentId;
  if (!pmAgentId) return;

  // Skip if the message is FROM the PM — don't wake yourself up
  if (fromAgentId === pmAgentId) return;

  // Check if PM is mentioned (in mentions array or toAgentId)
  const pmMentioned =
    message.toAgentId === pmAgentId ||
    message.mentions.includes(pmAgentId);

  // Find the sender agent for labeling
  const senderAgent = fromAgentId
    ? detail.agents.find((a) => a.agentId === fromAgentId)
    : null;
  const senderLabel = senderAgent ? `@${senderAgent.role}` : 'system';

  // Apply trigger rules
  const result = applyTriggerRules(type, pmMentioned, content, senderLabel, message, detail.agents, pmAgentId);
  if (!result) return;

  const { priority, summary } = result;

  queueInjection(roomId, { priority, summary, timestamp: Date.now() });
}

/**
 * Called when an agent's status changes (e.g., dies unexpectedly).
 * Posts an error message and injects into the PM.
 */
export function onAgentStatusChange(
  roomId: string,
  agentId: string,
  status: RoomAgentStatus,
  error?: string,
): void {
  // Only care about terminal states that the PM should know about
  if (status !== 'dead' && status !== 'done') return;

  const detail = roomManager.getRoomDetail(roomId);
  if (!detail) return;

  const pmAgentId = detail.room.pmAgentId;
  if (!pmAgentId) return;

  // Don't inject about the PM itself
  if (agentId === pmAgentId) return;

  const agent = detail.agents.find((a) => a.agentId === agentId);
  const role = agent?.role ?? agentId;

  if (status === 'dead') {
    const errorMsg = error ? `: ${error}` : '';
    queueInjection(roomId, {
      priority: 'immediate',
      summary: `@${role} died unexpectedly${errorMsg}`,
      timestamp: Date.now(),
    });
  } else if (status === 'done') {
    const resultSummary = agent?.result ? `: "${truncate(agent.result, 80)}"` : '';
    queueInjection(roomId, {
      priority: 'normal',
      summary: `@${role} marked as done${resultSummary}`,
      timestamp: Date.now(),
    });
  }
}

/**
 * Start periodic zombie detection — checks for idle agents and PM.
 */
export function startZombieDetection(): void {
  if (zombieInterval) return;

  zombieInterval = setInterval(() => {
    runZombieCheck();
  }, ZOMBIE_CHECK_INTERVAL_MS);

  console.log('[RoomInjection] Zombie detection started');
}

/**
 * Stop periodic zombie detection.
 */
export function stopZombieDetection(): void {
  if (zombieInterval) {
    clearInterval(zombieInterval);
    zombieInterval = null;
  }
  console.log('[RoomInjection] Zombie detection stopped');
}

// ─── Trigger Rules ───

function applyTriggerRules(
  type: RoomMessage['type'],
  pmMentioned: boolean,
  content: string,
  senderLabel: string,
  message: RoomMessage,
  agents: RoomAgent[],
  pmAgentId: string,
): { priority: InjectionEvent['priority']; summary: string } | null {
  switch (type) {
    case 'question':
      if (pmMentioned) {
        return {
          priority: 'immediate',
          summary: `${senderLabel} asked a question: "${truncate(content, 100)}"`,
        };
      }
      // Question not directed at PM — ignore
      return null;

    case 'error':
      return {
        priority: 'immediate',
        summary: `${senderLabel} reported an error: "${truncate(content, 100)}"`,
      };

    case 'signal_done':
      return {
        priority: 'normal',
        summary: `${senderLabel} signaled done: "${truncate(content, 80)}"`,
      };

    case 'finding':
      return {
        priority: 'normal',
        summary: `${senderLabel} posted finding: "${truncate(content, 80)}" (${content.length} chars)`,
      };

    case 'system': {
      // Check for critical keywords
      const lowerContent = content.toLowerCase();
      if (
        lowerContent.includes('finished') ||
        lowerContent.includes('crashed') ||
        lowerContent.includes('failed')
      ) {
        return {
          priority: 'normal',
          summary: `System: "${truncate(content, 100)}"`,
        };
      }

      // Check if all non-PM agents are done/dismissed/dead
      const runningNonPm = agents.filter(
        (a) =>
          a.agentId !== pmAgentId &&
          ['spawning', 'running', 'idle'].includes(a.status),
      );
      if (runningNonPm.length === 0 && agents.length > 1) {
        return {
          priority: 'immediate',
          summary: 'All agents have finished. No running agents remain.',
        };
      }

      return null;
    }

    case 'directive':
    case 'status_update':
    default:
      // Don't wake PM for directives (PM sends those) or status updates
      return null;
  }
}

// ─── Injection Queue ───

function queueInjection(roomId: string, event: InjectionEvent): void {
  // Make sure there's a PM session to inject into
  if (!pmSessions.has(roomId)) {
    console.log(`[RoomInjection] No PM session for room ${roomId}, dropping event`);
    return;
  }

  let pending = pendingInjections.get(roomId);
  if (!pending) {
    pending = { roomId, events: [], timer: null };
    pendingInjections.set(roomId, pending);
  }

  pending.events.push(event);

  if (event.priority === 'immediate') {
    // Flush immediately (includes any previously queued normal events)
    flushInjection(roomId);
  } else {
    // Normal/low: batch with a 5-second window
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.timer = setTimeout(() => {
      flushInjection(roomId);
    }, BATCH_WINDOW_MS);
  }
}

function flushInjection(roomId: string): void {
  const pending = pendingInjections.get(roomId);
  if (!pending || pending.events.length === 0) return;

  // Clear timer if running
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }

  // Drain events
  const events = pending.events.splice(0);

  const session = pmSessions.get(roomId);
  if (!session || !session.isRunning) {
    console.log(`[RoomInjection] PM session not running for room ${roomId}, dropping ${events.length} events`);
    return;
  }

  // Format the injection message
  const injectionText = formatInjectionMessage(events);

  // Check turn state and inject or defer
  injectOrDefer(roomId, session, injectionText);
}

// ─── Turn State Gating ───

function injectOrDefer(roomId: string, session: ClaudeSession, message: string): void {
  const state = session.turnState;

  if (state === 'idle') {
    // Inject immediately
    doInject(session, message);
  } else {
    // processing or waiting_approval — queue and listen for turn end
    console.log(`[RoomInjection] PM is ${state}, deferring injection for room ${roomId}`);

    const deferredHandler = (): void => {
      // Remove both listeners to avoid double-fire
      session.removeListener('result', deferredHandler);
      session.removeListener('done', cleanupHandler);

      // Re-check: if session is still running, inject
      if (session.isRunning) {
        // Small delay to let turn fully settle
        setTimeout(() => {
          if (session.isRunning && session.turnState === 'idle') {
            doInject(session, message);
          } else {
            console.log(`[RoomInjection] PM still not idle after result, re-deferring for room ${roomId}`);
            injectOrDefer(roomId, session, message);
          }
        }, 500);
      }
    };

    const cleanupHandler = (): void => {
      session.removeListener('result', deferredHandler);
      session.removeListener('done', cleanupHandler);
      console.log(`[RoomInjection] PM session ended before deferred injection for room ${roomId}`);
    };

    session.once('result', deferredHandler);
    session.once('done', cleanupHandler);
  }
}

function doInject(session: ClaudeSession, message: string): void {
  console.log(`[RoomInjection] Injecting user turn (${message.length} chars)`);
  session.sendMessage(message).catch((err) => {
    console.error('[RoomInjection] Failed to inject user turn:', err);
  });
}

// ─── Message Formatting ───

function formatInjectionMessage(events: InjectionEvent[]): string {
  const lines = events.map((e) => `- ${e.summary}`);

  return [
    'Room update (auto):',
    ...lines,
    '',
    'Check room_read_messages() for full content. Decide next steps.',
  ].join('\n');
}

// ─── Zombie Detection ───

function runZombieCheck(): void {
  const rooms = roomManager.listRooms().filter((r) => r.status === 'active');
  const now = Date.now();

  for (const room of rooms) {
    const agents = roomManager.listAgents(room.roomId);
    const pmAgentId = room.pmAgentId;

    for (const agent of agents) {
      // Skip non-running agents
      if (!['running', 'idle'].includes(agent.status)) continue;

      const lastActivity = agent.lastActivityAt
        ? new Date(agent.lastActivityAt).getTime()
        : new Date(agent.createdAt).getTime();
      const idleMs = now - lastActivity;

      const isPm = agent.agentId === pmAgentId;

      if (isPm) {
        // PM idle too long: auto-pause all running agents and warn
        if (idleMs > PM_IDLE_THRESHOLD_MS) {
          console.warn(
            `[RoomInjection] PM ${agent.agentId} idle for ${Math.round(idleMs / 60000)}m in room ${room.roomId}`,
          );

          // Pause all running non-PM agents
          for (const other of agents) {
            if (
              other.agentId !== pmAgentId &&
              ['running', 'idle'].includes(other.status)
            ) {
              roomManager.updateAgentStatus(other.agentId, 'paused');
            }
          }

          // Post system warning
          roomManager.postMessage({
            roomId: room.roomId,
            fromAgentId: null,
            toAgentId: null,
            type: 'system',
            content: `Warning: PM has been idle for ${Math.round(idleMs / 60000)} minutes. All running agents have been paused to conserve resources.`,
          });
        }
      } else {
        // Worker agent idle too long: post warning
        if (idleMs > IDLE_THRESHOLD_MS) {
          console.warn(
            `[RoomInjection] Agent ${agent.agentId} (${agent.role}) idle for ${Math.round(idleMs / 60000)}m in room ${room.roomId}`,
          );

          roomManager.postMessage({
            roomId: room.roomId,
            fromAgentId: null,
            toAgentId: null,
            type: 'system',
            content: `Warning: Agent "${agent.role}" (${agent.agentId}) has been idle for ${Math.round(idleMs / 60000)} minutes. It may be stuck or crashed.`,
          });
        }
      }
    }
  }
}

// ─── Helpers ───

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
