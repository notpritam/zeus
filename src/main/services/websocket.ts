import http from 'http';
import fs from 'fs';
import { stat as fsStat } from 'fs/promises';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import { app, Notification as ElectronNotification, shell } from 'electron';
import { getMainWindow } from '../index';
import type {
  WsEnvelope,
  TerminalInputPayload,
  TerminalResizePayload,
  StartSessionPayload,
  StatusPayload,
  ClaudeStartPayload,
  ClaudeResumePayload,
  ClaudeSendMessagePayload,
  ClaudeApproveToolPayload,
  ClaudeDenyToolPayload,
  SettingsPayload,
  PerfPayload,
} from '../types';
import { createSession, writeToSession, resizeSession, destroySession, getSessionPids } from './terminal';
import { registerSession, markExited, markKilled, getSession, getAllSessions } from './sessions';
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from './power';
import { getTunnelUrl, isTunnelActive, startTunnel, stopTunnel } from './tunnel';
import { validateToken } from './auth';
import { ClaudeSessionManager, ClaudeSession } from './claude-session';
import type { NormalizedEntry } from './claude-types';
import {
  getSettings,
  addProject,
  removeProject,
  updateDefaults,
  setLastUsedProject,
  setActiveTheme,
} from './settings';
import { getThemeById, refreshThemes, getThemesDir } from './themes';
import {
  insertClaudeSession,
  updateClaudeSessionId,
  updateClaudeSessionStatus,
  updateClaudeSessionMeta,
  upsertClaudeEntry,
  getAllClaudeSessions,
  getClaudeEntries,
  deleteClaudeSession,
  archiveClaudeSession,
  insertTerminalSession,
  updateTerminalSession,
  getAllTerminalSessions,
  deleteTerminalSession,
  archiveTerminalSession,
  insertQaAgentSession,
  updateQaAgentSessionStatus,
  getQaAgentSessionsByParent,
  deleteQaAgentSession,
  deleteQaAgentsByParent,
  countQaAgentsByParent,
  insertQaAgentEntry,
  getQaAgentEntries,
  markStaleQaAgentsErrored,
  finalizeCreatedToolEntries,
  copyClaudeEntriesForResume,
} from './db';
import type { ClaudeSessionInfo, GitPayload, FilesPayload, QaPayload, SessionIconName } from '../../shared/types';
import { SESSION_ICON_NAMES } from '../../shared/types';
import { GitWatcherManager, initGitRepo } from './git';
import { FileTreeServiceManager } from './file-tree';
import { QAService } from './qa';
import { SystemMonitorService } from './system-monitor';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort = 8888;

// Track which sessions belong to which client
const clientSessions = new Map<WebSocket, Set<string>>();

// Claude session manager (shared across all WebSocket clients)
const claudeManager = new ClaudeSessionManager();

// Track which Claude session is bound to which WS client
const clientClaudeSessions = new Map<WebSocket, Set<string>>();

// Git watcher manager (shared across all WebSocket clients)
const gitManager = new GitWatcherManager();

// File tree manager (shared across all WebSocket clients)
const fileTreeManager = new FileTreeServiceManager();

// QA service (singleton PinchTab server)
let qaService: QAService | null = null;

// QA agent sessions — keyed by qaAgentId, multiple per parent session
interface QaAgentRecord {
  qaAgentId: string;
  parentSessionId: string;
  parentSessionType: 'terminal' | 'claude';
  name?: string;
  task: string;
  targetUrl?: string;
  workingDir: string;
  session: ClaudeSession | null;
  /** Claude session ID for --resume after process exits */
  claudeSessionId?: string;
  /** Last message ID for resume */
  lastMessageId?: string;
  startedAt: number;
  /** Stored responseId from zeus_qa_run so we can reply when the agent finishes */
  pendingResponseId?: string;
  /** WebSocket that initiated the run — needed to send the final response */
  pendingResponseWs?: WebSocket;
  /** Accumulate text entries for final summary */
  collectedTextEntries: string[];
}
const qaAgentSessions = new Map<string, QaAgentRecord>();

// Track parentSessionId for external QA agents (registered via zeus-bridge MCP)
const externalQaParentMap = new Map<string, string>();
let qaAgentIdCounter = 0;

/** Kill all running QA agents that belong to a given parent session. */
function stopQaAgentsByParent(parentSessionId: string): void {
  for (const [id, record] of qaAgentSessions) {
    if (record.parentSessionId === parentSessionId) {
      try { if (record.session) record.session.kill(); } catch { /* already dead */ }
      qaAgentSessions.delete(id);
    }
  }
}

// System monitor service
const systemMonitor = new SystemMonitorService();

// Register PID sources for per-process monitoring
systemMonitor.registerPidSource(() =>
  getSessionPids().map((s) => ({
    ...s,
    type: 'terminal' as const,
    name: `Terminal ${s.sessionId.slice(0, 8)}`,
  })),
);
systemMonitor.registerPidSource(() =>
  claudeManager.getSessionPids().map((s) => ({
    ...s,
    type: 'claude' as const,
    name: `Claude ${s.sessionId.slice(0, 8)}`,
  })),
);

// Register QA/PinchTab PID source
systemMonitor.registerPidSource(() => {
  if (!qaService?.isRunning()) return [];
  const pid = qaService.getPid();
  if (!pid) return [];
  return [{ sessionId: 'qa', pid, type: 'qa' as const, name: 'PinchTab Server' }];
});

// Broadcast metrics to all clients when polled
systemMonitor.setOnMetrics((metrics) => {
  broadcastEnvelope({
    channel: 'perf',
    sessionId: '',
    payload: { type: 'perf_update', metrics } satisfies PerfPayload,
    auth: '',
  });
});

// Track authenticated clients
const authenticatedClients = new WeakSet<WebSocket>();

/**
 * Request OS-level attention: flash taskbar (Windows/Linux), bounce dock (macOS),
 * and show a native notification if the window is not focused.
 */
function requestAttention(title: string, body: string): void {
  const win = getMainWindow();

  if (win && !win.isFocused()) {
    // Flash the taskbar icon (Windows/Linux)
    win.flashFrame(true);

    // Bounce the dock icon (macOS)
    if (process.platform === 'darwin') {
      app.dock?.bounce('informational');
    }

    // Show native OS notification
    if (ElectronNotification.isSupported()) {
      const notif = new ElectronNotification({ title, body, silent: true });
      notif.on('click', () => {
        win.show();
        win.focus();
      });
      notif.show();
    }
  }
}

function sendEnvelope(ws: WebSocket, envelope: WsEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

function broadcastEnvelope(envelope: WsEnvelope): void {
  if (!wss) return;
  for (const client of wss.clients) {
    sendEnvelope(client, envelope);
  }
}

function sendError(ws: WebSocket, sessionId: string, message: string): void {
  sendEnvelope(ws, {
    channel: 'control',
    sessionId,
    payload: { type: 'error', message },
    auth: '',
  });
}

function broadcastSessionUpdated(sessionId: string): void {
  const record = getSession(sessionId);
  if (!record) return;
  broadcastEnvelope({
    channel: 'control',
    sessionId,
    payload: { type: 'session_updated', session: record },
    auth: '',
  });
}

function handleControl(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'start_session') {
    const opts = envelope.payload as StartSessionPayload;
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    const { sessionId, shell } = createSession(
      { cols, rows },
      (sid, data) => {
        // Broadcast terminal output to ALL clients (not just owner)
        broadcastEnvelope({
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'output', data },
          auth: '',
        });
      },
      (sid, code) => {
        markExited(sid, code);
        updateTerminalSession(sid, { status: 'exited', endedAt: Date.now(), exitCode: code });
        broadcastEnvelope({
          channel: 'terminal',
          sessionId: sid,
          payload: { type: 'exit', code },
          auth: '',
        });
        broadcastSessionUpdated(sid);
        const owned = clientSessions.get(ws);
        if (owned) owned.delete(sid);
      },
    );

    // Register in session registry
    const cwd = process.env.HOME ?? '/';
    const record = registerSession(sessionId, shell, cols, rows, cwd);

    // Persist to DB
    insertTerminalSession(record);

    // Track ownership
    if (!clientSessions.has(ws)) clientSessions.set(ws, new Set());
    clientSessions.get(ws)!.add(sessionId);

    // Broadcast session_started to all clients
    broadcastEnvelope({
      channel: 'control',
      sessionId,
      payload: { type: 'session_started', sessionId, shell },
      auth: '',
    });

    broadcastSessionUpdated(sessionId);
  } else if (payload.type === 'stop_session') {
    const sid = envelope.sessionId;
    markKilled(sid);
    updateTerminalSession(sid, { status: 'killed', endedAt: Date.now() });
    destroySession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
    broadcastSessionUpdated(sid);
  } else if (payload.type === 'list_sessions') {
    // Merge in-memory (active) with DB (historical), dedup by id (in-memory wins)
    const inMemory = getAllSessions();
    const inMemoryIds = new Set(inMemory.map((s) => s.id));
    const fromDb = getAllTerminalSessions().filter((s) => !inMemoryIds.has(s.id) && s.status !== 'archived');
    sendEnvelope(ws, {
      channel: 'control',
      sessionId: '',
      payload: { type: 'session_list', sessions: [...inMemory, ...fromDb] },
      auth: '',
    });
  } else if (payload.type === 'delete_terminal_session') {
    const sid = envelope.sessionId;
    destroySession(sid);
    markKilled(sid);
    stopQaAgentsByParent(sid);
    deleteQaAgentsByParent(sid);
    deleteTerminalSession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
    broadcastEnvelope({
      channel: 'control',
      sessionId: sid,
      payload: { type: 'terminal_session_deleted', deletedId: sid },
      auth: '',
    });
  } else if (payload.type === 'archive_terminal_session') {
    const sid = envelope.sessionId;
    destroySession(sid);
    markKilled(sid);
    archiveTerminalSession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
    broadcastEnvelope({
      channel: 'control',
      sessionId: sid,
      payload: { type: 'terminal_session_archived', archivedId: sid },
      auth: '',
    });
  } else {
    sendError(ws, envelope.sessionId, `Unknown control type: ${payload.type}`);
  }
}

