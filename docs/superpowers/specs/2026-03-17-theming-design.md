# Zeus Theming System — Design Spec

## Overview

Add a file-based theming system to Zeus. Each theme is a portable JSON file defining all CSS color tokens. Themes sync across all connected clients via the existing WebSocket settings channel. Users share themes by copying a single `.json` file.

## Theme File Format

Each theme is a self-contained JSON file:

```json
{
  "id": "nord",
  "name": "Nord",
  "author": "Arctic Ice Studio",
  "type": "dark",
  "colors": {
    "bg": "#2e3440",
    "bg-card": "#3b4252",
    "bg-surface": "#434c5e",
    "bg-elevated": "#4c566a",
    "border": "#4c566a",
    "border-dim": "#434c5e",
    "text-primary": "#eceff4",
    "text-secondary": "#d8dee9",
    "text-muted": "#81a1c1",
    "text-dim": "#6d8eb5",
    "text-faint": "#5e81ac",
    "text-ghost": "#4c566a",
    "accent": "#a3be8c",
    "accent-bg": "#2e3440",
    "accent-border": "rgba(163, 190, 140, 0.25)",
    "accent-foreground": "#eceff4",
    "danger": "#bf616a",
    "danger-bg": "#3b2c2e",
    "danger-border": "rgba(191, 97, 106, 0.25)",
    "warn": "#ebcb8b",
    "warn-bg": "#3b3526",
    "warn-border": "rgba(235, 203, 139, 0.25)",
    "info": "#81a1c1",
    "info-bg": "#2e3440",
    "info-border": "rgba(129, 161, 193, 0.25)",
    "background": "#2e3440",
    "foreground": "#d8dee9",
    "card": "#3b4252",
    "card-foreground": "#d8dee9",
    "popover": "#3b4252",
    "popover-foreground": "#d8dee9",
    "primary": "#81a1c1",
    "primary-foreground": "#eceff4",
    "secondary": "#434c5e",
    "secondary-foreground": "#d8dee9",
    "muted": "#434c5e",
    "muted-foreground": "#81a1c1",
    "destructive": "#bf616a",
    "input": "#4c566a",
    "ring": "#81a1c1"
  }
}
```

**Keys map 1:1** to the existing `--color-*` tokens in `styles.css`. No new tokens are introduced.

**Non-color tokens** (`--radius-*`, `--font-*`) are NOT theme-able — they remain fixed in the `@theme` block.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (kebab-case, e.g., `"zeus-dark"`) |
| `name` | `string` | Display name |
| `type` | `"dark" \| "light"` | Controls Tailwind `dark` class on `<html>` |
| `colors` | `Record<string, string>` | CSS color values keyed by token name (without `--color-` prefix) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Theme author for attribution |

### Color Value Validation

Theme files are validated at load time. Color values must match one of:
- Hex: `#RGB`, `#RRGGBB`, `#RRGGBBAA`
- RGB/RGBA: `rgb(...)` / `rgba(...)`
- HSL/HSLA: `hsl(...)` / `hsla(...)`

Invalid color values cause the theme file to be skipped with a warning log.

## Architecture

```
Host (Electron Main)                     Client (Renderer)
┌──────────────────────┐                 ┌─────────────────────┐
│ Theme Sources:       │                 │ useZeusStore         │
│  ├ built-in themes/  │  settings_update│  ├ themes: ThemeMeta[]│
│  │  (bundled JSON)   │ ──────────────> │  ├ activeThemeId     │
│  └ userData/themes/  │                 │  ├ activeThemeColors │
│    (user custom)     │  set_theme      │  └ applyTheme()      │
│                      │ <────────────── │    (sets CSS vars on │
│ settings.ts          │                 │     :root + dark cls)│
│  ├ reads theme files │  theme_colors   │                      │
│  ├ validates JSON    │ ──────────────> │ Settings Panel       │
│  └ persists choice   │                 │  └ ThemePicker UI    │
│    (activeThemeId)   │                 │    (grid of cards)   │
│                      │                 │                      │
│ zeus-settings.json   │                 │                      │
│  └ activeThemeId     │                 │                      │
└──────────────────────┘                 └─────────────────────┘
```

