import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { ThemeMeta, ThemeFile } from '../../shared/types';

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(|^color-mix\(/;
const USER_THEMES_DIR = 'zeus-themes';

let cachedThemes: ThemeFile[] = [];

function getBuiltInDir(): string {
  // In development: src/main/themes (via __dirname which points to dist/main)
  // In production: resources/themes
  const devPath = path.join(__dirname, '../../../src/main/themes');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath ?? __dirname, 'themes');
}

export function getThemesDir(): string {
  const dir = path.join(app.getPath('userData'), USER_THEMES_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function validateColors(colors: unknown): colors is Record<string, string> {
  if (!colors || typeof colors !== 'object') return false;
  for (const [, value] of Object.entries(colors as Record<string, unknown>)) {
    if (typeof value !== 'string') return false;
    if (!COLOR_RE.test(value)) return false;
  }
  return true;
}

function parseThemeFile(filePath: string, builtIn: boolean): ThemeFile | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.id || typeof parsed.id !== 'string') {
      console.warn(`[Zeus Themes] Missing or invalid 'id' in ${filePath}`);
      return null;
    }
    if (!parsed.name || typeof parsed.name !== 'string') {
      console.warn(`[Zeus Themes] Missing or invalid 'name' in ${filePath}`);
      return null;
    }
    if (parsed.type !== 'dark' && parsed.type !== 'light') {
      console.warn(`[Zeus Themes] Invalid 'type' in ${filePath}, must be 'dark' or 'light'`);
      return null;
    }
    if (!validateColors(parsed.colors)) {
      console.warn(`[Zeus Themes] Invalid 'colors' in ${filePath}`);
      return null;
    }

    return {
      id: parsed.id,
      name: parsed.name,
      author: typeof parsed.author === 'string' ? parsed.author : undefined,
      type: parsed.type,
      builtIn,
      colors: parsed.colors,
    };
  } catch (err) {
    console.warn(`[Zeus Themes] Failed to parse ${filePath}:`, err);
    return null;
  }
}

function scanDirectory(dir: string, builtIn: boolean): ThemeFile[] {
  const themes: ThemeFile[] = [];
  if (!fs.existsSync(dir)) return themes;

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const theme = parseThemeFile(path.join(dir, file), builtIn);
      if (theme) themes.push(theme);
    }
  } catch (err) {
    console.warn(`[Zeus Themes] Failed to scan ${dir}:`, err);
  }

  return themes;
}

export function loadAllThemes(): ThemeFile[] {
  const builtIn = scanDirectory(getBuiltInDir(), true);
  const user = scanDirectory(getThemesDir(), false);

  // Built-in themes take priority — skip user themes with same id
  const builtInIds = new Set(builtIn.map((t) => t.id));
  const filtered = user.filter((t) => !builtInIds.has(t.id));

  cachedThemes = [...builtIn, ...filtered];
  console.log(`[Zeus Themes] Loaded ${cachedThemes.length} themes (${builtIn.length} built-in, ${filtered.length} user)`);
  return cachedThemes;
}

export function refreshThemes(): ThemeFile[] {
  return loadAllThemes();
}

export function getThemeMeta(): ThemeMeta[] {
  return cachedThemes.map(({ colors: _, ...meta }) => meta);
}

export function getThemeById(id: string): ThemeFile | null {
  return cachedThemes.find((t) => t.id === id) ?? null;
}
