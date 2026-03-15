import { ipcMain } from 'electron';
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from '../services/power';
import {
  isWebSocketRunning,
  startWebSocketServer,
  stopWebSocketServer,
} from '../services/websocket';

export function registerIpcHandlers(): void {
  ipcMain.handle('zeus:status', () => {
    return {
      powerBlock: isPowerBlocked(),
      websocket: isWebSocketRunning(),
      tunnel: null,
    };
  });

  ipcMain.handle('zeus:toggle-power', () => {
    if (isPowerBlocked()) {
      stopPowerBlock();
    } else {
      startPowerBlock();
    }
    return isPowerBlocked();
  });

  ipcMain.handle('zeus:toggle-websocket', async () => {
    if (isWebSocketRunning()) {
      await stopWebSocketServer();
    } else {
      await startWebSocketServer();
    }
    return isWebSocketRunning();
  });
}
