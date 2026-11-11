/**
 * `@facilis.dev/i18n-db` — database i18n for generated projects: translated content fields
 * (a typed `jsonb` column + locale resolution) and the optional database catalogue overlay.
 *
 * The root entry point is server-only (Drizzle + policy-scoped DB). The browser half lives
 * behind the `@facilis.dev/i18n-db/client` subpath so a client bundle never pulls drizzle.
 */

export { translatedText } from "./columns.ts";
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
export { i18nMessages, type I18nMessageRow } from "./messages.ts";
export {
  catalogQuery,
  loadCatalog,
  loadCatalogs,
  parseCatalogLocales,
  saveCatalog,
  type I18nCatalog,
  type I18nCatalogs,
} from "./catalog.ts";
