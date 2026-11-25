/**
 * The raw database client modules (invariant 5, D-213): importing one outside
 * `@facilis.dev/db` builds a policy-free client and bypasses the handler's scoped `ctx.db`.
 *
 * The list is the modules `@facilis.dev/db` wraps (its PGlite and node-postgres drivers), not
 * the whole drizzle package: `drizzle-orm` operators and `drizzle-orm/pg-core` table builders
 * are the schema DSL every project needs. Shared by AI validator rule 9 and the handwritten
 * route gate so the two cannot drift.
 */

/** Drizzle's per-driver entrypoints: each one constructs or carries a raw client. */
const RAW_DRIVER =
  /^drizzle-orm\/(?:pglite|node-postgres|postgres-js|bun-sqlite|neon|vercel-postgres|aws-data-api|libsql|expo-sqlite|d1|op-sqlite|singlestore|tidb-serverless)$/;

/** Bare database drivers, imported directly by `@facilis.dev/db` only. */
const RAW_CLIENTS = new Set(["@electric-sql/pglite", "postgres", "pg"]);

/** True when the module specifier is a raw database client entrypoint (invariant 5). */
export function isRawDbImport(specifier: string): boolean {
  return RAW_DRIVER.test(specifier) || RAW_CLIENTS.has(specifier);
}
