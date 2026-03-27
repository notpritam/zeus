import z from "zod";
import { BusEvent } from "../event";

export const SettingsEvents = {
  Updated: BusEvent.define("settings.updated", z.object({ settings: z.unknown() })),
  Error: BusEvent.define("settings.error", z.object({ message: z.string() })),
  ThemeColors: BusEvent.define("settings.theme_colors", z.object({ theme: z.unknown() })),
};
