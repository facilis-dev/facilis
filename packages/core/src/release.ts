/**
 * Release-preview contract types (SPEC §7.7).
 *
 * The engine that fills them is `buildReleasePreview` in ./release-preview.ts; these
 * declarations stay separate so the Studio and the Node tooling can import the contract
 * without pulling the diff code in.
 */

export interface GitRef {
  readonly kind: "commit" | "branch" | "tag";
  readonly ref: string;
  readonly oid: string;
}

export type RiskClass = "safe" | "careful" | "destructive" | "breaking";

export type MigrationStatementKind =
  | "add_table"
  | "drop_table"
  | "add_column"
  | "drop_column"
  | "alter_column"
  | "add_index"
  | "drop_index"
  | "add_policy"
  | "drop_policy"
  | "alter_policy"
  | "add_fk"
  | "drop_fk"
  | "other";

export interface MigrationStatement {
  readonly sql: string;
  readonly kind: MigrationStatementKind;
  readonly risk: RiskClass;
  readonly affectedTable: string | null;
  readonly affectedColumns: readonly string[];
  readonly reason: string;
}

export interface SchemaDiffSummary {
  readonly addedTables: number;
  readonly droppedTables: number;
  readonly addedColumns: number;
  readonly droppedColumns: number;
  readonly alteredColumns: number;
  readonly addedPolicies: number;
  readonly droppedPolicies: number;
  readonly alteredPolicies: number;
}

export interface SchemaDiff {
  readonly statements: readonly MigrationStatement[];
  readonly summary: SchemaDiffSummary;
}

/**
 * SPEC §7.7 `ApiRouteRef`.
 *
 * `dbTables`, `permission` and `rawSql` are optional because a release snapshot built from
 * a git ref can only derive method + path from the route filename: the handler config lives
 * in the source, and only the working-copy manifest can read it. Omitting the field means
 * "not known at this ref", never "no tables" (D-086).
 */
export interface ApiRouteRef {
  readonly method: string;
  readonly path: string;
  readonly permission?: string | readonly string[];
  readonly dbTables?: readonly string[];
  /** Additive (SPEC §7.7 does not list it): the route's `rawSql` derogation (D-157). */
  readonly rawSql?: boolean;
  /** Additive (SPEC §7.7 does not list it): route source file for jump-to, as RouteMeta. */
  readonly sourceFile?: string;
}

/** One route whose known metadata differs between the two refs (SPEC §7.7). */
export interface ApiRouteChange {
  readonly before: ApiRouteRef;
  readonly after: ApiRouteRef;
  readonly fields: readonly string[];
}

export interface ApiDiff {
  readonly added: readonly ApiRouteRef[];
  readonly removed: readonly ApiRouteRef[];
  readonly changed: readonly ApiRouteChange[];
}

/**
 * Structural copy of `@facilis/db`'s `PolicySnapshot` (SPEC §7.3). It is declared here
 * instead of imported: the browser-safe `@facilis/core/release` subpath must not pull
 * `@facilis/db`'s declarations, which reach `@types/pg` and, through it, `@types/node`
 * into the Studio's browser program — the Node and DOM `ReadableStream` typings then
 * clash (D-086). The shapes are identical, so a db snapshot value stays assignable.
 */
export interface ReleasePolicySnapshot {
  readonly name: string;
  readonly command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  readonly using: string | null;
  readonly withCheck: string | null;
  readonly sql: string;
}

export interface PolicyChange {
  readonly table: string;
  readonly policy: string;
  readonly before: ReleasePolicySnapshot;
  readonly after: ReleasePolicySnapshot;
  readonly direction: "narrowed" | "broadened" | "unknown";
}

export interface SecurityDiff {
  readonly policiesAdded: readonly ReleasePolicySnapshot[];
  readonly policiesDropped: readonly ReleasePolicySnapshot[];
  readonly policiesChanged: readonly PolicyChange[];
  readonly rlsDisabled: readonly { readonly table: string }[];
}

export interface BreakingChange {
  readonly kind: "dropped_table_in_use" | "dropped_column_in_use" | "widened_type_mismatch";
  readonly table: string;
  readonly column?: string;
  readonly routes: readonly { readonly method: string; readonly path: string }[];
  readonly message: string;
}

export interface ReleaseWarning {
  readonly kind:
    "pending_migrations_on_target" | "destructive_without_backfill" | "policy_broadened";
  readonly message: string;
  readonly related?: string;
}

export interface ReleasePreview {
  readonly from: GitRef;
  readonly to: GitRef;
  readonly generatedAt: string;
  readonly schema: SchemaDiff;
  readonly api: ApiDiff | null;
  readonly security: SecurityDiff;
  readonly breaking: readonly BreakingChange[];
  readonly warnings: readonly ReleaseWarning[];
}