function handleTerminal(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'input') {
    const { data } = envelope.payload as TerminalInputPayload;
    try {
      writeToSession(envelope.sessionId, data);
    } catch (err) {
      sendError(ws, envelope.sessionId, (err as Error).message);
    }
  } else if (payload.type === 'resize') {
    const { cols, rows } = envelope.payload as TerminalResizePayload;
    try {
      resizeSession(envelope.sessionId, cols, rows);
    } catch (err) {
      sendError(ws, envelope.sessionId, (err as Error).message);
    }
  } else {
    sendError(ws, envelope.sessionId, `Unknown terminal type: ${payload.type}`);
  }
}

function handleStatus(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as StatusPayload;

  if (payload.type === 'get_status') {
    sendEnvelope(ws, {
      channel: 'status',
      sessionId: '',
      payload: {
        type: 'status_update',
        powerBlock: isPowerBlocked(),
        websocket: true,
        tunnel: getTunnelUrl(),
      },
      auth: '',
    });
  } else if (payload.type === 'toggle_power') {
    if (isPowerBlocked()) {
      stopPowerBlock();
    } else {
      startPowerBlock();
    }
    // Broadcast new status to all clients
    broadcastEnvelope({
      channel: 'status',
      sessionId: '',
      payload: {
        type: 'status_update',
        powerBlock: isPowerBlocked(),
        websocket: true,
        tunnel: getTunnelUrl(),
      },
      auth: '',
    });
  } else if (payload.type === 'toggle_tunnel') {
    (async () => {
      try {
        if (isTunnelActive()) {
          await stopTunnel();
        } else {
          await startTunnel(serverPort);
        }
        broadcastEnvelope({
          channel: 'status',
          sessionId: '',
          payload: {
            type: 'status_update',
            powerBlock: isPowerBlocked(),
            websocket: true,
            tunnel: getTunnelUrl(),
          },
          auth: '',
        });
      } catch (err) {
        console.error('[Zeus] Tunnel toggle error:', (err as Error).message);
        sendError(ws, '', `Tunnel error: ${(err as Error).message}`);
      }
    })();
  } else {
    sendError(ws, '', `Unknown status type: ${payload.type}`);
  }
}

function wireClaudeSession(ws: WebSocket, session: ClaudeSession, envelope: WsEnvelope): void {
  // Forward normalized entries to all clients + persist to DB
  session.on('entry', async (entry: NormalizedEntry) => {
    upsertClaudeEntry(envelope.sessionId, entry);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'entry', entry },
      auth: '',
    });

    // Sync QA Preview when Claude calls qa_* or pinchtab_* tools
    // toolName may be MCP-prefixed (e.g. mcp__zeus-qa__qa_navigate), so extract method name
    const qaMethodName = entry.entryType.type === 'tool_use'
      ? (entry.entryType.actionType?.action === 'mcp_tool' ? entry.entryType.actionType.method : entry.entryType.toolName)
      : '';
    if (entry.entryType.type === 'tool_use' && /^(qa_|pinchtab_)/i.test(qaMethodName)) {
      const { status } = entry.entryType;
      const toolName = qaMethodName;

      if (status === 'success' && qaService?.isRunning()) {
        try {
          if (/navigate/i.test(toolName)) {
            // Parse URL from tool input (try actionType.input first, then entry.content)
            let navUrl: string | undefined;
            try {
              if (entry.entryType.type === 'tool_use' && entry.entryType.actionType?.action === 'mcp_tool') {
                const input = typeof entry.entryType.actionType.input === 'string'
                  ? JSON.parse(entry.entryType.actionType.input)
                  : entry.entryType.actionType.input;
                navUrl = input?.url;
              }
              if (!navUrl) {
                const parsed = JSON.parse(entry.content);
                navUrl = parsed.url;
              }
            } catch { /* ignore parse errors */ }
            broadcastEnvelope({
              channel: 'qa', sessionId: '', auth: '',
              payload: { type: 'navigate_result', url: navUrl ?? '', title: '' },
            });
            // Auto-refresh snapshot after navigation
            const snap = await qaService.snapshot('interactive');
            broadcastEnvelope({
              channel: 'qa', sessionId: '', auth: '',
              payload: { type: 'snapshot_result', nodes: snap.nodes, raw: snap.raw },
            });
          } else if (/screenshot/i.test(toolName)) {
            const dataUrl = await qaService.screenshot();
            broadcastEnvelope({
              channel: 'qa', sessionId: '', auth: '',
              payload: { type: 'screenshot_result', dataUrl },
            });
          } else if (/snapshot/i.test(toolName)) {
            const snap = await qaService.snapshot('interactive');
            broadcastEnvelope({
              channel: 'qa', sessionId: '', auth: '',
              payload: { type: 'snapshot_result', nodes: snap.nodes, raw: snap.raw },
            });
          } else if (/click|fill|type|press|scroll|hover|focus|select|batch|run_test_flow/i.test(toolName)) {
            // After any interaction, auto-refresh snapshot
            const snap = await qaService.snapshot('interactive');
            broadcastEnvelope({
              channel: 'qa', sessionId: '', auth: '',
              payload: { type: 'snapshot_result', nodes: snap.nodes, raw: snap.raw },
            });
          }
        } catch (err) {
          console.warn(`[Zeus] QA preview sync failed for ${toolName}:`, (err as Error).message);
        }
      }
    }
  });

  // Forward activity state changes
  session.on('activity', (activity) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'session_activity', activity },
      auth: '',
    });
  });

  // Forward approval requests + request OS attention
  session.on('approval_needed', (approval) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'approval_needed', ...approval },
      auth: '',
    });
    requestAttention('Approval Needed', `"${approval.toolName}" needs your approval to continue.`);
  });

  // Forward session ID once extracted from stream + persist to DB
  session.on('session_id', (id) => {
    updateClaudeSessionId(envelope.sessionId, id);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_id', claudeSessionId: id },
      auth: '',
    });
  });

  // Forward turn completion (token usage) — session stays alive
  session.on('turn_complete', (result) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'turn_complete', result },
      auth: '',
    });
  });

  // Forward session end (process exited) + persist status + request attention
  session.on('done', () => {
    finalizeCreatedToolEntries(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, 'done', Date.now());
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'done' },
      auth: '',
    });
    requestAttention('Task Complete', 'Claude session finished successfully.');
  });

  // Forward errors + persist status + request attention
  session.on('error', (err) => {
    finalizeCreatedToolEntries(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, 'error', Date.now());
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'error', message: err.message },
      auth: '',
    });
    requestAttention('Task Failed', `Claude session encountered an error: ${err.message}`);
  });
}

