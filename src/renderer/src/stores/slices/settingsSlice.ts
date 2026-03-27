import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type {
  SavedProject,
  ClaudeDefaults,
  ThemeMeta,
} from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface SettingsSlice {
  // State
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  settingsError: string | null;
  themes: ThemeMeta[];
  activeThemeId: string;
  autoTunnel: boolean;
  activeThemeColors: Record<string, string> | null;

  // Actions
  addProject: (name: string, path: string, createDir?: boolean) => void;
  removeProject: (id: string) => void;
  updateDefaults: (defaults: Partial<ClaudeDefaults>) => void;
  setTheme: (themeId: string) => void;
  refreshThemes: () => void;
  openThemesFolder: () => void;
}

export const createSettingsSlice: StateCreator<ZeusState, [], [], SettingsSlice> = (set) => ({
  savedProjects: [],
  claudeDefaults: {
    permissionMode: 'bypassPermissions',
    model: '',
    notificationSound: true,
  },
  lastUsedProjectId: null,
  settingsError: null,
  themes: [],
  activeThemeId: 'zeus-dark',
  autoTunnel: false,
  activeThemeColors: null,

  addProject: (name: string, path: string, createDir?: boolean) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'add_project', name, path, createDir },
      auth: '',
    });
  },

  removeProject: (id: string) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'remove_project', id },
      auth: '',
    });
  },

  updateDefaults: (defaults: Partial<ClaudeDefaults>) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'update_defaults', defaults },
      auth: '',
    });
  },

  setTheme: (themeId: string) => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'set_theme', themeId },
      auth: '',
    });
  },

  refreshThemes: () => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'refresh_themes' },
      auth: '',
    });
  },

  openThemesFolder: () => {
    zeusWs.send({
      channel: 'settings',
      sessionId: '',
      payload: { type: 'open_themes_folder' },
      auth: '',
    });
  },
});
