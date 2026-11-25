/**
 * Locale parity (D-218): every key in the default catalogue `locales/en.json` must also be in
 * every other `locales/*.json`, and vice versa. This is a pure fact comparison shared by the
 * analyzer diagnostic and AI validator rule 13, so both report the same gaps in the same order.
 *
 * The default catalogue is English by contract (rule 13 already verifies keys against
 * `locales/en.json`); `config.i18n.defaultLocale` is deliberately not consulted, because a
 * project that switches it still ships English as the reference catalogue in the shipped apps.
 * A missing or malformed `en` catalogue yields no gaps: the analyzer already warns about the
 * malformed file and guessing a direction would be noise.
 */

/** The catalogue every other one is compared against (SPEC §9.3 rule 13). */
export const DEFAULT_LOCALE = "en";

export type LocaleParityDirection = "missing-from-secondary" | "missing-from-default";

/** One key present on one side of the parity contract only. */
export interface LocaleParityGap {
  readonly key: string;
  /** The secondary locale name (the catalogue file's basename, e.g. `"it"`). */
  readonly locale: string;
  readonly direction: LocaleParityDirection;
}

function sortedKeys(catalog: Readonly<Record<string, string>>): string[] {
  return Object.keys(catalog).toSorted((left, right) => left.localeCompare(right));
}

/**
 * Every parity gap, deterministically ordered: secondary locales by name, then the keys the
 * default catalogue has and the secondary one lacks, then the reverse direction.
 */
export function localeParityGaps(
  locales: Readonly<Record<string, Readonly<Record<string, string>>>>,
): readonly LocaleParityGap[] {
  const canonical = locales[DEFAULT_LOCALE];
  if (canonical === undefined) return [];
  const canonicalKeys = new Set(Object.keys(canonical));
  const gaps: LocaleParityGap[] = [];
  const secondary = Object.keys(locales)
    .filter((locale) => locale !== DEFAULT_LOCALE)
    .toSorted((left, right) => left.localeCompare(right));
  for (const locale of secondary) {
    const catalog = locales[locale];
    if (catalog === undefined) continue;
    const keys = new Set(Object.keys(catalog));
    for (const key of sortedKeys(canonical)) {
      if (!keys.has(key)) gaps.push({ key, locale, direction: "missing-from-secondary" });
    }
    for (const key of sortedKeys(catalog)) {
      if (!canonicalKeys.has(key)) gaps.push({ key, locale, direction: "missing-from-default" });
    }
  }
  return gaps;
}
