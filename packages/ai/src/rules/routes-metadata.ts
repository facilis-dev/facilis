/**
 * Rules 4 `db-tables-valid`, 5 `db-columns-valid` and 6 `permission-valid` (SPEC §9.3).
 *
 * The rules read the static metadata a route declares and check it against the effective
 * context: the code schema merged with the patch, and the config's permission list. They
 * also catch the inverse edit: removing a table or permission that an existing route
 * (from the live manifest) still references.
 */

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import { arrayProperty, stringProperty } from "../scan.ts";
import type { PatchContext, RouteFacts, TableFacts, ValidationError } from "../types.ts";
import { routeSources } from "./routes-security.ts";

const COLUMN_REFERENCE = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

function tableLookup(tables: readonly TableFacts[]): Map<string, TableFacts> {
  const lookup = new Map<string, TableFacts>();
  for (const table of tables) {
    lookup.set(table.name, table);
    if (table.variable !== undefined) lookup.set(table.variable, table);
  }
  return lookup;
}

function untouchedByPatch(route: RouteFacts, state: EffectiveState): boolean {
  if (route.sourceFile === null) return true;
  const file = normalizeProjectPath(route.sourceFile);
  return !state.patchedPaths.has(file) && !state.deletedPaths.has(file);
}

function routeLabel(route: RouteFacts): string {
  return (route.method ?? "?") + " " + (route.path ?? route.sourceFile ?? "<unknown route>");
}

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

export function routeDbTablesErrors(
  state: EffectiveState,
  context: PatchContext,
): ValidationError[] {
  const lookup = tableLookup(state.schemaTables);
  const errors: ValidationError[] = [];
  for (const source of routeSources(state)) {
    const tables = arrayProperty(source.content, source.masked, "dbTables");
    for (const table of tables ?? []) {
      if (lookup.has(table)) continue;
      errors.push(
        error(
          "db-tables-valid",
          source.path,
          'dbTables references table "' + table + '", which is not in the schema.',
          "Use a table declared in db/schema.ts (or added by this patch), or drop the reference.",
        ),
      );
    }
  }
  for (const route of context.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const table of route.dbTables) {
      if (!state.removedTables.includes(table)) continue;
      errors.push(
        error(
          "db-tables-valid",
          route.sourceFile ?? "<manifest>",
          'The patch removes table "' +
            table +
            '", which the existing route ' +
            routeLabel(route) +
            " still references.",
          "Update the route (or delete it) in the same patch, or keep the table.",
        ),
      );
    }
  }
  return errors;
}

function removedColumns(state: EffectiveState): { table: string; column: string }[] {
  const before = new Map(state.beforeSchemaTables.map((table) => [table.name, table]));
  const removed: { table: string; column: string }[] = [];
  for (const table of state.afterSchemaTables) {
    const previous = before.get(table.name);
    if (previous === undefined || previous.columns.length === 0 || table.columns.length === 0)
      continue;
    for (const column of previous.columns) {
      if (!table.columns.includes(column)) removed.push({ table: table.name, column });
    }
  }
  return removed;
}

export function routeDbColumnsWarnings(
  state: EffectiveState,
  context: PatchContext,
): ValidationError[] {
  const lookup = tableLookup(state.schemaTables);
  const warnings: ValidationError[] = [];
  const warn = (file: string, message: string, fix_hint: string): void => {
    warnings.push({ rule: "db-columns-valid", severity: "warning", file, message, fix_hint });
  };
  for (const source of routeSources(state)) {
    for (const reference of arrayProperty(source.content, source.masked, "dbColumns") ?? []) {
      if (!COLUMN_REFERENCE.test(reference)) {
        warn(
          source.path,
          '"' + reference + '" is not a "table.column" reference.',
          "Declare dbColumns entries as table.column using schema names.",
        );
        continue;
      }
      const [tableName, columnName] = reference.split(".");
      if (tableName === undefined || columnName === undefined) continue;
      const table = lookup.get(tableName);
      if (table === undefined) {
        warn(
          source.path,
          'dbColumns references table "' + tableName + '", which is not in the schema.',
          "Use a table declared in db/schema.ts.",
        );
      } else if (table.columns.length > 0 && !table.columns.includes(columnName)) {
        warn(
          source.path,
          'dbColumns references unknown column "' + columnName + '" on table "' + tableName + '".',
          "Use a column the schema declares, or update dbColumns with the patch.",
        );
      }
    }
  }
  const dropped = removedColumns(state);
  for (const route of context.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const reference of route.dbColumns) {
      const removed = dropped.some((entry) => entry.table + "." + entry.column === reference);
      if (!removed) continue;
      warn(
        route.sourceFile ?? "<manifest>",
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

function permissionsOf(source: { content: string; masked: string }): {
  present: boolean;
  values: string[];
} {
  const list = arrayProperty(source.content, source.masked, "permission");
  if (list !== null) return { present: true, values: list };
  const single = stringProperty(source.masked, "permission");
  if (single !== null) return { present: true, values: [single] };
  return { present: false, values: [] };
}

export function permissionErrors(state: EffectiveState, context: PatchContext): ValidationError[] {
  const declared = new Set(state.config.permissions);
  const errors: ValidationError[] = [];
  for (const source of routeSources(state)) {
    const permission = permissionsOf(source);
    if (!permission.present) {
      errors.push(
        error(
          "permission-valid",
          source.path,
          "Route config must declare permission ([] for a public route).",
          'Add permission: ["..."] or permission: [] to defineAuthorizedHandler (SPEC §7.4).',
        ),
      );
      continue;
    }
    for (const value of permission.values) {
      if (declared.has(value)) continue;
      errors.push(
        error(
          "permission-valid",
          source.path,
          'Permission "' + value + '" is not declared in facilis.config.ts.',
          "Declare it in auth.permissions (and roles) in the same patch, or use an existing permission.",
        ),
      );
    }
  }
  for (const route of context.routes) {
    if (!untouchedByPatch(route, state)) continue;
    for (const permission of route.permissions) {
      if (!state.removedPermissions.includes(permission)) continue;
      errors.push(
        error(
          "permission-valid",
          route.sourceFile ?? "<manifest>",
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
