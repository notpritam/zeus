import type { BrowserWindowConstructorOptions } from 'electron';
import path from 'path';

export function createMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1024,
    height: 640,
    minWidth: 480,
    minHeight: 360,
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
