import type { RiskClass } from "../release.ts";

/**
 * Pure release-side schema planner (docs/MIGRATION-PLAN.md §2.2, §2.5; ADR D-158).
 *
 * `planSchema(from, to)` turns two declared schema snapshots into the ordered SQL batches
 * of a release artifact. It never touches a database: the deploy side applies the plan
 * (P3), the release pipeline stores it (P4). These are the public contract types.
 */

export type SchemaPlanProblemCode =
  | "unsupported_declaration"
  | "unsupported_change"
  | "policy_unsafe";

export interface SchemaPlanProblem {
  /** Machine code; the release fails on any problem, it never degrades (D-158). */
  code: SchemaPlanProblemCode;
  table?: string;
  column?: string;
  /**
   * Machine token naming the construct, never prose: `index:<name>`, `check:<name>`,
   * `enum:<name>`, `identity:<column>`, `generated:<column>`, `primary_key`, `rls`.
   */
  construct?: string;
}

export interface SchemaPlanBatch {
  /** Stable id: zero-padded sequence plus a slug, e.g. `001-create-table-users`. */
  id: string;
  /** One SQL statement; batches run in array order. */
  sql: string;
  risk: RiskClass;
  /** Deploy preconditions, e.g. `no_null_rows:<table>.<column>`. */
  requires?: string[];
}

export interface SchemaPlan {
  batches: SchemaPlanBatch[];
  /** Max of the batch risks; `safe` for an empty plan. Never `breaking` (P4 owns routes). */
  risk: RiskClass;
  /** Ids of the destructive batches, i.e. the approval list of the artifact. */
  destructive: string[];
  /** Non-empty means the release fails; `batches` is then always empty. */
  problems: SchemaPlanProblem[];
}
