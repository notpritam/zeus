import http from 'http';
import fs from 'fs';
import { stat as fsStat } from 'fs/promises';
import path from 'path';
import os from 'os';
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
import { getTunnelUrl, isTunnelActive, startTunnel, stopTunnel, stopRemoteTunnel } from './tunnel';
import { zeusEnv } from './env';
import { validateToken, getAuthToken } from './auth';
import { ClaudeSessionManager, ClaudeSession } from './claude-session';
import type { NormalizedEntry } from './claude-types';
import {
  getSettings,
  addProject,
  removeProject,
  updateDefaults,
  setLastUsedProject,
  setActiveTheme,
  setAutoTunnel,
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
  getClaudeEntriesPaginated,
  deleteClaudeSession,
  restoreClaudeSession,
  getDeletedClaudeSessions,
  archiveClaudeSession,
  insertTerminalSession,
  updateTerminalSession,
  getAllTerminalSessions,
  deleteTerminalSession,
  restoreTerminalSession,
  archiveTerminalSession,
  insertSubagentSession,
  updateSubagentSessionStatus,
  getSubagentSessionsByParent,
  deleteSubagentSession,
  countSubagentsByParent,
  insertSubagentEntry,
  getSubagentEntries,
  clearSubagentEntries,
  updateSubagentResumeData,
  getSubagentSession,
  finalizeCreatedToolEntries,
  copyClaudeEntriesForResume,
  updateClaudeSessionQaTargetUrl,
} from './db';
import type { ClaudeSessionInfo, GitPayload, FilesPayload, QaBrowserPayload, SubagentPayload, SubagentType, SubagentCli, SessionIconName, AndroidPayload } from '../../shared/types';
import { SESSION_ICON_NAMES } from '../../shared/types';
import { GitWatcherManager, initGitRepo } from './git';
import { FileTreeServiceManager } from './file-tree';
import { QAService } from './qa';
import { AndroidQAService, findMaestroPath, findAdbPath } from './android-qa';
import { getSubagentType, type SubagentContext } from './subagent-registry';
import { detectDevServerUrlDetailed } from './detect-dev-server';
import { SystemMonitorService } from './system-monitor';
import { FlowRunner } from './flow-runner';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let serverPort = 8888;

/** Return tunnel URL with auth token appended so remote clients can authenticate. */
function getAuthenticatedTunnelUrl(): string | null {
  const url = getTunnelUrl();
  if (!url) return null;
  try {
    const token = getAuthToken();
    return `${url}?token=${token}`;
  } catch {
    return url;
  }
}

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

// Module-level singleton (mirrors qaService pattern)
let androidQAService: AndroidQAService | null = null;

function getAndroidQAService(): AndroidQAService {
  if (!androidQAService) {
    androidQAService = new AndroidQAService();
  }
  return androidQAService;
}

