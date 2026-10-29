/**
 * `@facilis/core` — the framework contract (SPEC §5.1).
 *
 * Named re-exports only: the public surface is a flat list so bundlers can tree-shake and
 * consumers never reach into internal modules.
 */

export { DB_MODES, defineConfig, facilisConfigSchema } from "./config.ts";
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
} from "./config.ts";

export { defineAuthorizedHandler } from "./route.ts";
export type {
  AuthContext,
  AuthorizedHandler,
  AuthorizedHandlerConfig,
  AuthorizedHandlerContext,
} from "./route.ts";

export type {
  FacilisContext,
  FacilisEventContext,
  FacilisRequest,
  FacilisRequestEvent,
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

export type {
  ApiDiff,
  ApiRouteRef,
  BreakingChange,
  GitRef,
  MigrationStatement,
  MigrationStatementKind,
  PolicyChange,
  ReleasePreview,
  ReleaseWarning,
  RiskClass,
  SchemaDiff,
  SchemaDiffSummary,
  SecurityDiff,
} from "./release.ts";
