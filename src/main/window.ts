import type { BrowserWindowConstructorOptions } from 'electron';
import path from 'path';

export function createMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 380,
    height: 420,
    minWidth: 380,
    minHeight: 420,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}
