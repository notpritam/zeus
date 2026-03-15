import { app, BrowserWindow } from 'electron';
import { startPowerBlock } from './services/power';
import { startWebSocketServer, stopWebSocketServer } from './services/websocket';
import { destroyAllSessions } from './services/terminal';
import { getActiveSessions, markKilled } from './services/sessions';
import { createMainWindowOptions } from './window';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow(createMainWindowOptions());

  // In dev: use Vite HMR server. In prod: load from the HTTP server.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL('http://127.0.0.1:3000');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startPowerBlock();
  await startWebSocketServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  // Mark all active sessions as killed before destroying
  for (const session of getActiveSessions()) {
    markKilled(session.id);
  }
  destroyAllSessions();
  await stopWebSocketServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