function buildQAAgentSystemPrompt(targetUrl: string): string {
  return `You are a QA agent for a web application running at ${targetUrl}.

You have full access to:
- Navigation & page info: qa_navigate, qa_text, qa_pdf, qa_health
- Element interaction: qa_click, qa_click_selector, qa_hover, qa_focus, qa_select_text, qa_type, qa_fill, qa_press, qa_scroll
- DOM inspection: qa_snapshot (supports CSS selector scoping and compact format), qa_screenshot (supports full_page)
- JavaScript execution: qa_evaluate (run JS in page context — read app state, dispatch events, assert DOM)
- Tab management: qa_list_tabs, qa_lock_tab, qa_unlock_tab
- Browser state: qa_cookies (get/set), qa_storage (localStorage/sessionStorage)
- Observability: qa_console_logs (filter by level), qa_network_requests (filter by URL pattern, failed_only), qa_js_errors
- Smart waiting: qa_wait_for_element (poll until selector matches), qa_wait_for_network_idle
- Assertions: qa_assert_element (assert exists/not-exists with optional text match)
- Batch: qa_batch_actions (run multiple actions in one call — much faster)
- Compound: qa_run_test_flow (navigate + wait + snapshot + screenshot + errors in one call)
- Instance info: qa_list_instances, qa_list_profiles
- File editing: Read, Edit, Write tools
- Shell commands: Bash tool

Tips for speed:
- Use qa_batch_actions to chain clicks/types/presses instead of calling each tool individually.
- Use qa_snapshot with a CSS selector param to scope to a section — avoids huge accessibility trees.
- Use qa_click_selector for table rows, cards, and other non-focusable clickable elements.
- Use qa_wait_for_element instead of fixed delays — it polls and returns as soon as the element appears.
- Use qa_assert_element for pass/fail checks — it auto-retries with timeout.
- For React controlled inputs, use qa_click on the field then qa_type (not qa_fill which may miss onChange).
- Use qa_evaluate to read Redux/Zustand store state or dispatch synthetic events.

Your workflow:
1. Navigate to the target URL
2. Test the requested functionality using the fastest tools available
3. Use qa_assert_element and qa_wait_for_element to verify state changes
4. Check qa_console_logs, qa_network_requests, and qa_js_errors
5. If you find bugs: fix the code, then re-test to confirm the fix
6. Report findings concisely

Always use qa_run_test_flow after making code changes to verify the fix.
Be concise — the user sees a compact action log, not a full chat.
Never use AskUserQuestion — make your best judgment and proceed.`;
}

function wireQAAgent(record: QaAgentRecord): void {
  const { qaAgentId, parentSessionId } = record;
  const session = record.session!; // guaranteed non-null when wiring
  const toolEntries = new Map<string, string>();
  // Track streaming text blocks: accumulate content, emit only when block is finalized
  let pendingTextId: string | null = null;
  let pendingTextContent = '';
  // Track streaming thinking blocks: same accumulate-and-flush pattern
  let pendingThinkingId: string | null = null;
  let pendingThinkingContent = '';

  const flushPendingText = (): void => {
    if (pendingTextId && pendingTextContent.trim()) {
      const trimmed = pendingTextContent.trim();
      const entry = { kind: 'text' as const, content: trimmed, timestamp: Date.now() };
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          qaAgentId,
          parentSessionId,
          entry,
        },
      });
      insertQaAgentEntry(qaAgentId, entry.kind, JSON.stringify(entry), entry.timestamp);
      // Collect for final summary returned to zeus_qa_run caller
      record.collectedTextEntries.push(trimmed);
    }
    pendingTextId = null;
    pendingTextContent = '';
  };

  const flushPendingThinking = (): void => {
    if (pendingThinkingId && pendingThinkingContent.trim()) {
      const entry = { kind: 'thinking' as const, content: pendingThinkingContent.trim().slice(0, 300), timestamp: Date.now() };
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          qaAgentId,
          parentSessionId,
          entry,
        },
      });
      insertQaAgentEntry(qaAgentId, entry.kind, JSON.stringify(entry), entry.timestamp);
    }
    pendingThinkingId = null;
    pendingThinkingContent = '';
  };

  session.on('entry', async (entry: NormalizedEntry) => {
    const now = Date.now();

    if (entry.entryType.type === 'assistant_message') {
      if (entry.id !== pendingTextId) {
        // New text block — flush previous one
        flushPendingText();
        pendingTextId = entry.id;
      }
      // Always update to latest accumulated content
      pendingTextContent = entry.content;
      return;
    }

    // Any non-text entry means the text block is done — flush it
    flushPendingText();

    // Accumulate thinking entries — flush only when block transitions
    if (entry.entryType.type === 'thinking') {
      if (entry.id !== pendingThinkingId) {
        flushPendingThinking();
        pendingThinkingId = entry.id;
      }
      pendingThinkingContent = entry.content;
      return;
    }

    // Any non-thinking entry means the thinking block is done — flush it
    flushPendingThinking();

    if (entry.entryType.type === 'tool_use') {
      const { toolName, status } = entry.entryType;

      if (status === 'created') {
        toolEntries.set(entry.id, toolName);
        let args = '';
        try {
          const parsed = JSON.parse(entry.content);
          if (parsed.url) args = parsed.url;
          else if (parsed.ref) args = `ref=${parsed.ref}`;
          else if (parsed.command) args = parsed.command.slice(0, 80);
          else if (parsed.file_path) args = parsed.file_path;
          else args = entry.content.slice(0, 100);
        } catch {
          args = entry.content.slice(0, 100);
        }

        const toolCallEntry = { kind: 'tool_call' as const, tool: toolName, args, timestamp: now };
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_entry',
            qaAgentId,
            parentSessionId,
            entry: toolCallEntry,
          },
        });
        insertQaAgentEntry(qaAgentId, toolCallEntry.kind, JSON.stringify(toolCallEntry), now);
      } else if (status === 'success' || status === 'failed' || status === 'timed_out') {
        const summary = entry.content.slice(0, 200);
        const isScreenshotTool = /screenshot/i.test(toolName);
        let imageData: string | undefined;

        // For screenshot tools, capture the image so it can be rendered in the UI
        if (isScreenshotTool && status === 'success' && qaService?.isRunning()) {
          try {
            imageData = await qaService.screenshot();
          } catch {
            // Non-critical — log entry still works without the image
          }
        }

        const toolResultEntry = {
          kind: 'tool_result' as const,
          tool: toolName,
          summary,
          success: status === 'success',
          timestamp: now,
          ...(imageData ? { imageData } : {}),
        };
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_entry',
            qaAgentId,
            parentSessionId,
            entry: toolResultEntry,
          },
        });
        insertQaAgentEntry(qaAgentId, toolResultEntry.kind, JSON.stringify(toolResultEntry), now);
        toolEntries.delete(entry.id);
      }
    }

    if (entry.entryType.type === 'error_message') {
      const errorEntry = { kind: 'error' as const, message: entry.content, timestamp: now };
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          qaAgentId,
          parentSessionId,
          entry: errorEntry,
        },
      });
      insertQaAgentEntry(qaAgentId, errorEntry.kind, JSON.stringify(errorEntry), now);
    }

    if (entry.entryType.type === 'system_message' && entry.content.trim()) {
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          qaAgentId,
          parentSessionId,
          entry: { kind: 'status', message: entry.content.slice(0, 200), timestamp: now },
        },
      });
    }

    if (entry.entryType.type === 'token_usage') {
      const { totalTokens } = entry.entryType;
      const statusEntry = {
        kind: 'status' as const,
        message: `Turn complete — ${totalTokens.toLocaleString()} tokens used`,
        timestamp: now,
      };
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_entry',
          qaAgentId,
          parentSessionId,
          entry: statusEntry,
        },
      });
      insertQaAgentEntry(qaAgentId, statusEntry.kind, JSON.stringify(statusEntry), now);
    }
  });

  session.on('approval_needed', (approval) => {
    if (approval.toolName === 'AskUserQuestion') {
      session.approveTool(approval.approvalId);
    }
  });

  session.on('done', () => {
    flushPendingText();
    flushPendingThinking();
    updateQaAgentSessionStatus(qaAgentId, 'stopped', Date.now());

    // Save Claude session data for --resume support
    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null; // process is dead but record stays for resume

    // Send deferred response to zeus_qa_run caller with the final summary
    if (record.pendingResponseId && record.pendingResponseWs) {
      const lastEntries = record.collectedTextEntries;
      const summary = lastEntries.length > 0
        ? lastEntries[lastEntries.length - 1]
        : 'QA agent completed without a summary.';
      try {
        sendEnvelope(record.pendingResponseWs, {
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'start_qa_agent_response',
            responseId: record.pendingResponseId,
            qaAgentId,
            status: 'done',
            summary,
          },
        });
      } catch {
        // WebSocket may have closed — non-critical
      }
    }

    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_stopped', qaAgentId, parentSessionId },
    });
    // Don't delete from qaAgentSessions — keep record for resume
  });

  session.on('error', (err) => {
    flushPendingText();
    flushPendingThinking();
    const crashEntry = { kind: 'error' as const, message: `Agent crashed: ${err.message}`, timestamp: Date.now() };
    insertQaAgentEntry(qaAgentId, crashEntry.kind, JSON.stringify(crashEntry), crashEntry.timestamp);
    updateQaAgentSessionStatus(qaAgentId, 'error', Date.now());

    // Save Claude session data for --resume support
    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null;

    // Send deferred error response to zeus_qa_run caller
    if (record.pendingResponseId && record.pendingResponseWs) {
      try {
        sendEnvelope(record.pendingResponseWs, {
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'start_qa_agent_response',
            responseId: record.pendingResponseId,
            qaAgentId,
            status: 'error',
            summary: `Agent crashed: ${err.message}`,
          },
        });
      } catch {
        // WebSocket may have closed — non-critical
      }
    }

    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_entry',
        qaAgentId,
        parentSessionId,
        entry: crashEntry,
      },
    });
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_stopped', qaAgentId, parentSessionId },
    });
    // Don't delete — keep record for resume
  });
}

