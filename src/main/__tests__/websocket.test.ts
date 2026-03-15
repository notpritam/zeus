// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  stopWebSocketServer,
  isWebSocketRunning,
} from '../services/websocket';
import { destroyAllSessions } from '../services/terminal';

const TEST_PORT = 3099;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndReceive(ws: WebSocket, msg: object): Promise<object> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify(msg));
  });
}

afterEach(async () => {
  destroyAllSessions();
  await stopWebSocketServer();
});

describe('websocket service', () => {
  it('starts and stops the server', async () => {
    expect(isWebSocketRunning()).toBe(false);

    await startWebSocketServer(TEST_PORT);
    expect(isWebSocketRunning()).toBe(true);

    await stopWebSocketServer();
    expect(isWebSocketRunning()).toBe(false);
  });

  it('accepts a client connection', async () => {
    await startWebSocketServer(TEST_PORT);
    const ws = await connect();

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('handles start_session and returns session_started', async () => {
    await startWebSocketServer(TEST_PORT);
    const ws = await connect();

    const response = (await sendAndReceive(ws, {
      channel: 'control',
      sessionId: '',
      payload: { type: 'start_session' },
      auth: '',
    })) as { channel: string; payload: { type: string; sessionId: string; shell: string } };

    expect(response.channel).toBe('control');
    expect(response.payload.type).toBe('session_started');
    expect(response.payload.sessionId).toBeTruthy();
    expect(response.payload.shell).toBeTruthy();

    ws.close();
  });

  it('returns error for unknown channel', async () => {
    await startWebSocketServer(TEST_PORT);
    const ws = await connect();

    const response = (await sendAndReceive(ws, {
      channel: 'git',
      sessionId: '',
      payload: {},
      auth: '',
    })) as { payload: { type: string; message: string } };

    expect(response.payload.type).toBe('error');
    expect(response.payload.message).toContain('not yet implemented');

    ws.close();
  });

  it('returns error for invalid JSON', async () => {
    await startWebSocketServer(TEST_PORT);
    const ws = await connect();

    const response = await new Promise<object>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send('not json');
    });

    expect((response as { payload: { type: string } }).payload.type).toBe('error');

    ws.close();
  });
});
