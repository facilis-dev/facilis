// The theme registry: each entry maps a next-themes name to the data-theme
// attribute written on <html>, the appearance Monaco/xterm should follow, and the
// palette label. Adding a theme = an entry here plus a matching
// [data-theme="…"] block in index.css — no component changes, because components
// only ever name roles.
import type { MessageKey } from "./i18n";

export type Appearance = "light" | "dark";

export interface UiThemeSpec {
  /** The data-theme value next-themes writes on <html>. */
  attribute: string;
  /** Which editor/terminal appearance this UI theme uses. */
  appearance: Appearance;
  /** Palette label, from the IDE's catalogue. */
  labelKey: MessageKey;
}

export const UI_THEMES = {
  light: { attribute: "facilis-light", appearance: "light", labelKey: "theme.light" },
  dark: { attribute: "facilis-dark", appearance: "dark", labelKey: "theme.dark" },
} as const satisfies Record<string, UiThemeSpec>;

export type ThemeName = keyof typeof UI_THEMES;
export const THEME_NAMES = Object.keys(UI_THEMES) as ThemeName[];

/** next-themes `value`: theme name → data-theme attribute. */
export const THEME_ATTRIBUTES: Record<ThemeName, string> = Object.fromEntries(
  THEME_NAMES.map((name) => [name, UI_THEMES[name].attribute]),
) as Record<ThemeName, string>;

/** The appearance a resolved next-themes selection maps to. */
export function appearanceOf(
  theme: string | undefined,
  resolved: string | undefined,
  system: string | undefined,
): Appearance {
  if (theme === "system" || resolved === "system") return system === "dark" ? "dark" : "light";
  const name = resolved ?? theme ?? "";
  const spec = (UI_THEMES as Record<string, UiThemeSpec>)[name];
  return spec?.appearance ?? (name === "dark" ? "dark" : "light");
}

/** The appearance for a data-theme value (the pre-paint script's output). */
export function appearanceOfAttribute(attribute: string | null | undefined): Appearance {
  for (const spec of Object.values(UI_THEMES))
    if (spec.attribute === attribute) return spec.appearance;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The appearance already applied to this document (the pre-paint script's output). */
export function appearanceFromDocument(): Appearance {
  if (typeof document === "undefined") return "light";
  return appearanceOfAttribute(document.documentElement.getAttribute("data-theme"));
}
