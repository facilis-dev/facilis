import { inArray, sql } from "drizzle-orm";
import type { PolicyScopedDatabase } from "@facilis.dev/db";
import { z } from "zod";

import { i18nMessages } from "./messages.ts";

/** A flat key/value catalogue for one locale (O-001: flat keys). */
export type I18nCatalog = Record<string, string>;

/** Every catalogue for the requested locales, each keyed by message key. */
export type I18nCatalogs = Record<string, I18nCatalog>;

/**
 * Query schema the project route passes to `defineAuthorizedHandler`: `?locales=en,it`,
 * default "en". It is exported (not wrapped in a handler) so the route's config literal is
 * visible to the Nitro AST metadata pass (security invariant 2).
 */
export const catalogQuery = z.object({
  locales: z.string().default("en"),
});

/** `"en, it ,en"` -> `["en","it"]`; a blank list falls back to the contract default. */
export function parseCatalogLocales(raw: string): string[] {
  const locales = raw
    .split(",")
    .map((locale) => locale.trim())
    .filter((locale) => locale.length > 0);
  return locales.length === 0 ? ["en"] : [...new Set(locales)];
}

/**
 * Reads one locale through the caller's policy-scoped database. RLS restricts the rows to
 * `app.tenant_id`, so no tenant id is ever part of the query.
 */
export async function loadCatalog(db: PolicyScopedDatabase, locale: string): Promise<I18nCatalog> {
  const rows = await db
    .select({ key: i18nMessages.key, value: i18nMessages.value })
    .from(i18nMessages)
    .where(sql`${i18nMessages.locale} = ${locale}`)
    .orderBy(i18nMessages.key);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * Reads several locales in one round trip. Requested locales with no rows still appear as
 * empty catalogues so the route response has a stable shape.
 */
export async function loadCatalogs(
  db: PolicyScopedDatabase,
  locales: readonly string[],
): Promise<I18nCatalogs> {
  const catalogs: I18nCatalogs = Object.fromEntries(locales.map((locale) => [locale, {}]));
  if (locales.length === 0) return catalogs;

  const rows = await db
    .select({
      locale: i18nMessages.locale,
      key: i18nMessages.key,
      value: i18nMessages.value,
    })
    .from(i18nMessages)
    .where(inArray(i18nMessages.locale, [...locales]))
    .orderBy(i18nMessages.locale, i18nMessages.key);

  for (const row of rows) {
    const catalog = catalogs[row.locale];
    // inArray() guarantees this, but the record is indexed so keep the narrowing explicit.
    if (catalog === undefined) continue;
    catalog[row.key] = row.value;
  }
  return catalogs;
}

/**
 * Upserts every key of one locale (seeding/admin). The tenant comes from the insert default,
 * i.e. the policy-scope GUC, and `excluded.value` makes a re-save overwrite the old text.
 */
export async function saveCatalog(
  db: PolicyScopedDatabase,
  locale: string,
  messages: I18nCatalog,
): Promise<void> {
  const rows = Object.entries(messages).map(([key, value]) => ({ locale, key, value }));
  if (rows.length === 0) return;

  await db
    .insert(i18nMessages)
    .values(rows)
    .onConflictDoUpdate({
      target: [i18nMessages.tenantId, i18nMessages.locale, i18nMessages.key],
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
}
