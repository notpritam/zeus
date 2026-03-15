import { app, BrowserWindow } from 'electron';
import path from 'path';
import { startPowerBlock } from './services/power';
import { startWebSocketServer, stopWebSocketServer } from './services/websocket';
import { destroyAllSessions } from './services/terminal';
import { registerIpcHandlers } from './ipc/handlers';
import { createMainWindowOptions } from './window';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow(createMainWindowOptions());

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startPowerBlock();
  await startWebSocketServer();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  destroyAllSessions();
  await stopWebSocketServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
