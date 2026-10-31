import { sql } from "drizzle-orm";
import { uuid } from "drizzle-orm/pg-core";

/**
 * SQL expression that fills a tenant column from the policy-scope GUC.
 *
 * It reads the same `app.tenant_id` every RLS policy reads, transaction-locally set by
 * `runWithPolicyScope` before the handler runs (contracts §4.2). The `nullif` guard is the
 * same one the policies use: after a `RESET` a GUC reads as `''`, and `''::uuid` raises.
 */
export function tenantDefaultSql() {
  return sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
}

/**
 * A `tenant_id` column that takes its value from the policy scope (D-040).
 *
 * ```ts
 * export const todos = pgTable("todos", { tenantId: tenantColumn(), ... }, ...).enableRLS();
 * ```
 *
 * The default is the DB's, not the app's: an insert never names the tenant (raw SQL included),
 * and it cannot name a different one — the RESTRICTIVE tenant policy still checks the written
 * row against the same GUC. It also makes the column optional in Drizzle's insert type, so app
 * code stops passing `tenantId: auth.tenantId` and the compiler stops asking for it.
 */
export function tenantColumn(name = "tenant_id") {
  return uuid(name).notNull().default(tenantDefaultSql());
}
