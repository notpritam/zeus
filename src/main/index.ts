import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (one level up from out/main/)
loadEnv({ path: resolve(__dirname, '../../.env') });

import { app, BrowserWindow } from 'electron';
import { startPowerBlock } from './services/power';
import { startWebSocketServer, stopWebSocketServer, notifyTunnelStatus } from './services/websocket';
import { destroyAllSessions } from './services/terminal';
import { getActiveSessions, markKilled } from './services/sessions';
import { initAuthToken } from './services/auth';
import { initSettings } from './services/settings';
import { loadAllThemes } from './services/themes';
import { startTunnel, stopTunnel } from './services/tunnel';
import { createMainWindowOptions } from './window';
import { initDatabase, closeDatabase, markStaleSessionsErrored, markStaleQaAgentsErrored, pruneOldSessions, finalizeAllCompletedSessions } from './services/db';

let mainWindow: BrowserWindow | null = null;

/** Get the main window (used by services to flash taskbar, bounce dock, etc.) */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  mainWindow = new BrowserWindow(createMainWindowOptions());

  // In dev: use Vite HMR server. In prod: load from the HTTP server.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL('http://127.0.0.1:8888');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const isDev = !!process.env.ELECTRON_RENDERER_URL;
  const wsPort = isDev ? 8889 : 8888;

  // Expose WS port so child processes (MCP bridges) connect to the right server
  process.env.ZEUS_WS_URL = `ws://127.0.0.1:${wsPort}`;

  startPowerBlock();
  initAuthToken();
  initDatabase();
  initSettings();
  loadAllThemes();
  markStaleSessionsErrored();
  markStaleQaAgentsErrored();
  finalizeAllCompletedSessions();
  pruneOldSessions(30);
  await startWebSocketServer(wsPort);

  if (!isDev) {
    const tunnelUrl = await startTunnel(wsPort);
    if (tunnelUrl) notifyTunnelStatus();
  } else {
    console.log('[Zeus] Dev mode — tunnel disabled, WS on port', wsPort);
  }

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
  await stopTunnel();
  await stopWebSocketServer();
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
