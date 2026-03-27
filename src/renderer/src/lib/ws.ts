import type { WsEnvelope } from '../../../shared/types';

type ChannelHandler = (envelope: WsEnvelope) => void;

/**
 * ZeusWs — WebSocket client with exponential-backoff reconnection,
 * heartbeat (ping every 30 s, force reconnect after 2 missed pongs),
 * and a send buffer that queues messages while disconnected and
 * flushes them on reconnect.
 *
 * Exported as a singleton (`zeusWs`) so every consumer shares one
 * connection.  The external API (`connect`, `disconnect`, `send`,
 * `on`, `connected`) is unchanged from the previous implementation.
 */
class ZeusWs {
  /* ── connection state ── */
  private ws: WebSocket | null = null;
  private _connected = false;
  private shouldReconnect = true;

  /* ── channel listeners ── */
  private listeners = new Map<string, Set<ChannelHandler>>();

  /* ── reconnection ── */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private static readonly MAX_RECONNECT_DELAY = 30_000;

  /* ── heartbeat ── */
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private static readonly PING_INTERVAL = 30_000;
  private static readonly MAX_MISSED_PONGS = 2;

  /* ── send buffer ── */
  private sendBuffer: string[] = [];

  /* ── public API ── */

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    // Tear down any existing connection first (prevents duplicates on
    // StrictMode re-mount).
    this.teardown();
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this.doConnect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.teardown();
  }

  /**
   * Send a message.  If the socket is not open the message is queued
   * in `sendBuffer` and will be flushed on the next successful
   * reconnect.
   */
  send(envelope: WsEnvelope): void {
    const msg = JSON.stringify(envelope);
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.sendBuffer.push(msg);
    }
  }

  /**
   * Subscribe to a channel.  Returns an unsubscribe function.
   */
  on(channel: string, handler: ChannelHandler): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(handler);
    return () => {
      this.listeners.get(channel)?.delete(handler);
    };
  }

  /* ── internals ── */

  private getUrl(): string {
    // Vite dev mode: renderer on a different port → WS on 8889
    const isLocalDev =
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalDev && location.port !== '8888') {
      return 'ws://127.0.0.1:8889';
    }
    // Production or ngrok: match protocol and pass through auth token
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = new URLSearchParams(location.search).get('token');
    const base = `${protocol}//${location.host}`;
    return token ? `${base}?token=${token}` : base;
  }

  private doConnect(): void {
    try {
      this.ws = new WebSocket(this.getUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000;
      this.missedPongs = 0;

      // Flush queued messages
      this.flushSendBuffer();

      // Start heartbeat
      this.startPing();

      // Notify listeners
      this.dispatch({
        channel: 'status',
        sessionId: '',
        payload: { type: '_connected' },
        auth: '',
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as WsEnvelope;

        // Handle pong — reset missed counter, do not propagate
        if (
          envelope.channel === 'status' &&
          (envelope.payload as Record<string, unknown>)?.type === 'pong'
        ) {
          this.missedPongs = 0;
          return;
        }

        this.dispatch(envelope);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      this.stopPing();

      this.dispatch({
        channel: 'status',
        sessionId: '',
        payload: { type: '_disconnected' },
        auth: '',
      });

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror — no action needed here
    };
  }

  /* ── reconnection ── */

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      ZeusWs.MAX_RECONNECT_DELAY,
    );
  }

  /* ── heartbeat ── */

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this._connected) return;

      this.missedPongs++;
      if (this.missedPongs >= ZeusWs.MAX_MISSED_PONGS) {
        // Server is unresponsive — force reconnect
        this.ws?.close();
        return;
      }

      // Send ping (bypass the buffer — we only ping when connected)
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            channel: 'status',
            sessionId: '',
            payload: { type: 'ping' },
            auth: '',
          }),
        );
      }
    }, ZeusWs.PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /* ── send buffer ── */

  private flushSendBuffer(): void {
    const pending = this.sendBuffer;
    this.sendBuffer = [];
    for (const msg of pending) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      } else {
        // Socket closed again mid-flush — re-queue the rest
        this.sendBuffer.push(msg);
      }
    }
  }

  /* ── teardown ── */

  private teardown(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /* ── dispatch ── */

  private dispatch(envelope: WsEnvelope): void {
    const handlers = this.listeners.get(envelope.channel);
    if (handlers) {
      for (const handler of handlers) {
        handler(envelope);
      }
    }
  }
}

// Singleton instance — shared across the entire renderer
export const zeusWs = new ZeusWs();
