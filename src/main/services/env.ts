import { app } from 'electron';
import path from 'path';

const isDev = process.env.ZEUS_ENV === 'development';

export const zeusEnv = {
  isDev,
  isProd: !isDev,
  wsPort: parseInt(process.env.ZEUS_WS_PORT ?? (isDev ? '8889' : '8888'), 10),
  dbPath: () => path.join(app.getPath('userData'), isDev ? 'zeus-dev.db' : 'zeus.db'),
  settingsFile: isDev ? 'zeus-dev-settings.json' : 'zeus-settings.json',
  label: isDev ? 'DEV' : 'PROD',
};
