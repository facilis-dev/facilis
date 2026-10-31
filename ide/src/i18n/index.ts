// The IDE's i18n layer.
//
// The runtime is @facilis/core's (flat keys, {placeholder} interpolation, a
// missing key returns the key and is reported once) — the IDE registers its own
// catalogues and owns the locale choice. The package's i18n subpath is imported so
// the static SPA bundle does not pull the framework's zod/db modules.
import {
  getDefaultLocale,
  registerCatalog,
  setDefaultLocale,
  setMissingTranslationHandler,
  t as translate,
  type I18nParams,
} from "@facilis/core/i18n";
import { en } from "./en";
import { it } from "./it";

export type MessageKey = keyof typeof en;
export type Locale = "en" | "it";

export const LOCALES: readonly Locale[] = ["en", "it"];

const STORAGE_KEY = "vv.locale";

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "it";
}

/**
 * The initial locale: the user's saved choice, else the browser's language, else
 * English. Pure so the ugly parts (storage, navigator) stay at the edges.
 */
export function detectLocale(stored: string | null, navLang: string | undefined): Locale {
  if (isLocale(stored)) return stored;
  return (navLang ?? "").toLowerCase().startsWith("it") ? "it" : "en";
}

function apply(locale: Locale): void {
  setDefaultLocale(locale);
  // The document language drives hyphenation/spellcheck and screen readers.
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

/** Register both catalogues and select the initial locale. Call once, before render. */
export function initI18n(): Locale {
  registerCatalog("en", en);
  // A partial translation falls back to English key by key.
  registerCatalog("it", { ...en, ...it });
  if (import.meta.env.DEV) {
    setMissingTranslationHandler((key, locale) =>
      console.warn("[i18n] missing " + locale + " key: " + key),
    );
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage disabled — fall back to the browser language */
  }
  const locale = detectLocale(
    stored,
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
  apply(locale);
  return locale;
}

export function getLocale(): Locale {
  return getDefaultLocale() as Locale;
}

/** Switch locale and remember the choice. Re-render is the caller's job. */
export function setLocale(locale: Locale): void {
  apply(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage disabled — the choice lasts for this page only */
  }
}

/** Translate a registered IDE key. Unknown keys return themselves; never throws. */
export function t(key: MessageKey, params?: I18nParams): string {
  return translate(key, params);
}