### Theme File Locations

1. **Built-in** — `src/main/themes/*.json` (bundled with the app, read-only, copied to `resources/` at build)
2. **User custom** — `{userData}/zeus-themes/*.json` (user drops theme files here)

Both directories are scanned and merged. Built-in themes cannot be overridden by user themes with the same `id`.

### CSS Override Mechanism

Tailwind v4's `@theme` block registers CSS custom properties on `:root` in the stylesheet. Utility classes like `bg-bg` compile to `background-color: var(--color-bg)`. Setting `document.documentElement.style.setProperty('--color-bg', newValue)` adds an inline style on the `<html>` element, which has higher cascade priority than the stylesheet `:root` block. This means all Tailwind utility classes and `var()` references pick up the override automatically. No rebuild needed.

## Type Changes

### `src/shared/types.ts`

```typescript
/** Metadata sent to clients (no colors — keeps payloads small) */
export interface ThemeMeta {
  id: string;
  name: string;
  author?: string;
  type: 'dark' | 'light';
  builtIn: boolean;  // computed at load time based on source directory, not from JSON
}

/** Full theme with color map (sent when a theme is applied) */
export interface ThemeFile extends ThemeMeta {
  colors: Record<string, string>;
}

/** Extend ZeusSettings with theme fields */
export interface ZeusSettings {
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  activeThemeId: string;     // NEW — defaults to "zeus-dark"
  themes: ThemeMeta[];       // NEW — computed from disk, not persisted
}

/** Extend SettingsPayload with theme message types */
export type SettingsPayload =
  | { type: 'get_settings' }
  | { type: 'settings_update'; settings: ZeusSettings }
  | { type: 'add_project'; name: string; path: string; createDir?: boolean }
  | { type: 'remove_project'; id: string }
  | { type: 'update_defaults'; defaults: Partial<ClaudeDefaults> }
  | { type: 'set_last_used_project'; id: string | null }
  | { type: 'settings_error'; message: string }
  // Theme payloads:
  | { type: 'set_theme'; themeId: string }                // Client → Host
  | { type: 'get_theme_colors'; themeId: string }         // Client → Host
  | { type: 'theme_colors'; theme: ThemeFile }             // Host → Client
  | { type: 'refresh_themes' }                             // Client → Host (re-scan dirs)
  | { type: 'open_themes_folder' };                        // Client → Host (open in Finder)
```

### `src/main/services/settings.ts`

```typescript
/** Extend SettingsOnDisk */
interface SettingsOnDisk {
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  activeThemeId: string;  // NEW — defaults to "zeus-dark"
}

const DEFAULT_SETTINGS: SettingsOnDisk = {
  claudeDefaults: { ... },
  lastUsedProjectId: null,
  activeThemeId: 'zeus-dark',  // NEW
};
```

The `getSettings()` function merges `SettingsOnDisk` + SQLite projects + `getThemeMeta()` from the theme service into a full `ZeusSettings` response. The `themes` array is computed on every call (not persisted).

## Data Flow

### Startup (No FOUC)

1. Host reads all `.json` files from built-in + user theme directories
2. Validates each: must have `id`, `name`, `type`, and valid `colors` object
3. Invalid files are logged and skipped
4. On `get_settings`, host sends `settings_update` with full `ZeusSettings` (includes `themes[]` and `activeThemeId`)
5. **Immediately after** `settings_update`, host also sends `theme_colors` with the active theme's full color map
6. Renderer applies colors to `:root` on receiving `theme_colors`

This eliminates FOUC — the active theme colors arrive in the same batch as settings, no second request needed.

### Theme Switch

1. User clicks a theme card in Settings panel
2. Client sends `{ type: 'set_theme', themeId: 'nord' }` on settings channel
3. Host validates theme exists, persists `activeThemeId` to disk
4. Host broadcasts `settings_update` (with new `activeThemeId`) + `theme_colors` (full color map) to ALL clients
5. Each client applies the new theme instantly

### Custom Theme Addition

