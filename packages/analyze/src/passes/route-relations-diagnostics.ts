/**
 * D-157 diagnostics derived from a route's relation-usage fact:
 *
 * - route-table-undeclared (error): used and not declared in dbTables;
 * - route-table-unused (warning): declared and not used — suppressed when a project-external
 *   callee received the client or db.execute is present, where the declaration stays
 *   authoritative (the runtime guard is the enforcement);
 * - route-table-unresolved (error): dynamic/unresolvable relation expression;
 * - route-raw-sql (error): db.execute without rawSql: true;
 * - route-elevation-undeclared (error): used inside an elevation outside its tables option.
 */

import { error, warning } from "../diagnostics.ts";
import type { RouteRelationsFact } from "../types-relations.ts";
import type { Diagnostic, RouteFact } from "../types.ts";

function usedNames(usage: RouteRelationsFact): ReadonlySet<string> {
  const names = new Set(usage.used.map((use) => use.name));
  for (const elevation of usage.elevations) {
    for (const use of elevation.used) names.add(use.name);
  }
  return names;
}

function unusedSuppressed(usage: RouteRelationsFact): boolean {
  return (
    usage.opaque ||
    usage.rawSql.length > 0 ||
    usage.elevations.some((elevation) => elevation.opaque || elevation.tablesUnknown)
  );
}

function undeclared(usage: RouteRelationsFact, declarations: ReadonlySet<string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const use of usage.used) {
    if (declarations.has(use.name)) continue;
    diagnostics.push(
      error(
        "route-table-undeclared",
        'relation "' + use.name + '" is used through the route db but not declared in dbTables',
        use.source,
      ),
    );
  }
  for (const elevation of usage.elevations) {
    for (const use of elevation.used) {
      if (declarations.has(use.name)) continue;
      diagnostics.push(
        error(
          "route-table-undeclared",
          'relation "' + use.name + '" is used inside an elevation but not declared in dbTables',
          use.source,
        ),
      );
    }
  }
  return diagnostics;
}

/** Every diagnostic the relation pass derives from one route's usage fact. */
export function routeRelationDiagnostics(
  route: RouteFact,
  usage: RouteRelationsFact,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declared = route.dbTables === null ? null : new Set(route.dbTables);
  if (declared !== null) diagnostics.push(...undeclared(usage, declared));
  for (const source of usage.unresolved) {
    diagnostics.push(
      error(
        "route-table-unresolved",
        "a relation used through the route db cannot be resolved statically",
        source,
      ),
    );
  }
  for (const source of usage.rawSql) {
    if (route.rawSql === true) continue;
    diagnostics.push(
      error("route-raw-sql", "db.execute() requires rawSql: true on the route config", source),
    );
  }
  for (const elevation of usage.elevations) {
    if (elevation.tablesUnknown || elevation.opaque) continue;
    const tables = new Set(elevation.tables);
    for (const use of elevation.used) {
      if (tables.has(use.name)) continue;
      diagnostics.push(
        error(
          "route-elevation-undeclared",
          'relation "' +
            use.name +
            '" is used inside a "' +
            elevation.kind +
            '" elevation but not declared in its tables option',
          use.source,
        ),
      );
    }
  }
  if (declared !== null && !unusedSuppressed(usage)) {
    const used = usedNames(usage);
    for (const name of route.dbTables ?? []) {
      if (used.has(name)) continue;
      diagnostics.push(
        warning(
          "route-table-unused",
          'dbTables declares "' + name + '" but the route never uses it',
          route.source,
        ),
      );
    }
  }
  return diagnostics;
}
