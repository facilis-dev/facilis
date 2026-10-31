/**
 * Lab preferences live here so main.tsx can apply them before the first paint (no flash of
 * another direction) and Lab keeps them in sync afterwards. Values are validated on read: a
 * stale or hand-edited localStorage entry must never put the lab in an unknown state.
 */

export const DIRECTIONS = ["a", "b", "c"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const SCREENS = ["auth", "dashboard", "detail", "settings"] as const;
export type ScreenId = (typeof SCREENS)[number];

export const THEMES = ["light", "dark"] as const;
export type LabTheme = (typeof THEMES)[number];

export type Preferences = {
  readonly direction: Direction;
  readonly screen: ScreenId;
  readonly theme: LabTheme;
};

const STORAGE_KEY = "facilis.design-lab.preferences";

const DEFAULTS: Preferences = { direction: "a", screen: "dashboard", theme: "light" };

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((entry) => entry === value);
}

/** Reads and validates the stored preference; anything unusable falls back to the defaults. */
export function readPreferences(): Preferences {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const record = parsed as Record<string, unknown>;
    const direction = record["direction"];
    const screen = record["screen"];
    const theme = record["theme"];
    return {
      direction: isOneOf(DIRECTIONS, direction) ? direction : DEFAULTS.direction,
      screen: isOneOf(SCREENS, screen) ? screen : DEFAULTS.screen,
      theme: isOneOf(THEMES, theme) ? theme : DEFAULTS.theme,
    };
  } catch {
    return DEFAULTS;
  }
}

export function writePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
}

/** The data attributes both theme.css and directions.css key off. */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  root.dataset["direction"] = preferences.direction;
  root.dataset["theme"] = preferences.theme;
}
