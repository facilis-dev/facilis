import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/db` — Drizzle + PGlite, the policy scope and the RLS helpers (SPEC §5.2).
 *
 * Two table classes (D-136): RLS-scoped tables use tenantColumn + a policy set and
 * .enableRLS(); system-only tables have no RLS and are reachable only through runAsSystem /
 * ctx.sudo. The connection helpers here are framework plumbing; routes get ctx.db instead.
 */
export const DB_MODULE: FrameworkModule = {
  id: "db",
  package: "@facilis.dev/db",
  summary:
    "Drizzle/PGlite client, policy scope and audited system role, RLS policy helpers, views, migrations and file tables.",
  entries: [
    {
      name: "createDb",
      kind: "function",
      signature: "createDb(options?: CreateDbOptions): Promise<FacilisDb>",
      summary:
        "Opens the database: PGlite (embedded, optional dataDir + snapshot restore) by default, Postgres when a url is given; a broken pool rejects with DbConnectionError instead of resolving.",
    },
    {
      name: "runWithPolicyScope",
      kind: "function",
      signature:
        "runWithPolicyScope<T>(db: FacilisDb, scope: PolicyScope, fn: (tx: PolicyScopedDatabase) => Promise<T>): Promise<T>",
      summary:
        "Runs fn as facilis_app in one transaction with app.tenant_id/user_id/roles/permissions set transaction-locally; the route wrapper already wraps every handler in it.",
    },
    {
      name: "runAsSystem",
      kind: "function",
      signature:
        "runAsSystem<T>(db: FacilisDb, options: RunAsSystemOptions, fn: (systemDb: PolicyScopedDatabase) => Promise<T>): Promise<T>",
      summary:
        "The job/CLI counterpart of ctx.sudo: its own transaction as facilis_system (BYPASSRLS, audited), guarded by the declared dbTables — the only way a generated project reaches a system-only table.",
    },
    {
      name: "tenantColumn",
      kind: "function",
      signature: 'tenantColumn(name = "tenant_id")',
      summary:
        "A uuid tenant column defaulting to current_setting('app.tenant_id'): inserts never name the tenant and Drizzle's insert type makes the column optional.",
      example:
        'export const todos = pgTable("todos", { tenantId: tenantColumn(), id: uuid().primaryKey() }, (table) => rlsForTable({ tenantColumn: "tenant_id" }).policies).enableRLS();',
    },
    {
      name: "tenantIsolationPolicy",
      kind: "function",
      signature: 'tenantIsolationPolicy(column = "tenant_id"): PgPolicy',
      summary:
        "RESTRICTIVE tenant_isolation policy: rows are AND-ed to app.tenant_id (restrictive on purpose — permissive policies would OR across tenants, D-008).",
    },
    {
      name: "ownerIsolationPolicy",
      kind: "function",
      signature: 'ownerIsolationPolicy(column = "owner_id"): PgPolicy',
      summary:
        "Permissive owner_isolation policy: a caller sees rows whose column equals app.user_id; combine with the restrictive tenant policy.",
    },
    {
      name: "rolePolicy",
      kind: "function",
      signature: 'rolePolicy(column: string, policyName = "role_access"): PgPolicy',
      summary:
        "Permissive role policy: a row is visible when the row's column names one of the caller's app roles (app.roles::jsonb ? column), e.g. an admin-column gate.",
    },
    {
      name: "rlsForTable",
      kind: "function",
      signature: "rlsForTable(options?: RlsOptions): RlsExtras",
      summary:
        "Builds the standard policy set for a scoped table; spread it as pgTable(..., () => rlsForTable({ tenantColumn, ownerColumn, rolesColumn }).policies).enableRLS().",
    },
    {
      name: "defineView",
      kind: "function",
      signature: "defineView(options: DefineViewOptions): FacilisView",
      summary:
        "Declares a SQL view with its base tables and an optional permission (permission → security definer, absent → security invoker for RLS-filtered reads).",
    },
    {
      name: "facilisFiles",
      kind: "constant",
      signature: "facilisFiles: PgTable (hash, name, mime, size, owner_id, created_at)",
      summary:
        "The framework file-metadata table; re-export it from db/schema.ts so the storage routes and fileLinks() work, and generate its migration like any app table.",
    },
    {
      name: "applyMigrations",
      kind: "function",
      signature: "applyMigrations(db: FacilisDb, source: MigrationSource): Promise<void>",
      summary:
        "Idempotent migration runner: SQL text, a statement list, or a directory of drizzle-kit .sql files in filename order; applied statements are tracked in _facilis_applied_statements.",
    },
  ],
};
