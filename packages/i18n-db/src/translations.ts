import { z } from "zod";

/**
 * A text stored as a map of locale tag -> translated string, e.g.
 * `{ en: "Todo", it: "Da fare" }`. The raw value is what the database stores and what
 * admin/edit APIs accept; serving maps a row through `resolveTranslation`.
 */
export type Translations = Readonly<Record<string, string>>;

/**
 * Validates admin/edit payloads: every key must be a structurally valid locale tag and
 * every value a non-empty string. Keys stay verbatim; matching normalizes them later, so
 * `{ "IT": "Ciao" }` is stored as written but still served for `it`.
 */
export const translationsSchema: z.ZodType<Translations> = z
  .record(z.string(), z.string().min(1))
  .superRefine((value, ctx) => {
    for (const tag of Object.keys(value)) {
      if (normalizeLocale(tag) === null) {
        ctx.addIssue({
          code: "custom",
          message: `"${tag}" is not a valid locale tag`,
          path: [tag],
        });
      }
    }
  });

/** Intl-canonical form of a locale tag (`it-ch` -> `it-CH`), or null when it is invalid. */
export function normalizeLocale(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag.trim());
    return canonical ?? null;
  } catch {
    // Intl throws RangeError for malformed tags; invalid input is a value, not a crash.
    return null;
  }
}

/**
 * Picks the supported tag matching `locale`: exact canonical match, then its base language
 * (`it-CH` -> `it`), then any supported variant of that language. `fallback` is returned
 * when the tag is invalid or unsupported, so callers always get a usable locale.
 */
export function matchLocale(
  locale: string | undefined,
  supported: readonly string[],
  fallback: string,
): string {
  return findSupportedLocale(locale, supported) ?? fallback;
}

/** Parses Accept-Language: q-ordered (stable ties), canonicalized, no wildcard, no q=0. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (header === null || header === undefined || header.trim() === "") return [];

  const ranked: { tag: string; q: number; index: number }[] = [];
  header.split(",").forEach((part, index) => {
    const [rawTag, ...parameters] = part.split(";");
    const tag = rawTag?.trim() ?? "";
    // "*" means "anything else": it cannot resolve to a concrete language.
    if (tag === "" || tag === "*") return;

    let q = 1;
    for (const parameter of parameters) {
      const [name, rawValue] = parameter.split("=");
      if (name?.trim().toLowerCase() !== "q") continue;
      const parsed = Number.parseFloat(rawValue ?? "");
      q = Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 0), 1);
    }
    if (q <= 0) return;

    const normalized = normalizeLocale(tag);
    if (normalized === null) return;
    ranked.push({ tag: normalized, q, index });
  });

  const ordered = ranked
    .toSorted((left, right) => right.q - left.q || left.index - right.index)
    .map((entry) => entry.tag);
  return ordered.filter((tag, index) => ordered.indexOf(tag) === index);
}

export interface ResolveUserLocaleOptions {
  /** Saved preference (e.g. a profile column); wins over the request header. */
  readonly userLocale?: string | null;
  /** Raw Accept-Language header; second in precedence. */
  readonly acceptLanguage?: string | null;
  /** Application locales to filter candidates through; omitted/empty means no filter. */
  readonly supported?: readonly string[];
  /** Last resort; defaults to "en". */
  readonly defaultLocale?: string;
}

/**
 * Resolves the language a request should be served in: saved preference, then
 * Accept-Language tags in q-order, then the default — each filtered by `supported`.
 * Storing the preference is the app's job; this only resolves it.
 */
export function resolveUserLocale(options: ResolveUserLocaleOptions): string {
  const { userLocale, acceptLanguage, supported, defaultLocale = "en" } = options;
  const candidates = supported !== undefined && supported.length > 0 ? supported : null;

  for (const tag of [userLocale ?? undefined, ...parseAcceptLanguage(acceptLanguage)]) {
    if (tag === undefined) continue;
    const resolved =
      candidates === null
        ? (normalizeLocale(tag) ?? undefined)
        : findSupportedLocale(tag, candidates);
    if (resolved !== undefined) return resolved;
  }

  return candidates === null
    ? (normalizeLocale(defaultLocale) ?? defaultLocale)
    : (findSupportedLocale(defaultLocale, candidates) ?? defaultLocale);
}

/**
 * Serves only one language: exact locale, then its base language (`it-CH` -> `it`), then
 * `fallbackLocale`, then the first non-empty value, else "". Tolerates null/malformed row
 * data (it can predate the schema) and never throws.
 */
export function resolveTranslation(
  value: Translations | null | undefined,
  locale: string,
  fallbackLocale = "en",
): string {
  const source: unknown = value;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return "";

  const entries: [string, string][] = [];
  for (const [key, rawValue] of Object.entries(source)) {
    if (typeof rawValue === "string") entries.push([key, rawValue]);
  }

  const exact = lookupLocale(entries, locale);
  if (exact !== undefined) return exact;

  const normalized = normalizeLocale(locale);
  const base = normalized === null ? undefined : lookupLocale(entries, baseLanguage(normalized));
  if (base !== undefined) return base;

  const fallback = lookupLocale(entries, fallbackLocale);
  if (fallback !== undefined) return fallback;

  return entries.find(([, text]) => text.length > 0)?.[1] ?? "";
}

function findSupportedLocale(
  locale: string | null | undefined,
  supported: readonly string[],
): string | undefined {
  if (locale === null || locale === undefined) return undefined;
  const normalized = normalizeLocale(locale);
  if (normalized === null) return undefined;
  const base = baseLanguage(normalized);

  const variants = supported.map((tag) => ({ tag, normalized: normalizeLocale(tag) }));
  const exact = variants.find((entry) => entry.normalized === normalized);
  if (exact !== undefined) return exact.tag;
  const baseExact = variants.find((entry) => entry.normalized === base);
  if (baseExact !== undefined) return baseExact.tag;
  return variants.find((entry) => entry.normalized?.startsWith(`${base}-`))?.tag;
}

function lookupLocale(entries: readonly [string, string][], tag: string): string | undefined {
  const normalized = normalizeLocale(tag);
  if (normalized === null) return undefined;
  for (const [key, text] of entries) {
    // Empty values are treated as absent so the fallback chain can still serve something.
    if (text.length > 0 && normalizeLocale(key) === normalized) return text;
  }
  return undefined;
}

function baseLanguage(normalized: string): string {
  return normalized.split("-")[0] ?? normalized;
}
