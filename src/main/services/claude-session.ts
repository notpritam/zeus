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
import type { PermissionRule } from '../../shared/permission-types';
import { evaluate, extractPattern, relativize } from './permission-evaluator';
import { insertAuditEntry } from './db';
import path from 'path';
import { app } from 'electron';

// Hook callback IDs matching vibe-kanban conventions
const AUTO_APPROVE_CALLBACK_ID = 'AUTO_APPROVE_CALLBACK_ID';
const STOP_GIT_CHECK_CALLBACK_ID = 'STOP_GIT_CHECK_CALLBACK_ID';

export interface SessionOptions {
  workingDir: string;
  permissionMode?: PermissionMode; // default: 'bypassPermissions'
  model?: string;
  resumeSessionId?: string;
  resumeAtMessageId?: string;
  enableQA?: boolean;
  qaTargetUrl?: string;
  zeusSessionId?: string;
  subagentId?: string;
  mcpServers?: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>;
  permissionRules?: PermissionRule[];  // glob-based rules
  projectId?: string;                 // for audit logging
  roomId?: string;
  agentId?: string;
  agentRole?: string;                 // 'pm' | 'worker'
  roomAware?: boolean;                // default true
  systemPromptAppend?: string;        // room context to append
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
  private _turnState: 'idle' | 'processing' | 'waiting_approval' = 'idle';
  private pendingApprovals = new Map<string, { requestId: string; toolInput: unknown }>();
  private permissionRules: PermissionRule[];
  private projectId: string | null;

  get sessionId(): string | null {
    return this._sessionId;
  }
  get lastMessageId(): string | null {
    return this._lastMessageId;
  }
  get isRunning(): boolean {
    return this._isRunning;
  }
  get turnState() {
    return this._turnState;
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }

  constructor(private options: SessionOptions) {
    super();
    this.logProcessor = new ClaudeLogProcessor(options.workingDir);
    this.permissionRules = options.permissionRules ?? [];
    this.projectId = options.projectId ?? null;
    this.logProcessor.onActivity((activity) => {
      this.emit('activity', activity);
    });
  }

  async start(prompt: string): Promise<void> {
    const args = this.buildArgs();
    const mode = this.options.permissionMode ?? 'bypassPermissions';

    // 1. Spawn Claude CLI as piped subprocess
    const spawnArgs = ['-y', '@anthropic-ai/claude-code@latest', ...args];
    console.log('[Claude] Spawning:', 'npx', spawnArgs.join(' '));
    this.child = spawn('npx', spawnArgs, {
      cwd: this.options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NPM_CONFIG_LOGLEVEL: 'error',
        ...(this.options.zeusSessionId ? { ZEUS_SESSION_ID: this.options.zeusSessionId } : {}),
        ...(this.options.subagentId ? { ZEUS_QA_AGENT_ID: this.options.subagentId } : {}),
      },
    });

    this._isRunning = true;

    this.child.on('exit', (code, signal) => {
      console.log(`[Claude] Process exited: code=${code} signal=${signal}`);
      if (this._isRunning) {
        this._isRunning = false;
        this._turnState = 'idle';
        if (code !== 0 && code !== null) {
          this.emit('error', new Error(`Claude CLI exited with code ${code}`));
        }
        this.emit('done', null);
      }
    });

    this.child.on('error', (err) => {
      console.error('[Claude] Process error:', err.message);
      this._isRunning = false;
      this._turnState = 'idle';
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

    this.protocol.on('result', () => {
      // Commit pending assistant UUID on Result
      if (this._pendingAssistantUuid) {
        this._lastMessageId = this._pendingAssistantUuid;
        this._pendingAssistantUuid = null;
      }
      // result = end of one turn, NOT end of session.
      // The process stays alive for follow-ups via stdin.
      this._turnState = 'idle';
      this.emit('result');
    });

    this.protocol.on('error', (err) => {
      this._turnState = 'idle';
      this.emit('error', err);
    });

    this.protocol.on('close', () => {
      // Process stdout closed — session is truly done
      if (this._isRunning) {
        this._isRunning = false;
        this._turnState = 'idle';
        this.emit('done', null);
      }
    });

    // 4. Initialize the stream-json protocol on stdin.
    // --input-format=stream-json requires initialization before Claude
    // will process anything. The prompt is sent via stdin as well.
    const hooks = this.buildHooks(mode);
    await this.protocol.initialize(hooks);
    await this.protocol.setPermissionMode(mode);

    const fullPrompt = this.options.systemPromptAppend
      ? `${prompt}\n\n${this.options.systemPromptAppend}`
      : prompt;
    await this.protocol.sendUserMessage(fullPrompt);
    this._turnState = 'processing';
  }

  /** Send a follow-up message to an active session */
  async sendMessage(content: string | import('./claude-types').ContentBlock[]): Promise<void> {
    if (!this.protocol) throw new Error('Session not started');
    await this.protocol.sendUserMessage(content);
    this._turnState = 'processing';
  }

  /** Approve a pending tool use */
  async approveTool(approvalId: string, updatedInput?: Record<string, unknown>): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || !this.protocol) return;