1. User drops a `.json` file into `{userData}/zeus-themes/`
2. User clicks "Refresh" in theme picker
3. Client sends `{ type: 'refresh_themes' }` on settings channel
4. Host re-scans directories, broadcasts `settings_update` with updated `themes[]`

### Open Themes Folder

1. User clicks "Open Folder" in theme picker
2. Client sends `{ type: 'open_themes_folder' }` on settings channel
3. Host calls `shell.openPath(getThemesDir())` via Electron's `shell` module

## Theme Application (Renderer)

Applied inside the Zustand store's settings channel handler — no separate React component needed:

```typescript
// In useZeusStore.ts — settings channel handler
case 'theme_colors': {
  const theme = payload.theme as ThemeFile;
  const root = document.documentElement;

  // Apply all color tokens as CSS custom properties
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }

  // Toggle dark/light class for Tailwind's @custom-variant dark
  if (theme.type === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  set({ activeThemeColors: theme.colors });
  break;
}
```

### Store State Additions

```typescript
// In ZeusState interface
themes: ThemeMeta[];                    // from settings_update
activeThemeId: string;                  // from settings_update
activeThemeColors: Record<string, string> | null;  // from theme_colors

// Actions
setTheme: (themeId: string) => void;    // sends set_theme via WS
refreshThemes: () => void;              // sends refresh_themes via WS
openThemesFolder: () => void;           // sends open_themes_folder via WS
```

## Host-Side: Theme Service

New file: `src/main/services/themes.ts`

```typescript
// Responsibilities:
// - Scan built-in and user theme directories
// - Read and validate theme JSON files (including color format validation)
// - Return ThemeMeta[] (list) or ThemeFile (full colors)
// - Cache parsed themes in memory
// - Mark builtIn: true/false based on source directory

export function loadAllThemes(): ThemeFile[]
export function getThemeMeta(): ThemeMeta[]
export function getThemeById(id: string): ThemeFile | null
export function getThemesDir(): string  // userData/zeus-themes path
export function refreshThemes(): void   // re-scan directories, update cache
```

### Integration with `settings.ts`

- `activeThemeId` added to `SettingsOnDisk` (defaults to `"zeus-dark"`)
- `getSettings()` merges `themes: getThemeMeta()` and `activeThemeId` into the `ZeusSettings` response
- New function: `setActiveTheme(themeId: string)` — persists to disk

### Integration with `websocket.ts`

New cases in `handleSettings()`:
- `set_theme` → validate theme exists, call `setActiveTheme()`, broadcast `settings_update` + `theme_colors`
- `get_theme_colors` → unicast full `ThemeFile` for requested theme
- `refresh_themes` → call `refreshThemes()`, broadcast `settings_update`
- `open_themes_folder` → call `shell.openPath(getThemesDir())`

On initial `get_settings`, also send `theme_colors` for the active theme immediately after `settings_update`.

## UI — Theme Picker

### Location

New "Appearance" section added to the **Settings** activity bar tab. Rendered below the existing `SessionSettingsPanel` content, separated by a section header.

### Component: `ThemePicker.tsx`

```
┌─ Appearance ──────────────────────┐
│ THEME                             │
│ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │██████│ │░░░░░░│ │▓▓▓▓▓▓│      │
│ │██████│ │░░░░░░│ │▓▓▓▓▓▓│      │
│ │ Dark │ │ Light│ │ Nord │      │
│ │  ✓   │ │      │ │      │      │
│ └──────┘ └──────┘ └──────┘      │
│ ┌──────┐ ┌──────┐               │
│ │▓▓▓▓▓▓│ │▓▓▓▓▓▓│               │
│ │▓▓▓▓▓▓│ │▓▓▓▓▓▓│               │
│ │Catpuc│ │Solrzd│               │
│ └──────┘ └──────┘               │
│                                   │
│ Custom themes: ~/Library/.../     │
│ [Open Folder] [Refresh]          │
└───────────────────────────────────┘
```

Each card shows:
- 4 color swatches (bg, accent, primary, text-primary) as a mini preview
- Theme name
- Checkmark on active theme
- "by {author}" subtitle if present
- Small "dark"/"light" badge

### Integration into `RightPanel.tsx`

