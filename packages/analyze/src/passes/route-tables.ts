import { warning } from "../diagnostics.ts";
import type { Diagnostic, RouteFact, TableFact } from "../types.ts";

/**
 * D-137: a route cannot declare a **system-only** table in its wrapper config. By D-136 that
 * table has no privilege for `facilis_app`, so a query on the route's `ctx.db` fails closed
 * with `permission denied`; the only legal access is the audited `ctx.sudo`/`ctx.system`
 * elevation. A table that appears among the route's elevation `tables` is therefore excluded,
 * and the diagnostic is a warning, not a gate error: an elevation whose table list is dynamic
 * (`tables: loadTables()`) is recorded as unknown, and a warning must not fail that route's CI.
 */
export function routeSystemTableDiagnostics(
  routes: readonly RouteFact[],
  tables: readonly TableFact[],
): readonly Diagnostic[] {
  const byName = new Map<string, TableFact>();
  for (const table of tables) {
    if (!byName.has(table.name)) byName.set(table.name, table);
  }
  const diagnostics: Diagnostic[] = [];
  for (const route of routes) {
    const declared = declaredTables(route);
    if (declared.size === 0) continue;
    const elevated = new Set(route.elevations.flatMap((elevation) => elevation.tables));
    for (const name of declared) {
      const table = byName.get(name);
      if (table === undefined || table.rlsEnabled || elevated.has(name)) continue;
      diagnostics.push(
        warning(
          "route-system-table",
          'table "' +
            name +
            '" is system-only (no RLS); reach it through ctx.sudo/ctx.system, not the route db',
          route.source,
        ),
      );
    }
  }
  return diagnostics;
}

/** Every table the wrapper config names: `dbTables` plus the table side of `dbColumns`. */
function declaredTables(route: RouteFact): ReadonlySet<string> {
  const names = new Set(route.dbTables ?? []);
  for (const entry of route.dbColumns ?? []) {
    const separator = entry.indexOf(".");
    if (separator > 0) names.add(entry.slice(0, separator));
  }
  return names;
}
