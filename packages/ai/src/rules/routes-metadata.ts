/**
 * Rules 4 `db-tables-valid`, 5 `db-columns-valid` and 6 `permission-valid` (SPEC §9.3).
 *
 * The rules read the route facts the analyzer produced and check them against the effective
 * facts: the schema tables (Drizzle property names for columns) and the config's permission
 * list. They also catch the inverse edit: removing a table, column or permission that an
 * existing route still references.
 */

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { RouteFact, TableFact, ValidationError } from "../types.ts";
import { patchedRoutes } from "./routes-security.ts";

const COLUMN_REFERENCE = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

function tableLookup(tables: readonly TableFact[]): Map<string, TableFact> {
  const lookup = new Map<string, TableFact>();
  for (const table of tables) {
    lookup.set(table.name, table);
    if (table.binding !== null) lookup.set(table.binding, table);
  }
  return lookup;
}

function untouchedByPatch(route: RouteFact, state: EffectiveState): boolean {
  const file = normalizeProjectPath(route.sourceFile);
  return !state.patchedPaths.has(file) && !state.deletedPaths.has(file);
}

function routeLabel(route: RouteFact): string {
  return route.method + " " + route.path;
}

function error(
  rule: string,
  file: string,
  message: string,
  fix_hint: string,
  line?: number,
): ValidationError {
  return {
    rule,
    severity: "error",
    file,
    message,
    fix_hint,
    ...(line === undefined ? {} : { line }),
  };
}

function warning(
  rule: string,
  file: string,
  message: string,
  fix_hint: string,
  line?: number,
): ValidationError {
  return {
    rule,
    severity: "warning",
    file,
    message,
    fix_hint,
    ...(line === undefined ? {} : { line }),
  };
}

/** Rule 4: every declared `dbTables` entry must be a table or view the project declares. */
export function routeDbTablesErrors(state: EffectiveState): ValidationError[] {
  // D-157: a view is declared by its own SQL name (the base tables stay in the view).
  const known = new Set(tableLookup(state.schemaTables).keys());
  for (const view of state.analysis.views ?? []) {
    known.add(view.name);
    if (view.binding !== null) known.add(view.binding);
  }
  const errors: ValidationError[] = [];
  for (const route of patchedRoutes(state)) {
    for (const table of route.dbTables ?? []) {
      if (known.has(table)) continue;
      errors.push(
        error(
          "db-tables-valid",
          route.sourceFile,
          'dbTables references relation "' + table + '", which is not in the schema.',
          "Use a table or view declared in db/ (or added by this patch), or drop the reference.",
          route.source.line,
        ),
      );
    }
  }
  for (const route of state.before.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const table of route.dbTables ?? []) {
      if (!state.removedTables.includes(table)) continue;
      errors.push(
        error(
          "db-tables-valid",
          route.sourceFile,
          'The patch removes table "' +
            table +
            '", which the existing route ' +
            routeLabel(route) +
            " still references.",
          "Update the route (or delete it) in the same patch, or keep the table. If the change was meant to be additive, re-emit db/schema.ts with every existing table plus the new one.",
        ),
      );
    }
  }
  return errors;
}

/** Columns (Drizzle property names) dropped by the patch, keyed table.property. */
function removedColumns(state: EffectiveState): { table: string; column: string }[] {
  const before = new Map(state.beforeSchemaTables.map((table) => [table.name, table]));
  const removed: { table: string; column: string }[] = [];
  for (const table of state.afterSchemaTables) {
    const previous = before.get(table.name);
    if (previous === undefined || previous.columns.length === 0 || table.columns.length === 0) {
      continue;
    }
    const current = new Set(table.columns.map((column) => column.property));
    for (const column of previous.columns) {
      if (!current.has(column.property))
        removed.push({ table: table.name, column: column.property });
    }
  }
  return removed;
}

/** Rule 5: `dbColumns` entries are `table.property` references into the effective schema. */
export function routeDbColumnsWarnings(state: EffectiveState): ValidationError[] {
  const lookup = tableLookup(state.schemaTables);
  const warnings: ValidationError[] = [];
  const warn = (file: string, message: string, fix_hint: string, line?: number): void => {
    warnings.push(warning("db-columns-valid", file, message, fix_hint, line));
  };
  for (const route of patchedRoutes(state)) {
    for (const reference of route.dbColumns ?? []) {
      if (!COLUMN_REFERENCE.test(reference)) {
        warn(
          route.sourceFile,
          '"' + reference + '" is not a "table.column" reference.',
          "Declare dbColumns entries as table.column using Drizzle property names.",
          route.source.line,
        );
        continue;
      }
      const [tableName, columnName] = reference.split(".");
      if (tableName === undefined || columnName === undefined) continue;
      const table = lookup.get(tableName);
      if (table === undefined) {
        warn(
          route.sourceFile,
          'dbColumns references table "' + tableName + '", which is not in the schema.',
          "Use a table declared in db/schema.ts.",
          route.source.line,
        );
      } else if (
        table.columns.length > 0 &&
        !table.columns.some((column) => column.property === columnName)
      ) {
        warn(
          route.sourceFile,
          'dbColumns references unknown column "' + columnName + '" on table "' + tableName + '".',
          "Use a column the schema declares, or update dbColumns with the patch.",
          route.source.line,
        );
      }
    }
  }
  const dropped = removedColumns(state);
  for (const route of state.before.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const reference of route.dbColumns ?? []) {
      const removed = dropped.some((entry) => entry.table + "." + entry.column === reference);
      if (!removed) continue;
      warn(
        route.sourceFile,
        'The patch drops "' +
          reference +
          '", which the existing route ' +
          routeLabel(route) +
          " still references.",
        "Update the route in the same patch, or keep the column.",
      );
    }
  }
  return warnings;
}

/** Rule 6: every route permission must be declared in `facilis.config.ts`; null fails closed. */
export function permissionErrors(state: EffectiveState): ValidationError[] {
  const declared = new Set(state.config.permissions);
  const errors: ValidationError[] = [];
  for (const route of patchedRoutes(state)) {
    if (route.permission === null) {
      errors.push(
        error(
          "permission-valid",
          route.sourceFile,
          "Route config must declare permission ([] for a public route).",
          'Add permission: ["..."] or permission: [] to defineAuthorizedHandler (SPEC §7.4).',
          route.source.line,
        ),
      );
      continue;
    }
    for (const value of route.permission) {
      if (declared.has(value)) continue;
      errors.push(
        error(
          "permission-valid",
          route.sourceFile,
          'Permission "' + value + '" is not declared in facilis.config.ts.',
          "Declare it in auth.permissions (and roles) in the same patch, or use an existing permission.",
          route.source.line,
        ),
      );
    }
  }
  for (const route of state.before.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const permission of route.permission ?? []) {
      if (!state.removedPermissions.includes(permission)) continue;
      errors.push(
        error(
          "permission-valid",
          route.sourceFile,
          'The patch removes permission "' +
            permission +
            '", which the existing route ' +
            routeLabel(route) +
            " still requires.",
          "Update the route in the same patch, or keep the permission declared.",
        ),
      );
    }
  }
  return errors;
}
