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
      claudeSessions: [],
      activeClaudeId: null,
      claudeEntries: {},
      pendingApprovals: [],
      viewMode: 'terminal',
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
    expect(state.claudeSessions).toEqual([]);
    expect(state.activeClaudeId).toBeNull();
    expect(state.viewMode).toBe('terminal');
  });

  it('connect calls zeusWs.connect and subscribes to channels', () => {
    const cleanup = useZeusStore.getState().connect();
    expect(zeusWs.on).toHaveBeenCalledWith('status', expect.any(Function));
    expect(zeusWs.on).toHaveBeenCalledWith('control', expect.any(Function));
    expect(zeusWs.on).toHaveBeenCalledWith('claude', expect.any(Function));
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

  it('selectSession updates activeSessionId and sets terminal mode', () => {
    useZeusStore.getState().selectSession('abc-123');
    const state = useZeusStore.getState();
    expect(state.activeSessionId).toBe('abc-123');
    expect(state.viewMode).toBe('terminal');
  });

  it('selectSession can clear selection', () => {
    useZeusStore.setState({ activeSessionId: 'abc' });
    useZeusStore.getState().selectSession(null);
    expect(useZeusStore.getState().activeSessionId).toBeNull();
  });

  it('startClaudeSession creates session and sends WS message', () => {
    useZeusStore.getState().startClaudeSession({ prompt: 'Fix the bug', workingDir: '/tmp' });
    const state = useZeusStore.getState();
    expect(state.claudeSessions).toHaveLength(1);
    expect(state.claudeSessions[0].prompt).toBe('Fix the bug');
    expect(state.claudeSessions[0].status).toBe('running');
    expect(state.activeClaudeId).toBe(state.claudeSessions[0].id);
    expect(state.viewMode).toBe('claude');
    expect(zeusWs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'claude',
        payload: expect.objectContaining({ type: 'start_claude', prompt: 'Fix the bug' }),
      }),
    );
  });

  it('sendClaudeMessage sends to active session', () => {
    useZeusStore.getState().startClaudeSession({ prompt: 'Test', workingDir: '/tmp' });
    const id = useZeusStore.getState().activeClaudeId;
    vi.clearAllMocks();
    useZeusStore.getState().sendClaudeMessage('Follow up');
    expect(zeusWs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'claude',
        sessionId: id,
        payload: { type: 'send_message', content: 'Follow up' },
      }),
    );
  });

  it('selectClaudeSession switches to claude mode', () => {
    useZeusStore.getState().selectClaudeSession('c-123');
    const state = useZeusStore.getState();
    expect(state.activeClaudeId).toBe('c-123');
    expect(state.viewMode).toBe('claude');
  });
});
