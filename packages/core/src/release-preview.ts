// The release-preview engine (SPEC §7.7, §11.3): four diff lenses, one pure call.
//
// Callers hand it the declared schema and routes at two git refs (the Studio reads them
// out of the VFS through @facilis.dev/analyze; the Node tooling out of a checkout), and it
// returns the typed ReleasePreview. Nothing here touches git, the database or the DOM.
//
// The schema lens is planSchema itself (D-158/D-159, issue #48): the same generator the
// release pipeline runs over the two declared snapshots, so the preview shows exactly the
// batches the artifact ships and fails closed wherever the analyzer cannot resolve a
// declaration. The schema-plan modules import @facilis.dev/db only as types, so this
// browser-safe subpath pulls no Node-only runtime code (D-086).

import type { SchemaSnapshot, TableSnapshot } from "@facilis.dev/db";

import type { GitRef, ReleasePreview } from "./release.ts";
import { diffRoutes } from "./release-api.ts";
import { findBreakingChanges, type ReleaseDeclaredDiff } from "./release-breaking.ts";
import { collectWarnings, diffSecurity } from "./release-security.ts";
import { planSchema } from "./schema-plan/plan.ts";

// Self-sufficient browser-safe subpath (@facilis.dev/core/release): the Studio needs the
// output contract too, and importing it from the main entry would pull the Node-only
// runtime packages in route.ts into the browser bundle.
export type {
  ApiDiff,
  ApiRouteChange,
  ApiRouteRef,
  BreakingChange,
  GitRef,
  PolicyChange,
  ReleasePolicySnapshot,
  ReleasePreview,
  ReleaseWarning,
  RiskClass,
  SchemaDiff,
  SchemaDiffSummary,
  SecurityDiff,
} from "./release.ts";
export type {
  SchemaPlan,
  SchemaPlanBatch,
  SchemaPlanProblem,
  SchemaPlanProblemCode,
} from "./schema-plan/types.ts";
export type { SchemaSnapshot } from "@facilis.dev/db";

/**
 * One route at a ref. A route derived from a filename knows method and path only; a route
 * read from a manifest also knows `permission`, `dbTables`, `dbColumns`, `rawSql` and
 * `sourceFile`.
 */
export interface ReleaseRouteFact {
  readonly method: string;
  readonly path: string;
  readonly sourceFile?: string;
  readonly permission?: string | readonly string[];
  readonly dbTables?: readonly string[];
  readonly dbColumns?: readonly string[];
  /** `rawSql: true` allows `db.execute` (D-157); absent means not known at this ref. */
  readonly rawSql?: boolean;
}

export interface ReleaseSnapshot {
  /**
   * The full declared schema at the ref (issue #47): analyzer facts mapped through
   * schemaSnapshotFromAnalysis, the exact shape planSchema consumes. Unreadable
   * declarations ride along as `unsupported` entries and fail the plan closed.
   */
  readonly schema: SchemaSnapshot;
  readonly routes: readonly ReleaseRouteFact[];
}

export interface ReleasePreviewInput {
  readonly from: GitRef;
  readonly to: GitRef;
  readonly before: ReleaseSnapshot;
  readonly after: ReleaseSnapshot;
  /** Routes served right now (the manifest), for destructive-change cross-checks. */
  readonly inUseRoutes?: readonly ReleaseRouteFact[];
  readonly generatedAt?: string;
}

export function buildReleasePreview(input: ReleasePreviewInput): ReleasePreview {
  const inUse = input.inUseRoutes ?? input.after.routes;
  // Verbatim planSchema output: the IDE plan must equal the artifact plan (issue #48).
  const plan = planSchema(input.before.schema, input.after.schema);
  const declared = diffDeclared(input.before.schema.tables, input.after.schema.tables);
  const breaking = findBreakingChanges(declared, inUse);
  const security = diffSecurity(input.before.schema.tables, input.after.schema.tables);
  return {
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schema: { plan, summary: declared.summary },
    api: diffRoutes(input.before.routes, input.after.routes),
    security,
    breaking,
    warnings: collectWarnings(plan, declared.droppedPolicies, security),
  };
}

