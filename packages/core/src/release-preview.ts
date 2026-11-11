// The release-preview engine (SPEC §7.7, §11.3): four diff lenses, risk classification.
//
// The engine is pure: callers hand it the declared schema, routes and migration files at
// two git refs (the Studio reads them out of the VFS; the Node tooling out of a checkout),
// and it returns the typed ReleasePreview. Nothing here touches git, the database or the
// DOM, so the classification rules stay unit-testable.
//
// Declared limits (D-086): column type/nullability is only visible through the migration
// SQL (a snapshot of db/schema.ts carries names), so a rename or retype that ships without
// a migration is reported by the code<->live lens, not by the schema summary; policy
// clause changes are similarly only visible when both sides carry policy SQL.

import type { GitRef, MigrationStatement, ReleasePreview } from "./release.ts";
import { diffRoutes } from "./release-api.ts";
import {
  findBreakingChanges,
  liftBreakingRisk,
  type ReleaseDeclaredDiff,
} from "./release-breaking.ts";
import { classifyStatement } from "./release-classify.ts";
import { collectWarnings, diffSecurity, dropPolicyStatements } from "./release-security.ts";
import { splitSqlStatements } from "./release-sql.ts";

// Self-sufficient browser-safe subpath (@facilis.dev/core/release): the Studio needs the
// output contract too, and importing it from the main entry would pull the Node-only
// runtime packages in route.ts into the browser bundle.
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

/** One RLS policy declared on a table. `sql` is absent when only the name is known. */
export interface ReleasePolicyFact {
  readonly name: string;
  readonly sql?: string;
}

/** One table as declared at a ref. Columns are names: the migration SQL carries types. */
export interface ReleaseTableFact {
  readonly name: string;
  readonly columns: readonly string[];
  readonly policies: readonly ReleasePolicyFact[];
  readonly rlsEnabled: boolean;
  /** Carries a tenant/owner scope column (SPEC §8.4.5). */
  readonly scoped: boolean;
}

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

/** One migration file as it exists at a ref. */
export interface ReleaseMigrationFile {
  readonly path: string;
  readonly sql: string;
}

export interface ReleaseSnapshot {
  readonly schema: { readonly tables: readonly ReleaseTableFact[] };
  readonly routes: readonly ReleaseRouteFact[];
  readonly migrations: readonly ReleaseMigrationFile[];
}

export interface ReleasePreviewInput {
  readonly from: GitRef;
  readonly to: GitRef;
  readonly before: ReleaseSnapshot;
  readonly after: ReleaseSnapshot;
  /** Routes served right now (the manifest), for destructive-change cross-checks. */
  readonly inUseRoutes?: readonly ReleaseRouteFact[];
  /** Migration paths the target database has not applied (the code<->live drift). */
  readonly pendingMigrations?: readonly string[];
  readonly generatedAt?: string;
}

export function buildReleasePreview(input: ReleasePreviewInput): ReleasePreview {
  const inUse = input.inUseRoutes ?? input.after.routes;
  const declared = diffDeclared(input.before.schema.tables, input.after.schema.tables);
  const breaking = findBreakingChanges(declared, inUse);
  const statements = migrationStatements(input.before.migrations, input.after.migrations).map(
    (statement) => liftBreakingRisk(statement, breaking),
  );
  const security = diffSecurity(input.before.schema.tables, input.after.schema.tables);
  const droppedPolicies = dropPolicyStatements(input.before.migrations, input.after.migrations);
  return {
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    schema: { statements, summary: declared.summary },
    api: diffRoutes(input.before.routes, input.after.routes),
    security,
    breaking,
    warnings: collectWarnings(statements, input.pendingMigrations ?? [], droppedPolicies, security),
  };
}

// ── schema ──────────────────────────────────────────────────────────────────────────

function diffDeclared(
  beforeTables: readonly ReleaseTableFact[],
  afterTables: readonly ReleaseTableFact[],
): ReleaseDeclaredDiff {
  const before = indexTables(beforeTables);
  const after = indexTables(afterTables);
  const droppedTables: string[] = [];
  const droppedColumns: { table: string; column: string }[] = [];
  let addedTables = 0;
  let addedColumns = 0;
  let addedPolicies = 0;
  let droppedPolicies = 0;

  for (const [name, table] of after) {
    const previous = before.get(name);
    if (previous === undefined) {
      addedTables += 1;
      addedColumns += table.columns.length;
      addedPolicies += table.policies.length;
      continue;
    }
    const previousColumns = new Set(previous.columns);
    const currentColumns = new Set(table.columns);
    addedColumns += table.columns.filter((column) => !previousColumns.has(column)).length;
    for (const column of previous.columns) {
      if (!currentColumns.has(column)) droppedColumns.push({ table: name, column });
    }
    const previousPolicies = new Set(previous.policies.map((policy) => policy.name));
    const currentPolicies = new Set(table.policies.map((policy) => policy.name));
    addedPolicies += table.policies.filter((policy) => !previousPolicies.has(policy.name)).length;
    droppedPolicies += previous.policies.filter(
      (policy) => !currentPolicies.has(policy.name),
    ).length;
  }
  for (const [name, table] of before) {
    if (after.has(name)) continue;
    droppedTables.push(name);
    droppedPolicies += table.policies.length;
  }

  return {
    summary: {
      addedTables,
      droppedTables: droppedTables.length,
      addedColumns,
      droppedColumns: droppedColumns.length,
      alteredColumns: 0,
      addedPolicies,
      droppedPolicies,
      alteredPolicies: 0,
    },
    droppedTables,
    droppedColumns,
  };
}

function indexTables(tables: readonly ReleaseTableFact[]): Map<string, ReleaseTableFact> {
  return new Map(tables.map((table) => [table.name, table]));
}

/** The statements of the migration files that exist in `after` but not in `before`. */
function migrationStatements(
  before: readonly ReleaseMigrationFile[],
  after: readonly ReleaseMigrationFile[],
): MigrationStatement[] {
  const known = new Set(before.map((file) => file.path));
  const statements: MigrationStatement[] = [];
  for (const file of after.toSorted((left, right) => left.path.localeCompare(right.path))) {
    if (known.has(file.path)) continue;
    for (const sql of splitSqlStatements(file.sql)) {
      const classification = classifyStatement(sql);
      statements.push({
        sql: sql.trim(),
        kind: classification.kind,
        risk: classification.risk,
        affectedTable: classification.affectedTable,
        affectedColumns: classification.affectedColumns,
        reason: classification.reason,
      });
    }
  }
  return statements;
}
