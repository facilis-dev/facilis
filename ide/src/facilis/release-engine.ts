// The one bridge to the pure release-preview engine in @facilis/core (D-086).
//
// The browser must import the self-sufficient subpath "@facilis/core/release", never the
// package root: the main entry re-exports route.ts, which pulls @facilis/auth and
// @facilis/db (node:module, drizzle, PGlite) into the bundle. The subpath re-exports the
// engine and the whole output contract, and its @facilis/db dependency is type-only.
export { buildReleasePreview } from "@facilis/core/release";
export type {
  ApiDiff,
  ApiRouteChange,
  ApiRouteRef,
  BreakingChange,
  GitRef,
  MigrationStatement,
  MigrationStatementKind,
  PolicyChange,
  ReleaseMigrationFile,
  ReleasePolicyFact,
  ReleasePreview,
  ReleasePreviewInput,
  ReleaseRouteFact,
  ReleaseSnapshot,
  ReleaseTableFact,
  ReleaseWarning,
  RiskClass,
  SchemaDiff,
  SchemaDiffSummary,
  SecurityDiff,
} from "@facilis/core/release";
