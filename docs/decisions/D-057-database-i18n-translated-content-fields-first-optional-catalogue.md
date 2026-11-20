# D-057 — Database i18n: translated content fields first, optional catalogue overlay
**Status:** accepted (2026-10-31; clarified by the product owner the same day)

"Translatable texts in the DB" means **a text stored in a row can carry several languages,
and the app serves only the user's language** — e.g. `{ en: "Todo", it: "Fare" }` on a
product/blog row. It is not a switch for the UI catalogue. `@facilis.dev/i18n-db` is an opt-in
package with two independent pieces; a project imports what it needs.

**A. Translated content fields (primary).**
- The stored shape is one JSONB column per translatable field, typed `Translations =
  Readonly<Record<string, string>>`; `translatedText("title")` is the Drizzle column helper,
  `translationsSchema` the Zod validator. The project schema re-exports it, drizzle-kit
  generates the migration (no migration ships with the package).
- Serving picks one language: `resolveTranslation(value, locale, fallbackLocale = "en")`
  tries exact locale → base language (`it-CH` → `it`) → fallback locale → first present
  value → `""`, never throws. The API maps rows through it, so the raw translations object
  only leaves the server if the API says so.
- The user's language is resolved too: `resolveUserLocale({ userLocale, acceptLanguage,
  supported, defaultLocale })` — saved preference first (the app persists it, e.g. on the
  profile), then `Accept-Language`, then the default; `parseAcceptLanguage`/`matchLocale` are
  exported for the same logic. Persistence is app-owned: the package is a pure resolver.
- Client and server share the pure helpers through the `/client` subpath, which must not pull
  drizzle.

**B. Catalogue overlay (optional).** UI message keys can be overridden per deployment through
the tenant-scoped `i18n_messages` table; the JSON catalogues of `@facilis.dev/core/i18n` stay the
base and a per-key fallback. The table needs the restrictive tenant policy **and** the
permissive tenant gate `i18n_messages_tenant_access` — a restrictive-only policy admits no
rows (D-008), the same reason `@facilis.dev/auth` has `users_tenant_access`. It ships a public
`loadCatalogs` and the project writes the explicit `defineAuthorizedHandler` route (the AST
pass cannot see a re-exported handler, so the route metadata would be lost). `hydrateCatalogs`
on the client merges the DB rows over the JSON per key and registers the catalogues.

**Consequences:** content translations become a normal typed column, not a framework mode;
the UI catalogue overlay is available but optional; both are disabled by not importing the
package.
