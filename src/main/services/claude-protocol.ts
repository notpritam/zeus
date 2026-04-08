// ProtocolPeer — bidirectional JSON communication with Claude CLI
// Manages stdin/stdout JSON line protocol (stream-json format)

import { ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import type {
  ClaudeJson,
  ContentBlock,
  ControlRequestType,
  PermissionMode,
  PermissionResult,
} from './claude-types';
import { makeControlRequest, makeControlResponse, makeUserMessage } from './claude-types';

/** Minimal interface for a piped child process — works with both ChildProcess and SpawnResult */
interface PipedProcess {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
}

export class ProtocolPeer extends EventEmitter {
  private stdin: Writable;

  constructor(private child: PipedProcess) {
    super();
    if (!child.stdin || !child.stdout) {
      throw new Error('Child process must have piped stdin and stdout');
    }
    this.stdin = child.stdin;
    this.startReading();
  }

  private startReading(): void {
    const rl = createInterface({ input: this.child.stdout! });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const msg = JSON.parse(trimmed) as ClaudeJson;

        // Emit raw message for logging/processing
        this.emit('message', msg);

        // Route control requests separately for approval handling
        if (msg.type === 'control_request' && 'request_id' in msg) {
          this.emit(
            'control_request',
            (msg as { request_id: string }).request_id,
            (msg as { request: ControlRequestType }).request,
          );
        }

        // Signal session completion
        if (msg.type === 'result') {
          this.emit('result', msg);
        }
      } catch {
        // Non-JSON line — wrap as system message
        this.emit('message', { type: 'system', content: trimmed } as ClaudeJson);
      }
    });

    rl.on('close', () => this.emit('close'));

    // Stderr — log everything for debugging, forward non-noise as messages
    if (this.child.stderr) {
      const stderrRl = createInterface({ input: this.child.stderr });
      stderrRl.on('line', (line: string) => {
        console.error('[Claude stderr]', line);
        // Emit raw stderr line for startup diagnostics
        this.emit('stderr_line', line);
        if (line.includes('[WARN] Fast mode')) return;
        if (line.includes('npm warn')) return;
        this.emit('message', { type: 'stderr', content: line } as ClaudeJson);
      });
    }
  }

  // --- Outbound messages (App → Claude stdin) ---

  private sendJson(obj: unknown): void {
    this.stdin.write(JSON.stringify(obj) + '\n');
  }

  async initialize(hooks?: Record<string, unknown[]>): Promise<void> {
    this.sendJson(makeControlRequest({ subtype: 'initialize', hooks }));
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.sendJson(makeControlRequest({ subtype: 'set_permission_mode', mode }));
  }

  async sendUserMessage(content: string | ContentBlock[]): Promise<void> {
    this.sendJson(makeUserMessage(content));
  }

  async sendPermissionResponse(requestId: string, result: PermissionResult): Promise<void> {
    this.sendJson(makeControlResponse(requestId, result));
  }

  async sendHookResponse(requestId: string, hookOutput: unknown): Promise<void> {
    this.sendJson(makeControlResponse(requestId, hookOutput));
  }

  async interrupt(): Promise<void> {
    this.sendJson(makeControlRequest({ subtype: 'interrupt' }));
  }
}
