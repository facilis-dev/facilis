import { getTableConfig } from "drizzle-orm/pg-core";

import {
  applyStatements,
  createDb,
  ensureAppRole,
  policyCreateSql,
  type FacilisDb,
} from "@facilis/db";

import { i18nMessages } from "./messages.ts";

/**
 * Hand-written DDL matching ./messages.ts exactly (no drizzle-kit in tests): column names,
 * types, nullability, the GUC tenant default and the composite primary key.
 */
export const I18N_MESSAGES_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS i18n_messages (
    tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
    locale text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (tenant_id, locale, key)
  )`,
];

function policyStatements(): readonly string[] {
  const policies = getTableConfig(i18nMessages).policies.map((policy) =>
    policyCreateSql("i18n_messages", policy),
  );
  return ["ALTER TABLE i18n_messages ENABLE ROW LEVEL SECURITY", ...policies];
}

/** Boots an in-memory PGlite database with the catalogue table, its RLS policies and the app role. */
export async function createI18nTestDb(): Promise<FacilisDb> {
  const db = await createDb();
  await applyStatements(db, [...I18N_MESSAGES_TABLE_STATEMENTS, ...policyStatements()]);
  await ensureAppRole(db);
  return db;
}
