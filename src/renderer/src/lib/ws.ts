import type { WsEnvelope } from '../../../shared/types';

type ChannelHandler = (envelope: WsEnvelope) => void;

class ZeusWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<ChannelHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    // Close any existing connection first (prevents duplicates on StrictMode re-mount)
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this.doConnect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
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

  send(envelope: WsEnvelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  on(channel: string, handler: ChannelHandler): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(handler);
    return () => {
      this.listeners.get(channel)?.delete(handler);
    };
  }

  private getUrl(): string {
    // If served from a different port on localhost, we're in Vite dev mode
    const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalDev && location.port !== '3000') {
      return 'ws://127.0.0.1:3000';
    }
    // Production or ngrok: use same host
    return `ws://${location.host}`;
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
      // Notify connection listeners
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
        this.dispatch(envelope);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      this.dispatch({
        channel: 'status',
        sessionId: '',
        payload: { type: '_disconnected' },
        auth: '',
      });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
  }

  private dispatch(envelope: WsEnvelope): void {
    const handlers = this.listeners.get(envelope.channel);
    if (handlers) {
      for (const handler of handlers) {
        handler(envelope);
      }
    }
  }
}

// Singleton instance
export const zeusWs = new ZeusWebSocket();
