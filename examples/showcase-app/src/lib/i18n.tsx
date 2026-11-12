/**
 * Catalogue boot and locale state for the static showcase.
 *
 * This template has no backend and no @facilis.dev/* dependency, so the small runtime lives
 * here: flat JSON catalogues, a persisted locale and a t() that never throws. Every user-facing
 * string in the site goes through t() with its key in locales/en.json and locales/it.json.
 */

import { useSyncExternalStore } from "react";
import en from "../../locales/en.json";
import it from "../../locales/it.json";

export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const LOCALE_STORAGE_KEY = "facilis.showcase.locale";
const CATALOGS: Readonly<Record<Locale, Record<string, string>>> = { en, it };
const PLACEHOLDER = /\{([a-zA-Z0-9_.-]+)\}/g;

type Params = Readonly<Record<string, string | number>>;

let activeLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function interpolate(template: string, params: Params): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    // Unknown placeholders stay verbatim: a typo in params should not erase text.
    return value === undefined ? match : String(value);
  });
}

/**
 * Translates a flat key from the active catalogue. A missing key falls back to the default
 * catalogue and then to the key itself, so a catalogue gap never crashes a page.
 */
export function t(key: string, params?: Params): string {
  const template = CATALOGS[activeLocale][key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  return params === undefined ? template : interpolate(template, params);
}

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
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  writeStoredLocale(locale);
  for (const listener of listeners) listener();
}

/** Applies the stored or browser-preferred locale before the first render. */
export function initI18n(): void {
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
