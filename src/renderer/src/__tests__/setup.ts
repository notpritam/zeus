import '@testing-library/jest-dom/vitest';

// Mock the zeus API exposed via preload
window.zeus = {
  getStatus: async () => ({
    powerBlock: true,
    websocket: false,
    tunnel: null,
  }),
  togglePower: async () => false,
};
