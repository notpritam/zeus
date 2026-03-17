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

## Architecture

```
Host (Electron Main)                     Client (Renderer)
┌──────────────────────┐                 ┌─────────────────────┐
│ Theme Sources:       │                 │ ThemeProvider        │
│  ├ built-in themes/  │  settings_update│  ├ receives themes[] │
│  │  (bundled JSON)   │ ──────────────> │  ├ applies colors    │
│  └ userData/themes/  │                 │  │  to :root style   │
│    (user custom)     │  set_theme      │  └ toggles dark/light│
│                      │ <────────────── │                      │
│ settings.ts          │                 │ Settings Panel       │
│  ├ reads theme files │                 │  └ Theme Picker UI   │
│  ├ validates JSON    │                 │    (grid of cards)   │
│  └ persists choice   │                 │                      │
│    (activeThemeId)   │                 │ Zustand Store        │
│                      │                 │  ├ themes: ThemeMeta[]│
│ zeus-settings.json   │                 │  ├ activeThemeId     │
│  └ activeThemeId     │                 │  └ activeThemeColors │
└──────────────────────┘                 └─────────────────────┘
```

### Theme File Locations

1. **Built-in** — `src/main/themes/*.json` (bundled with the app, read-only, copied to `resources/` at build)
2. **User custom** — `{userData}/zeus-themes/*.json` (user drops theme files here)

Both directories are scanned and merged. Built-in themes cannot be overridden by user themes with the same `id`.

## Type Changes

### `src/shared/types.ts`

```typescript
/** Metadata sent to clients (no colors — keeps payloads small) */
interface ThemeMeta {
  id: string;
  name: string;
  author?: string;
  type: 'dark' | 'light';
  builtIn: boolean;
}

/** Full theme with color map (sent when a theme is applied) */
interface ThemeFile extends ThemeMeta {
  colors: Record<string, string>;
}

/** Extend ZeusSettings */
interface ZeusSettings {
  savedProjects: SavedProject[];
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  activeThemeId: string;  // NEW — defaults to "zeus-dark"
}

/** New settings payload types */
// Client → Host:
//   { type: 'set_theme', themeId: string }
//   { type: 'get_theme_colors', themeId: string }
//
// Host → Client (inside settings_update):
//   settings.themes: ThemeMeta[]
//   settings.activeThemeId: string
//
// Host → Client (on theme apply):
//   { type: 'theme_colors', theme: ThemeFile }
```

## Data Flow

### Startup

1. Host reads all `.json` files from built-in + user theme directories
2. Validates each: must have `id`, `name`, `type`, and `colors` object
3. Invalid files are logged and skipped
4. On `get_settings`, host sends `settings_update` with `themes: ThemeMeta[]` and `activeThemeId`
5. Client requests full colors for the active theme via `get_theme_colors`
6. Host responds with `theme_colors` containing full `ThemeFile`
7. Renderer applies colors to `:root`

### Theme Switch

1. User clicks a theme card in Settings panel
2. Client sends `{ type: 'set_theme', themeId: 'nord' }` on settings channel
3. Host validates theme exists, persists `activeThemeId` to disk
4. Host broadcasts `settings_update` (with new `activeThemeId`) + `theme_colors` (full color map) to ALL clients
5. Each client applies the new theme instantly

### Custom Theme Addition

1. User drops a `.json` file into `{userData}/zeus-themes/`
2. User clicks "Refresh" in theme picker (or restarts app)
3. Host re-scans directories, includes new theme in next `settings_update`

## Theme Application (Renderer)

```typescript
function applyTheme(theme: ThemeFile): void {
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
}
```

This overrides the `@theme` block defaults at runtime. No rebuild needed. The `@theme` values serve as the fallback (Zeus Dark).

## Host-Side: Theme Service

New file: `src/main/services/themes.ts`

```typescript
// Responsibilities:
// - Scan built-in and user theme directories
// - Read and validate theme JSON files
// - Return ThemeMeta[] (list) or ThemeFile (full colors)
// - Cache parsed themes in memory

export function loadAllThemes(): ThemeFile[]
export function getThemeMeta(): ThemeMeta[]
export function getThemeById(id: string): ThemeFile | null
export function getThemesDir(): string  // userData/zeus-themes path
```

### Integration with `settings.ts`

- `activeThemeId` added to `zeus-settings.json` (defaults to `"zeus-dark"`)
- `getSettings()` response extended with `themes: ThemeMeta[]` and `activeThemeId`

### Integration with `websocket.ts`

New payload types in `handleSettings()`:
- `set_theme` → validate, persist, broadcast settings_update + theme_colors
- `get_theme_colors` → respond with full ThemeFile for requested theme

## UI — Theme Picker

### Location

New "Appearance" section added to the **Settings** activity bar tab. This is a **global** setting (not per-session), so it appears as a separate section from the per-session `SessionSettingsPanel`.

The right panel's Settings tab will show both:
1. Session-specific settings (existing `SessionSettingsPanel`)
2. Appearance settings (new, below session settings or as a sub-tab)

### Theme Picker Design

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
│ [Open Folder]                     │
└───────────────────────────────────┘
```

Each card shows:
- 4 color swatches (bg, accent, primary, text-primary) as a mini preview
- Theme name
- Checkmark on active theme
- "by {author}" subtitle if present

### "Open Folder" Button

Opens the user themes directory in Finder/Explorer so users can drop in new theme files.

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

### Glow Animations

The `zeus-attention-*` classes use hardcoded rgba colors. These reference semantic colors (accent, danger, warn) so they can stay as-is — the animation colors are close enough to the semantic tokens and changing them per-theme adds complexity without clear benefit.

## Migration

- Existing users get `activeThemeId: "zeus-dark"` as default
- The `@theme` block in `styles.css` remains as the CSS fallback (Zeus Dark values)
- No breaking changes to any component code — all components already use CSS variable classes

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
- `src/shared/types.ts` — add ThemeMeta, ThemeFile types; extend ZeusSettings
- `src/main/services/settings.ts` — persist activeThemeId
- `src/main/services/websocket.ts` — handle set_theme, get_theme_colors payloads
- `src/renderer/src/stores/useZeusStore.ts` — add theme state + actions
- `src/renderer/src/components/RightPanel.tsx` — integrate ThemePicker into settings tab
- `src/renderer/src/styles.css` — fix scrollbar hardcoded colors
- `src/renderer/src/components/Markdown.tsx` — use CSS variable for code theme bg
- `src/renderer/src/components/ClaudeView.tsx` — use CSS variable for code theme bg
- `src/renderer/index.html` — remove hardcoded `class="dark"` (managed by JS)

## Out of Scope

- Theme editor UI (users edit JSON directly)
- Auto-generating themes from a single accent color
- Per-session themes (global only)
- Theme marketplace / remote fetching
- File watcher on user themes directory (manual refresh)
