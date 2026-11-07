/**
 * Rules 10 `rls-on-scoped-table`, 14 `migration-generated` and 15
 * `destructive-confirmed` (SPEC §9.3), read from the effective code schema.
 *
 * Only tables the project declares itself count (`source.file === db/schema.ts`): the
 * framework tables re-exported from `@facilis/auth` ship their own RLS and must not be
 * re-flagged here. Scope is the analyzer's ScopeFact or a tenant/owner column property.
 */

import type { EffectiveState } from "../overlay.ts";
import { hasMigrationPatch, SCHEMA_PATH } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { FilePatch, TableFact, ValidationError } from "../types.ts";

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

function warning(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "warning", file, message, fix_hint };
}

/** True when this patch set touches the project schema file (create, update or delete). */
function touchesSchema(state: EffectiveState): boolean {
  return state.patchedPaths.has(SCHEMA_PATH) || state.deletedPaths.has(SCHEMA_PATH);
}

function normalized(value: string): string {
  return value.replaceAll("_", "").replaceAll("-", "").toLowerCase();
}

/** A table is scoped when the analyzer saw a scope or a configured tenant/owner column. */
function isScoped(
  table: TableFact,
  tenantColumns: readonly string[],
  ownerColumns: readonly string[],
): boolean {
  if (table.scope !== null) return true;
  const names = new Set([...tenantColumns, ...ownerColumns].map(normalized));
  return table.columns.some(
    (column) => names.has(normalized(column.property)) || names.has(normalized(column.name)),
  );
}

/**
 * Rule 10: a schema rewrite is a complete re-emission of the schema, so every scoped table
 * in the result must ship its RLS policy — .enableRLS() plus a policy (invariant 4). The
 * check is not limited to new tables: dropping the policy from an existing scoped table is
 * the same security regression.
 */
export function rlsErrors(state: EffectiveState): ValidationError[] {
  if (!touchesSchema(state)) return [];
  const errors: ValidationError[] = [];
  for (const table of state.afterSchemaTables) {
    if (!isScoped(table, state.config.tenantColumns, state.config.ownerColumns)) continue;
    if (table.rlsEnabled && table.policies.length > 0) continue;
    errors.push(
      error(
        "rls-on-scoped-table",
        SCHEMA_PATH,
        'Scoped table "' + table.name + '" has no RLS policy in the patched db/schema.ts.',
        "Add .enableRLS() and a tenantIsolationPolicy()/ownerIsolationPolicy() (or pgPolicy) to the table in db/schema.ts (invariant 4).",
      ),
    );
  }
  return errors;
}

/** Rule 14: a schema edit must ship a generated migration file (warning). */
export function migrationWarnings(
  patches: readonly FilePatch[],
  state: EffectiveState,
): ValidationError[] {
  const touches = patches.some((patch) => {
    const path = normalizeProjectPath(patch.path);
    return path === SCHEMA_PATH && patch.action !== "delete";
  });
  if (!touches) return [];
  if (hasMigrationPatch(patches, state.migrationsDir)) return [];
  return [
    warning(
      "migration-generated",
      SCHEMA_PATH,
      "The patch changes the schema without shipping a migration.",
      "Add the drizzle-kit generated migration (.sql) under " +
        state.migrationsDir +
        "/ in the same patch.",
    ),
  ];
}

function removedColumns(before: readonly TableFact[], after: readonly TableFact[]): string[] {
  const afterByName = new Map(after.map((table) => [table.name, table]));
  const removed: string[] = [];
  for (const table of before) {
    const current = afterByName.get(table.name);
    if (current === undefined || table.columns.length === 0 || current.columns.length === 0) {
      continue;
    }
    const currentColumns = new Set(current.columns.map((column) => column.property));
    for (const column of table.columns) {
      if (!currentColumns.has(column.property)) removed.push(table.name + "." + column.property);
    }
  }
  return removed;
}

/** Rule 15: dropping a table or column is destructive and must be confirmed. */
export function destructiveErrors(
  state: EffectiveState,
  requiresConfirmation: boolean,
): ValidationError[] {
  const afterNames = new Set(state.afterSchemaTables.map((table) => table.name));
  const droppedTables = state.beforeSchemaTables
    .map((table) => table.name)
    .filter((name) => !afterNames.has(name));
  const droppedColumns = removedColumns(state.beforeSchemaTables, state.afterSchemaTables);
  const changes = [
    ...droppedTables.map((name) => 'drops table "' + name + '"'),
    ...droppedColumns.map((name) => 'drops column "' + name + '"'),
  ];
  if (changes.length === 0 || requiresConfirmation) return [];
  const shown = changes.slice(0, 3).join(", ");
  const suffix = changes.length > 3 ? " (and " + (changes.length - 3) + " more)" : "";
  return [
    error(
      "destructive-confirmed",
      SCHEMA_PATH,
      "Destructive schema change without confirmation: the patch " + shown + suffix + ".",
      "If the removal was not intended, re-emit the complete db/schema.ts keeping every existing table and column and add only the requested change. For a deliberate removal, set requires_confirmation to true and explain it in notes (SPEC §9.2 rule 9 / §9.3 rule 15).",
    ),
  ];
}
