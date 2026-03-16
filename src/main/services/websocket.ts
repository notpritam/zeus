import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
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
} from '../types';
import { createSession, writeToSession, resizeSession, destroySession } from './terminal';
import { registerSession, markExited, markKilled, getSession, getAllSessions } from './sessions';
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from './power';
import { getTunnelUrl } from './tunnel';
import { validateToken } from './auth';
import { ClaudeSessionManager, ClaudeSession } from './claude-session';
import type { NormalizedEntry } from './claude-types';
import {
  getSettings,
  addProject,
  removeProject,
  updateDefaults,
  setLastUsedProject,
} from './settings';
import {
  insertClaudeSession,
  updateClaudeSessionId,
  updateClaudeSessionStatus,
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
} from './db';
import type { ClaudeSessionInfo, GitPayload, FilesPayload } from '../../shared/types';
import { GitWatcherManager } from './git';
import { FileTreeServiceManager } from './file-tree';

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;

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

// Track authenticated clients
const authenticatedClients = new WeakSet<WebSocket>();

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
  } else {
    sendError(ws, '', `Unknown status type: ${payload.type}`);
  }
}

function wireClaudeSession(ws: WebSocket, session: ClaudeSession, envelope: WsEnvelope): void {
  // Forward normalized entries to all clients + persist to DB
  session.on('entry', (entry: NormalizedEntry) => {
    upsertClaudeEntry(envelope.sessionId, entry);
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'entry', entry },
      auth: '',
    });
  });

  // Forward approval requests
  session.on('approval_needed', (approval) => {
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'approval_needed', ...approval },
      auth: '',
    });
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

  // Forward session end (process exited) + persist status
  session.on('done', () => {
    updateClaudeSessionStatus(envelope.sessionId, 'done', Date.now());
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'done' },
      auth: '',
    });
  });

  // Forward errors + persist status
  session.on('error', (err) => {
    updateClaudeSessionStatus(envelope.sessionId, 'error', Date.now());
    broadcastEnvelope({
      channel: 'claude',
      sessionId: envelope.sessionId,
      payload: { type: 'error', message: err.message },
      auth: '',
    });
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

    try {
      const session = await claudeManager.createSession(envelope.sessionId, opts.prompt, {
        workingDir,
        permissionMode: opts.permissionMode ?? 'bypassPermissions',
        model: opts.model,
      });

      // Persist to DB
      insertClaudeSession({
        id: envelope.sessionId,
        claudeSessionId: null,
        status: 'running',
        prompt: opts.prompt,
        name: opts.sessionName ?? null,
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

      // Auto-start git watcher if enabled
      if (opts.enableGitWatcher !== false) {
        handleGit(ws, {
          channel: 'git',
          sessionId: envelope.sessionId,
          payload: { type: 'start_watching', workingDir },
          auth: '',
        });
      }

      // Auto-start file tree watcher
      handleFiles(ws, {
        channel: 'files',
        sessionId: envelope.sessionId,
        payload: { type: 'start_watching', workingDir },
        auth: '',
      });
    } catch (err) {
      sendError(ws, envelope.sessionId, `Failed to start Claude: ${(err as Error).message}`);
    }
  } else if (payload.type === 'resume_claude') {
    const opts = envelope.payload as ClaudeResumePayload;
    const workingDir = opts.workingDir || process.env.HOME || '/';

    try {
      const session = await claudeManager.resumeSession(
        envelope.sessionId,
        opts.claudeSessionId,
        opts.prompt,
        { workingDir },
      );

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
    const { content } = envelope.payload as ClaudeSendMessagePayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      // Persist user message to DB
      upsertClaudeEntry(envelope.sessionId, {
        id: `user-${Date.now()}`,
        entryType: { type: 'user_message' },
        content,
      });
      await session.sendMessage(content);
    } else {
      sendError(ws, envelope.sessionId, 'No active Claude session for this ID');
    }
  } else if (payload.type === 'approve_tool') {
    const { approvalId } = envelope.payload as ClaudeApproveToolPayload;
    const session = claudeManager.getSession(envelope.sessionId);
    if (session) {
      adoptClaudeSession(ws, envelope.sessionId);
      await session.approveTool(approvalId);
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
        notificationSound: s.notificationSound,
        startedAt: s.startedAt,
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
  } else if (payload.type === 'delete_claude_session') {
    // Kill if still running, stop git watcher, then delete from DB
    claudeManager.killSession(envelope.sessionId);
    gitManager.stopWatching(envelope.sessionId);
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
  } else {
    sendError(ws, envelope.sessionId, `Unknown claude type: ${payload.type}`);
  }
}

async function handleGit(_ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as GitPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === 'start_watching') {
    try {
      const watcher = await gitManager.startWatching(sessionId, payload.workingDir);

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
  } else {
    sendError(_ws, sessionId, `Unknown git type: ${(payload as { type: string }).type}`);
  }
}

async function handleFiles(ws: WebSocket, envelope: WsEnvelope): Promise<void> {
  const payload = envelope.payload as FilesPayload;
  const sessionId = envelope.sessionId;

  if (payload.type === 'start_watching') {
    try {
      const service = await fileTreeManager.startWatching(sessionId, payload.workingDir);

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

function handleSettings(ws: WebSocket, envelope: WsEnvelope): void {
  const payload = envelope.payload as SettingsPayload;

  if (payload.type === 'get_settings') {
    sendEnvelope(ws, {
      channel: 'settings',
      sessionId: '',
      payload: { type: 'settings_update', settings: getSettings() },
      auth: '',
    });
  } else if (payload.type === 'add_project') {
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
  } else {
    sendError(ws, '', `Unknown settings type: ${(payload as { type: string }).type}`);
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
      sendError(ws, envelope.sessionId, `Channel "${envelope.channel}" not yet implemented`);
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

export async function startWebSocketServer(port = 3000): Promise<void> {
  if (server) return;

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

    httpServer.on('error', reject);

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

  // Kill all Claude sessions, git watchers, and file tree watchers
  claudeManager.killAll();
  await gitManager.stopAll();
  await fileTreeManager.stopAll();

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