The Settings tab content switches from just `<SessionSettingsPanel />` to a scrollable area containing both `<SessionSettingsPanel />` and `<ThemePicker />`. The ThemePicker appears after a section divider.

## Built-in Themes

Ship with 5 themes:

| ID | Name | Type | Accent |
|----|------|------|--------|
| `zeus-dark` | Zeus Dark | dark | `#22c55e` (green) |
| `zeus-light` | Zeus Light | light | `#2563eb` (blue) |
| `nord` | Nord | dark | `#a3be8c` (green) |
| `catppuccin-mocha` | Catppuccin Mocha | dark | `#cba6f7` (mauve) |
| `solarized-dark` | Solarized Dark | dark | `#859900` (green) |

Each ships as a JSON file in `src/main/themes/`.

## CSS Fixes Required

### Scrollbar

Current scrollbar uses hardcoded `rgba(255, 255, 255, ...)`. Must use theme-aware values:

```css
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-text-primary) 20%, transparent);
}
```

### Code Syntax Highlighting

The Prism `oneDark` theme in `Markdown.tsx` and `ClaudeView.tsx` uses hardcoded `#1a1a1a`. Update to use `var(--color-bg-surface)`.

### Monaco Editor Theme (DiffView.tsx)

`DiffView.tsx` registers a Monaco editor theme with hardcoded colors (`#0a0a0a`, `#e0e0e0`, `#1a1a1a`, etc.). These must be updated to read from the current theme colors. Since Monaco themes are registered imperatively (not via CSS), the diff view component needs to re-register the Monaco theme whenever `activeThemeColors` changes in the store.

### Shimmer Accent Animation

`.zeus-shimmer-accent` in `styles.css` has a hardcoded `#93c5fd` midpoint. Replace with:
```css
color-mix(in srgb, var(--color-primary) 60%, white)
```

### Glow Animations

The `zeus-attention-*` classes use hardcoded rgba colors. These reference semantic colors (accent, danger, warn) so they can stay as-is — the animation colors are close enough to the semantic tokens and changing them per-theme adds complexity without clear benefit.

## Migration

- Existing users get `activeThemeId: "zeus-dark"` as default
- The `@theme` block in `styles.css` remains as the CSS fallback (Zeus Dark values)
- No breaking changes to any component code — all components already use CSS variable classes
- `index.html` keeps `class="dark"` as the initial default; JS manages it at runtime

## Files Changed / Created

### New Files
- `src/main/services/themes.ts` — theme loading service
- `src/main/themes/zeus-dark.json` — default dark theme
- `src/main/themes/zeus-light.json` — light theme
- `src/main/themes/nord.json` — Nord theme
- `src/main/themes/catppuccin-mocha.json` — Catppuccin theme
- `src/main/themes/solarized-dark.json` — Solarized theme
- `src/renderer/src/components/ThemePicker.tsx` — theme picker UI component

### Modified Files
- `src/shared/types.ts` — add ThemeMeta, ThemeFile types; extend ZeusSettings and SettingsPayload
- `src/main/services/settings.ts` — add activeThemeId to SettingsOnDisk; extend getSettings()
- `src/main/services/websocket.ts` — handle set_theme, get_theme_colors, refresh_themes, open_themes_folder
- `src/renderer/src/stores/useZeusStore.ts` — add theme state, actions, and theme_colors handler with applyTheme logic
- `src/renderer/src/components/RightPanel.tsx` — integrate ThemePicker below SessionSettingsPanel
- `src/renderer/src/styles.css` — fix scrollbar, shimmer-accent hardcoded colors
- `src/renderer/src/components/Markdown.tsx` — use CSS variable for code theme bg
- `src/renderer/src/components/ClaudeView.tsx` — use CSS variable for code theme bg
- `src/renderer/src/components/DiffView.tsx` — re-register Monaco theme from active theme colors

## Out of Scope

- Theme editor UI (users edit JSON directly)
- Auto-generating themes from a single accent color
- Per-session themes (global only)
- Theme marketplace / remote fetching
- File watcher on user themes directory (manual refresh via button)
- Theming of non-color tokens (radius, fonts)