// Subagent sessions — keyed by subagentId, multiple per parent session
interface SubagentRecord {
  subagentId: string;
  subagentType: SubagentType;
  cli: SubagentCli;
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
const subagentSessions = new Map<string, SubagentRecord>();

// Track parentSessionId for external subagents (registered via zeus-bridge MCP)
const externalSubagentParentMap = new Map<string, string>();
let subagentIdCounter = 0;

// QA flow runner — loads structured flow definitions from qa-flows/
const flowRunner = new FlowRunner(path.join(app.getAppPath(), 'qa-flows'));

/** Kill all running subagents that belong to a given parent session. */
function stopSubagentsByParent(parentSessionId: string): void {
  for (const [id, record] of subagentSessions) {
    if (record.parentSessionId === parentSessionId) {
      try { if (record.session) record.session.kill(); } catch { /* already dead */ }
      subagentSessions.delete(id);
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
  } else {
    console.error(`[Zeus] sendEnvelope DROPPED: ws.readyState=${ws.readyState} (expected ${WebSocket.OPEN}), channel=${envelope.channel}, type=${(envelope.payload as Record<string, unknown>)?.type}`);
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
    const cwd = opts.cwd || process.env.HOME || '/';

    const { sessionId, shell } = createSession(
      { cols, rows, cwd },
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
    const record = registerSession(sessionId, shell, cols, rows, cwd);

    // Persist to DB
    insertTerminalSession(record);

    // Track ownership
    if (!clientSessions.has(ws)) clientSessions.set(ws, new Set());
    clientSessions.get(ws)!.add(sessionId);

    // Broadcast session_started with correlationId echoed back
    broadcastEnvelope({
      channel: 'control',
      sessionId,
      payload: {
        type: 'session_started',
        sessionId,
        shell,
        correlationId: opts.correlationId,
      },
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
    stopSubagentsByParent(sid);
    deleteTerminalSession(sid);
    const owned = clientSessions.get(ws);
    if (owned) owned.delete(sid);
    broadcastEnvelope({
      channel: 'control',
      sessionId: sid,
      payload: { type: 'terminal_session_deleted', deletedId: sid },
      auth: '',
    });
  } else if (payload.type === 'restore_terminal_session') {
    const sid = envelope.sessionId;
    restoreTerminalSession(sid);
    broadcastEnvelope({
      channel: 'control',
      sessionId: sid,
      payload: { type: 'terminal_session_restored', sessionId: sid },
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
        tunnel: getAuthenticatedTunnelUrl(),
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
        tunnel: getAuthenticatedTunnelUrl(),
      },
      auth: '',
    });
  } else if (payload.type === 'stop_tunnel') {
    // Used by dev instance to remotely stop prod's tunnel + ngrok session
    (async () => {
      try {
        // Always stop — kills listener + ngrok agent session to free the slot
        await stopTunnel();
        console.log('[Zeus] Tunnel + ngrok session killed via remote request');
        // Broadcast to all local clients so prod UI updates
        broadcastEnvelope({
          channel: 'status',
          sessionId: '',
          payload: {
            type: 'status_update',
            powerBlock: isPowerBlocked(),
            websocket: true,
            tunnel: getAuthenticatedTunnelUrl(),
          },
          auth: '',
        });
      } catch (err) {
        console.error('[Zeus] Remote tunnel stop error:', (err as Error).message);
      }
    })();
  } else if (payload.type === 'toggle_tunnel') {
    (async () => {
      try {
        if (isTunnelActive()) {
          await stopTunnel();
        } else {
          // In dev mode, stop prod's tunnel first to reclaim the ngrok domain
          if (zeusEnv.isDev) {
            const prodPort = 8888;
            console.log('[Zeus DEV] Checking for prod tunnel on port', prodPort);
            await stopRemoteTunnel(prodPort);
            // Wait for ngrok's backend to fully release the session slot
            await new Promise((r) => setTimeout(r, 3000));
          }
          // Retry up to 3 times — ngrok backend can be slow to free the slot
          let tunnelStarted = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const url = await startTunnel(serverPort);
            if (url) { tunnelStarted = true; break; }
            if (attempt < 3) {
              console.log(`[Zeus DEV] Tunnel start attempt ${attempt} failed, retrying in 3s...`);
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (!tunnelStarted) {
            sendError(ws, '', 'Failed to start tunnel after 3 attempts — prod ngrok session may still be active');
            return;
          }
        }
        broadcastEnvelope({
          channel: 'status',
          sessionId: '',
          payload: {
            type: 'status_update',
            powerBlock: isPowerBlocked(),
            websocket: true,
            tunnel: getAuthenticatedTunnelUrl(),
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

/** Read the qa_finish file written by the QA agent's MCP server */
function readQaFinishFile(qaAgentId: string, sessionPid?: number): { summary: string; status: string } | null {
  // Try qaAgentId-based path first, then fallback to PID-based
  const paths = [
    path.join(os.tmpdir(), `zeus-qa-finish-${qaAgentId}.json`),
    ...(sessionPid ? [path.join(os.tmpdir(), `zeus-qa-finish-ppid-${sessionPid}.json`)] : []),
  ];
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        // Clean up the file
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        console.log(`[QA Agent] Read finish file: ${filePath}`);
        return { summary: data.summary ?? '', status: data.status ?? 'done' };
      }
    } catch {
      // ignore read errors
    }
  }
  return null;
}

function wireSubagent(record: SubagentRecord): void {
  const { subagentId, parentSessionId } = record;
  const session = record.session!; // guaranteed non-null when wiring

  // Accumulate streaming text/thinking — only emit once finalized
  let pendingTextId: string | null = null;
  let pendingTextEntry: NormalizedEntry | null = null;
  let pendingThinkingId: string | null = null;
  let pendingThinkingEntry: NormalizedEntry | null = null;

  const emit = (entry: NormalizedEntry): void => {
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_entry', subagentId, parentSessionId, entry },
    });
    insertSubagentEntry(subagentId, entry.entryType.type, JSON.stringify(entry), Date.now());
  };

  const flushPendingText = (): void => {
    if (pendingTextEntry && pendingTextEntry.content.trim()) {
      emit(pendingTextEntry);
      record.collectedTextEntries.push(pendingTextEntry.content.trim());
    }
    pendingTextId = null;
    pendingTextEntry = null;
  };

  const flushPendingThinking = (): void => {
    if (pendingThinkingEntry && pendingThinkingEntry.content.trim()) {
      emit(pendingThinkingEntry);
    }
    pendingThinkingId = null;
    pendingThinkingEntry = null;
  };

  session.on('entry', async (entry: NormalizedEntry) => {
    // Accumulate assistant_message streaming — flush only when a new block starts or a non-text entry arrives
    if (entry.entryType.type === 'assistant_message') {
      if (entry.id !== pendingTextId) {
        flushPendingText();
        pendingTextId = entry.id;
      }
      pendingTextEntry = entry; // keep latest accumulated version
      return;
    }
    flushPendingText();

    // Accumulate thinking streaming
    if (entry.entryType.type === 'thinking') {
      if (entry.id !== pendingThinkingId) {
        flushPendingThinking();
        pendingThinkingId = entry.id;
      }
      pendingThinkingEntry = entry;
      return;
    }
    flushPendingThinking();

    // For screenshot tool results, attach captured image as metadata
    if (entry.entryType.type === 'tool_use') {
      const { toolName, status } = entry.entryType;
      const isScreenshot = /screenshot/i.test(toolName);
      if (isScreenshot && status === 'success') {
        // PinchTab QA screenshot (existing behavior, unchanged)
        if (qaService?.isRunning()) {
          try {
            const imageData = await qaService.screenshot();
            if (imageData) {
              const meta = (entry.metadata ?? {}) as Record<string, unknown>;
              meta.images = [imageData];
              entry = { ...entry, metadata: meta };
            }
          } catch { /* non-critical */ }
        }
        // Android QA screenshot
        else if (record.subagentType === 'android_qa' && androidQAService?.isRunning()) {
          try {
            const imageData = await androidQAService.screenshot();
            if (imageData) {
              const meta = (entry.metadata ?? {}) as Record<string, unknown>;
              meta.images = [imageData];
              entry = { ...entry, metadata: meta };
            }
          } catch { /* non-critical */ }
        }
      }
    }

    // Pass through all other entry types as-is (tool_use, error_message, system_message, token_usage, etc.)
    emit(entry);
  });

  session.on('approval_needed', (approval) => {
    if (approval.toolName === 'AskUserQuestion') {
      session.approveTool(approval.approvalId);
    }
  });

  // Turn ended (process still alive) — send deferred response and kill
  session.on('result', () => {
    console.log(`[Subagent] result event fired for ${subagentId} (pendingResponseId=${record.pendingResponseId ?? 'NONE'}, wsState=${record.pendingResponseWs?.readyState ?? 'NO_WS'}, pid=${session.pid}, isRunning=${session.isRunning})`);
    flushPendingText();
    flushPendingThinking();

    // Save Claude session data for resume support
    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    updateSubagentResumeData(subagentId, record.claudeSessionId ?? null, record.lastMessageId ?? null);

    updateSubagentSessionStatus(subagentId, 'stopped', Date.now());
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_stopped', subagentId, parentSessionId },
    });

    // Send deferred response to zeus_qa_run caller.
    // Read the finish file (written by qa_finish tool) for structured findings.
    // If no finish file, use collected text entries as fallback summary.
    if (record.pendingResponseId && record.pendingResponseWs) {
      const finishData = readQaFinishFile(subagentId, session.pid);
      let summary: string;
      let status: string;

      if (finishData) {
        summary = finishData.summary;
        status = finishData.status;
        console.log(`[Subagent] result: sending deferred response for ${subagentId} (qa_finish file found, status=${status})`);
      } else {
        const lastEntries = record.collectedTextEntries;
        summary = lastEntries.length > 0
          ? lastEntries[lastEntries.length - 1]
          : 'Subagent completed (no qa_finish called).';
        status = 'done';
        console.log(`[Subagent] result: sending deferred response for ${subagentId} (no qa_finish file, using collected text)`);
      }

      try {
        sendEnvelope(record.pendingResponseWs, {
          channel: 'subagent', sessionId: '', auth: '',
          payload: {
            type: 'start_subagent_response',
            responseId: record.pendingResponseId,
            subagentId,
            status,
            summary,
          },
        });
        console.log(`[Subagent] result: deferred response SENT for ${subagentId} (responseId=${record.pendingResponseId}, wsState=${record.pendingResponseWs.readyState})`);
      } catch (err) {
        console.error(`[Subagent] result: failed to send deferred response for ${subagentId}:`, (err as Error).message);
      }
      record.pendingResponseId = undefined;
      record.pendingResponseWs = undefined;

      // Kill the process — it's hanging waiting for stdin input we'll never send
      if (record.session && record.session.isRunning) {
        record.session.kill();
      }
    }
  });

  session.on('done', () => {
    console.log(`[Subagent] done event fired for ${subagentId} (pendingResponseId=${record.pendingResponseId ?? 'NONE'}, wsState=${record.pendingResponseWs?.readyState ?? 'NO_WS'})`);
    flushPendingText();
    flushPendingThinking();
    updateSubagentSessionStatus(subagentId, 'stopped', Date.now());

    // Save Claude session data for --resume support (in-memory + DB)
    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null; // process is dead but record stays for resume
    updateSubagentResumeData(subagentId, record.claudeSessionId ?? null, record.lastMessageId ?? null);

    // Send deferred response to caller with the final summary
    if (record.pendingResponseId && record.pendingResponseWs) {
      const finishData = readQaFinishFile(subagentId, session.pid);
      let summary: string;
      let status: string;

      if (finishData) {
        summary = finishData.summary;
        status = finishData.status;
        console.log(`[Subagent] done: sending deferred response for ${subagentId} (qa_finish file found, status=${status})`);
      } else {
        const lastEntries = record.collectedTextEntries;
        summary = lastEntries.length > 0
          ? lastEntries[lastEntries.length - 1]
          : 'Subagent completed without a summary.';
        status = 'done';
        console.log(`[Subagent] done: sending deferred response for ${subagentId} (no qa_finish file, using collected text, entries=${lastEntries.length})`);
      }

      try {
        sendEnvelope(record.pendingResponseWs, {
          channel: 'subagent', sessionId: '', auth: '',
          payload: {
            type: 'start_subagent_response',
            responseId: record.pendingResponseId,
            subagentId,
            status,
            summary,
          },
        });
        console.log(`[Subagent] done: deferred response SENT for ${subagentId} (responseId=${record.pendingResponseId})`);
      } catch (err) {
        console.error(`[Subagent] done: failed to send deferred response for ${subagentId}:`, (err as Error).message);
      }
      record.pendingResponseId = undefined;
      record.pendingResponseWs = undefined;
    } else {
      console.log(`[Subagent] done: no pending response for ${subagentId} (already sent or not a subagent run)`);
    }

    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_stopped', subagentId, parentSessionId },
    });
    // Don't delete from subagentSessions — keep record for resume
  });

  session.on('error', (err) => {
    console.error(`[Subagent] error event fired for ${subagentId}: ${err.message} (pendingResponseId=${record.pendingResponseId ?? 'NONE'})`);
    flushPendingText();
    flushPendingThinking();
    const crashEntry = { kind: 'error' as const, message: `Agent crashed: ${err.message}`, timestamp: Date.now() };
    insertSubagentEntry(subagentId, crashEntry.kind, JSON.stringify(crashEntry), crashEntry.timestamp);
    updateSubagentSessionStatus(subagentId, 'error', Date.now());

    // Save Claude session data for --resume support (in-memory + DB)
    record.claudeSessionId = session.sessionId ?? undefined;
    record.lastMessageId = session.lastMessageId ?? undefined;
    record.session = null;
    updateSubagentResumeData(subagentId, record.claudeSessionId ?? null, record.lastMessageId ?? null);

    // Send deferred error response to caller
    if (record.pendingResponseId && record.pendingResponseWs) {
      try {
        sendEnvelope(record.pendingResponseWs, {
          channel: 'subagent', sessionId: '', auth: '',
          payload: {
            type: 'start_subagent_response',
            responseId: record.pendingResponseId,
            subagentId,
            status: 'error',
            summary: `Agent crashed: ${err.message}`,
          },
        });
      } catch {
        // WebSocket may have closed — non-critical
      }
    }

    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: {
        type: 'subagent_entry',
        subagentId,
        parentSessionId,
        entry: crashEntry,
      },
    });
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_stopped', subagentId, parentSessionId },
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
        qaTargetUrl: null,
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

      // Auto-detect QA target URL for this session's working directory
      detectDevServerUrlDetailed(workingDir).then((result) => {
        console.log(`[QA URL] Auto-detect for new session ${envelope.sessionId}:`, result.detail);
        if (result.url) {
          updateClaudeSessionQaTargetUrl(envelope.sessionId, result.url);
        }
        broadcastEnvelope({
          channel: 'claude',
          sessionId: envelope.sessionId,
          payload: {
            type: 'qa_target_url_detected',
            sessionId: envelope.sessionId,
            qaTargetUrl: result.url,
            source: result.source,
            detail: result.detail,
            port: result.port ?? null,
            framework: result.framework ?? null,
            verification: result.verification ?? null,
          },
          auth: '',
        });
      }).catch((err) => {
        console.error(`[QA URL] Auto-detect failed for session ${envelope.sessionId}:`, err);
      });

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
        qaTargetUrl: null,
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
    stopSubagentsByParent(envelope.sessionId);
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
        qaTargetUrl: s.qaTargetUrl ?? undefined,
        startedAt: s.startedAt,
        subagentCount: countSubagentsByParent(s.id),
      };
    });
    sendEnvelope(ws, {
      channel: 'claude',
      sessionId: '',
      payload: { type: 'claude_session_list', sessions },
      auth: '',
    });
  } else if (payload.type === 'get_claude_history') {
    const limit = (payload as Record<string, unknown>).limit as number | undefined;
    const beforeSeq = (payload as Record<string, unknown>).beforeSeq as number | undefined;
    if (typeof limit === 'number') {
      // Paginated request
      const result = getClaudeEntriesPaginated(envelope.sessionId, limit, beforeSeq);
      sendEnvelope(ws, {
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: {
          type: 'claude_history',
          entries: result.entries,
          totalCount: result.totalCount,
          oldestSeq: result.oldestSeq,
          isPaginated: true,
        },
        auth: '',
      });
    } else {
      // Legacy: full load (backward compat)
      const entries = getClaudeEntries(envelope.sessionId);
      sendEnvelope(ws, {
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'claude_history', entries },
        auth: '',
      });
    }
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
  } else if (payload.type === 'update_qa_target_url') {
    const newUrl = (payload as Record<string, unknown>).qaTargetUrl as string;
    if (newUrl) {
      updateClaudeSessionQaTargetUrl(envelope.sessionId, newUrl);
      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: { type: 'qa_target_url_updated', sessionId: envelope.sessionId, qaTargetUrl: newUrl },
        auth: '',
      });
    }
  } else if (payload.type === 'detect_qa_target_url') {
    // Re-detect dev server URL for this session's working directory
    const dbSessions = getAllClaudeSessions();
    const sessionRow = dbSessions.find((s) => s.id === envelope.sessionId);
    const workDir = sessionRow?.workingDir || process.env.HOME || '/';
    console.log(`[QA URL] Detecting dev server for session ${envelope.sessionId} in ${workDir}`);
    detectDevServerUrlDetailed(workDir).then((result) => {
      console.log(`[QA URL] Detection result:`, result);
      if (result.url) {
        updateClaudeSessionQaTargetUrl(envelope.sessionId, result.url);
      }
      broadcastEnvelope({
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: {
          type: 'qa_target_url_detected',
          sessionId: envelope.sessionId,
          qaTargetUrl: result.url,
          source: result.source,
          detail: result.detail,
          port: result.port ?? null,
          framework: result.framework ?? null,
          verification: result.verification ?? null,
        },
        auth: '',
      });
    }).catch((err) => {
      console.error(`[QA URL] Detection failed:`, err);
      sendEnvelope(ws, {
        channel: 'claude',
        sessionId: envelope.sessionId,
        payload: {
          type: 'qa_target_url_detected',
          sessionId: envelope.sessionId,
          qaTargetUrl: null,
          source: 'none',
          detail: `Detection failed: ${(err as Error).message}`,
          port: null,
          framework: null,
          verification: null,
        },
        auth: '',
      });
    });
  } else if (payload.type === 'delete_claude_session') {
    // Kill if still running, stop git watcher, stop QA agents, then soft-delete (recoverable for 30 days)
    claudeManager.killSession(envelope.sessionId);
    gitManager.stopWatching(envelope.sessionId);
    stopSubagentsByParent(envelope.sessionId);
    deleteClaudeSession(envelope.sessionId);
    const owned = clientClaudeSessions.get(ws);
    if (owned) owned.delete(envelope.sessionId);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_deleted', deletedId: envelope.sessionId },
      auth: '',
    });
  } else if (payload.type === 'restore_claude_session') {
    restoreClaudeSession(envelope.sessionId);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'claude_session_restored', sessionId: envelope.sessionId },
      auth: '',
    });
  } else if (payload.type === 'list_deleted_sessions') {
    const deletedRows = getDeletedClaudeSessions();
    const sessions: ClaudeSessionInfo[] = deletedRows.map((s) => ({
      id: s.id,
      claudeSessionId: s.claudeSessionId,
      status: s.status as ClaudeSessionInfo['status'],
      prompt: s.prompt,
      name: s.name ?? undefined,
      icon: (s.icon as SessionIconName) ?? undefined,
      color: s.color ?? undefined,
      notificationSound: s.notificationSound,
      workingDir: s.workingDir ?? undefined,
      qaTargetUrl: s.qaTargetUrl ?? undefined,
      startedAt: s.startedAt,
      deletedAt: s.deletedAt ?? undefined,
    }));
    sendEnvelope(ws, {
      channel: 'claude',
      sessionId: '',
      payload: { type: 'deleted_sessions_list', sessions },
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
      qaTargetUrl: null,
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
  } else if (payload.type === 'git_list_branches') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      try {
        const branches = await watcher.listBranches();
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_branches_result', branches },
          auth: '',
        });
      } catch (err) {
        broadcastEnvelope({
          channel: 'git',
          sessionId,
          payload: { type: 'git_error', message: (err as Error).message },
          auth: '',
        });
      }
    }
  } else if (payload.type === 'git_checkout') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.checkoutBranch(payload.branch);
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_checkout_result', ...result, branch: result.success ? payload.branch : undefined },
        auth: '',
      });
    }
  } else if (payload.type === 'git_create_branch') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.createBranch(payload.branch, payload.checkout ?? true);
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_create_branch_result', ...result, branch: result.success ? payload.branch : undefined },
        auth: '',
      });
    }
  } else if (payload.type === 'git_delete_branch') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.deleteBranch(payload.branch, payload.force ?? false);
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_delete_branch_result', ...result },
        auth: '',
      });
    }
  } else if (payload.type === 'git_push') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.push(payload.force ?? false);
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_push_result', ...result },
        auth: '',
      });
    }
  } else if (payload.type === 'git_pull') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.pull();
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_pull_result', ...result },
        auth: '',
      });
    }
  } else if (payload.type === 'git_fetch') {
    const watcher = gitManager.getWatcher(sessionId);
    if (watcher) {
      const result = await watcher.fetch();
      broadcastEnvelope({
        channel: 'git',
        sessionId,
        payload: { type: 'git_fetch_result', ...result },
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
  } else if (payload.type === 'scan_by_extension') {
    const service = fileTreeManager.getService(sessionId);
    if (service) {
      try {
        const results = await service.scanByExtension(payload.ext);
        sendEnvelope(ws, {
          channel: 'files',
          sessionId,
          payload: { type: 'scan_by_extension_result', ext: payload.ext, results },
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
  const payload = envelope.payload as QaBrowserPayload;

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
    // Kill all subagents that use PinchTab (they depend on it)
    for (const [id, record] of subagentSessions) {
      if (record.subagentType === 'qa' && record.session) record.session.kill();
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
  } else if (payload.type === 'list_qa_flows') {
    // Reload flows from disk in case they changed, then send summaries
    flowRunner.loadFlows();
    sendEnvelope(ws, {
      channel: 'qa', sessionId: '', auth: '',
      payload: { type: 'qa_flows_list', flows: flowRunner.listFlows() },
    });
  } else {
    sendEnvelope(ws, { channel: 'qa', sessionId: '', payload: { type: 'qa_error', message: `Unknown QA type: ${(payload as { type: string }).type}` }, auth: '' });
  }
}

// Helper to send a response with responseId forwarding (matches handleQA pattern)
function sendAndroidResponse(ws: WebSocket, envelope: WsEnvelope, responsePayload: Record<string, unknown>): void {
  const inPayload = envelope.payload as Record<string, unknown>;
  sendEnvelope(ws, {
    channel: 'android', sessionId: '', auth: '',
    payload: { ...responsePayload, responseId: inPayload.responseId },
  });
}

async function handleAndroid(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as AndroidPayload;
  const service = getAndroidQAService();

  switch (payload.type) {
    case 'start_emulator': {
      try {
        const device = await service.start(payload.avdName);
        service.removeAllListeners('logcat');
        service.on('logcat', (entries) => {
          broadcastEnvelope({
            channel: 'android', sessionId: '', auth: '',
            payload: { type: 'logcat_entries', entries },
          });
        });
        sendAndroidResponse(ws, envelope, { type: 'emulator_started', device });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'stop_emulator': {
      try {
        await service.stop();
        sendAndroidResponse(ws, envelope, { type: 'emulator_stopped' });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'list_devices': {
      try {
        const devices = await service.listDevices();
        const avds = await service.listAvds();
        sendAndroidResponse(ws, envelope, { type: 'devices_list', devices, avds });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'get_android_status': {
      try {
        const devices = await service.listDevices();
        sendAndroidResponse(ws, envelope, {
          type: 'android_status',
          running: service.isRunning(),
          devices,
        });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'screenshot': {
      try {
        const dataUrl = await service.screenshot();
        sendAndroidResponse(ws, envelope, { type: 'screenshot_result', dataUrl });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'view_hierarchy': {
      try {
        const nodes = await service.viewHierarchy();
        sendAndroidResponse(ws, envelope, { type: 'view_hierarchy_result', nodes });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'install_apk': {
      try {
        await service.installApk(payload.apkPath);
        sendAndroidResponse(ws, envelope, { type: 'apk_installed', apkPath: payload.apkPath });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }

    case 'launch_app': {
      try {
        await service.launchApp(payload.appId);
        sendAndroidResponse(ws, envelope, { type: 'app_launched', appId: payload.appId });
      } catch (err) {
        sendAndroidResponse(ws, envelope, { type: 'android_error', message: String(err) });
      }
      break;
    }
  }
}

async function handleSubagent(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as SubagentPayload;

  if (payload.type === 'start_subagent') {
    const subagentType: SubagentType = payload.subagentType ?? 'qa';
    const cli: SubagentCli = payload.cli ?? 'claude';
    const inputs = payload.inputs ?? {};
    const task = inputs.task ?? '';
    const workingDir = payload.workingDir;
    const parentSessionId = payload.parentSessionId;
    const parentSessionType = payload.parentSessionType;
    const definition = getSubagentType(subagentType);

    console.log(`[Subagent] start_subagent received:`, { subagentType, cli, task, parentSessionId, parentSessionType, workingDir });

    try {
      // QA-specific setup: ensure PinchTab is running
      if (subagentType === 'qa') {
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
      }

      // Android QA-specific setup: ensure emulator is running
      if (subagentType === 'android_qa') {
        const androidService = getAndroidQAService();

        // 1. Ensure emulator is running (detect existing or boot new)
        let device = await androidService.detectRunning();
        if (!device) {
          device = await androidService.start(inputs.avdName);
        }

        // 2. Wire logcat streaming
        androidService.removeAllListeners('logcat');
        androidService.on('logcat', (entries) => {
          broadcastEnvelope({
            channel: 'android', sessionId: '', auth: '',
            payload: { type: 'logcat_entries', entries },
          });
        });

        // 3. Launch app if appId provided
        if (inputs.appId) {
          await androidService.launchApp(inputs.appId);
        }

        // 4. Inject deviceId into inputs so buildPrompt can reference it
        inputs.deviceId = device.deviceId;
      }

      // Resolve target URL (QA-specific): explicit input > parent session's detected URL > live detection > env default
      let targetUrl: string | undefined = inputs.targetUrl;
      if (subagentType === 'qa') {
        if (!targetUrl) {
          const parentSessions = getAllClaudeSessions();
          const parentSession = parentSessions.find((s) => s.id === parentSessionId);
          targetUrl = parentSession?.qaTargetUrl || process.env.ZEUS_QA_DEFAULT_URL || undefined;
        }
        // If still no URL, run live detection for the working directory
        if (!targetUrl) {
          const detected = await detectDevServerUrlDetailed(workingDir);
          if (detected.url) {
            targetUrl = detected.url;
            console.log(`[Subagent] Auto-detected target URL: ${detected.url} (${detected.detail})`);
            if (parentSessionId) {
              updateClaudeSessionQaTargetUrl(parentSessionId, detected.url);
            }
          } else {
            console.warn(`[Subagent] No target URL detected — agent will start without a URL. Detail: ${detected.detail}`);
          }
        }
      }

      // Build context for prompt generation
      const context: SubagentContext = {
        workingDir,
        parentSessionId,
        parentSessionType,
        targetUrl,
      };

      // For non-QA types: read file if inputs.filePath exists
      if (subagentType !== 'qa' && inputs.filePath) {
        try { context.fileContent = fs.readFileSync(path.resolve(workingDir, inputs.filePath), 'utf-8'); } catch { /* ignore */ }
      }

      // ── Flow Resolution (QA-specific) ──
      if (subagentType === 'qa') {
        const resolved = flowRunner.resolve(task, {
          flowId: inputs.flowId,
          personas: inputs.personas ? inputs.personas.split(',').map((p: string) => p.trim()) : undefined,
        });

        if (resolved) {
          context.resolvedFlow = resolved;

          // ── Structured flow: spawn one agent per persona ──
          const personaPromises = resolved.personas.map(async (persona) => {
            const subagentId = `subagent-${++subagentIdCounter}-${Date.now()}-${persona.id}`;
            const agentName = payload.name
              ? `${payload.name} (${persona.id})`
              : `${resolved.flow.name} — ${persona.id}`;

            const sessionOpts: import('./claude-session').SessionOptions = {
              workingDir,
              permissionMode: definition?.permissionMode ?? 'bypassPermissions',
              enableQA: true,
              qaTargetUrl: targetUrl,
              zeusSessionId: parentSessionId,
              subagentId,
            };
            if (definition?.mcpServers?.length) {
              sessionOpts.mcpServers = definition.mcpServers;
            }
            const session = new ClaudeSession(sessionOpts);

            const record: SubagentRecord = {
              subagentId,
              subagentType,
              cli,
              parentSessionId,
              parentSessionType,
              name: agentName,
              task: `[Flow: ${resolved.flow.id}] ${persona.id}`,
              targetUrl,
              workingDir,
              session,
              startedAt: Date.now(),
              pendingResponseId: payload.responseId,
              pendingResponseWs: ws,
              collectedTextEntries: [],
            };

            subagentSessions.set(subagentId, record);
            console.log(`[Subagent] Created flow record: subagentId=${subagentId}, flow=${resolved.flow.id}, persona=${persona.id}`);
            wireSubagent(record);

            insertSubagentSession({
              id: subagentId,
              parentSessionId,
              parentSessionType,
              name: agentName ?? null,
              task: record.task,
              targetUrl: targetUrl ?? null,
              status: 'running',
              startedAt: record.startedAt,
              endedAt: null,
              workingDir,
              subagentType,
              cli,
            });

            console.log('[Subagent] Flow agent started successfully:', subagentId);
            broadcastEnvelope({
              channel: 'subagent', sessionId: '', auth: '',
              payload: {
                type: 'subagent_started',
                subagentId,
                subagentType,
                cli,
                parentSessionId,
                parentSessionType,
                name: agentName,
                task: record.task,
                targetUrl,
              },
            });

            const effectiveUrl = targetUrl || 'http://localhost:5173';
            const flowSection = flowRunner.buildAgentPrompt(resolved.flow, persona, effectiveUrl);
            const flowPrompt = definition
              ? definition.buildPrompt({ ...inputs, task: flowSection }, { ...context, targetUrl: effectiveUrl })
              : flowSection;

            const initialMsgEntry: NormalizedEntry = {
              id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date().toISOString(),
              entryType: { type: 'user_message' },
              content: flowSection,
            };
            broadcastEnvelope({
              channel: 'subagent', sessionId: '', auth: '',
              payload: { type: 'subagent_entry', subagentId, parentSessionId, entry: initialMsgEntry },
            });
            insertSubagentEntry(subagentId, 'user_message', JSON.stringify(initialMsgEntry), Date.now());

            await session.start(flowPrompt);
          });

          // Spawn all persona agents in parallel
          await Promise.all(personaPromises);
          return; // Skip the free-form path below
        }
      }

      // ── Free-form / non-QA fallback ──
      const subagentId = `subagent-${++subagentIdCounter}-${Date.now()}`;

      const sessionOpts: import('./claude-session').SessionOptions = {
        workingDir,
        permissionMode: definition?.permissionMode ?? 'bypassPermissions',
        enableQA: subagentType === 'qa',
        qaTargetUrl: targetUrl,
        zeusSessionId: parentSessionId,
        subagentId,
      };
      if (definition?.mcpServers?.length) {
        sessionOpts.mcpServers = definition.mcpServers;
      }

      // Android QA: clone registry mcpServers and resolve maestro path at spawn time
      if (subagentType === 'android_qa' && definition?.mcpServers?.length) {
        const clonedServers = definition.mcpServers.map(s => ({
          ...s,
          args: s.args ? [...s.args] : undefined,
          env: s.env ? { ...s.env } : undefined,
        }));

        // Resolve maestro binary path (deferred from module load)
        const maestroServer = clonedServers.find(s => s.name === 'maestro');
        if (maestroServer) {
          maestroServer.command = findMaestroPath();
        }

        // Inject device ID into extras server env
        const extrasServer = clonedServers.find(s => s.name === 'android-qa-extras');
        if (extrasServer) {
          let adbPathResolved = 'adb';
          try { adbPathResolved = findAdbPath(); } catch { /* fallback to bare adb */ }
          extrasServer.env = {
            ...(extrasServer.env ?? {}),
            ZEUS_ANDROID_DEVICE_ID: inputs.deviceId ?? '',
            ZEUS_ANDROID_ADB_PATH: adbPathResolved,
          };
        }

        sessionOpts.mcpServers = clonedServers;
      }

      const session = new ClaudeSession(sessionOpts);

      const agentName = payload.name || undefined;
      const record: SubagentRecord = {
        subagentId,
        subagentType,
        cli,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task,
        targetUrl,
        workingDir,
        session,
        startedAt: Date.now(),
        pendingResponseId: payload.responseId,
        pendingResponseWs: ws,
        collectedTextEntries: [],
      };

      subagentSessions.set(subagentId, record);
      console.log(`[Subagent] Created record: subagentId=${subagentId}, pendingResponseId=${record.pendingResponseId}, pendingResponseWs.readyState=${ws.readyState}`);
      wireSubagent(record);

      // Persist subagent session to DB
      insertSubagentSession({
        id: subagentId,
        parentSessionId,
        parentSessionType,
        name: agentName ?? null,
        task,
        targetUrl: targetUrl ?? null,
        status: 'running',
        startedAt: record.startedAt,
        endedAt: null,
        workingDir,
        subagentType,
        cli,
      });

      // Broadcast subagent_started FIRST so the store creates the agent entry
      console.log('[Subagent] Agent started successfully:', subagentId);
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: {
          type: 'subagent_started',
          subagentId,
          subagentType,
          cli,
          parentSessionId,
          parentSessionType,
          name: agentName,
          task,
          targetUrl,
        },
      });

      // Then broadcast initial user message so it shows in the panel
      const initialMsgEntry: NormalizedEntry = {
        id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        entryType: { type: 'user_message' },
        content: task,
      };
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_entry', subagentId, parentSessionId, entry: initialMsgEntry },
      });
      insertSubagentEntry(subagentId, 'user_message', JSON.stringify(initialMsgEntry), Date.now());

      const prompt = definition
        ? definition.buildPrompt(inputs, context)
        : task;
      await session.start(prompt);

      // Response is deferred — sent when the subagent's turn ends (see wireSubagent 'result' handler)
    } catch (err) {
      console.error('[Subagent] Failed to start:', (err as Error).message, (err as Error).stack);
      sendEnvelope(ws, {
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_error', message: `Failed to start subagent: ${(err as Error).message}` },
      });
    }
  } else if (payload.type === 'stop_subagent') {
    const record = subagentSessions.get(payload.subagentId);
    if (record && record.session && record.session.isRunning) {
      // Interrupt (not kill) — keeps the session alive so the user can send follow-up messages
      try {
        await record.session.interrupt();
        // Broadcast a status entry so the user sees the interrupt happened
        const interruptEntry: NormalizedEntry = {
          id: `subagent-interrupt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entryType: { type: 'system_message' },
          content: 'Agent interrupted — you can send a new message.',
        };
        broadcastEnvelope({
          channel: 'subagent', sessionId: '', auth: '',
          payload: {
            type: 'subagent_entry',
            subagentId: payload.subagentId,
            parentSessionId: record.parentSessionId,
            entry: interruptEntry,
          },
        });
        insertSubagentEntry(payload.subagentId, 'system_message', JSON.stringify(interruptEntry), Date.now());
      } catch {
        // interrupt() failed — process is likely already dead
      }
      // Always update status to stopped immediately so the UI reflects it
      updateSubagentSessionStatus(payload.subagentId, 'stopped');
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_stopped', subagentId: payload.subagentId, parentSessionId: record.parentSessionId },
      });
    } else if (record) {
      // Already stopped — broadcast to sync UI
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_stopped', subagentId: payload.subagentId, parentSessionId: record.parentSessionId },
      });
    } else {
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_stopped', subagentId: payload.subagentId, parentSessionId: '' },
      });
    }
  } else if (payload.type === 'delete_subagent') {
    // Stop if running, then delete from DB and notify clients
    const record = subagentSessions.get(payload.subagentId);
    if (record) {
      if (record.session && record.session.isRunning) {
        record.session.kill();
      }
      subagentSessions.delete(payload.subagentId);
    }
    deleteSubagentSession(payload.subagentId);
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_deleted', subagentId: payload.subagentId, parentSessionId: payload.parentSessionId },
    });
  } else if (payload.type === 'list_subagents') {
    // Merge in-memory agents (running or stopped-but-resumable) with completed agents from DB
    const inMemoryIds = new Set<string>();
    const inMemoryAgents = Array.from(subagentSessions.values())
      .filter((r) => r.parentSessionId === payload.parentSessionId)
      .map((r) => {
        inMemoryIds.add(r.subagentId);
        const isAlive = r.session !== null && r.session.isRunning;
        return {
          subagentId: r.subagentId,
          subagentType: r.subagentType,
          cli: r.cli,
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
    const dbAgents = getSubagentSessionsByParent(payload.parentSessionId)
      .filter((r) => !inMemoryIds.has(r.id))
      .map((r) => ({
        subagentId: r.id,
        subagentType: (r.subagentType ?? 'qa') as SubagentType,
        cli: (r.cli ?? 'claude') as SubagentCli,
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
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_list', parentSessionId: payload.parentSessionId, agents },
    });
  } else if (payload.type === 'subagent_message') {
    let record = subagentSessions.get(payload.subagentId);

    // If not in memory, try to restore from DB (e.g. after app restart)
    if (!record) {
      const dbRow = getSubagentSession(payload.subagentId);
      if (dbRow) {
        record = {
          subagentId: dbRow.id,
          subagentType: (dbRow.subagentType ?? 'qa') as SubagentType,
          cli: (dbRow.cli ?? 'claude') as SubagentCli,
          parentSessionId: dbRow.parentSessionId,
          parentSessionType: dbRow.parentSessionType,
          name: dbRow.name ?? undefined,
          task: dbRow.task,
          targetUrl: dbRow.targetUrl ?? undefined,
          workingDir: dbRow.workingDir || process.cwd(),
          session: null,
          claudeSessionId: dbRow.claudeSessionId ?? undefined,
          lastMessageId: dbRow.lastMessageId ?? undefined,
          startedAt: dbRow.startedAt,
          collectedTextEntries: [],
        };
        subagentSessions.set(dbRow.id, record);
      }
    }

    if (!record) {
      sendEnvelope(ws, {
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_error', message: 'No subagent found with that ID' },
      });
      return;
    }

    const userMsgEntry: NormalizedEntry = {
      id: `subagent-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      entryType: { type: 'user_message' },
      content: payload.text,
    };
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: {
        type: 'subagent_entry',
        subagentId: payload.subagentId,
        parentSessionId: record.parentSessionId,
        entry: userMsgEntry,
      },
    });
    insertSubagentEntry(payload.subagentId, 'user_message', JSON.stringify(userMsgEntry), Date.now());

    try {
      // Broadcast that the agent is running again
      updateSubagentSessionStatus(record.subagentId, 'running');
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: {
          type: 'subagent_started',
          subagentId: record.subagentId,
          subagentType: record.subagentType,
          cli: record.cli,
          parentSessionId: record.parentSessionId,
          parentSessionType: record.parentSessionType,
          name: record.name,
          task: record.task,
          targetUrl: record.targetUrl,
        },
      });

      if (record.session && record.session.isRunning) {
        // Session is alive (e.g. interrupted but process still running) — send message directly
        console.log(`[Subagent] Sending follow-up to alive session ${record.subagentId}`);
        await record.session.sendMessage(payload.text);
      } else {
        // Session is dead — start a new session (with --resume if we have Claude session ID)
        console.log(`[Subagent] Starting new session for agent ${record.subagentId} (resume=${!!record.claudeSessionId})`);
        const definition = getSubagentType(record.subagentType);
        const targetUrl = record.targetUrl || process.env.ZEUS_QA_DEFAULT_URL || 'http://localhost:5173';
        const sessionOpts: import('./claude-session').SessionOptions = {
          workingDir: record.workingDir,
          permissionMode: definition?.permissionMode ?? 'bypassPermissions',
          enableQA: record.subagentType === 'qa',
          qaTargetUrl: targetUrl,
          zeusSessionId: record.parentSessionId,
          subagentId: record.subagentId,
        };
        if (definition?.mcpServers?.length) {
          sessionOpts.mcpServers = definition.mcpServers;
        }
        if (record.claudeSessionId) {
          sessionOpts.resumeSessionId = record.claudeSessionId;
          sessionOpts.resumeAtMessageId = record.lastMessageId ?? undefined;
        }
        const newSession = new ClaudeSession(sessionOpts);
        record.session = newSession;
        record.collectedTextEntries = [];
        wireSubagent(record);

        const prompt = record.claudeSessionId
          ? payload.text  // resuming — just send the follow-up text
          : (definition
              ? definition.buildPrompt({ task: payload.text }, { workingDir: record.workingDir, parentSessionId: record.parentSessionId, parentSessionType: record.parentSessionType, targetUrl })
              : payload.text);
        await newSession.start(prompt);
      }
    } catch (err) {
      console.error(`[Subagent] Failed to send message to agent ${record.subagentId}:`, (err as Error).message);
      // Revert status back to stopped so the UI isn't stuck on "running"
      updateSubagentSessionStatus(record.subagentId, 'stopped');
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_stopped', subagentId: record.subagentId, parentSessionId: record.parentSessionId },
      });
      const errorEntry: NormalizedEntry = {
        id: `subagent-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        entryType: { type: 'error_message', errorType: 'other' },
        content: `Failed to send message: ${(err as Error).message}`,
      };
      broadcastEnvelope({
        channel: 'subagent', sessionId: '', auth: '',
        payload: { type: 'subagent_entry', subagentId: record.subagentId, parentSessionId: record.parentSessionId, entry: errorEntry },
      });
      insertSubagentEntry(record.subagentId, 'error_message', JSON.stringify(errorEntry), Date.now());
    }
  } else if (payload.type === 'clear_subagent_entries') {
    clearSubagentEntries(payload.subagentId);
    // Also clear in-memory collected text
    const record = subagentSessions.get(payload.subagentId);
    if (record) {
      record.collectedTextEntries = [];
    }
  } else if (payload.type === 'get_subagent_entries') {
    // Load persisted entries from DB for a specific agent
    const dbEntries = getSubagentEntries(payload.subagentId);
    const entries = dbEntries
      .map((row) => JSON.parse(row.data) as NormalizedEntry)
      .filter((e) => e.entryType);
    sendEnvelope(ws, {
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_entries', subagentId: payload.subagentId, entries },
    });
  } else if (payload.type === 'register_external_subagent') {
    // External subagent registration (from zeus-bridge MCP)
    const subagentId = `subagent-ext-${++subagentIdCounter}-${Date.now()}`;
    const parentSessionId = payload.parentSessionId || 'external';
    const parentSessionType = payload.parentSessionType || 'claude';
    const subagentType: SubagentType = payload.subagentType ?? 'qa';
    const task = payload.task || 'External subagent task';
    const targetUrl = payload.targetUrl || process.env.ZEUS_QA_DEFAULT_URL || 'http://localhost:5173';
    const agentName = payload.name || undefined;

    insertSubagentSession({
      id: subagentId,
      parentSessionId,
      parentSessionType,
      name: agentName ?? null,
      task,
      targetUrl,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      subagentType,
      cli: 'claude',
    });

    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: {
        type: 'subagent_started',
        subagentId,
        subagentType,
        cli: 'claude' as SubagentCli,
        parentSessionId,
        parentSessionType,
        name: agentName,
        task,
        targetUrl,
      },
    });

    // Send response back with the subagentId
    sendEnvelope(ws, {
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'register_external_subagent_response', subagentId, responseId: payload.responseId },
    });

    externalSubagentParentMap.set(subagentId, parentSessionId);

    console.log(`[Subagent] External agent registered: ${subagentId} (parent: ${parentSessionId})`);

  } else if (payload.type === 'external_subagent_entry') {
    // External subagent log entry (from zeus-bridge MCP)
    const { subagentId, entry: rawEntry } = payload as { subagentId: string; entry: { kind: string; timestamp: number; [key: string]: unknown } };
    if (!subagentId || !rawEntry) return;

    const normalizedEntry = rawEntry as unknown as NormalizedEntry;

    insertSubagentEntry(subagentId, normalizedEntry.entryType.type, JSON.stringify(normalizedEntry), Date.now());
    const parentSessionId = externalSubagentParentMap.get(subagentId) ?? 'external';
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: {
        type: 'subagent_entry',
        subagentId,
        parentSessionId,
        entry: normalizedEntry,
      },
    });

  } else if (payload.type === 'external_subagent_done') {
    // External subagent completion (from zeus-bridge MCP)
    const { subagentId, status } = payload as { subagentId: string; status: string };
    if (!subagentId) return;

    updateSubagentSessionStatus(subagentId, status || 'stopped', Date.now());
    const parentSessionId = externalSubagentParentMap.get(subagentId) ?? 'external';
    broadcastEnvelope({
      channel: 'subagent', sessionId: '', auth: '',
      payload: { type: 'subagent_stopped', subagentId, parentSessionId },
    });
    externalSubagentParentMap.delete(subagentId);

    console.log(`[Subagent] External agent stopped: ${subagentId} (${status})`);

  } else {
    sendEnvelope(ws, { channel: 'subagent', sessionId: '', payload: { type: 'subagent_error', message: `Unknown subagent type: ${(payload as { type: string }).type}` }, auth: '' });
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
  } else if (payload.type === 'set_auto_tunnel') {
    setAutoTunnel(payload.enabled);
    broadcastEnvelope({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
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
    case 'subagent':
      handleSubagent(ws, envelope).catch((err) => {
        console.error('[Subagent] Unhandled error in handleSubagent:', err);
        sendEnvelope(ws, {
          channel: 'subagent', sessionId: '', auth: '',
          payload: { type: 'subagent_error', message: `Subagent error: ${(err as Error).message}` },
        });
      });
      break;
    case 'android':
      handleAndroid(ws, envelope).catch((err) => {
        console.error('[Android] Unhandled error in handleAndroid:', err);
        sendEnvelope(ws, {
          channel: 'android', sessionId: '', auth: '',
          payload: { type: 'android_error', message: `Android error: ${(err as Error).message}` },
        });
      });
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
      tunnel: getAuthenticatedTunnelUrl(),
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
