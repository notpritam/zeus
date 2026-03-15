// ClaudeSession + ClaudeSessionManager
// Spawns Claude CLI as a piped subprocess, manages the stream-json protocol,
// and emits normalized entries for the UI layer.

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { ProtocolPeer } from './claude-protocol';
import type {
  ClaudeJson,
  ControlRequestType,
  PermissionMode,
  PermissionResult,
} from './claude-types';
import { ClaudeLogProcessor } from './claude-log-processor';

// Hook callback IDs matching vibe-kanban conventions
const AUTO_APPROVE_CALLBACK_ID = 'AUTO_APPROVE_CALLBACK_ID';
const STOP_GIT_CHECK_CALLBACK_ID = 'STOP_GIT_CHECK_CALLBACK_ID';

export interface SessionOptions {
  workingDir: string;
  permissionMode?: PermissionMode; // default: 'bypassPermissions'
  model?: string;
  resumeSessionId?: string;
  resumeAtMessageId?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
}

export class ClaudeSession extends EventEmitter {
  private child: ChildProcess | null = null;
  private protocol: ProtocolPeer | null = null;
  private logProcessor: ClaudeLogProcessor;
  private _sessionId: string | null = null;
  private _lastMessageId: string | null = null;
  private _pendingAssistantUuid: string | null = null;
  private _isRunning = false;
  private pendingApprovals = new Map<string, { requestId: string; toolInput: unknown }>();

  get sessionId(): string | null {
    return this._sessionId;
  }
  get lastMessageId(): string | null {
    return this._lastMessageId;
  }
  get isRunning(): boolean {
    return this._isRunning;
  }

  constructor(private options: SessionOptions) {
    super();
    this.logProcessor = new ClaudeLogProcessor(options.workingDir);
  }

