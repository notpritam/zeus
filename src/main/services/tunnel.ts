import ngrok from '@ngrok/ngrok';
import WebSocket from 'ws';

let listener: ngrok.Listener | null = null;
let tunnelUrl: string | null = null;

export async function startTunnel(port: number): Promise<string | null> {
  const authtoken = process.env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    console.warn('[Zeus] NGROK_AUTHTOKEN not set — tunnel disabled, app will work locally only');
    return null;
  }

  try {
    listener = await ngrok.forward({
      addr: port,
      authtoken,
      domain: process.env.NGROK_DOMAIN || undefined,
      // Bypass ngrok free-tier interstitial ("Visit Site" warning page)
      request_header_add: ['ngrok-skip-browser-warning:true'],
    });

    tunnelUrl = listener.url() ?? null;
    console.log(`[Zeus] Tunnel active: ${tunnelUrl}`);
    return tunnelUrl;
  } catch (err) {
    console.error('[Zeus] Failed to start tunnel:', (err as Error).message);
    return null;
  }
}

export async function stopTunnel(): Promise<void> {
  if (listener) {
    try {
      await listener.close();
    } catch (err) {
      console.error('[Zeus] Error closing listener:', (err as Error).message);
    }
    listener = null;
    tunnelUrl = null;
  }
  // Kill the ngrok agent session entirely so the slot is freed for other instances
  try {
    await ngrok.kill();
    console.log('[Zeus] Tunnel + ngrok session closed');
  } catch (err) {
    console.error('[Zeus] Error killing ngrok session:', (err as Error).message);
  }
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

export function isTunnelActive(): boolean {
  return listener !== null && tunnelUrl !== null;
}

/**
 * Connect to another Zeus instance's WS and tell it to stop its tunnel.
 * Used by dev mode to reclaim the ngrok domain from a running prod instance.
 */
export async function stopRemoteTunnel(remotePort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);

    const ws = new WebSocket(`ws://127.0.0.1:${remotePort}`);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        channel: 'status',
        sessionId: '',
        payload: { type: 'stop_tunnel' },
        auth: '',
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.channel === 'status' && msg.payload?.type === 'status_update') {
          clearTimeout(timeout);
          const stopped = msg.payload.tunnel === null;
          console.log(`[Zeus] Remote tunnel ${stopped ? 'stopped' : 'still active'} on port ${remotePort}`);
          ws.close();
          resolve(stopped);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      console.log(`[Zeus] No remote instance on port ${remotePort} — proceeding`);
      resolve(true); // no prod running, safe to proceed
    });
  });
}
