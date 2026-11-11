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
  type AppRoleProvisioning,
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
  type CheckSnapshot,
  type ColumnSnapshot,
  type EnumSnapshot,
  type ForeignKeySnapshot,
  type IndexSnapshot,
  type PolicySnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
  type UniqueConstraintSnapshot,
  type UnsupportedDeclarationSnapshot,
} from "./snapshot.ts";
export {
  liveSchemaSnapshot,
  type LiveColumnSnapshot,
  type LivePolicySnapshot,
  type LiveSchemaSnapshot,
  type LiveTableSnapshot,
} from "./live-schema.ts";
export {
  canonicalColumnType,
  diffSchemaSnapshots,
  type SchemaDrift,
  type SchemaDriftKind,
} from "./schema-drift.ts";
export {
  canonicalDigestJson,
  declaredDigestSchema,
  digestSchema,
  liveDigestSchema,
  SCHEMA_DIGEST_VERSION,
  type DigestColumn,
  type DigestPolicy,
  type DigestSchema,
  type DigestTable,
} from "./schema-digest.ts";
export { applyMigrations, applyStatements, type MigrationSource } from "./migrator.ts";
export {
  applyViews,
  collectViewMetadata,
  defineView,
  grantViewSelect,
  isFacilisView,
  viewCreateStatement,
  viewDefinitionStatement,
  viewMetadata,
  ViewDefinitionError,
  VIEW_BRAND,
  VIEW_NAME_PATTERN,
  VIEW_PERMISSION_PATTERN,
  type DefineViewOptions,
  type FacilisView,
  type ViewApplyFailure,
  type ViewApplyOptions,
  type ViewApplyResult,
  type ViewErrorCode,
  type ViewMetadata,
} from "./views.ts";
export {
  ensureSystemRole,
  runAsSystem,
  runWithSystemRole,
  SUDO_ID_GUC,
  SYSTEM_ROLE,
  type RunAsSystemOptions,
  type RunWithSystemRoleOptions,
} from "./sudo.ts";
export {
  FACILIS_JOB_STATUSES,
  facilisJobs,
  type FacilisJobRow,
  type FacilisJobStatus,
  type NewFacilisJobRow,
} from "./jobs.ts";
export {
  FACILIS_TASK_DECISIONS,
  FACILIS_TASK_KINDS,
  FACILIS_TASK_STATUSES,
  facilisTasks,
  type FacilisTaskDecision,
  type FacilisTaskKind,
  type FacilisTaskRow,
  type FacilisTaskStatus,
  type NewFacilisTaskRow,
} from "./tasks.ts";
export {
  FACILIS_WORKFLOW_STATUSES,
  facilisWorkflows,
  type FacilisWorkflowRow,
  type FacilisWorkflowStatus,
  type NewFacilisWorkflowRow,
} from "./workflows.ts";
export {
  newSudoId,
  resetSudoAuditSink,
  setSudoAuditSink,
  writeSudoAudit,
  SudoAuditUnavailableError,
  type SudoAuditEvent,
  type SudoAuditEventName,
  type SudoAuditSink,
} from "./sudo-audit.ts";
export {
  firstKeyword,
  hasMultipleStatements,
  isReadOnlySql,
  stripTrailingSemicolon,
} from "./read-only-sql.ts";
export {
  guardDatabase,
  TableAccessError,
  type TableAccessErrorCode,
  type TableGuardOptions,
} from "./table-guard.ts";
export {
  createLiveView,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  QueryExecutionError,
  QUERY_STATEMENT_TIMEOUT_MS,
  runReadOnlyQuery,
  toJsonValue,
  type QueryColumn,
  type QueryExecution,
  type QueryExecutionErrorCode,
} from "./query-console.ts";
