/**
 * @facilis/db — Drizzle client for PGlite and Postgres, policy scope, RLS policy
 * generators, schema snapshot and idempotent statement runner.
 */

export {
  createDb,
  DbConnectionError,
  DEFAULT_OWNER_COLUMNS,
  DEFAULT_TENANT_COLUMNS,
  DriverNotImplementedError,
  SnapshotUnavailableError,
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
export { tenantColumn, tenantDefaultSql } from "./tenant-column.ts";
export {
  facilisFiles,
  fileLinks,
  type FacilisFile,
  type FileLinksOptions,
  type FileLinksTable,
  type NewFacilisFile,
} from "./files.ts";
export {
  schemaSnapshot,
  type ColumnSnapshot,
  type ForeignKeySnapshot,
  type PolicySnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
} from "./snapshot.ts";
export { applyMigrations, applyStatements, type MigrationSource } from "./migrator.ts";
