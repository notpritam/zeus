import ngrok from '@ngrok/ngrok';

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
      console.log('[Zeus] Tunnel closed');
    } catch (err) {
      console.error('[Zeus] Error closing tunnel:', (err as Error).message);
    }
    listener = null;
    tunnelUrl = null;
  }
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

export function isTunnelActive(): boolean {
  return listener !== null && tunnelUrl !== null;
}