/** Auto-adopt a Claude session if the client doesn't own it yet (e.g. after reconnect) */
function adoptClaudeSession(ws: WebSocket, sessionId: string): void {
  if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
  const owned = clientClaudeSessions.get(ws)!;
  if (!owned.has(sessionId)) {
    owned.add(sessionId);
  }
}

async function handleClaude(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as { type: string };

  if (payload.type === 'start_claude') {
    const opts = envelope.payload as ClaudeStartPayload;
    const workingDir = opts.workingDir || process.env.HOME || '/';

    // Ensure working directory exists — auto-create if missing
    if (!fs.existsSync(workingDir)) {
      try {
        fs.mkdirSync(workingDir, { recursive: true });
        console.log(`[Zeus] Created working directory: ${workingDir}`);
      } catch (mkdirErr: unknown) {
        const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
        sendError(ws, envelope.sessionId, `Working directory does not exist and could not be created: ${workingDir} — ${msg}`);
        return;
      }
    }

    // Validate it's actually a directory, not a file
    try {
      const stat = fs.statSync(workingDir);
      if (!stat.isDirectory()) {
        sendError(ws, envelope.sessionId, `Path exists but is not a directory: ${workingDir}`);
        return;
      }
    } catch {
      sendError(ws, envelope.sessionId, `Cannot access working directory: ${workingDir}`);
      return;
    }

    try {
      const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
        workingDir,
        permissionMode: opts.permissionMode ?? 'bypassPermissions',
        model: opts.model,
        enableQA: opts.enableQA,
        qaTargetUrl: opts.qaTargetUrl,
        zeusSessionId: envelope.sessionId,
      });

      // Persist to DB — assign a random icon
      const randomIcon = SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)];
      insertClaudeSession({
        id: envelope.sessionId,
        claudeSessionId: null,
        status: 'running',
        prompt: opts.prompt,
        name: opts.sessionName ?? null,
        icon: randomIcon,
        color: null,
        notificationSound: opts.notificationSound ?? true,
        workingDir,
        permissionMode: opts.permissionMode ?? 'bypassPermissions',
        model: opts.model ?? null,
        startedAt: Date.now(),
        endedAt: null,
      });

      // Persist initial user message
      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: 'user_message' },
        content: opts.prompt,
      });

      // Track ownership
      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ws, session, envelope);

      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_started' },
        auth: '',
      });

      // Auto-start QA if enabled
      if (opts.enableQA) {
        try {
          if (!qaService?.isRunning()) {
            qaService = new QAService();
            await qaService.start();
          }
          const instance = await qaService.launchInstance(true);
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'qa_started' }, auth: '',
          });
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'instance_launched', instance }, auth: '',
          });

          // Wire CDP events to frontend
          const cdp = qaService.getCdpClient();
          if (cdp) {
            cdp.on('console', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_console', logs: [entry] }, auth: '',
              });
            });
            cdp.on('network', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_network', requests: [entry] }, auth: '',
              });
            });
            cdp.on('js_error', (entry) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'cdp_error', errors: [entry] }, auth: '',
              });
            });
            cdp.on('navigated', ({ url, title }: { url: string; title: string }) => {
              broadcastEnvelope({
                channel: 'qa', sessionId: '', payload: { type: 'navigate_result', url, title }, auth: '',
              });
            });
          }
        } catch (err) {
          console.warn('[Zeus] QA auto-start failed (non-fatal):', (err as Error).message);
        }
      }

      // Git and file tree watchers are started by the frontend explicitly
      // (sent right after start_claude). No auto-start here to avoid race conditions.
    } catch (err) {
      sendError(ws, envelope.sessionId, `Failed to start Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === 'resume_claude') {
    const opts = envelope.payload as ClaudeResumePayload;
    const workingDir = opts.workingDir || process.env.HOME || '/';

    // Ensure working directory exists for resumed sessions too
    if (!fs.existsSync(workingDir)) {
      try {
        fs.mkdirSync(workingDir, { recursive: true });
        console.log(`[Zeus] Created working directory for resume: ${workingDir}`);
      } catch (mkdirErr: unknown) {
        const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
        sendError(ws, envelope.sessionId, `Working directory does not exist and could not be created: ${workingDir} — ${msg}`);
        return;
      }
    }

    try {
      const session = await claudeManager.resumeSession(
        envelope.sessionId,
        opts.claudeSessionId,
        opts.prompt,
        { workingDir, zeusSessionId: envelope.sessionId },
      );

      // Persist resumed session to DB — carry over name, icon & color from original
      insertClaudeSession({
        id: envelope.sessionId,
        claudeSessionId: opts.claudeSessionId,
        status: 'running',
        prompt: opts.prompt,
        name: opts.name ?? null,
        icon: SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)],
        color: opts.color ?? null,
        notificationSound: true,
        workingDir,
        permissionMode: 'bypassPermissions',
        model: null,
        startedAt: Date.now(),
        endedAt: null,
      });

      // Copy history entries from previous sessions sharing the same Claude session ID
      // so the resumed session's DB has the full conversation timeline
      copyClaudeEntriesForResume(opts.claudeSessionId, envelope.sessionId);

      if (!clientClaudeSessions.has(ws)) clientClaudeSessions.set(ws, new Set());
      clientClaudeSessions.get(ws)!.add(envelope.sessionId);

      wireClaudeSession(ws, session, envelope);

      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_started' },
        auth: '',
      });
    } catch (err) {
      sendError(ws, envelope.sessionId, `Failed to resume Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === 'send_message') {
    const { content, files, images } = envelope.payload as ClaudeSendMessagePayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);

      // Build metadata for DB persistence
      const meta: Record<string, unknown> = {};
      if (files && files.length > 0) meta.files = files;
      if (images && images.length > 0) meta.images = images.map((img) => ({ filename: img.filename, mediaType: img.mediaType }));

      // Persist user message to DB (original content, not enhanced)
      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: 'user_message' },
        content,
        metadata: Object.keys(meta).length > 0 ? meta : undefined,
      });

      // Build enhanced message with file contents if files attached
      let enhancedText = content;
      if (files && files.length > 0) {
        const fileService = fileTreeManager.getService(envelope.sessionId);
        if (fileService) {
          const fileBlocks: string[] = [];
          for (const filePath of files) {
            try {
              // Check if it's a directory or file
              const resolved = path.resolve(fileService.getWorkingDir(), filePath);
              const stats = await fsStat(resolved);
              if (stats.isDirectory()) {
                const dirFiles = await fileService.readDirectoryRecursive(filePath);
                for (const f of dirFiles) {
                  fileBlocks.push(`<file path="${f.path}">\n${f.content}\n</file>`);
                }
              } else {
                const fileContent = await fileService.readFileContent(filePath);
                if (fileContent !== null) {
                  fileBlocks.push(`<file path="${filePath}">\n${fileContent}\n</file>`);
                } else {
                  fileBlocks.push(`<file path="${filePath}">\n[Binary or too large to include]\n</file>`);
                }
              }
            } catch {
              fileBlocks.push(`<file path="${filePath}">\n[Could not read file]\n</file>`);
            }
          }
          if (fileBlocks.length > 0) {
            enhancedText = `<attached_files>\n${fileBlocks.join('\n')}\n</attached_files>\n\n${content}`;
          }
        }
      }

      // If images attached, send as multi-part content blocks
      if (images && images.length > 0) {
        const blocks: import('./claude-types').ContentBlock[] = [];

        // Add image blocks
        for (const img of images) {
          // Strip data URL prefix to get raw base64
          const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType,
              data: base64,
            },
          });
        }

        // Add text block
        if (enhancedText) {
          blocks.push({ type: 'text', text: enhancedText });
        }

        await session.sendMessage(blocks);
      } else {
        await session.sendMessage(enhancedText);
      }
    } else {
      sendError(ws, envelope.sessionId, 'No active Claude session for this ID');
    }
  } else if (payload.type === 'approve_tool') {
    const { approvalId, updatedInput } = envelope.payload as ClaudeApproveToolPayload;
    console.log('[WS] approve_tool', approvalId, 'hasUpdatedInput:', !!updatedInput);
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.approveTool(approvalId, updatedInput);
    }
  } else if (payload.type === 'deny_tool') {
    const { approvalId, reason } = envelope.payload as ClaudeDenyToolPayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.denyTool(approvalId, reason);
    }
  } else if (payload.type === 'interrupt') {
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.interrupt();
    }
  } else if (payload.type === 'stop_claude') {
    adoptClaudeSession(ws, envelope.sessionId);
    claudeManager.killSession(envelope.sessionId);
    stopQaAgentsByParent(envelope.sessionId);
    updateClaudeSessionStatus(envelope.sessionId, 'done', Date.now());
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
  } else if (payload.type === 'list_claude_sessions') {
    const dbSessions = getAllClaudeSessions().filter((s) => s.status !== 'archived');
    const sessions: ClaudeSessionInfo[] = dbSessions.map((s) => {
      // Cross-reference in-memory manager for accurate running status
      const live = claudeManager.getSession(s.id);
      const status = live?.isRunning ? 'running' : (s.status as ClaudeSessionInfo['status']);
      return {
        id: s.id,
        claudeSessionId: s.claudeSessionId,
        status,
        prompt: s.prompt,
        name: s.name ?? undefined,
        icon: (s.icon as SessionIconName) ?? undefined,
        color: s.color ?? undefined,
        notificationSound: s.notificationSound,
        workingDir: s.workingDir ?? undefined,
        startedAt: s.startedAt,
        qaAgentCount: countQaAgentsByParent(s.id),
      };
    });
    sendEnvelope(ws, {
      channel: 'claude',
      sessionId: '',
      payload: { type: 'claude_session_list', sessions },
      auth: '',
    });
  } else if (payload.type === 'get_claude_history') {
    const entries = getClaudeEntries(envelope.sessionId);
    sendEnvelope(ws, {
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_history', entries },
      auth: '',
    });
  } else if (payload.type === 'update_claude_session') {
    const updates: { name?: string; color?: string | null } = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.color !== undefined) updates.color = payload.color;
    updateClaudeSessionMeta(envelope.sessionId, updates);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_updated', sessionId: envelope.sessionId, ...updates },
      auth: '',
    });
  } else if (payload.type === 'delete_claude_session') {
    // Kill if still running, stop git watcher, clean up QA agents, then delete from DB
    claudeManager.killSession(envelope.sessionId);
    gitManager.stopWatching(envelope.sessionId);
    stopQaAgentsByParent(envelope.sessionId);
    deleteQaAgentsByParent(envelope.sessionId);
    deleteClaudeSession(envelope.sessionId);
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_deleted', deletedId: envelope.sessionId },
      auth: '',
    });
  } else if (payload.type === 'archive_claude_session') {
    // Kill if still running, stop git watcher, then archive in DB
    claudeManager.killSession(envelope.sessionId);
    gitManager.stopWatching(envelope.sessionId);
    archiveClaudeSession(envelope.sessionId);
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_archived', archivedId: envelope.sessionId },
      auth: '',
    });
  // ─── External Session Management (from zeus-bridge MCP) ───

  } else if (payload.type === 'register_external_session') {
    // External agent creates a session visible in the UI
    const sessionId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    insertClaudeSession({
      id: sessionId,
      claudeSessionId: null,
      status: 'running',
      prompt: payload.prompt || 'External session',
      name: payload.name || null,
      icon: SESSION_ICON_NAMES[Math.floor(Math.random() * SESSION_ICON_NAMES.length)],
      color: null,
      notificationSound: true,
      workingDir: payload.workingDir || process.env.HOME || '/',
      permissionMode: 'bypassPermissions',
      model: null,
      startedAt: now,
      endedAt: null,
    });

    // Persist initial user message entry
    upsertClaudeEntry(sessionId, {
      id: `user-${now}`,
      entryType: { type: 'user_message' },
      content: payload.prompt || 'External session',
    });

    broadcastEnvelope({
      channel: 'claude',
      sessionId,
      payload: { type: 'claude_started' },
      auth: '',
    });

    // Send response back with sessionId
    sendEnvelope(ws, {
      channel: 'claude',
      sessionId,
      payload: { type: 'register_external_session_response', responseId: payload.responseId, sessionId },
      auth: '',
    });

    console.log(`[Claude] External session registered: ${sessionId} — ${payload.name}`);

  } else if (payload.type === 'external_session_entry') {
    // External agent adds an entry to a session
    const { sessionId: extSessionId, entry } = payload as { sessionId: string; entry: NormalizedEntry };
    if (!extSessionId || !entry) return;

    upsertClaudeEntry(extSessionId, entry);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: extSessionId,
      payload: { type: 'entry', entry },
      auth: '',
    });

  } else if (payload.type === 'external_session_activity') {
    // External agent updates activity state
    const { sessionId: extSessionId, activity } = payload as { sessionId: string; activity: unknown };
    if (!extSessionId || !activity) return;

    broadcastEnvelope({
      channel: 'claude',
      sessionId: extSessionId,
      payload: { type: 'session_activity', activity },
      auth: '',
    });

  } else if (payload.type === 'external_session_done') {
    // External agent ends a session
    const { sessionId: extSessionId, status } = payload as { sessionId: string; status: string };
    if (!extSessionId) return;

    const finalStatus = status === 'error' ? 'error' : 'done';
    finalizeCreatedToolEntries(extSessionId);
    updateClaudeSessionStatus(extSessionId, finalStatus, Date.now());

    broadcastEnvelope({
      channel: 'claude',
      sessionId: extSessionId,
      payload: { type: finalStatus === 'error' ? 'error' : 'done', message: finalStatus === 'error' ? 'External session errored' : undefined },
      auth: '',
    });

    console.log(`[Claude] External session ended: ${extSessionId} (${finalStatus})`);

  } else {
    sendError(ws, envelope.sessionId, `Unknown claude type: ${payload.type}`);
  }
}

