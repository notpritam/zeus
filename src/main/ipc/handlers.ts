import { ipcMain } from 'electron';
import { isPowerBlocked } from '../services/power';

export function registerIpcHandlers(): void {
  ipcMain.handle('zeus:status', () => {
    return {
      powerBlock: isPowerBlocked(),
      websocket: false,
      tunnel: null,
    };
  });
}
