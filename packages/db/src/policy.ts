import { sql } from "drizzle-orm";

import type { FacilisDb, PgDatabaseLike } from "./client.ts";

/** Non-superuser role used for policy-scoped work; RLS is bypassed by superusers (D-008). */
export const APP_ROLE = "facilis_app";

/** Values exported to Postgres GUCs for one policy-scoped operation (contract §4.2). */
export interface PolicyScope {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly roles?: readonly string[];
}

/** Transaction handed to `runWithPolicyScope` callbacks. */
export type PolicyScopedTransaction = Parameters<Parameters<PgDatabaseLike["transaction"]>[0]>[0];

/** Drizzle database or transaction accepted by every scoped query helper. */
export type PolicyScopedDatabase = PgDatabaseLike | PolicyScopedTransaction;

/** Thrown when the app role has not been bootstrapped yet (`ensureAppRole`). */
export class AppRoleUnavailableError extends Error {
  readonly code = "app_role_unavailable";

  constructor(cause: unknown) {
    super(`App role "${APP_ROLE}" is unavailable; run ensureAppRole() after migrations.`, {
      cause,
    });
    this.name = "AppRoleUnavailableError";
  }
}

/**
 * Creates the non-superuser role that policy-scoped queries run as, and grants it access
 * to every current and future table and sequence in the public schema. Sequences matter
 * for serial/uuid-default apps: an insert as facilis_app also needs USAGE on the backing
 * sequence. Idempotent: safe on every boot.
 */
export async function ensureAppRole(db: FacilisDb): Promise<void> {
  const existing = await db.db.execute(sql`select 1 from pg_roles where rolname = ${APP_ROLE}`);
  if (existing.rows.length === 0) {
    await db.db.execute(sql.raw(`CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`));
  }
  // Re-assert attributes in case an older dev dataDir created the role differently.
  await db.db.execute(sql.raw(`ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN`));
  await db.db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`));
  await db.db.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`),
  );
  await db.db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    ),
  );
  await db.db.execute(
    sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`),
  );
  await db.db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
    ),
  );
}

/**
 * Runs `fn` in one transaction whose Postgres identity is facilis_app and whose GUCs carry
 * the scope. GUC values travel through set_config parameters, never string concatenation.
 */
export async function runWithPolicyScope<T>(
  db: FacilisDb,
  scope: PolicyScope,
  fn: (tx: PolicyScopedDatabase) => Promise<T>,
): Promise<T> {
  return db.db.transaction(async (tx) => {
    try {
      // SET LOCAL ROLE drops back to the connecting (superuser) role at commit.
      await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    } catch (cause) {
      throw new AppRoleUnavailableError(cause);
    }

    const roles = JSON.stringify(scope.roles ?? []);
    await tx.execute(sql`
      select
        set_config('app.tenant_id', ${scope.tenantId ?? ""}, true),
        set_config('app.user_id', ${scope.userId ?? ""}, true),
        set_config('app.roles', ${roles}, true)
    `);

    return fn(tx);
  });
}
