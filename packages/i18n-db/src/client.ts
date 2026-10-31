import { registerCatalog, setDefaultLocale } from "@facilis/core/i18n";

// The browser half also exposes the pure locale/translation helpers so a generated app can
// resolve content without a second import; the column helper and Drizzle stay server-only.
export {
  matchLocale,
  normalizeLocale,
  parseAcceptLanguage,
  resolveTranslation,
  resolveUserLocale,
  translationsSchema,
  type ResolveUserLocaleOptions,
  type Translations,
} from "./translations.ts";

export interface HydrateCatalogsOptions {
  /** Locales to load; every one is registered, even when the database has no rows for it. */
  readonly locales: readonly string[];
  /** Bundled JSON catalogues; DB rows win per key and missing rows fall back here. */
  readonly base?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Applied with `setDefaultLocale` after registration when given. */
  readonly defaultLocale?: string;
  /** Catalogue endpoint; defaults to "/api/i18n". */
  readonly endpoint?: string;
}

const DEFAULT_ENDPOINT = "/api/i18n";

/**
 * Fetches the DB catalogue overlay, merges it over the bundled JSON per key and registers
 * every locale (D-049). Throws on a failed request, a network error or a malformed payload
 * so the caller can decide (the docs show the try/catch); it never logs.
 */
export async function hydrateCatalogs(options: HydrateCatalogsOptions): Promise<void> {
  const { locales, base, defaultLocale, endpoint = DEFAULT_ENDPOINT } = options;
  const remote = await fetchCatalogs(endpoint, locales);

  for (const locale of locales) {
    // Spreading a missing catalogue is a no-op, which is exactly the per-key fallback.
    registerCatalog(locale, { ...base?.[locale], ...remote[locale] });
  }
  if (defaultLocale !== undefined) setDefaultLocale(defaultLocale);
}

async function fetchCatalogs(
  endpoint: string,
  locales: readonly string[],
): Promise<Record<string, Record<string, string>>> {
  // The endpoint may already carry a query string; append rather than replace it.
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${endpoint}${separator}locales=${encodeURIComponent(locales.join(","))}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`i18n: catalogue request failed with HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("i18n: catalogue response is not valid JSON", { cause });
  }
  return validateCatalogs(payload);
}

/** Validates `{ "<locale>": { "<key>": "<value>" } }` by hand: the client has no zod. */
function validateCatalogs(payload: unknown): Record<string, Record<string, string>> {
  if (!isRecord(payload)) {
    throw new Error("i18n: catalogue response must be a JSON object");
  }

  const catalogs: Record<string, Record<string, string>> = {};
  for (const [locale, rawCatalog] of Object.entries(payload)) {
    if (!isRecord(rawCatalog)) {
      throw new Error(`i18n: catalogue for "${locale}" must be a JSON object`);
    }
    const catalog: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawCatalog)) {
      if (typeof value !== "string") {
        throw new Error(`i18n: message "${key}" for "${locale}" must be a string`);
      }
      catalog[key] = value;
    }
    catalogs[locale] = catalog;
  }
  return catalogs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
