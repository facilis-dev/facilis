import { sql } from "drizzle-orm";
import { PgDialect, pgPolicy, type PgPolicy, type PgPolicyToOption } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

/** Row-level-security extras returned by `rlsForTable` for a pgTable definition. */
export interface RlsOptions {
  readonly tenantColumn?: string;
  readonly ownerColumn?: string;
  readonly rolesColumn?: string;
}

export interface RlsExtras {
  readonly enableRLS: true;
  readonly policies: PgPolicy[];
}

/**
 * Tenant isolation as a RESTRICTIVE policy. Deviation from SPEC §8.4.5's original SQL:
 * as written there the policy is permissive, and Postgres ORs permissive policies, so
 * role/owner clauses let callers cross tenants. D-008 (Phase 0 evidence) fixes this by
 * making tenant isolation RESTRICTIVE (always AND-ed); this generator emits that form.
 */
export function tenantIsolationPolicy(column = "tenant_id"): PgPolicy {
  return pgPolicy("tenant_isolation", {
    as: "restrictive",
    for: "all",
    using: tenantPredicate(column),
    withCheck: tenantPredicate(column),
  });
}

/** Permissive policy granting a caller rows they own (SPEC §8.4.5 owner clause). */

export function ownerIsolationPolicy(column = "owner_id"): PgPolicy {
  return pgPolicy("owner_isolation", {
    for: "all",
    using: ownerPredicate(column),
    withCheck: ownerPredicate(column),
  });
}

/**
 * Permissive role policy: a row is visible when the row's `column` names one of the
 * caller's app roles (`app.roles::jsonb ? column`). Columns hold a role name such as
 * "admin"; roles themselves are never Postgres roles (SPEC §8.4.5).
 */
export function rolePolicy(column: string, policyName = "role_access"): PgPolicy {
  return pgPolicy(policyName, {
    for: "all",
    using: rolePredicate(column),
    withCheck: rolePredicate(column),
  });
}

/**
 * Builds the standard policy set for a scoped table. Use as
 * `pgTable(..., () => rlsForTable({ tenantColumn }).policies).enableRLS()`.
 * (`enableRLS` is returned so callers can assert/forward the flag; Drizzle applies it
 * through `.enableRLS()`, since pgTable's extras callback only accepts config values.)
 */
export function rlsForTable(options: RlsOptions = {}): RlsExtras {
  const policies: PgPolicy[] = [tenantIsolationPolicy(options.tenantColumn)];
  if (options.ownerColumn !== undefined) policies.push(ownerIsolationPolicy(options.ownerColumn));
  if (options.rolesColumn !== undefined) policies.push(rolePolicy(options.rolesColumn));
  return { enableRLS: true, policies };
}

/** Alias kept for the wording used in the Phase 1 contracts file. */
export const withRls = rlsForTable;

/** Renders a complete CREATE POLICY statement (used by migrations and the manifest). */
export function policyCreateSql(tableName: string, policy: PgPolicy): string {
  const parts = [`CREATE POLICY ${quoteIdentifier(policy.name)} ON ${quoteIdentifier(tableName)}`];
  if (policy.as !== undefined) parts.push(`AS ${policy.as.toUpperCase()}`);
  parts.push(`FOR ${(policy.for ?? "all").toUpperCase()}`);
  if (policy.to !== undefined) parts.push(`TO ${policyToList(policy.to)}`);
  if (policy.using !== undefined) parts.push(`USING (${dialect.sqlToQuery(policy.using).sql})`);
  if (policy.withCheck !== undefined) {
    parts.push(`WITH CHECK (${dialect.sqlToQuery(policy.withCheck).sql})`);
  }
  return `${parts.join(" ")};`;
}

function tenantPredicate(column: string) {
  return sql`${sql.identifier(column)} = nullif(current_setting('app.tenant_id', true), '')::uuid`;
}

function ownerPredicate(column: string) {
  return sql`${sql.identifier(column)} = nullif(current_setting('app.user_id', true), '')::uuid`;
}

function rolePredicate(column: string) {
  return sql`nullif(current_setting('app.roles', true), '')::jsonb ? ${sql.identifier(column)}`;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function policyToList(to: PgPolicyToOption): string {
  if (Array.isArray(to)) return to.map((entry) => policyToList(entry)).join(", ");
  if (typeof to === "string") {
    return ["public", "current_role", "current_user", "session_user"].includes(to)
      ? to.toUpperCase()
      : quoteIdentifier(to);
  }
  return quoteIdentifier(to.name);
}
