/**
 * Rule 18 `route-table-declared` (SPEC §9.3, D-157): `dbTables` is an applied declaration.
 *
 * Every relation a handler reaches through `ctx.db`, `ctx.sudo` or `ctx.system` — tables
 * and views — must be declared, following project-local helper calls. The rule covers **all**
 * effective routes whose usage facts exist, not only the patched ones: a patch that edits a
 * shared helper changes what untouched routes touch, and must not bypass the declaration.
 *
 * Errors: undeclared, unresolved/dynamic relation, `db.execute` without `rawSql: true`,
 * elevation use outside its `tables` option. Warning: declared but unused (suppressed when
 * usage is opaque or raw SQL is present, where the declaration stays authoritative).
 */

import type { EffectiveState } from "../overlay.ts";
import type { RouteRelationsFact, ValidationError } from "../types.ts";

function lineOf(source: { readonly line: number } | undefined): number | undefined {
  return source?.line;
}

function error(
  file: string,
  message: string,
  fixHint: string,
  line: number | undefined,
): ValidationError {
  return {
    rule: "route-table-declared",
    severity: "error",
    file,
    message,
    fix_hint: fixHint,
    ...(line === undefined ? {} : { line }),
  };
}

function unusedWarning(route: { readonly sourceFile: string }, name: string): ValidationError {
  return {
    rule: "route-table-declared",
    severity: "warning",
    file: route.sourceFile,
    message: 'dbTables declares "' + name + '" but the handler never uses it.',
    fix_hint:
      'Remove "' + name + '" from dbTables, or use it: the declaration is enforced (D-157).',
  };
}

function usedNames(usage: RouteRelationsFact): ReadonlySet<string> {
  const names = new Set(usage.used.map((use) => use.name));
  for (const elevation of usage.elevations) {
    for (const use of elevation.used) names.add(use.name);
  }
  return names;
}

/** Opaque usage or raw SQL keeps the declaration authoritative instead of warning. */
function unusedSuppressed(usage: RouteRelationsFact): boolean {
  return (
    usage.opaque ||
    usage.rawSql.length > 0 ||
    usage.elevations.some((elevation) => elevation.opaque || elevation.tablesUnknown)
  );
}

export interface RouteTableDeclaredFindings {
  readonly errors: ValidationError[];
  readonly warnings: ValidationError[];
}

/** Rule 18 over the effective analysis (SPEC §9.3, D-157). */
export function routeTableDeclaredFindings(state: EffectiveState): RouteTableDeclaredFindings {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const route of state.analysis.routes) {
    // A hand-built analysis may predate the fact (IDE snapshots): no usage facts, no check.
    const usage: RouteRelationsFact | undefined = route.relations;
    if (route.wrapper !== "valid" || usage === undefined) continue;
    const declared = route.dbTables === null ? null : new Set(route.dbTables);
    if (declared !== null) {
      for (const use of usage.used) {
        if (declared.has(use.name)) continue;
        errors.push(
          error(
            use.source.file,
            'Relation "' +
              use.name +
              '" is used through the route db but not declared in dbTables.',
            'Add "' +
              use.name +
              '" to dbTables (tables and views the handler touches), or stop using it.',
            lineOf(use.source),
          ),
        );
      }
      for (const elevation of usage.elevations) {
        for (const use of elevation.used) {
          if (declared.has(use.name)) continue;
          errors.push(
            error(
              use.source.file,
              'Relation "' +
                use.name +
                '" is used inside an elevation but not declared in dbTables.',
              'Add "' + use.name + '" to dbTables and to the elevation tables option.',
              lineOf(use.source),
            ),
          );
        }
      }
    }
    for (const source of usage.unresolved) {
      errors.push(
        error(
          source.file,
          "A relation used through the route db cannot be resolved statically.",
          "Use a table or view binding imported from db/ instead of a dynamic expression.",
          lineOf(source),
        ),
      );
    }
    for (const source of usage.rawSql) {
      if (route.rawSql === true) continue;
      errors.push(
        error(
          source.file,
          "db.execute() requires rawSql: true on the route config.",
          route.rawSql === null
            ? "Declare rawSql: true (or false) statically, or use the query builder."
            : "Add rawSql: true to the route config, or use the query builder.",
          lineOf(source),
        ),
      );
    }
    for (const elevation of usage.elevations) {
      if (elevation.tablesUnknown || elevation.opaque) continue;
      const tables = new Set(elevation.tables);
      for (const use of elevation.used) {
        if (tables.has(use.name)) continue;
        errors.push(
          error(
            use.source.file,
            'Relation "' +
              use.name +
              '" is used inside the "' +
              elevation.kind +
              '" elevation but not declared in its tables option.',
            'Add "' + use.name + '" to the elevation tables and to dbTables.',
            lineOf(use.source),
          ),
        );
      }
    }
    if (declared !== null && !unusedSuppressed(usage)) {
      const used = usedNames(usage);
      for (const name of route.dbTables ?? []) {
        if (used.has(name)) continue;
        warnings.push(unusedWarning(route, name));
      }
    }
  }
  return { errors, warnings };
}
