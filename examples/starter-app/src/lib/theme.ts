/**
 * Theme selection (docs/FRONTEND.md section 5).
 *
 * A theme is just which complete variable set theme.css applies, so the app only persists the
 * choice and writes data-theme on <html>; no component knows a colour (D-055).
 */

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "facilis.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
let activeTheme: Theme | null = null;

/** Pure resolution order: an explicit stored value, then the OS preference, then light. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

function readStoredTheme(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): fall back to the OS.
    return null;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persisting is best effort; the in-memory theme still applies for this page.
  }
}

function systemPrefersDark(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia(DARK_QUERY).matches;
}

function current(): Theme {
  activeTheme ??= resolveTheme(readStoredTheme(), systemPrefersDark());
  return activeTheme;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyTheme(theme: Theme, persist: boolean): void {
  activeTheme = theme;
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
  if (persist) writeStoredTheme(theme);
  for (const listener of listeners) listener();
}

/** Applies the starting theme before the first render: stored -> OS -> light. */
export function initTheme(): void {
  applyTheme(resolveTheme(readStoredTheme(), systemPrefersDark()), false);
}

/** Applies and persists an explicit theme. */
export function setTheme(theme: Theme): void {
  applyTheme(theme, true);
}

export function toggleTheme(): void {
  setTheme(current() === "dark" ? "light" : "dark");
}

export function getTheme(): Theme {
  return current();
}

/** Subscribes to the theme store so every toggle re-renders the controls. */
export function useTheme(): { theme: Theme; setTheme(theme: Theme): void; toggle(): void } {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light" as Theme);
  return { theme, setTheme, toggle: toggleTheme };
}
