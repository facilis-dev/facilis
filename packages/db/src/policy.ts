import { sql } from "drizzle-orm";

import type { FacilisDb, PgDatabaseLike } from "./client.ts";

/** Non-superuser role used for policy-scoped work; RLS is bypassed by superusers (D-008). */
export const APP_ROLE = "facilis_app";

/** Values exported to Postgres GUCs for one policy-scoped operation (contract §4.2). */
export interface PolicyScope {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly roles?: readonly string[];
  /** The session's expanded permissions, read by permission views (D-098). */
  readonly permissions?: readonly string[];
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
 * The classification `ensureAppRole` derives from the live schema: every table in `public`
 * is either RLS-scoped (the app role has DML and the policies decide the rows) or
 * system-only (no table privilege at all; reachable only through the system identity).
 * D-136 makes this the invariant: a table without RLS is never app-reachable.
 */
export interface AppRoleProvisioning {
  readonly systemOnlyTables: readonly string[];
}

/**
 * Creates the non-superuser role that policy-scoped queries run as and reconciles its
 * privileges with the live schema: **RLS is the grant boundary** (D-136). A table with RLS
 * enabled gets DML for the app role (its policies then decide the rows); a table without RLS
 * gets no table privilege at all, so only the system identity can touch it. Sequences stay
 * granted to both classes: USAGE can neither read nor write a table, and serial/identity
 * columns need it for inserts. Idempotent and re-asserting: safe on every boot, and the
 * blanket grants an older cluster carries are revoked the next time this runs.
 *
 * The role is `NOINHERIT` on purpose. It is a member of `facilis_system` so a deployment
 * whose connection already is `facilis_app` can `SET ROLE` for the audited elevation
 * (D-099); membership must not hand the request identity the system role's grants, or the
 * system-only tables would be reachable from every handler. `SET ROLE` still works with
 * `NOINHERIT`: only implicit inheritance of the member role's privileges is disabled.
 */
export async function ensureAppRole(db: FacilisDb): Promise<AppRoleProvisioning> {
  const existing = await db.db.execute(sql`select 1 from pg_roles where rolname = ${APP_ROLE}`);
  if (existing.rows.length === 0) {
    await db.db.execute(
      sql.raw(`CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`),
    );
  }
  // Re-assert attributes in case an older dev dataDir created the role differently.
  await db.db.execute(sql.raw(`ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN NOINHERIT`));
  await db.db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`));
  // No table default privilege: a table a migration creates stays closed to the app role
  // until its RLS is on and this function runs again after the migration. The REVOKE also
  // clears the default an older version of this function installed on existing clusters.
  await db.db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${APP_ROLE}`,
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
  // Clear every table-class privilege before re-granting: it removes the blanket grant an
  // older cluster installed on objects the classification below does not cover (partition
  // children, materialized and foreign tables) and on system-only tables. Views lose their
  // grant here and get it back from applyViews, the only code that grants one (D-097).
  await db.db.execute(
    sql.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`),
  );

  const systemOnlyTables: string[] = [];
  for (const table of await publicTables(db)) {
    const identifier = sql.identifier(table.name);
    if (table.rowSecurityEnabled) {
      await db.db.execute(
        sql`grant select, insert, update, delete on table ${identifier} to ${sql.identifier(APP_ROLE)}`,
      );
      continue;
    }
    // Belt and braces: PUBLIC holds nothing by default, but a hand-written grant must not
    // reopen a system-only table.
    await db.db.execute(
      sql`revoke all privileges on table ${identifier} from ${sql.identifier(APP_ROLE)}`,
    );
    await db.db.execute(sql`revoke all privileges on table ${identifier} from public`);
    systemOnlyTables.push(table.name);
  }
  return { systemOnlyTables };
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
    const permissions = JSON.stringify(scope.permissions ?? []);
    await tx.execute(sql`
      select
        set_config('app.tenant_id', ${scope.tenantId ?? ""}, true),
        set_config('app.user_id', ${scope.userId ?? ""}, true),
        set_config('app.roles', ${roles}, true),
        set_config('app.permissions', ${permissions}, true)
    `);

    return fn(tx);
  });
}

/** One `public` table, as the catalog reports it (the live schema is the classification). */
interface PublicTable {
  readonly name: string;
  readonly rowSecurityEnabled: boolean;
}

/**
 * The grant loop's input. The catalog, not the code schema, decides: migrations are what
 * actually enabled RLS. Partition children are skipped — routing through a partitioned
 * parent checks the parent's privilege, and the framework has no partitioned tables today.
 */
async function publicTables(db: FacilisDb): Promise<PublicTable[]> {
  const result = await db.db.execute(sql`
    select c.relname as name, c.relrowsecurity as row_security
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
    order by c.relname
  `);
  const tables: PublicTable[] = [];
  for (const row of result.rows) {
    const name = row["name"];
    const rowSecurityEnabled = row["row_security"];
    if (typeof name !== "string" || typeof rowSecurityEnabled !== "boolean") {
      throw new Error("ensureAppRole: unexpected pg_class row shape");
    }
    tables.push({ name, rowSecurityEnabled });
  }
  return tables;
}
