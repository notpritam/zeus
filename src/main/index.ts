import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (one level up from out/main/)
loadEnv({ path: resolve(__dirname, '../../.env') });

// Fix PATH for Electron — when launched from Finder/dock, PATH is stripped to
// /usr/bin:/bin:/usr/sbin:/sbin. Prepend common user binary locations so that
// `which claude`, `node`, `npm`, and `npx` resolve correctly.
function fixElectronPath(): void {
  const home = process.env.HOME ?? '';
  const additions = [
    `${home}/.local/bin`,
    `${home}/.npm/bin`,
    '/usr/local/bin',
    `${home}/.nvm/versions/node/${process.version}/bin`,
    `${home}/.volta/bin`,
  ].filter(Boolean);
  const current = process.env.PATH ?? '';
  const missing = additions.filter(p => !current.includes(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, current].join(':');
  }
}

fixElectronPath();

import { app, BrowserWindow, Menu, nativeImage } from 'electron';
import path from 'path';
import { registerService, bootAll, shutdownAll } from './lifecycle';
import { Log } from './log/log';
import { initDatabase, closeDatabase } from './db/client';
import { startWebSocketServer, stopWebSocketServer, notifyTunnelStatus } from './server/server';
import { resolveClaudeBinary } from './services/claude-cli';
import { startPowerBlock } from './services/power';
import { destroyAllSessions } from './services/terminal';
import { getActiveSessions, markKilled } from './services/sessions';
import { initAuthToken } from './services/auth';
import { initSettings, getAutoTunnel } from './services/settings';
import { loadAllThemes } from './services/themes';
import { startTunnel, stopTunnel } from './services/tunnel';
import { createMainWindowOptions } from './window';
import { markStaleSessionsErrored, pruneOldSessions, finalizeAllCompletedSessions } from './db/queries/claude';
import { markStaleSubagentsErrored } from './db/queries/subagent';
import { zeusEnv } from './services/env';
import { TaskManager } from './services/task-manager';

let mainWindow: BrowserWindow | null = null;

/** Get the main window (used by services to flash taskbar, bounce dock, etc.) */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  // Set macOS dock icon (dev mode shows Electron icon otherwise)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  // Application menu with Zeus branding
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Zeus',
      submenu: [
        { role: 'about', label: 'About Zeus' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Zeus' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Zeus' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

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

app.setName('Zeus');

// ─── Register lifecycle services ───

const { wsPort, label } = zeusEnv;
const dbPath = zeusEnv.dbPath();

registerService({
  name: 'log',
  deps: [],
  start: async () => Log.init({ level: 'INFO', logDir: path.join(app.getPath('userData'), 'logs') }),
  stop: async () => Log.close(),
});

registerService({
  name: 'db',
  deps: ['log'],
  start: async () => initDatabase(dbPath),
  stop: async () => closeDatabase(),
});

registerService({
  name: 'claude-cli',
  deps: ['log'],
  start: async () => { await resolveClaudeBinary(); },
  stop: async () => {},
});

registerService({
  name: 'ws-server',
  deps: ['log', 'db'],
  start: async () => { await startWebSocketServer(wsPort); },
  stop: async () => { await stopWebSocketServer(); },
});

// ─── Boot sequence ───

app.whenReady().then(async () => {
  console.log(`[Zeus ${label}] Starting on port ${wsPort}...`);

  // Expose WS port so child processes (MCP bridges) connect to the right server
  process.env.ZEUS_WS_URL = `ws://127.0.0.1:${wsPort}`;

  // Expose default QA target URL — uses the dev server URL in dev mode,
  // so QA agents test the correct app without manual URL entry
  process.env.ZEUS_QA_DEFAULT_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';

  // Pre-lifecycle init (no deps on log/db)
  startPowerBlock();
  initAuthToken();

  // Boot log -> db -> claude-cli -> ws-server in dependency order
  await bootAll();

  // Post-boot init (depends on db being ready)
  initSettings();
  loadAllThemes();
  markStaleSessionsErrored();
  markStaleSubagentsErrored();
  // Recover tasks — ensure worktrees exist for active tasks
  TaskManager.recoverTasks().catch((err) => {
    console.error('[Zeus] Task recovery failed:', err);
  });
  finalizeAllCompletedSessions();
  pruneOldSessions(30);

  const autoTunnel = getAutoTunnel();
  if (autoTunnel) {
    const tunnelUrl = await startTunnel(wsPort);
    if (tunnelUrl) notifyTunnelStatus();
  } else {
    console.log(`[Zeus ${label}] Auto-tunnel disabled, WS on port ${wsPort}`);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (e) => {
  e.preventDefault();

  // Mark all active sessions as killed before destroying
  for (const session of getActiveSessions()) {
    markKilled(session.id);
  }
  destroyAllSessions();
  await stopTunnel();

  // Shutdown services in reverse dependency order (ws-server -> db -> log)
  await shutdownAll();

  app.exit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
