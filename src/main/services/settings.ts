import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import type { ZeusSettings, SavedProject, ClaudeDefaults } from '../../shared/types';

const SETTINGS_FILE = 'zeus-settings.json';

const DEFAULT_SETTINGS: ZeusSettings = {
  savedProjects: [],
  claudeDefaults: {
    permissionMode: 'bypassPermissions',
    model: '',
    notificationSound: true,
  },
  lastUsedProjectId: null,
};

let settings: ZeusSettings = { ...DEFAULT_SETTINGS };

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function writeToDisk(): void {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Zeus] Failed to write settings:', err);
  }
}

export function initSettings(): void {
  const filePath = getSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ZeusSettings>;
      settings = {
        savedProjects: parsed.savedProjects ?? DEFAULT_SETTINGS.savedProjects,
        claudeDefaults: {
          ...DEFAULT_SETTINGS.claudeDefaults,
          ...parsed.claudeDefaults,
        },
        lastUsedProjectId: parsed.lastUsedProjectId ?? DEFAULT_SETTINGS.lastUsedProjectId,
      };
      console.log('[Zeus] Settings loaded from disk');
    } else {
      settings = { ...DEFAULT_SETTINGS };
      writeToDisk();
      console.log('[Zeus] Settings created with defaults');
    }
  } catch (err) {
    console.error('[Zeus] Failed to read settings, using defaults:', err);
    settings = { ...DEFAULT_SETTINGS };
    writeToDisk();
  }
}

export function getSettings(): ZeusSettings {
  return settings;
}

export function addProject(name: string, projectPath: string): SavedProject {
  const project: SavedProject = {
    id: crypto.randomUUID(),
    name,
    path: projectPath,
    addedAt: Date.now(),
  };
  settings.savedProjects.push(project);
  writeToDisk();
  return project;
}

export function removeProject(id: string): void {
  settings.savedProjects = settings.savedProjects.filter((p) => p.id !== id);
  if (settings.lastUsedProjectId === id) {
    settings.lastUsedProjectId = null;
  }
  writeToDisk();
}

export function updateDefaults(partial: Partial<ClaudeDefaults>): void {
  settings.claudeDefaults = { ...settings.claudeDefaults, ...partial };
  writeToDisk();
}

export function setLastUsedProject(id: string | null): void {
  settings.lastUsedProjectId = id;
  writeToDisk();
}
