import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/i18n-db` — database i18n (D-057).
 *
 * The root entry is server-only (Drizzle + policy-scoped db): translated content columns and
 * the optional catalogue overlay (i18n_messages). The browser half, which registers the
 * overlay over the bundled catalogues, lives behind @facilis.dev/i18n-db/client.
 */
export const I18N_DB_MODULE: FrameworkModule = {
  id: "i18n-db",
  package: "@facilis.dev/i18n-db",
  summary:
    "Translated content fields (jsonb {locale: text}), locale resolution and the tenant-scoped database catalogue overlay.",
  entries: [
    {
      name: "translatedText",
      kind: "function",
      signature: "translatedText(name: string)",
      summary:
        "A translatable content field: NOT NULL jsonb holding { locale: text }; use it in db/schema.ts and let drizzle-kit generate the migration.",
      example:
        'export const todos = pgTable("todos", { title: translatedText("title"), /* ... */ });',
    },
    {
      name: "translationsSchema",
      kind: "constant",
      signature: "translationsSchema: z.ZodType<Translations>",
      summary:
        "Zod schema for admin/edit payloads: every key must be a structurally valid locale tag and every value a non-empty string.",
    },
    {
      name: "resolveTranslation",
      kind: "function",
      signature:
        'resolveTranslation(value: Translations | null | undefined, locale: string, fallbackLocale = "en"): string',
      summary:
        "Serves only one language: exact locale canonical match, then base language (it-CH → it), then the fallback locale, then the first non-empty value; tolerates malformed rows and never throws.",
    },
    {
      name: "resolveUserLocale",
      kind: "function",
      signature: "resolveUserLocale(options: ResolveUserLocaleOptions): string",
      summary:
        "Resolves the language a request is served in: saved preference, then Accept-Language q-order, then the default — each filtered by the supported list.",
    },
    {
      name: "parseAcceptLanguage",
      kind: "function",
      signature: "parseAcceptLanguage(header: string | null | undefined): string[]",
      summary:
        "Parses Accept-Language: q-ordered with stable ties, canonicalized, no wildcard and no q=0 entries.",
    },
    {
      name: "i18nMessages",
      kind: "constant",
      signature: "i18nMessages: PgTable (tenant_id, locale, key, value, updated_at)",
      summary:
        "The tenant-scoped catalogue overlay table; re-export it from db/schema.ts so the /api/i18n catalogue route and hydrateCatalogs have storage.",
    },
    {
      name: "loadCatalog",
      kind: "function",
      signature: "loadCatalog(db: PolicyScopedDatabase, locale: string): Promise<I18nCatalog>",
      summary:
        "Reads one locale through the caller's policy-scoped database; RLS restricts rows to app.tenant_id, so no tenant id is ever part of the query.",
    },
    {
      name: "loadCatalogs",
      kind: "function",
      signature:
        "loadCatalogs(db: PolicyScopedDatabase, locales: readonly string[]): Promise<I18nCatalogs>",
      summary:
        "Reads several locales in one round trip; a requested locale with no rows is an empty catalogue, so the route response keeps a stable shape.",
    },
    {
      name: "saveCatalog",
      kind: "function",
      signature:
        "saveCatalog(db: PolicyScopedDatabase, locale: string, messages: I18nCatalog): Promise<void>",
      summary:
        "Upserts every key of one locale (seeding/admin): the tenant comes from the insert default, and a re-save overwrites the old text.",
    },
    {
      name: "hydrateCatalogs",
      kind: "function",
      signature: "hydrateCatalogs(options: HydrateCatalogsOptions): Promise<void>",
      summary:
        "Client entry (@facilis.dev/i18n-db/client): fetches the DB overlay, merges it over the bundled JSON per key, registers every locale and sets the default; throws on failure, never logs.",
    },
  ],
};
