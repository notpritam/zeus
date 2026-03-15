import { ipcMain } from 'electron';
import { isPowerBlocked, startPowerBlock, stopPowerBlock } from '../services/power';

export function registerIpcHandlers(): void {
  ipcMain.handle('zeus:status', () => {
    return {
      powerBlock: isPowerBlocked(),
      websocket: false,
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
}
