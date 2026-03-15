import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useZeusStore } from '@/stores/useZeusStore';
import { zeusWs } from '@/lib/ws';

describe('useZeusStore', () => {
  beforeEach(() => {
    useZeusStore.setState({
      connected: false,
      powerBlock: true,
      websocket: true,
      tunnel: null,
      sessions: [],
      activeSessionId: null,
    });
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useZeusStore.getState();
    expect(state.connected).toBe(false);
    expect(state.powerBlock).toBe(true);
    expect(state.websocket).toBe(true);
    expect(state.tunnel).toBeNull();
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
  });

  it('connect calls zeusWs.connect and subscribes to channels', () => {
    const cleanup = useZeusStore.getState().connect();
    expect(zeusWs.on).toHaveBeenCalledWith('status', expect.any(Function));
    expect(zeusWs.on).toHaveBeenCalledWith('control', expect.any(Function));
    expect(zeusWs.connect).toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
  });

  it('togglePower sends toggle_power via WS', () => {
    useZeusStore.getState().togglePower();
    expect(zeusWs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'status',
        payload: { type: 'toggle_power' },
      }),
    );
  });

  it('startSession sends start_session via WS', () => {
    useZeusStore.getState().startSession(100, 40);
    expect(zeusWs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'control',
        payload: { type: 'start_session', cols: 100, rows: 40 },
      }),
    );
  });

  it('stopSession sends stop_session via WS', () => {
    useZeusStore.getState().stopSession('test-id');
    expect(zeusWs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'control',
        sessionId: 'test-id',
        payload: { type: 'stop_session' },
      }),
    );
  });

  it('selectSession updates activeSessionId', () => {
    useZeusStore.getState().selectSession('abc-123');
    expect(useZeusStore.getState().activeSessionId).toBe('abc-123');
  });

  it('selectSession can clear selection', () => {
    useZeusStore.setState({ activeSessionId: 'abc' });
    useZeusStore.getState().selectSession(null);
    expect(useZeusStore.getState().activeSessionId).toBeNull();
  });
});
