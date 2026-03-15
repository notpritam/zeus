import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useZeusStore } from '@/stores/useZeusStore';

describe('useZeusStore', () => {
  beforeEach(() => {
    useZeusStore.setState({
      powerBlock: true,
      websocket: false,
      tunnel: null,
      loading: true,
    });
  });

  it('has correct initial state', () => {
    const state = useZeusStore.getState();
    expect(state.powerBlock).toBe(true);
    expect(state.websocket).toBe(false);
    expect(state.tunnel).toBeNull();
    expect(state.loading).toBe(true);
  });

  it('init fetches status and sets loading to false', async () => {
    window.zeus.getStatus = vi.fn().mockResolvedValue({
      powerBlock: true,
      websocket: false,
      tunnel: null,
    });

    await useZeusStore.getState().init();

    const state = useZeusStore.getState();
    expect(state.loading).toBe(false);
    expect(state.powerBlock).toBe(true);
    expect(window.zeus.getStatus).toHaveBeenCalledOnce();
  });

  it('togglePower updates powerBlock state', async () => {
    window.zeus.togglePower = vi.fn().mockResolvedValue(false);

    await useZeusStore.getState().togglePower();

    expect(useZeusStore.getState().powerBlock).toBe(false);
    expect(window.zeus.togglePower).toHaveBeenCalledOnce();
  });
});