// ── declared summary ────────────────────────────────────────────────────────────────

/**
 * The declared diff the summary, breaking and security lenses share. Columns carry types
 * and policies carry SQL in the snapshot, so altered counts are real comparisons now
 * (the migration-file lens could only ever report zero).
 */
function diffDeclared(
  beforeTables: readonly TableSnapshot[],
  afterTables: readonly TableSnapshot[],
): ReleaseDeclaredDiff {
  const before = indexTables(beforeTables);
  const after = indexTables(afterTables);
  const droppedTables: string[] = [];
  const droppedColumns: { table: string; column: string }[] = [];
  const droppedPolicies: { table: string; policy: string }[] = [];
  let addedTables = 0;
  let addedColumns = 0;
  let alteredColumns = 0;
  let addedPolicies = 0;
  let droppedPolicyCount = 0;
  let alteredPolicies = 0;

  for (const [name, table] of after) {
    const previous = before.get(name);
    if (previous === undefined) {
      addedTables += 1;
      addedColumns += table.columns.length;
      addedPolicies += table.policies.length;
      continue;
    }
    const previousColumns = columnsByName(previous);
    const currentColumns = columnsByName(table);
    addedColumns += table.columns.filter((column) => !previousColumns.has(column.name)).length;
    for (const column of previous.columns) {
      const current = currentColumns.get(column.name);
      if (current === undefined) droppedColumns.push({ table: name, column: column.name });
      else if (columnChanged(column, current)) alteredColumns += 1;
    }
    const previousPolicies = new Map(previous.policies.map((policy) => [policy.name, policy]));
    const currentPolicies = new Set(table.policies.map((policy) => policy.name));
    addedPolicies += table.policies.filter((policy) => !previousPolicies.has(policy.name)).length;
    for (const policy of previous.policies) {
      if (!currentPolicies.has(policy.name)) {
        droppedPolicyCount += 1;
        droppedPolicies.push({ table: name, policy: policy.name });
      }
    }
    for (const policy of table.policies) {
      const previousPolicy = previousPolicies.get(policy.name);
      if (previousPolicy !== undefined && previousPolicy.sql !== policy.sql) alteredPolicies += 1;
    }
  }
  for (const [name, table] of before) {
    if (after.has(name)) continue;
    droppedTables.push(name);
    droppedPolicyCount += table.policies.length;
    for (const policy of table.policies) droppedPolicies.push({ table: name, policy: policy.name });
  }

  return {
    summary: {
      addedTables,
      droppedTables: droppedTables.length,
      addedColumns,
      droppedColumns: droppedColumns.length,
      alteredColumns,
      addedPolicies,
      droppedPolicies: droppedPolicyCount,
      alteredPolicies,
    },
    droppedTables,
    droppedColumns,
    droppedPolicies,
  };
}

function indexTables(tables: readonly TableSnapshot[]): Map<string, TableSnapshot> {
  return new Map(tables.map((table) => [table.name, table]));
}

function columnsByName(table: TableSnapshot): Map<string, TableSnapshot["columns"][number]> {
  return new Map(table.columns.map((column) => [column.name, column]));
}

/** Every fact the planner can act on: a change in any of them is an altered column. */
function columnChanged(
  before: TableSnapshot["columns"][number],
  after: TableSnapshot["columns"][number],
): boolean {
  return (
    before.type !== after.type ||
    before.notNull !== after.notNull ||
    before.default !== after.default ||
    before.isPrimaryKey !== after.isPrimaryKey ||
    before.isUnique !== after.isUnique ||
    (before.identity ?? null) !== (after.identity ?? null) ||
    (before.generated ?? false) !== (after.generated ?? false)
  );
}
