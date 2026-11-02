// Breaking-change detection for a release preview (SPEC §11.3): a drop is only
// "breaking" when a route still reads the entity, so the engine marks exactly the
// statements that will take the running app down.

import type { BreakingChange, MigrationStatement, SchemaDiffSummary } from "./release.ts";
import type { ReleaseRouteFact } from "./release-preview.ts";

export interface ReleaseDeclaredDiff {
  readonly summary: SchemaDiffSummary;
  readonly droppedTables: readonly string[];
  readonly droppedColumns: readonly { readonly table: string; readonly column: string }[];
}

// ── breaking changes ───────────────────────────────────────────────────────────────

export function findBreakingChanges(
  declared: ReleaseDeclaredDiff,
  inUse: readonly ReleaseRouteFact[],
): BreakingChange[] {
  const breaking: BreakingChange[] = [];
  for (const table of declared.droppedTables) {
    const routes = routesUsingTable(inUse, table);
    if (routes.length === 0) continue;
    breaking.push({
      kind: "dropped_table_in_use",
      table,
      routes,
      message:
        "Dropping table " + table + " breaks " + routes.length + " route(s) that still use it",
    });
  }
  for (const { table, column } of declared.droppedColumns) {
    const routes = routesUsingColumn(inUse, table, column);
    if (routes.length === 0) continue;
    breaking.push({
      kind: "dropped_column_in_use",
      table,
      column,
      routes,
      message:
        "Dropping " + table + "." + column + " breaks " + routes.length + " route(s) that read it",
    });
  }
  return breaking;
}

function routesUsingTable(
  routes: readonly ReleaseRouteFact[],
  table: string,
): { method: string; path: string }[] {
  return routes
    .filter(
      (route) =>
        (route.dbTables ?? []).includes(table) ||
        (route.dbColumns ?? []).some((column) => column.startsWith(table + ".")),
    )
    .map((route) => ({ method: route.method.toUpperCase(), path: route.path }));
}

function routesUsingColumn(
  routes: readonly ReleaseRouteFact[],
  table: string,
  column: string,
): { method: string; path: string }[] {
  const reference = table + "." + column;
  return routes
    .filter((route) => (route.dbColumns ?? []).includes(reference))
    .map((route) => ({ method: route.method.toUpperCase(), path: route.path }));
}

export function liftBreakingRisk(
  statement: MigrationStatement,
  breaking: readonly BreakingChange[],
): MigrationStatement {
  const risk = breaking.some(
    (change) =>
      change.table === statement.affectedTable &&
      (change.kind === "dropped_table_in_use"
        ? statement.kind === "drop_table"
        : change.column !== undefined && statement.affectedColumns.includes(change.column)),
  );
  return risk ? { ...statement, risk: "breaking" } : statement;
}