    const finalInput = updatedInput ?? pending.toolInput;
    console.log('[ClaudeSession] approveTool', approvalId, 'updatedInput?', !!updatedInput, JSON.stringify(finalInput).slice(0, 300));

    const result: PermissionResult = {
      behavior: 'allow',
      updatedInput: finalInput,
    };
    await this.protocol.sendPermissionResponse(pending.requestId, result);
    this.pendingApprovals.delete(approvalId);
    this._turnState = 'processing';
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
    this._turnState = 'processing';
  }

  /** Interrupt the current operation */
  async interrupt(): Promise<void> {
    await this.protocol?.interrupt();
  }

  /** Kill the session process */
  kill(): void {
    // Don't set _isRunning = false here — let the exit/close handler do it
    // so that the 'done' event is properly emitted and listeners (e.g. wireSubagent)
    // can run cleanup like broadcasting subagent_stopped.
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

    // MCP server integration:
    //   Subagent sessions get their type-specific MCP servers from the registry
    //   Regular sessions get zeus-bridge (orchestration, subagent dispatch)
    const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
    const isSubagent = !!this.options.subagentId;

    if (isSubagent && this.options.mcpServers) {
      for (const mcp of this.options.mcpServers) {
        const env: Record<string, string> = {
          ...(mcp.env ?? {}),
          ZEUS_QA_AGENT_ID: this.options.subagentId!,
          ZEUS_WS_URL: process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:8888',
        };
        mcpServers[mcp.name] = {
          command: mcp.command,
          args: mcp.args,
          env,
        };
      }

      // QA-specific system prompt injection (only if zeus-qa MCP server is attached)
      if (this.options.mcpServers.some(m => m.name === 'zeus-qa')) {
        const targetUrl = this.options.qaTargetUrl || process.env.ZEUS_QA_DEFAULT_URL || 'http://localhost:5173';
        const qaPrompt = [
          'You have access to QA browser testing tools via the zeus-qa MCP server.',
          `After making UI changes, call qa_run_test_flow with url "${targetUrl}".`,
          'Check the summary for errors. If issues found, fix them and re-test.',
          'Do not claim work is complete until qa_run_test_flow returns a clean report.',
        ].join(' ');
        args.push('--append-system-prompt', qaPrompt);
      }
    } else if (!isSubagent) {
      const bridgePath = path.resolve(app.getAppPath(), 'out/main/mcp-zeus-bridge.mjs');
      mcpServers['zeus-bridge'] = { command: 'node', args: [bridgePath] };

      const bridgePrompt = [
        'You have access to Zeus orchestration tools via the zeus-bridge MCP server.',
        'Use zeus_qa_run to spawn a QA testing agent — it blocks until the agent finishes and returns a summary.',
        'After making UI changes, call zeus_qa_run with a task describing what to test.',
        'The QA agent has full browser automation. Review its summary before claiming work is complete.',
      ].join(' ');
      args.push('--append-system-prompt', bridgePrompt);

      // Merge external MCPs from registry (resolved via profile + overrides)
      if (this.options.mcpServers) {
        for (const mcp of this.options.mcpServers) {
          mcpServers[mcp.name] = { command: mcp.command, args: mcp.args, env: mcp.env };
        }
      }
    }

    // Room MCP injection for room-aware agents
    if (this.options.roomId && this.options.roomAware !== false && !this.options.subagentId) {
      const wsUrl = process.env.ZEUS_WS_URL ?? 'ws://127.0.0.1:8888';
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

    args.push('--mcp-config', JSON.stringify({ mcpServers }));

    return args;
  }

  private buildHooks(mode: PermissionMode): Record<string, unknown[]> {
    const hooks: Record<string, unknown[]> = {};

    // If glob rules are active, route ALL tools through approval
    // (our evaluator will auto-resolve most of them in handleControlRequest)
    if (this.permissionRules.length > 0) {
      hooks['PreToolUse'] = [
        { matcher: '.*', hookCallbackIds: ['tool_approval'] },
      ];
      return hooks;
    }

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
        this._turnState = 'waiting_approval';
        this.emit('approval_needed', {
          approvalId,
          requestId,
          toolName: tool_name,
          toolInput: input,
          toolUseId: tool_use_id,
        });
        this.emit('activity', { state: 'waiting_approval', toolName: tool_name });
        return;
      }

      // ─── Glob rule evaluation ───
      if (this.permissionRules.length > 0) {
        const rawPattern = extractPattern(tool_name, input as Record<string, unknown>);
        const pattern = relativize(rawPattern, this.options.workingDir);
        const { action, matchedRule } = evaluate(tool_name, pattern, this.permissionRules);

        // Audit log
        this.logAudit(tool_name, pattern, action, matchedRule);

        if (action === 'allow') {
          const result: PermissionResult = { behavior: 'allow', updatedInput: input };
          await this.protocol!.sendPermissionResponse(requestId, result);
          this.emit('permission_auto_resolved', { toolName: tool_name, pattern, action: 'allow' });
          return;
        }

        if (action === 'deny') {
          const result: PermissionResult = {
            behavior: 'deny',
            message: `Permission denied by project rule: ${matchedRule?.tool}:${matchedRule?.pattern} → deny`,
          };
          await this.protocol!.sendPermissionResponse(requestId, result);
          this.emit('permission_auto_resolved', { toolName: tool_name, pattern, action: 'deny' });
          return;
        }

        // action === 'ask' → fall through to existing UI flow
      }

      // ExitPlanMode — approve and switch to bypass (after glob evaluation so rules can deny it)
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
      this._turnState = 'waiting_approval';
      this.emit('approval_needed', {
        approvalId,
        requestId,
        toolName: tool_name,
        toolInput: input,
        toolUseId: tool_use_id,
      });
      this.emit('activity', { state: 'waiting_approval', toolName: tool_name });
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

  private logAudit(toolName: string, pattern: string, action: string, matchedRule: PermissionRule | null): void {
    try {
      insertAuditEntry({
        id: crypto.randomUUID(),
        sessionId: this.options.zeusSessionId ?? '',
        projectId: this.projectId,
        toolName,
        pattern,
        action,
        ruleMatched: matchedRule ? JSON.stringify(matchedRule) : null,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn('[ClaudeSession] Failed to log audit entry:', err);
    }
  }
}

// --- Session Manager (manages multiple Claude sessions) ---

export class ClaudeSessionManager {
  // Keyed by client-provided key (envelope sessionId)
  private sessions = new Map<string, ClaudeSession>();

  async createSession(
    clientKey: string,
    prompt: string,
    options: SessionOptions,
  ): Promise<ClaudeSession> {
    const session = new ClaudeSession(options);

    // Store immediately by client key so lookups work right away
    this.sessions.set(clientKey, session);

    await session.start(prompt);
    return session;
  }

  async resumeSession(
    clientKey: string,
    claudeSessionId: string,
    prompt: string,
    options: SessionOptions,
  ): Promise<ClaudeSession> {
    return this.createSession(clientKey, prompt, {
      ...options,
      resumeSessionId: claudeSessionId,
    });
  }

  getSession(clientKey: string): ClaudeSession | undefined {
    return this.sessions.get(clientKey);
  }

  getAllSessions(): Map<string, ClaudeSession> {
    return new Map(this.sessions);
  }

  getSessionPids(): Array<{ sessionId: string; pid: number }> {
    const result: Array<{ sessionId: string; pid: number }> = [];
    for (const [id, session] of this.sessions) {
      if (session.isRunning && session.pid) {
        result.push({ sessionId: id, pid: session.pid });
      }
    }
    return result;
  }

  killSession(clientKey: string): void {
    const session = this.sessions.get(clientKey);
    if (session) {
      session.kill();
      this.sessions.delete(clientKey);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
  }
}
