/**
 * Audited sudo (D-099): run a block of code in the current transaction as the framework's
 * `facilis_system` Postgres role.
 *
 * The system role is the one named exception to SPEC §8.4.5's "no Postgres roles" rule: it
 * is NOLOGIN, NOSUPERUSER with BYPASSRLS and DML grants only (no DDL), it is never assigned
 * to users and never referenced by policies, and it is reachable only through this module.
 * Every escalation is recorded on the append-only audit sink first (fail closed), then in
 * the SAVEPOINT, so a crash between entries leaves a visible trace instead of a silent one.
 */

import { sql } from "drizzle-orm";

import type { FacilisDb } from "./client.ts";
import { APP_ROLE, type PolicyScopedDatabase } from "./policy.ts";
import { newSudoId, writeSudoAudit } from "./sudo-audit.ts";
import { guardDatabase, TableAccessError } from "./table-guard.ts";

/** The elevated Postgres role; provisioned by `ensureSystemRole` (dev) or the deploy step. */
export const SYSTEM_ROLE = "facilis_system";

/** GUC carrying the audit call id while a sudo block runs. Not a provenance column. */
export const SUDO_ID_GUC = "app.sudo_id";

/**
 * Creates the system role and grants it DML on the public schema, plus membership to
 * facilis_app (production connects as the app role and must be able to SET ROLE). Idempotent
 * and re-asserting, like ensureAppRole: an older dataDir must not keep weaker attributes.
 */
export async function ensureSystemRole(db: FacilisDb): Promise<void> {
  const existing = await db.db.execute(sql`select 1 from pg_roles where rolname = ${SYSTEM_ROLE}`);
  if (existing.rows.length === 0) {
    await db.db.execute(sql.raw(`CREATE ROLE ${SYSTEM_ROLE} NOLOGIN NOSUPERUSER BYPASSRLS`));
  }
  // Re-assert attributes in case an older dev dataDir created the role differently.
  await db.db.execute(sql.raw(`ALTER ROLE ${SYSTEM_ROLE} NOSUPERUSER BYPASSRLS NOLOGIN`));
  await db.db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${SYSTEM_ROLE}`));
  await db.db.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${SYSTEM_ROLE}`,
    ),
  );
  await db.db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${SYSTEM_ROLE}`,
    ),
  );
  await db.db.execute(
    sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${SYSTEM_ROLE}`),
  );
  await db.db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${SYSTEM_ROLE}`,
    ),
  );
  // The runtime may connect as facilis_app: membership is what lets it SET ROLE.
  await db.db.execute(sql.raw(`GRANT ${SYSTEM_ROLE} TO ${APP_ROLE}`));
}

export interface RunWithSystemRoleOptions {
  /** Audit call id, exposed as app.sudo_id for correlation inside the block. */
  readonly sudoId: string;
}

/**
 * Runs `fn` in a SAVEPOINT of the current transaction as facilis_system.
 *
 * On success the role is restored to facilis_app explicitly: RESET ROLE would return to the
 * connecting session user (a superuser in dev) and silently widen the rest of the request.
 * On failure the savepoint rollback restores both the role and the GUCs.
 */
export async function runWithSystemRole<T>(
  db: PolicyScopedDatabase,
  options: RunWithSystemRoleOptions,
  fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${SYSTEM_ROLE}`));
    await tx.execute(sql`select set_config('app.sudo_id', ${options.sudoId}, true)`);
    const result = await fn(tx);
    await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    await tx.execute(sql`select set_config('app.sudo_id', '', true)`);
    return result;
  });
}

export interface RunAsSystemOptions {
  /** Audit actor label for a job/CLI caller, e.g. "system:nightly-reindex". */
  readonly actor: `system:${string}`;
  readonly operation: string;
  readonly reason: string;
  /**
   * The job's declared tables and views (SQL names), possibly empty. The elevated client is
   * guarded by this declaration, not by whatever the system role happens to reach (D-157).
   */
  readonly dbTables: readonly string[];
  /** Explicit exception for raw SQL inside the job (D-157); default false. */
  readonly rawSql?: boolean;
  /** Correlation id when the job was triggered by a request. */
  readonly requestId?: string;
}

/**
 * Runs `fn` in its own transaction as facilis_system, audited like `ctx.sudo`, and returns
 * its result. This is the job/CLI counterpart of the route context's sudo.
 */
export async function runAsSystem<T>(
  db: FacilisDb,
  options: RunAsSystemOptions,
  fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
): Promise<T> {
  assertSystemRunOptions(options);
  const id = newSudoId();
  const startedAt = Date.now();
  // Relations the guarded client actually reached; only declared ones can get this far.
  const observed = new Set<string>();
  const base = {
    id,
    actor: options.actor,
    roles: [] as readonly string[],
    operation: options.operation,
    reason: options.reason,
    tables: options.dbTables,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
  };
  writeSudoAudit({ ...base, event: "started", at: new Date().toISOString() });

  try {
    const result = await db.db.transaction((tx) =>
      runWithSystemRole(tx, { sudoId: id }, (systemDb) =>
        fn(
          guardDatabase(systemDb, {
            declared: options.dbTables,
            allowRawSql: options.rawSql === true,
            onRelation: (relation) => observed.add(relation),
          }),
        ),
      ),
    );
    writeSudoAudit({
      ...base,
      event: "succeeded",
      outcome: "succeeded",
      observedTables: [...observed],
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    // Canonical code only: the internal message may name the relation, which is not audited.
    writeSudoAudit({
      ...base,
      event: "failed",
      outcome: "failed",
      at: new Date().toISOString(),
      errorCode: error instanceof TableAccessError ? error.code : "handler_failed",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * Rejects a job call that could not produce a meaningful audit entry.
 *
 * An empty `dbTables` list is deliberately allowed here (D-107): a job may declare that it
 * touches no relation, and it is the only caller permitted to do so — `ctx.sudo`/`ctx.system`
 * still reject an empty subset in @facilis.dev/core. The declaration is enforced by the guard.
 */
function assertSystemRunOptions(options: RunAsSystemOptions): void {
  if (typeof options.actor !== "string" || !options.actor.startsWith("system:")) {
    throw new Error('sudo_invalid_actor: actor must be "system:<job>" for a system run.');
  }
  if (typeof options.operation !== "string" || options.operation.trim().length === 0) {
    throw new Error("sudo_invalid_operation: operation must be a non-empty string.");
  }
  if (typeof options.reason !== "string" || options.reason.trim().length === 0) {
    throw new Error("sudo_invalid_reason: reason must be a non-empty string.");
  }
  if (!isStringList(options.dbTables)) {
    throw new Error(
      "sudo_invalid_dbTables: dbTables must be an array of non-empty strings (possibly empty).",
    );
  }
  if (options.rawSql !== undefined && typeof options.rawSql !== "boolean") {
    throw new Error("sudo_invalid_rawSql: rawSql must be a boolean when present.");
  }
}

/**
 * An array of non-empty strings, possibly empty: a job that declares no relation still
 * produces a valid audit entry (D-107). The empty case is left to the caller's policy, so
 * runAsSystem can accept it while the route-scoped sudo keeps its non-empty subset rule.
 */
function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === "string" && entry.length > 0)
  );
}
