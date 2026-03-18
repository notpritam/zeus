import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (one level up from out/main/)
loadEnv({ path: resolve(__dirname, '../../.env') });

import { app, BrowserWindow, Menu } from 'electron';
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
import { zeusEnv } from './services/env';

let mainWindow: BrowserWindow | null = null;

/** Get the main window (used by services to flash taskbar, bounce dock, etc.) */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow(createMainWindowOptions());

  // Prevent renderer crashes from JS errors (e.g. ResizeObserver loop)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Zeus] Renderer process gone:', details.reason, details.exitCode);
    // Reload on crash instead of showing blank screen
    if (details.reason === 'crashed' || details.reason === 'oom') {
      mainWindow?.reload();
    }
  });

  // Suppress console-level JS errors that are benign
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    // level 3 = error — log to main process for debugging
    if (level === 3 && !message.includes('ResizeObserver')) {
      console.error('[Renderer Error]', message);
    }
  });

  // In dev: use Vite HMR server. In prod: load from the HTTP server.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${zeusEnv.wsPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const { isDev, wsPort, shouldTunnel, label } = zeusEnv;
  console.log(`[Zeus ${label}] Starting on port ${wsPort}...`);

  // Expose WS port so child processes (MCP bridges) connect to the right server
  process.env.ZEUS_WS_URL = `ws://127.0.0.1:${wsPort}`;

  // Expose default QA target URL — uses the dev server URL in dev mode,
  // so QA agents test the correct app without manual URL entry
  process.env.ZEUS_QA_DEFAULT_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';

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

  if (shouldTunnel) {
    const tunnelUrl = await startTunnel(wsPort);
    if (tunnelUrl) notifyTunnelStatus();
  } else {
    console.log(`[Zeus ${label}] Tunnel disabled, WS on port ${wsPort}`);
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
