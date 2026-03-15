import '@testing-library/jest-dom/vitest';

// Mock the zeus API exposed via preload (guard for Node env in main process tests)
if (typeof window !== 'undefined') {
  window.zeus = {
    getStatus: async () => ({
      powerBlock: true,
      websocket: false,
      tunnel: null,
    }),
    togglePower: async () => false,
    toggleWebSocket: async () => false,
  };
}
