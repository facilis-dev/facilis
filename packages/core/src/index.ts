/**
 * `@facilis/core` — the framework contract (SPEC §5.1).
 *
 * Named re-exports only: the public surface is a flat list so bundlers can tree-shake and
 * consumers never reach into internal modules.
 */

export {
  DB_MODES,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_SSO_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  SSO_PROVIDER_KINDS,
  defineConfig,
  facilisConfigSchema,
  ssoConfigSchema,
  ssoProviderSchema,
  STORAGE_DRIVERS,
} from "./config.ts";
export type {
  DbMode,
  FacilisAuthConfig,
  FacilisBlocksConfig,
  FacilisConfig,
  FacilisConfigInput,
  FacilisDbConfig,
  FacilisI18nConfig,
  FacilisNitroOptions,
  FacilisReleaseConfig,
  FacilisLoggingConfig,
  FacilisLoggingConfigInput,
  FacilisStorageConfig,
  FacilisStorageConfigInput,
  FacilisStorageEncryptionConfig,
  FacilisSsoConfig,
  FacilisSsoConfigInput,
  FacilisSsoProvider,
  SsoProviderKind,
  StorageDriverKind,
} from "./config.ts";

export {
  StorageUnavailableError,
  unavailableStorage,
  type StorageApi,
  type StorageDownloadOptions,
  type StoragePresignOptions,
  type StoragePutResult,
  type StorageStream,
  type StorageTokenPayload,
} from "./storage.ts";

export {
  LOG_KINDS,
  LOG_LEVELS,
  NOOP_LOGGER,
  NOOP_LOGGING_API,
  acceptRequestId,
  createAccessEntry,
  createErrorEntry,
  isLogLevel,
  logLevelEnabled,
  newLogRequestId,
  requestPath,
} from "./logging.ts";
export type {
  AccessLogEntry,
  AppLogEntry,
  AuditLogEntry,
  ErrorLogEntry,
  FacilisAuditInput,
  FacilisLogger,
  FacilisLoggingApi,
  FacilisLogRequestMeta,
  LogEntry,
  LogEntryMeta,
  LogKind,
  LogLevel,
} from "./logging.ts";

export { DEFAULT_JOBS_CONFIG, facilisJobsConfigSchema } from "./jobs-config.ts";
export type { FacilisJobsConfig, FacilisJobsConfigInput } from "./jobs-config.ts";
export {
  defineJob,
  isJobDefinition,
  JOB_ERROR_CODES,
  JOB_STATUSES,
  JobError,
  serializeJobData,
} from "./jobs.ts";
export type {
  EnqueueJobOptions,
  JobDefinition,
  JobErrorCode,
  JobJson,
  JobListOptions,
  JobOverrides,
  JobQueueStats,
  JobRecord,
  JobRunContext,
  JobStatus,
  JobsApi,
} from "./jobs.ts";

export { defineAuthorizedHandler } from "./route.ts";
export type {
  AuthContext,
  AuthorizedHandler,
  AuthorizedHandlerConfig,
  AuthorizedHandlerContext,
} from "./route.ts";
export type {
  AuditedElevationContext,
  SudoHandler,
  SudoOptions,
  SystemHandler,
  SystemOptions,
} from "./sudo.ts";

export type {
  FacilisContext,
  FacilisEventContext,
  FacilisHandlerContext,
  FacilisHandlerEvent,
  FacilisRequest,
  FacilisRequestEvent,
  FacilisResponse,
} from "./event.ts";

export {
  FACILIS_ERROR_CODES,
  FACILIS_ERROR_STATUS,
  fail,
  flattenZodIssues,
  invalidInput,
} from "./errors.ts";
export type { FacilisErrorBody, FacilisErrorCode } from "./errors.ts";

export {
  getDefaultLocale,
  registerCatalog,
  setDefaultLocale,
  setMissingTranslationHandler,
  t,
} from "./i18n.ts";
export type { I18nParams, MissingTranslationHandler } from "./i18n.ts";

export {
  buildManifest,
  isManifestSection,
  MANIFEST_SECTIONS,
  summarizeManifest,
} from "./manifest.ts";
export type {
  ApiHint,
  BlockCategory,
  BlockManifest,
  BuildManifestInput,
  ColumnSnapshot,
  FacilisManifest,
  FacilisMetaResponse,
  ForeignKeySnapshot,
  HttpMethod,
  LocaleCatalogs,
  ManifestFrameworkVersions,
  ManifestSection,
  ManifestSummary,
  ManifestWarning,
  PolicySnapshot,
  RouteMeta,
  SchemaSnapshot,
  TableSnapshot,
} from "./manifest.ts";

export { computeRevision } from "./revision.ts";
export { DEFAULT_TENANT_ID } from "./tenancy.ts";
export type {
  BlockManifestRevisionSource,
  RevisionInput,
  SchemaFileRevisionSource,
} from "./revision.ts";

export { buildReleasePreview } from "./release-preview.ts";
export type {
  ReleaseMigrationFile,
  ReleasePolicyFact,
  ReleasePreviewInput,
  ReleaseRouteFact,
  ReleaseSnapshot,
  ReleaseTableFact,
} from "./release-preview.ts";
export type {
  ApiDiff,
  ApiRouteChange,
  ApiRouteRef,
  BreakingChange,
  GitRef,
  MigrationStatement,
  MigrationStatementKind,
  PolicyChange,
  ReleasePolicySnapshot,
  ReleasePreview,
  ReleaseWarning,
  RiskClass,
  SchemaDiff,
  SchemaDiffSummary,
  SecurityDiff,
} from "./release.ts";
