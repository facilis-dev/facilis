import type { PolicySnapshot } from "@facilis/db";

/**
 * Release-preview contract types (SPEC §7.7).
 *
 * Type declarations only: the diff engine lands in Phase 3.5 (SPEC §11.3). The Studio's
 * ReleasePreviewPanel is written against these shapes so the engine can be added without
 * touching UI code.
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
 * SPEC §7.7 references `ApiDiff` without declaring it. This is the minimal placeholder
 * until the Phase 3.5 diff engine fixes the shape; the Lead tracks it as a spec gap.
 */
export interface ApiRouteRef {
  readonly method: string;
  readonly path: string;
}

export interface ApiDiff {
  readonly added: readonly ApiRouteRef[];
  readonly removed: readonly ApiRouteRef[];
  readonly changed: readonly ApiRouteRef[];
}

export interface PolicyChange {
  readonly table: string;
  readonly policy: string;
  readonly before: PolicySnapshot;
  readonly after: PolicySnapshot;
  readonly direction: "narrowed" | "broadened" | "unknown";
}

export interface SecurityDiff {
  readonly policiesAdded: readonly PolicySnapshot[];
  readonly policiesDropped: readonly PolicySnapshot[];
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
