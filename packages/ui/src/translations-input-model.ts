/**
 * Pure model helpers for the TranslationsInput.
 *
 * The value shape is the same Readonly<Record<string, string>> used by @facilis/i18n-db, but
 * this package deliberately does not depend on that server package: the input only needs the
 * locale-to-text map and its own ordering rules.
 */

export type Translations = Readonly<Record<string, string>>;

/**
 * Tabs order: the configured locales first, then locales added in the UI, then any extra keys
 * already present in the value (sorted, so renders are deterministic).
 */
export function orderedLocales(
  value: Translations,
  locales: readonly string[],
  added: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const candidates = [...locales, ...added, ...Object.keys(value).toSorted()];

  for (const locale of candidates) {
    if (locale === "" || seen.has(locale)) continue;
    seen.add(locale);
    ordered.push(locale);
  }

  return ordered;
}

/** The default locale when present, otherwise the first ordered locale. */
export function defaultLocaleOf(
  ordered: readonly string[],
  defaultLocale?: string,
): string | undefined {
  if (defaultLocale !== undefined && ordered.includes(defaultLocale)) return defaultLocale;
  return ordered[0];
}

/** Keeps the active locale only while it exists; otherwise falls back to the default. */
export function resolveActiveLocale(
  active: string | undefined,
  ordered: readonly string[],
  defaultLocale?: string,
): string | undefined {
  if (active !== undefined && ordered.includes(active)) return active;
  return defaultLocaleOf(ordered, defaultLocale);
}

/** A locale is filled when its text is not only whitespace. */
export function isFilled(value: Translations, locale: string): boolean {
  return (value[locale] ?? "").trim() !== "";
}

/** Adds an empty entry for a locale without overwriting an existing translation. */
export function addLocale(value: Translations, locale: string): Translations {
  if (value[locale] !== undefined) return value;
  return { ...value, [locale]: "" };
}

/** Removes the locale entry; the tab list is component state, not part of the value shape. */
export function removeLocale(value: Translations, locale: string): Translations {
  const next = { ...value };
  delete next[locale];
  return next;
}

/** Locales offered by the add action: configured ones not yet present, in source order. */
export function addableLocales(
  available: readonly string[] | undefined,
  ordered: readonly string[],
): string[] {
  if (available === undefined) return [];
  const present = new Set(ordered);
  const seen = new Set<string>();

  return available.filter((locale) => {
    if (locale === "" || seen.has(locale) || present.has(locale)) return false;
    seen.add(locale);
    return true;
  });
}
