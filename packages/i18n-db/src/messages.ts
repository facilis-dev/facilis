import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { tenantColumn, tenantIsolationPolicy } from "@facilis/db";

/**
 * Tenant-scoped catalogue overlay (D-049): one row per locale/key, unique per tenant.
 *
 * The JSON catalogues of `@facilis/core/i18n` stay the base; these rows win key by key.
 * A project re-exports this table from its `db/schema.ts` and lets drizzle-kit generate
 * the migration — the package intentionally ships no migration.
 */
export const i18nMessages = pgTable(
  "i18n_messages",
  {
    // The insert never names the tenant; the column takes it from the policy-scope GUC,
    // so raw SQL and app code are both held to the deployment tenant (D-040).
    tenantId: tenantColumn(),
    locale: text("locale").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.locale, table.key] }),
    tenantIsolationPolicy(),
    // A RESTRICTIVE policy only narrows the rows a permissive policy already allows; with
    // no permissive policy Postgres denies every row (D-008). This clause admits the scoped
    // tenant and the restrictive tenant_isolation AND's it down to that tenant's rows.
    pgPolicy("i18n_messages_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

export type I18nMessageRow = typeof i18nMessages.$inferSelect;