async function handleGit(_ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as GitPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === 'start_watching') {
    try {
      const { watcher, isNew } = await gitManager.startWatching(sessionId, payload.workingDir);

      if (isNew) {
        watcher.on('connected', () => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_connected' },
            auth: '',
          });
        });

        watcher.on('heartbeat', () => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_heartbeat' },
            auth: '',
          });
        });

        watcher.on('status', (data) => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_status', data },
            auth: '',
          });
        });

        watcher.on('not_a_repo', () => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'not_a_repo' },
            auth: '',
          });
        });

        watcher.on('error', (err: Error) => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_error', message: err.message },
            auth: '',
          });
        });
      }

      // Only send connected + refresh if this is actually a git repo
      if (watcher.isRepo) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_connected' },
          auth: '',
        });
        await watcher.refresh();
      }
    } catch (err) {
      sendError(_ws, sessionId, `Failed to start git watcher: ${(err as Error).message}`);
    }
  } else if (payload.type === 'stop_watching') {
    await gitManager.stopWatching(sessionId);
    broadcastEnvelope({
      channel: 'git',
      sessionId,
      payload: { type: 'git_disconnected' },
      auth: '',
    });
  } else if (payload.type === 'refresh') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      await watcher.refresh();
    }
  } else if (payload.type === 'git_stage') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.stageFiles(payload.files);
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_unstage') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.unstageFiles(payload.files);
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_stage_all') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.stageAll();
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_unstage_all') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.unstageAll();
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_discard') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        await watcher.discardFiles(payload.files);
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_file_contents') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const result = await watcher.getFileContents(payload.file, payload.staged);
        sendEnvelope(_ws, {
          channel: 'git',
          sessionId,
          payload: {
            type: 'git_file_contents_result',
            file: payload.file,
            staged: payload.staged,
            original: result.original,
            modified: result.modified,
            language: result.language,
          },
          auth: '',
        });
      } catch (err) {
        sendEnvelope(_ws, {
          channel: 'git',
          sessionId,
          payload: {
            type: 'git_file_contents_error',
            file: payload.file,
            error: (err as Error).message,
          },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_save_file') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.saveFile(payload.file, payload.content);
      sendEnvelope(_ws, {
        channel: 'git',
        sessionId,
        payload: {
          type: 'git_save_file_result',
          file: payload.file,
          success: result.success,
          error: result.error,
        },
        auth: '',
      });
    }
  } else if (payload.type === 'git_commit') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.commit(payload.message);
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_commit_result', ...result },
        auth: '',
      });
    } else {
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_error', message: 'No active git watcher for this session' },
        auth: '',
      });
    }
  } else if (payload.type === 'git_init') {
    const result = await initGitRepo(payload.workingDir);
    broadcastEnvelope({
      channel: 'git',
      sessionId,
      payload: { type: 'git_init_result', ...result },
      auth: '',
    });
    // If init succeeded, auto-start watching
    if (result.success) {
      const { watcher, isNew } = await gitManager.startWatching(sessionId, payload.workingDir);
      if (isNew) {
        watcher.on('connected', () => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_connected' },
            auth: '',
          });
        });
        watcher.on('heartbeat', () => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_heartbeat' },
            auth: '',
          });
        });
        watcher.on('status', (data) => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_status', data },
            auth: '',
          });
        });
        watcher.on('error', (err: Error) => {
          broadcastEnvelope({
            channel: 'git',
            sessionId,
            payload: { type: 'git_error', message: err.message },
            auth: '',
          });
        });
      }
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_connected' },
        auth: '',
      });
      await watcher.refresh();
    }
  } else {
    sendError(_ws, sessionId, `Unknown git type: ${(payload as { type: string }).type}`);
  }
}

