/**
 * Catalogue boot and locale state (docs/FRONTEND.md section 6).
 *
 * The JSON catalogues are the single source of UI strings; the locale choice is persisted and
 * used to re-register the default catalogue, so every t() call follows the switch.
 */

import { useSyncExternalStore } from "react";
import { registerCatalog, setDefaultLocale, t as translate } from "@facilis/core/i18n";
import en from "../../locales/en.json";
import it from "../../locales/it.json";

export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const LOCALE_STORAGE_KEY = "facilis.locale";
const CATALOGS: Readonly<Record<Locale, Record<string, string>>> = { en, it };

let activeLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export { translate as t };

function matchSupported(tag: string, supported: readonly Locale[]): Locale | null {
  const normalized = tag.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const exact = supported.find((locale) => locale === normalized);
  if (exact !== undefined) return exact;
  const [base] = normalized.split("-");
  if (base === undefined) return null;
  return supported.find((locale) => locale === base) ?? null;
}

/**
 * Pure starting-locale resolution: a stored choice wins, then the first navigator language that
 * maps to a shipped catalogue (base language included), then the default locale.
 */
export function resolvePreferredLocale(
  stored: string | null,
  languages: readonly string[],
  supported: readonly Locale[] = LOCALES,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  const storedMatch = stored === null ? null : matchSupported(stored, supported);
  if (storedMatch !== null) return storedMatch;
  for (const language of languages) {
    const match = matchSupported(language, supported);
    if (match !== null) return match;
  }
  return fallback;
}

function readStoredLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persisting is best effort; the current page still uses the selected catalogue.
  }
}

function applyLocale(locale: Locale): void {
  activeLocale = locale;
  setDefaultLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  writeStoredLocale(locale);
  for (const listener of listeners) listener();
}

/**
 * Registers every catalogue and applies the user's starting locale before the first render.
 * A project with a database overlay (D-049) calls hydrateCatalogs here inside try/catch; the
 * reference app ships files only, so there is nothing to await.
 */
export function initI18n(): void {
  for (const locale of LOCALES) registerCatalog(locale, CATALOGS[locale]);
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  applyLocale(resolvePreferredLocale(readStoredLocale(), languages));
}

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  applyLocale(locale);
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): { locale: Locale; setLocale(locale: Locale): void } {
  const locale = useSyncExternalStore(subscribeToLocale, getLocale, () => DEFAULT_LOCALE);
  return { locale, setLocale };
}
