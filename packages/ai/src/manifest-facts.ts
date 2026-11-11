/**
 * Defensive reader for the live `/__facilis/manifest` payload (SPEC §6.2).
 *
 * Only two things still come from the manifest: the registered blocks (reviewed supply
 * chain, not a source fact) and a locale-catalogue fallback. Config, schema and routes are
 * read from @facilis.dev/analyze's source facts (D-092); the manifest is data from a running
 * app, not a trusted compiler output, so an unexpected shape yields fewer facts and never
 * an exception.
 */

import type { BlockFacts } from "./types.ts";

export interface ManifestFacts {
  readonly blocks: readonly BlockFacts[];
  readonly locales: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function factsFromBlocks(value: unknown): BlockFacts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.name === "string" ? [{ name: entry.name }] : [],
  );
}

/** Prefer the default locale, fall back to English, then to the first object catalogue. */
function factsFromCatalog(value: unknown, defaultLocale: string | null): Record<string, string> {
  if (!isRecord(value)) return {};
  const preferred = defaultLocale !== null && isRecord(value[defaultLocale]) ? defaultLocale : "en";
  const locale = isRecord(value[preferred])
    ? preferred
    : Object.keys(value).find((candidate) => isRecord(value[candidate]));
  const catalog = locale === undefined ? undefined : value[locale];
  if (!isRecord(catalog)) return {};
  const strings: Record<string, string> = {};
  for (const [key, text] of Object.entries(catalog)) {
    if (typeof text === "string") strings[key] = text;
  }
  return strings;
}

/** Read whatever the manifest is allowed to contribute; a broken payload yields zero facts. */
export function factsFromManifest(manifest: unknown): ManifestFacts {
  const root = isRecord(manifest) ? manifest : {};
  const i18n = isRecord(root.i18n) ? root.i18n : {};
  const defaultLocale = typeof i18n.defaultLocale === "string" ? i18n.defaultLocale : null;
  return {
    blocks: factsFromBlocks(root.blocks),
    locales: factsFromCatalog(i18n.catalogs, defaultLocale),
  };
}