async function handleFiles(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as FilesPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === 'start_watching') {
    try {
      const { service, isNew } = await fileTreeManager.startWatching(sessionId, payload.workingDir);

      if (isNew) {
        service.on('connected', () => {
          broadcastEnvelope({
            channel: 'files',
            sessionId,
            payload: { type: 'files_connected' },
            auth: '',
          });
        });

        service.on('files_changed', (data: { directories: string[] }) => {
          broadcastEnvelope({
            channel: 'files',
            sessionId,
            payload: { type: 'files_changed', directories: data.directories },
            auth: '',
          });
        });

        service.on('error', (err: Error) => {
          broadcastEnvelope({
            channel: 'files',
            sessionId,
            payload: { type: 'files_error', message: err.message },
            auth: '',
          });
        });
      }

      // Always send current state (whether new or existing service)
      broadcastEnvelope({
        channel: 'files',
        sessionId,
        payload: { type: 'files_connected' },
        auth: '',
      });
      try {
        const entries = await service.listDirectory('');
        broadcastEnvelope({
          channel: 'files',
          sessionId,
          payload: { type: 'directory_listing', dirPath: '', entries },
          auth: '',
        });
      } catch { /* root listing will be retried by the client */ }
    } catch (err) {
      sendError(ws, sessionId, `Failed to start file watcher: ${(err as Error).message}`);
    }
  } else if (payload.type === 'stop_watching') {
    await fileTreeManager.stopWatching(sessionId);
  } else if (payload.type === 'list_directory') {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const entries = await service.listDirectory(payload.dirPath);
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: { type: 'directory_listing', dirPath: payload.dirPath, entries },
          auth: '',
        });
      } catch (err) {
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: { type: 'files_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'read_file') {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const result = await service.readFile(payload.filePath);
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: {
            type: 'read_file_result',
            filePath: payload.filePath,
            content: result.content,
            language: result.language,
          },
          auth: '',
        });
      } catch (err) {
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: {
            type: 'read_file_error',
            filePath: payload.filePath,
            error: (err as Error).message,
          },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'search_files') {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const results = await service.searchFiles(payload.query);
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: { type: 'search_files_result', query: payload.query, results },
          auth: '',
        });
      } catch (err) {
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: { type: 'files_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'save_file') {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      const result = await service.saveFile(payload.filePath, payload.content);
      sendEnvelope(ws, {
        channel: 'files',
        sessionId,
        payload: {
          type: 'save_file_result',
          filePath: payload.filePath,
          success: result.success,
          error: result.error,
        },
        auth: '',
      });
    }
  } else {
    sendError(ws, sessionId, `Unknown files type: ${(payload as { type: string }).type}`);
  }
}

