import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Mock xterm.js — jsdom doesn't support canvas
vi.mock('xterm', () => {
  const Terminal = vi.fn(function (this: Record<string, unknown>) {
    this.loadAddon = vi.fn();
    this.open = vi.fn();
    this.write = vi.fn();
    this.onData = vi.fn(() => ({ dispose: vi.fn() }));
    this.dispose = vi.fn();
    this.cols = 80;
    this.rows = 24;
  });
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn(function (this: Record<string, unknown>) {
    this.fit = vi.fn();
  });
  return { FitAddon };
});

vi.mock('@xterm/addon-web-links', () => {
  const WebLinksAddon = vi.fn();
  return { WebLinksAddon };
});

// Mock the WebSocket client
vi.mock('@/lib/ws', () => ({
  zeusWs: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(() => vi.fn()),
    connected: false,
  },
}));
