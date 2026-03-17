// src/main/services/cdp-client.ts
// Chrome DevTools Protocol client — connects to debug port, captures
// Runtime and Network events, writes ring buffers to a temp file so the
// standalone MCP QA server can read them.

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Types ───

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status: number;
  duration: number;
  type: string;
  failed: boolean;
  error?: string;
}

export interface JsError {
  message: string;
  stack: string;
  source: string;
  line: number;
  timestamp: number;
}

export interface CdpState {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  errors: JsError[];
  updatedAt: number;
}

const CDP_STATE_FILE = path.join(os.tmpdir(), 'zeus-qa-cdp-state.json');
const RING_BUFFER_SIZE = 100;
const DEBOUNCE_MS = 200;

class RingBuffer<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > RING_BUFFER_SIZE) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}

// ─── CDP Client ───

const CDP_MAX_RETRIES = 5;
const CDP_RETRY_INTERVAL = 1000;

export class CdpClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private consoleBuf = new RingBuffer<ConsoleEntry>();
  private networkBuf = new RingBuffer<NetworkEntry>();
  private errorBuf = new RingBuffer<JsError>();
  private pendingRequests = new Map<string, { url: string; method: string; startTime: number; type: string }>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private cdpPort: number;

  constructor(cdpPort?: number) {
    super();
    this.cdpPort = cdpPort ?? parseInt(process.env.ZEUS_CDP_PORT ?? '9222', 10);
  }

  async connect(): Promise<void> {
    const wsUrl = await this.discoverWebSocketUrl();
    console.log(`[CDP] Connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        console.log('[CDP] Connected');
        this.connected = true;
        await this.enableDomains();
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleCdpMessage(msg);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        console.log('[CDP] Disconnected');
        this.connected = false;
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        console.error('[CDP] WebSocket error:', err.message);
        if (!this.connected) reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getState(): CdpState {
    return {
      console: this.consoleBuf.getAll(),
      network: this.networkBuf.getAll(),
      errors: this.errorBuf.getAll(),
      updatedAt: Date.now(),
    };
  }

  clearBuffers(): void {
    this.consoleBuf.clear();
    this.networkBuf.clear();
    this.errorBuf.clear();
    this.scheduleWrite();
  }

  private async discoverWebSocketUrl(): Promise<string> {
    const discoveryUrl = `http://127.0.0.1:${this.cdpPort}`;
    for (let i = 0; i < CDP_MAX_RETRIES; i++) {
      try {
        const res = await fetch(`${discoveryUrl}/json/list`);
        if (res.ok) {
          const tabs = await res.json() as Array<{ webSocketDebuggerUrl?: string; type?: string }>;
          const page = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
      } catch { /* not ready yet */ }
      if (i < CDP_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, CDP_RETRY_INTERVAL));
      }
    }
    throw new Error(`CDP: Could not discover WebSocket URL after ${CDP_MAX_RETRIES} attempts`);
  }

  private async enableDomains(): Promise<void> {
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Page.enable');
  }

  private send(method: string, params?: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket not open'));
      }
      const id = ++this.messageId;
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ─── CDP Event Handlers ───

  private handleCdpMessage(msg: { method?: string; params?: Record<string, unknown> }): void {
    if (!msg.method) return;

    switch (msg.method) {
      case 'Runtime.consoleAPICalled':
        this.handleConsole(msg.params!);
        break;
      case 'Runtime.exceptionThrown':
        this.handleException(msg.params!);
        break;
      case 'Network.requestWillBeSent':
        this.handleRequestStart(msg.params!);
        break;
      case 'Network.responseReceived':
        this.handleResponse(msg.params!);
        break;
      case 'Network.loadingFailed':
        this.handleLoadingFailed(msg.params!);
        break;
      case 'Page.frameNavigated':
        this.handleFrameNavigated(msg.params!);
        break;
      case 'Page.navigatedWithinDocument':
        this.handleNavigatedWithinDocument(msg.params!);
        break;
    }
  }

  private handleConsole(params: Record<string, unknown>): void {
    const type = params.type as string;
    const args = params.args as Array<{ type: string; value?: unknown; description?: string }> | undefined;
    const message = args
      ?.map(a => a.value !== undefined ? String(a.value) : (a.description ?? ''))
      .join(' ') ?? '';

    const entry: ConsoleEntry = {
      level: (['warning'].includes(type) ? 'warn' : type) as ConsoleEntry['level'],
      message,
      timestamp: Date.now(),
    };
    this.consoleBuf.push(entry);
    this.emit('console', entry);
    this.scheduleWrite();
  }

  private handleException(params: Record<string, unknown>): void {
    const detail = params.exceptionDetails as Record<string, unknown> | undefined;
    if (!detail) return;

    const exception = detail.exception as Record<string, unknown> | undefined;
    const stackTrace = detail.stackTrace as { callFrames?: Array<{ url: string; lineNumber: number }> } | undefined;
    const firstFrame = stackTrace?.callFrames?.[0];

    const entry: JsError = {
      message: (exception?.description ?? exception?.value ?? detail.text ?? 'Unknown error') as string,
      stack: exception?.description as string ?? '',
      source: firstFrame?.url ?? '',
      line: firstFrame?.lineNumber ?? 0,
      timestamp: Date.now(),
    };
    this.errorBuf.push(entry);
    this.emit('js_error', entry);
    this.scheduleWrite();
  }

  private handleFrameNavigated(params: Record<string, unknown>): void {
    const frame = params.frame as Record<string, unknown> | undefined;
    if (!frame) return;
    // Only emit for top-level frame (no parentId)
    if (frame.parentId) return;
    const url = frame.url as string;
    const title = (frame.name as string) ?? '';
    this.emit('navigated', { url, title });
  }

  /** Catches SPA navigation (pushState / replaceState / hash changes) */
  private handleNavigatedWithinDocument(params: Record<string, unknown>): void {
    const frameId = params.frameId as string | undefined;
    // Only top-level frame — frameId matches the first page target
    // For navigatedWithinDocument there's no parentId check, but we emit for all since
    // this event only fires for the frame that actually navigated
    const url = params.url as string;
    if (url) {
      this.emit('navigated', { url, title: '' });
    }
  }

  private handleRequestStart(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const request = params.request as Record<string, string>;
    this.pendingRequests.set(requestId, {
      url: request.url,
      method: request.method,
      startTime: Date.now(),
      type: (params.type as string) ?? 'Other',
    });
  }

  private handleResponse(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const response = params.response as Record<string, unknown>;
    const entry: NetworkEntry = {
      requestId,
      url: pending.url,
      method: pending.method,
      status: (response.status as number) ?? 0,
      duration: Date.now() - pending.startTime,
      type: pending.type,
      failed: false,
    };
    this.networkBuf.push(entry);
    this.pendingRequests.delete(requestId);
    this.emit('network', entry);
    this.scheduleWrite();
  }

  private handleLoadingFailed(params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const entry: NetworkEntry = {
      requestId,
      url: pending.url,
      method: pending.method,
      status: 0,
      duration: Date.now() - pending.startTime,
      type: pending.type,
      failed: true,
      error: (params.errorText as string) ?? 'Loading failed',
    };
    this.networkBuf.push(entry);
    this.pendingRequests.delete(requestId);
    this.emit('network', entry);
    this.scheduleWrite();
  }

  // ─── Temp File State Persistence ───

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeStateFile();
    }, DEBOUNCE_MS);
  }

  private writeStateFile(): void {
    try {
      const state = this.getState();
      const tmpFile = `${CDP_STATE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(state));
      fs.renameSync(tmpFile, CDP_STATE_FILE);
    } catch (err) {
      console.error('[CDP] Failed to write state file:', (err as Error).message);
    }
  }

  private cleanup(): void {
    try {
      if (fs.existsSync(CDP_STATE_FILE)) fs.unlinkSync(CDP_STATE_FILE);
      const tmp = `${CDP_STATE_FILE}.tmp`;
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch { /* best effort */ }
  }
}

export { CDP_STATE_FILE };
