import z from "zod";

// ─── Client → Server ───

export const SettingsGetSettings = z.object({
  type: z.literal("get_settings"),
});

export const SettingsAddProject = z.object({
  type: z.literal("add_project"),
  name: z.string(),
  path: z.string(),
  createDir: z.boolean().optional(),
});

export const SettingsRemoveProject = z.object({
  type: z.literal("remove_project"),
  id: z.string(),
});

export const SettingsUpdateDefaults = z.object({
  type: z.literal("update_defaults"),
  defaults: z.unknown(),
});

export const SettingsSetLastUsedProject = z.object({
  type: z.literal("set_last_used_project"),
  id: z.string(),
});

export const SettingsSetTheme = z.object({
  type: z.literal("set_theme"),
  themeId: z.string(),
});

export const SettingsGetThemeColors = z.object({
  type: z.literal("get_theme_colors"),
  themeId: z.string(),
});

export const SettingsRefreshThemes = z.object({
  type: z.literal("refresh_themes"),
});

export const SettingsOpenThemesFolder = z.object({
  type: z.literal("open_themes_folder"),
});

export const SettingsSetAutoTunnel = z.object({
  type: z.literal("set_auto_tunnel"),
  enabled: z.boolean(),
});

export const SettingsIncoming = z.discriminatedUnion("type", [
  SettingsGetSettings,
  SettingsAddProject,
  SettingsRemoveProject,
  SettingsUpdateDefaults,
  SettingsSetLastUsedProject,
  SettingsSetTheme,
  SettingsGetThemeColors,
  SettingsRefreshThemes,
  SettingsOpenThemesFolder,
  SettingsSetAutoTunnel,
]);
export type SettingsIncoming = z.infer<typeof SettingsIncoming>;

// ─── Server → Client ───

export const SettingsUpdate = z.object({
  type: z.literal("settings_update"),
  settings: z.unknown(),
});

export const SettingsThemeColors = z.object({
  type: z.literal("theme_colors"),
  theme: z.unknown(),
});

export const SettingsError = z.object({
  type: z.literal("settings_error"),
  message: z.string(),
});

export const SettingsOutgoing = z.discriminatedUnion("type", [
  SettingsUpdate,
  SettingsThemeColors,
  SettingsError,
]);
export type SettingsOutgoing = z.infer<typeof SettingsOutgoing>;
