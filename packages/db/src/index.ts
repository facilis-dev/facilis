/**
 * @facilis/db — Drizzle + PGlite client, policy scope, RLS policy generators,
 * schema snapshot and idempotent statement runner.
 */

export {
  createDb,
  DEFAULT_OWNER_COLUMNS,
  DEFAULT_TENANT_COLUMNS,
  DriverNotImplementedError,
  type CreateDbOptions,
  type DbDriver,
  type FacilisDb,
  type FacilisSchema,
  type PgDatabaseLike,
} from "./client.ts";
export {
  APP_ROLE,
  AppRoleUnavailableError,
  ensureAppRole,
  runWithPolicyScope,
  type PolicyScope,
  type PolicyScopedDatabase,
  type PolicyScopedTransaction,
} from "./policy.ts";
export {
  ownerIsolationPolicy,
  policyCreateSql,
  rlsForTable,
  rolePolicy,
  tenantIsolationPolicy,
  withRls,
  type RlsExtras,
  type RlsOptions,
} from "./rls.ts";
export {
  schemaSnapshot,
  type ColumnSnapshot,
  type ForeignKeySnapshot,
  type PolicySnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
} from "./snapshot.ts";
export { applyMigrations, applyStatements, type MigrationSource } from "./migrator.ts";