  async start(prompt: string): Promise<void> {
    const args = this.buildArgs();
    const mode = this.options.permissionMode ?? 'bypassPermissions';

    // 1. Spawn Claude CLI as piped subprocess
    this.child = spawn('npx', ['-y', '@anthropic-ai/claude-code@latest', ...args], {
      cwd: this.options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error' },
    });

    this._isRunning = true;

    this.child.on('exit', (code) => {
      this._isRunning = false;
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Claude CLI exited with code ${code}`));
      }
    });

    this.child.on('error', (err) => {
      this._isRunning = false;
      this.emit('error', err);
    });

    // 2. Create protocol peer
    this.protocol = new ProtocolPeer(this.child);

    // 3. Wire up message handling
    this.protocol.on('message', (msg: ClaudeJson) => {
      this.handleMessage(msg);
    });

    this.protocol.on('control_request', (requestId: string, request: ControlRequestType) => {
      this.handleControlRequest(requestId, request);
    });

    this.protocol.on('result', (msg: ClaudeJson) => {
      // Commit pending assistant UUID on Result
      if (this._pendingAssistantUuid) {
        this._lastMessageId = this._pendingAssistantUuid;
        this._pendingAssistantUuid = null;
      }
      this._isRunning = false;
      this.emit('done', msg);
    });

    this.protocol.on('error', (err) => this.emit('error', err));

    this.protocol.on('close', () => {
      this._isRunning = false;
    });

    // 4. Initialize protocol (same sequence as vibe-kanban)
    const hooks = this.buildHooks(mode);
    await this.protocol.initialize(hooks);
    await this.protocol.setPermissionMode(mode);
    await this.protocol.sendUserMessage(prompt);
  }

  /** Send a follow-up message to an active session */
  async sendMessage(content: string): Promise<void> {
    if (!this.protocol) throw new Error('Session not started');
    await this.protocol.sendUserMessage(content);
  }

  /** Approve a pending tool use */
  async approveTool(approvalId: string): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || !this.protocol) return;

    const result: PermissionResult = {
      behavior: 'allow',
      updatedInput: pending.toolInput,
    };
    await this.protocol.sendPermissionResponse(pending.requestId, result);
    this.pendingApprovals.delete(approvalId);
  }

  /** Deny a pending tool use */
  async denyTool(approvalId: string, reason = 'User denied'): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || !this.protocol) return;

    const result: PermissionResult = {
      behavior: 'deny',
      message: `The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said: ${reason}`,
    };
    await this.protocol.sendPermissionResponse(pending.requestId, result);
    this.pendingApprovals.delete(approvalId);
  }

  /** Interrupt the current operation */
  async interrupt(): Promise<void> {
    await this.protocol?.interrupt();
  }

  /** Kill the session process */
  kill(): void {
    this._isRunning = false;
    this.child?.kill('SIGTERM');
  }

  // --- Private ---

  private buildArgs(): string[] {
    const args = [
      '-p',
      '--verbose',
      '--output-format=stream-json',
      '--input-format=stream-json',
      '--include-partial-messages',
      '--permission-prompt-tool=stdio',
      '--permission-mode=bypassPermissions',
    ];

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.resumeSessionId) {
      args.push('--resume', this.options.resumeSessionId);
      if (this.options.resumeAtMessageId) {
        args.push('--resume-session-at', this.options.resumeAtMessageId);
      }
    }

    return args;
  }

  private buildHooks(mode: PermissionMode): Record<string, unknown[]> {
    const hooks: Record<string, unknown[]> = {};

    if (mode === 'plan') {
      // Plan mode: approve everything except ExitPlanMode and AskUserQuestion
      hooks['PreToolUse'] = [
        {
          matcher: '^(ExitPlanMode|AskUserQuestion)$',
          hookCallbackIds: ['tool_approval'],
        },
        {
          matcher: '^(?!(ExitPlanMode|AskUserQuestion)$).*',
          hookCallbackIds: [AUTO_APPROVE_CALLBACK_ID],
        },
      ];
    } else if (mode === 'default') {
      // Supervised mode: approve everything except reads
      hooks['PreToolUse'] = [
        {
          matcher: '^(?!(Glob|Grep|NotebookRead|Read|Task|TodoWrite)$).*',
          hookCallbackIds: ['tool_approval'],
        },
      ];
    } else {
      // Bypass mode: only intercept AskUserQuestion
      hooks['PreToolUse'] = [{ matcher: '^AskUserQuestion$', hookCallbackIds: ['tool_approval'] }];
    }

    return hooks;
  }

  private handleMessage(msg: ClaudeJson): void {
    // Emit raw for logging/debugging
    this.emit('raw', msg);

    // Extract session ID from first message that has one
    if (!this._sessionId && 'session_id' in msg && msg.session_id) {
      this._sessionId = msg.session_id as string;
      this.emit('session_id', this._sessionId);
    }

    // Track message UUIDs for resume support
    if (msg.type === 'user' && 'uuid' in msg && msg.uuid) {
      this._pendingAssistantUuid = null;
      this._lastMessageId = msg.uuid as string;
    } else if (msg.type === 'assistant' && 'uuid' in msg && msg.uuid) {
      this._pendingAssistantUuid = msg.uuid as string;
    }

    // Normalize to UI entries
    const entries = this.logProcessor.process(msg);
    for (const entry of entries) {
      this.emit('entry', entry);
    }
  }

  private async handleControlRequest(
    requestId: string,
    request: ControlRequestType,
  ): Promise<void> {
    if (request.subtype === 'can_use_tool') {
      const { tool_name, input, tool_use_id } = request;

      // AskUserQuestion — always needs user input
      if (tool_name === 'AskUserQuestion') {
        const approvalId = crypto.randomUUID();
        this.pendingApprovals.set(approvalId, { requestId, toolInput: input });
        this.emit('approval_needed', {
          approvalId,
          requestId,
          toolName: tool_name,
          toolInput: input,
          toolUseId: tool_use_id,
        });
        return;
      }

      // ExitPlanMode — approve and switch to bypass
      if (tool_name === 'ExitPlanMode') {
        const result: PermissionResult = {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [
            {
              type: 'setMode',
              mode: 'bypassPermissions',
              destination: 'session',
            },
          ],
        };
        await this.protocol!.sendPermissionResponse(requestId, result);
        return;
      }

      // Regular tool — emit for user approval
      const approvalId = crypto.randomUUID();
      this.pendingApprovals.set(approvalId, { requestId, toolInput: input });
      this.emit('approval_needed', {
        approvalId,
        requestId,
        toolName: tool_name,
        toolInput: input,
        toolUseId: tool_use_id,
      });
    } else if (request.subtype === 'hook_callback') {
      const { callback_id } = request;

      if (callback_id === AUTO_APPROVE_CALLBACK_ID) {
        // Auto-approve — no user interaction needed
        await this.protocol!.sendHookResponse(requestId, {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'Auto-approved by Zeus',
          },
        });
      } else if (callback_id === STOP_GIT_CHECK_CALLBACK_ID) {
        // Git check on stop — approve for now
        // TODO: Check for uncommitted changes and block if needed
        await this.protocol!.sendHookResponse(requestId, { decision: 'approve' });
      } else {
        // Unknown hook — forward to approval flow
        await this.protocol!.sendHookResponse(requestId, {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: 'Forwarding to approval',
          },
        });
      }
    }
  }
}

// --- Session Manager (manages multiple Claude sessions) ---

export class ClaudeSessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private pendingByInternalId = new Map<string, ClaudeSession>();

  async createSession(prompt: string, options: SessionOptions): Promise<ClaudeSession> {
    const session = new ClaudeSession(options);
    const internalId = crypto.randomUUID();

    // Track by internal ID until we get the real session ID
    this.pendingByInternalId.set(internalId, session);

    session.on('session_id', (id) => {
      this.sessions.set(id, session);
      this.pendingByInternalId.delete(internalId);
    });

    await session.start(prompt);
    return session;
  }

  async resumeSession(
    sessionId: string,
    prompt: string,
    options: SessionOptions,
  ): Promise<ClaudeSession> {
    return this.createSession(prompt, {
      ...options,
      resumeSessionId: sessionId,
    });
  }

  getSession(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Map<string, ClaudeSession> {
    return new Map(this.sessions);
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
    for (const session of this.pendingByInternalId.values()) {
      session.kill();
    }
    this.pendingByInternalId.clear();
  }
}
