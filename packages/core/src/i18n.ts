/**
 * Runtime i18n catalogue (decision O-001: flat keys).
 *
 * `t()` never throws and never logs: a missing translation returns the key and reports the
 * miss through an injectable collector, so the validator/Studio can surface it once instead
 * of every render (SPEC §4.1 `i18n-keys-registered`).
 */

export type I18nParams = Readonly<Record<string, string | number>>;
export type MissingTranslationHandler = (key: string, locale: string) => void;

const PLACEHOLDER = /\{([a-zA-Z0-9_.-]+)\}/g;

const catalogs = new Map<string, Readonly<Record<string, string>>>();
let defaultLocale = "en";
let onMissingTranslation: MissingTranslationHandler | null = null;

/** Registers (or replaces) the full catalogue for a locale. */
export function registerCatalog(locale: string, messages: Record<string, string>): void {
  if (locale.length === 0) throw new Error("registerCatalog: locale must be a non-empty string");
  catalogs.set(locale, { ...messages });
}

export function setDefaultLocale(locale: string): void {
  if (locale.length === 0) throw new Error("setDefaultLocale: locale must be a non-empty string");
  defaultLocale = locale;
}

export function getDefaultLocale(): string {
  return defaultLocale;
}

/** Injects the missing-key collector (e.g. a warning list); pass `null` to disable it. */
export function setMissingTranslationHandler(handler: MissingTranslationHandler | null): void {
  onMissingTranslation = handler;
}

function interpolate(template: string, params: I18nParams): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    // Unknown placeholders stay verbatim: a typo in params should not erase text.
    return value === undefined ? match : String(value);
  });
}

/**
 * Translates a flat key in the default locale.
 *
 * Missing keys return the key itself (and are reported to the collector) so a UI never
 * crashes on a catalogue gap; adding the key to `locales/<locale>.json` fixes it.
 */
export function t(key: string, params?: I18nParams): string {
  const template = catalogs.get(defaultLocale)?.[key];
  if (template === undefined) {
    onMissingTranslation?.(key, defaultLocale);
    return key;
  }
  return params === undefined ? template : interpolate(template, params);
}
