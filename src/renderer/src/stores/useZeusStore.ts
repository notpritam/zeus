import { create } from 'zustand';

interface ZeusState {
  powerBlock: boolean;
  websocket: boolean;
  tunnel: string | null;
  loading: boolean;

  init: () => Promise<void>;
  togglePower: () => Promise<void>;
}

export const useZeusStore = create<ZeusState>((set) => ({
  powerBlock: true,
  websocket: false,
  tunnel: null,
  loading: true,

  init: async () => {
    const status = await window.zeus.getStatus();
    set({
      powerBlock: status.powerBlock,
      websocket: status.websocket,
      tunnel: status.tunnel,
      loading: false,
    });
  },

  togglePower: async () => {
    const newState = await window.zeus.togglePower();
    set({ powerBlock: newState });
  },
}));