async function handleQA(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as QaPayload;

  if (payload.type === 'start_qa') {
    try {
      if (qaService?.isRunning()) {
        sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_started', responseId: payload.responseId }, auth: '' });
        return;
      }
      qaService = new QAService();
      await qaService.start();
      broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'qa_started', responseId: payload.responseId }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message, responseId: payload.responseId }, auth: '',
      });
    }
  } else if (payload.type === 'stop_qa') {
    // Kill all QA agents (they depend on PinchTab)
    for (const [id, record] of qaAgentSessions) {
      record.session.kill();
    }

    if (qaService) {
      await qaService.stop();
      qaService = null;
    }
    broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'qa_stopped' }, auth: '' });
  } else if (payload.type === 'get_qa_status') {
    const running = qaService?.isRunning() ?? false;
    const instances = running && qaService ? await qaService.listInstances() : [];
    sendEnvelope(ws, {
      channel: 'qa', sessionId: '', payload: { type: 'qa_status', running, instances, responseId: payload.responseId }, auth: '',
    });
  } else if (payload.type === 'launch_instance') {
    if (!qaService?.isRunning()) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: 'QA service not running' }, auth: '' });
      return;
    }
    try {
      const instance = await qaService.launchInstance(payload.headless);
      broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'instance_launched', instance, responseId: payload.responseId }, auth: '' });

      // Wire CDP events to frontend
      const cdp = qaService!.getCdpClient();
      if (cdp) {
        cdp.on('console', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_console', logs: [entry] }, auth: '',
          });
        });
        cdp.on('network', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_network', requests: [entry] }, auth: '',
          });
        });
        cdp.on('js_error', (entry) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'cdp_error', errors: [entry] }, auth: '',
          });
        });
        cdp.on('navigated', ({ url, title }: { url: string; title: string }) => {
          broadcastEnvelope({
            channel: 'qa', sessionId: '', payload: { type: 'navigate_result', url, title }, auth: '',
          });
        });
      }
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'stop_instance') {
    if (!qaService?.isRunning()) return;
    try {
      await qaService.stopInstance(payload.instanceId);
      broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'instance_stopped', instanceId: payload.instanceId }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'navigate') {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.navigate(payload.url);
      broadcastEnvelope({ channel: 'qa', sessionId: '', payload: { type: 'navigate_result', url: result.url, title: result.title }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'snapshot') {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.snapshot(payload.filter);
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'snapshot_result', nodes: result.nodes, raw: result.raw }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'screenshot') {
    if (!qaService?.isRunning()) return;
    try {
      const dataUrl = await qaService.screenshot();
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'screenshot_result', dataUrl }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'action') {
    if (!qaService?.isRunning()) return;
    try {
      const result = await qaService.action(payload.kind, payload.ref, payload.value, payload.key);
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'action_result', success: result.success, message: result.message }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'text') {
    if (!qaService?.isRunning()) return;
    try {
      const text = await qaService.text();
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'text_result', text }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'list_tabs') {
    if (!qaService?.isRunning()) return;
    try {
      const tabs = await qaService.listTabs();
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'tabs_list', tabs }, auth: '' });
    } catch (err) {
      sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: (err as Error).message }, auth: '' });
    }
  } else if (payload.type === 'start_qa_agent') {
    console.log('[QA Agent] start_qa_agent received:', { task: payload.task, parentSessionId: payload.parentSessionId, parentSessionType: payload.parentSessionType, workingDir: payload.workingDir, targetUrl: payload.targetUrl });
    try {
      if (!qaService?.isRunning()) {
        qaService = new QAService();
        await qaService.start();
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'qa_started' },
        });
      }
      const instances = await qaService.listInstances();
      if (instances.length === 0) {
        const instance = await qaService.launchInstance(true);
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'instance_launched', instance },
        });
        const cdp = qaService.getCdpClient();
        if (cdp) {
          cdp.on('console', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_console', logs: [entry] } });
          });
          cdp.on('network', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_network', requests: [entry] } });
          });
          cdp.on('js_error', (entry) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'cdp_error', errors: [entry] } });
          });
          cdp.on('navigated', ({ url, title }: { url: string; title: string }) => {
            broadcastEnvelope({ channel: 'qa', sessionId: '', auth: '', payload: { type: 'navigate_result', url, title } });
          });
        }
      }

      const targetUrl = payload.targetUrl || 'http://localhost:5173';
      const qaAgentId = `qa-agent-${++qaAgentIdCounter}-${Date.now()}`;
      const parentSessionId = payload.parentSessionId;
      const parentSessionType = payload.parentSessionType;

      const session = new ClaudeSession({
        workingDir: payload.workingDir,
        permissionMode: 'bypassPermissions',
        enableQA: true,
        qaTargetUrl: targetUrl,
        zeusSessionId: payload.parentSessionId,
      });

      const agentName = payload.name || undefined;
      const record: QaAgentRecord = {
        qaAgentId,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task: payload.task,
        targetUrl,
        workingDir: payload.workingDir,
        session,
        startedAt: Date.now(),
        pendingResponseId: payload.responseId,
        pendingResponseWs: ws,
        collectedTextEntries: [],
      };

      qaAgentSessions.set(qaAgentId, record);
      wireQAAgent(record);

      // Persist QA agent session to DB
      insertQaAgentSession({
        id: qaAgentId,
        parentSessionId,
        parentSessionType,
        name: agentName ?? null,
        task: payload.task,
        targetUrl,
        status: 'running',
        startedAt: record.startedAt,
        endedAt: null,
      });

      const prompt = `${buildQAAgentSystemPrompt(targetUrl)}\n\n---\n\nTask: ${payload.task}`;
      await session.start(prompt);

      console.log('[QA Agent] Agent started successfully:', qaAgentId);
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: {
          type: 'qa_agent_started',
          qaAgentId,
          parentSessionId,
          parentSessionType,
          name: agentName,
          task: payload.task,
          targetUrl,
        },
      });

      // Response is deferred — sent when the QA agent finishes (see wireQAAgent 'done' handler)
    } catch (err) {
      console.error('[QA Agent] Failed to start:', (err as Error).message);
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: `Failed to start QA agent: ${(err as Error).message}` },
      });
    }
  } else if (payload.type === 'stop_qa_agent') {
    const record = qaAgentSessions.get(payload.qaAgentId);
    if (record && record.session && record.session.isRunning) {
      // Interrupt (not kill) — keeps the session alive so the user can send follow-up messages
      try {
        await record.session.interrupt();
        // Broadcast a status entry so the user sees the interrupt happened
        const interruptEntry: import('../../shared/types').QaAgentLogEntry = {
          kind: 'status',
          message: 'Agent interrupted — you can send a new message.',
          timestamp: Date.now(),
        };
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_entry',
            qaAgentId: payload.qaAgentId,
            parentSessionId: record.parentSessionId,
            entry: interruptEntry,
          },
        });
        insertQaAgentEntry(payload.qaAgentId, interruptEntry.kind, JSON.stringify(interruptEntry), interruptEntry.timestamp);
      } catch {
        // If interrupt fails (process already dead), fall back to broadcasting stopped
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'qa_agent_stopped', qaAgentId: payload.qaAgentId, parentSessionId: record.parentSessionId },
        });
      }
    } else if (record) {
      // Already stopped — no-op, user can send a new message to resume
    } else {
      broadcastEnvelope({
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_agent_stopped', qaAgentId: payload.qaAgentId, parentSessionId: '' },
      });
    }
  } else if (payload.type === 'delete_qa_agent') {
    // Stop if running, then delete from DB and notify clients
    const record = qaAgentSessions.get(payload.qaAgentId);
    if (record) {
      if (record.session && record.session.isRunning) {
        record.session.kill();
      }
      qaAgentSessions.delete(payload.qaAgentId);
    }
    deleteQaAgentSession(payload.qaAgentId);
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_deleted', qaAgentId: payload.qaAgentId, parentSessionId: payload.parentSessionId },
    });
  } else if (payload.type === 'list_qa_agents') {
    // Merge in-memory agents (running or stopped-but-resumable) with completed agents from DB
    const inMemoryIds = new Set<string>();
    const inMemoryAgents = Array.from(qaAgentSessions.values())
      .filter((r) => r.parentSessionId === payload.parentSessionId)
      .map((r) => {
        inMemoryIds.add(r.qaAgentId);
        const isAlive = r.session !== null && r.session.isRunning;
        return {
          qaAgentId: r.qaAgentId,
          parentSessionId: r.parentSessionId,
          parentSessionType: r.parentSessionType,
          name: r.name,
          task: r.task,
          targetUrl: r.targetUrl,
          status: isAlive ? 'running' as const : 'stopped' as const,
          startedAt: r.startedAt,
        };
      });

    // Get completed/errored agents from DB (skip ones already in memory)
    const dbAgents = getQaAgentSessionsByParent(payload.parentSessionId)
      .filter((r) => !inMemoryIds.has(r.id))
      .map((r) => ({
        qaAgentId: r.id,
        parentSessionId: r.parentSessionId,
        parentSessionType: r.parentSessionType,
        name: r.name ?? undefined,
        task: r.task,
        targetUrl: r.targetUrl ?? undefined,
        status: r.status as 'stopped' | 'error',
        startedAt: r.startedAt,
      }));

    const agents = [...inMemoryAgents, ...dbAgents];
    sendEnvelope(ws, {
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_list', parentSessionId: payload.parentSessionId, agents },
    });
  } else if (payload.type === 'qa_agent_message') {
    const record = qaAgentSessions.get(payload.qaAgentId);
    if (!record) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: 'No QA agent found with that ID' },
      });
      return;
    }

    const userMsgEntry = { kind: 'user_message' as const, content: payload.text, timestamp: Date.now() };
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_entry',
        qaAgentId: payload.qaAgentId,
        parentSessionId: record.parentSessionId,
        entry: userMsgEntry,
      },
    });
    insertQaAgentEntry(payload.qaAgentId, userMsgEntry.kind, JSON.stringify(userMsgEntry), userMsgEntry.timestamp);

    try {
      if (record.session && record.session.isRunning) {
        // Session is alive — send message directly
        await record.session.sendMessage(payload.text);
      } else if (record.claudeSessionId) {
        // Session is dead — resume with --resume
        const resumedSession = new ClaudeSession({
          workingDir: record.workingDir,
          permissionMode: 'bypassPermissions',
          enableQA: true,
          qaTargetUrl: record.targetUrl,
          zeusSessionId: record.parentSessionId,
          resumeSessionId: record.claudeSessionId,
          resumeAtMessageId: record.lastMessageId ?? undefined,
        });
        record.session = resumedSession;
        record.collectedTextEntries = [];
        wireQAAgent(record);

        // Broadcast that the agent is running again
        updateQaAgentSessionStatus(record.qaAgentId, 'running');
        broadcastEnvelope({
          channel: 'qa', sessionId: '', auth: '',
          payload: {
            type: 'qa_agent_started',
            qaAgentId: record.qaAgentId,
            parentSessionId: record.parentSessionId,
            parentSessionType: record.parentSessionType,
            name: record.name,
            task: record.task,
            targetUrl: record.targetUrl,
          },
        });

        await resumedSession.start(payload.text);
      } else {
        sendEnvelope(ws, {
          channel: 'qa', sessionId: '', auth: '',
          payload: { type: 'qa_error', message: 'Agent session ended and cannot be resumed' },
        });
      }
    } catch (err) {
      sendEnvelope(ws, {
        channel: 'qa', sessionId: '', auth: '',
        payload: { type: 'qa_error', message: `Failed to send message: ${(err as Error).message}` },
      });
    }
  } else if (payload.type === 'get_qa_agent_entries') {
    // Load persisted entries from DB for a specific agent
    const dbEntries = getQaAgentEntries(payload.qaAgentId);
    const entries = dbEntries.map((row) => JSON.parse(row.data) as import('../../shared/types').QaAgentLogEntry);
    sendEnvelope(ws, {
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_entries', qaAgentId: payload.qaAgentId, entries },
    });
  } else if (payload.type === 'register_external_qa') {
    // External QA agent registration (from zeus-bridge MCP)
    const qaAgentId = `qa-ext-${++qaAgentIdCounter}-${Date.now()}`;
    const parentSessionId = payload.parentSessionId || 'external';
    const parentSessionType = payload.parentSessionType || 'claude';
    const task = payload.task || 'External QA test';
    const targetUrl = payload.targetUrl || 'http://localhost:5173';
    const agentName = payload.name || undefined;

    insertQaAgentSession({
      id: qaAgentId,
      parentSessionId,
      parentSessionType,
      name: agentName ?? null,
      task,
      targetUrl,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
    });

    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_started',
        qaAgentId,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task,
        targetUrl,
      },
    });

    // Send response back with the qaAgentId
    sendEnvelope(ws, {
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'register_external_qa_response', responseId: payload.responseId, qaAgentId },
    });

    externalQaParentMap.set(qaAgentId, parentSessionId);

    console.log(`[QA Agent] External agent registered: ${qaAgentId} (parent: ${parentSessionId})`);

  } else if (payload.type === 'external_qa_entry') {
    // External QA agent log entry (from zeus-bridge MCP)
    const { qaAgentId, entry } = payload as { qaAgentId: string; entry: { kind: string; timestamp: number; [key: string]: unknown } };
    if (!qaAgentId || !entry) return;

    insertQaAgentEntry(qaAgentId, entry.kind, JSON.stringify(entry), entry.timestamp);
    const parentSessionId = externalQaParentMap.get(qaAgentId) ?? 'external';
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: {
        type: 'qa_agent_entry',
        qaAgentId,
        parentSessionId,
        entry,
      },
    });

  } else if (payload.type === 'external_qa_done') {
    // External QA agent completion (from zeus-bridge MCP)
    const { qaAgentId, status } = payload as { qaAgentId: string; status: string };
    if (!qaAgentId) return;

    updateQaAgentSessionStatus(qaAgentId, status || 'stopped', Date.now());
    const parentSessionId = externalQaParentMap.get(qaAgentId) ?? 'external';
    broadcastEnvelope({
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_agent_stopped', qaAgentId, parentSessionId },
    });
    externalQaParentMap.delete(qaAgentId);

    console.log(`[QA Agent] External agent stopped: ${qaAgentId} (${status})`);

  } else {
    sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: `Unknown QA type: ${(payload as { type: string }).type}` }, auth: '' });
  }
}

function handleSettings(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as SettingsPayload;

  if (payload.type === 'get_settings') {
    const settings = getSettings();
    sendEnvelope(ws, {
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings },
      auth: '',
    });
    // Send active theme colors immediately to prevent FOUC
    const activeTheme = getThemeById(settings.activeThemeId);
    if (activeTheme) {
      sendEnvelope(ws, {
        channel: 'settings',
        sessionId: '',
        payload: { type: 'theme_colors', theme: activeTheme },
        auth: '',
      });
    }
  } else if (payload.type === 'add_project') {
    if (payload.createDir && !fs.existsSync(payload.path)) {
      try {
        fs.mkdirSync(payload.path, { recursive: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEnvelope(ws, {
          channel: 'settings',
          sessionId: '',
          payload: { type: 'settings_error', message: `Failed to create directory: ${msg}` },
          auth: '',
        });
        return;
      }
    }
    if (!fs.existsSync(payload.path)) {
      sendEnvelope(ws, {
        channel: 'settings',
        sessionId: '',
        payload: { type: 'settings_error', message: `Directory does not exist: ${payload.path}` },
        auth: '',
      });
      return;
    }
    addProject(payload.name, payload.path);
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
  } else if (payload.type === 'remove_project') {
    removeProject(payload.id);
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
  } else if (payload.type === 'update_defaults') {
    updateDefaults(payload.defaults);
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
  } else if (payload.type === 'set_last_used_project') {
    setLastUsedProject(payload.id);
  } else if (payload.type === 'set_theme') {
    const theme = getThemeById(payload.themeId);
    if (!theme) {
      sendEnvelope(ws, {
        channel: 'settings',
        sessionId: '',
        payload: { type: 'settings_error', message: `Theme not found: ${payload.themeId}` },
        auth: '',
      });
      return;
    }
    setActiveTheme(payload.themeId);
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'theme_colors', theme },
      auth: '',
    });
  } else if (payload.type === 'get_theme_colors') {
    const theme = getThemeById(payload.themeId);
    if (theme) {
      sendEnvelope(ws, {
        channel: 'settings',
        sessionId: '',
        payload: { type: 'theme_colors', theme },
        auth: '',
      });
    } else {
      sendEnvelope(ws, {
        channel: 'settings',
        sessionId: '',
        payload: { type: 'settings_error', message: `Theme not found: ${payload.themeId}` },
        auth: '',
      });
    }
  } else if (payload.type === 'refresh_themes') {
    refreshThemes();
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
  } else if (payload.type === 'open_themes_folder') {
    shell.openPath(getThemesDir());
  } else {
    sendError(ws, '', `Unknown settings type: ${(payload as { type: string }).type}`);
  }
}

async function handlePerf(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as PerfPayload;

  if (payload.type === 'get_perf') {
    const metrics = await systemMonitor.collect();
    sendEnvelope(ws, {
      channel: 'perf',
      sessionId: '',
      payload: { type: 'perf_update', metrics } satisfies PerfPayload,
      auth: '',
    });
  } else if (payload.type === 'set_poll_interval') {
    systemMonitor.setPollInterval(payload.intervalMs);
  } else if (payload.type === 'start_monitoring') {
    systemMonitor.start();
  } else if (payload.type === 'stop_monitoring') {
    systemMonitor.stop();
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  let envelope: WsEnvelope;
  try {
    envelope = JSON.parse(raw) as WsEnvelope;
  } catch {
    sendError(ws, '', 'Invalid JSON');
    return;
  }


  switch (envelope.channel) {
    case 'control':
      handleControl(ws, envelope);
      break;
    case 'terminal':
      handleTerminal(ws, envelope);
      break;
    case 'status':
      handleStatus(ws, envelope);
      break;
    case 'claude':
      handleClaude(ws, envelope);
      break;
    case 'settings':
      handleSettings(ws, envelope);
      break;
    case 'git':
      handleGit(ws, envelope);
      break;
    case 'files':
      handleFiles(ws, envelope);
      break;
    case 'qa':
      handleQA(ws, envelope);
      break;
    case 'perf':
      handlePerf(ws, envelope);
      break;
    default:
      sendError(ws, envelope.sessionId, `Unknown channel: ${envelope.channel}`);
  }
}

function handleClose(ws: WebSocket): void {
  // Clean up terminal sessions
  const owned = clientSessions.get(ws);
  if (owned) {
    for (const sid of owned) {
      markKilled(sid);
      updateTerminalSession(sid, { status: 'killed', endedAt: Date.now() });
      destroySession(sid);
      broadcastSessionUpdated(sid);
    }
    clientSessions.delete(ws);
  }

  // Claude sessions: just clear ownership, keep processes + git watchers alive
  clientClaudeSessions.delete(ws);
}

export async function startWebSocketServer(port = 8888): Promise<void> {
  if (server) return;
  serverPort = port;

  return new Promise((resolve, reject) => {
    // Serve built renderer files (gracefully skip if dir doesn't exist — e.g. in tests)
    const clientDir = path.join(__dirname, '../renderer');
    const dirExists = fs.existsSync(clientDir);
    const serve = dirExists ? sirv(clientDir, { single: true }) : null;

    const httpServer = http.createServer((req, res) => {
      if (serve) {
        serve(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const wsServer = new WebSocketServer({ server: httpServer });

    wsServer.on('connection', (ws, req) => {
      const remoteAddr = req.socket.remoteAddress ?? '';
      const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

      if (isLocal) {
        authenticatedClients.add(ws);
        console.log('[Zeus] WebSocket client connected (local — auto-authenticated)');
      } else {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const token = url.searchParams.get('token');

        if (!token || !validateToken(token)) {
          console.warn(`[Zeus] Unauthorized WebSocket connection from ${remoteAddr}`);
          ws.close(4401, 'Unauthorized');
          return;
        }

        authenticatedClients.add(ws);
        console.log(`[Zeus] WebSocket client connected (remote — authenticated: ${remoteAddr})`);
      }

      ws.on('message', (data) => handleMessage(ws, data.toString()));
      ws.on('close', () => {
        console.log('[Zeus] WebSocket client disconnected');
        handleClose(ws);
      });
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Zeus] Port ${port} already in use. Is another Zeus instance running on this port?`);
        console.error(`[Zeus] Tip: Set ZEUS_WS_PORT=<port> or use ZEUS_ENV=development for port 8889.`);
      }
      reject(err);
    });

    httpServer.listen(port, '0.0.0.0', () => {
      server = httpServer;
      wss = wsServer;

      console.log(`[Zeus] Server listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

export async function stopWebSocketServer(): Promise<void> {
  if (!wss || !server) return;

  // Kill all Claude sessions, git watchers, file tree watchers, and QA service
  claudeManager.killAll();
  await gitManager.stopAll();
  await fileTreeManager.stopAll();
  if (qaService) {
    await qaService.stop();
    qaService = null;
  }

  // Close all client connections
  for (const ws of wss.clients) {
    handleClose(ws);
    ws.close();
  }

  return new Promise((resolve) => {
    wss!.close(() => {
      server!.close(() => {
        server = null;
        wss = null;
        console.log('[Zeus] Server stopped');
        resolve();
      });
    });
  });
}

export function notifyTunnelStatus(): void {
  broadcastEnvelope({
    channel: 'status',
    sessionId: '',
    payload: {
      type: 'status_update',
      powerBlock: isPowerBlocked(),
      websocket: true,
      tunnel: getTunnelUrl(),
    },
    auth: '',
  });
}

export function isWebSocketRunning(): boolean {
  return server !== null && server.listening;
}

export function getServerPort(): number {
  return serverPort;
}
