/**
 * Rules 10 `rls-on-scoped-table`, 14 `migration-generated` and 15
 * `destructive-confirmed` (SPEC §9.3), read from the effective code schema.
 */

import { hasMigrationPatch, SCHEMA_PATH, type EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { FilePatch, TableFacts, ValidationError } from "../types.ts";

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

function warning(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "warning", file, message, fix_hint };
}

/**
 * Rule 10: a schema rewrite is a complete re-emission of db/schema.ts, so every scoped
 * table in the result must ship its RLS policy — `.enableRLS()` plus a policy helper
 * (invariant 4). The check is not limited to new tables: dropping the policy from an
 * existing scoped table is the same security regression.
 */
export function rlsErrors(state: EffectiveState): ValidationError[] {
  if (!state.patchedPaths.has(SCHEMA_PATH) && !state.deletedPaths.has(SCHEMA_PATH)) return [];
  const errors: ValidationError[] = [];
  for (const table of state.afterSchemaTables) {
    if (!table.scoped) continue;
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
  const touchesSchema = patches.some((patch) => {
    const path = normalizeProjectPath(patch.path);
    return path === SCHEMA_PATH && patch.action !== "delete";
  });
  if (!touchesSchema) return [];
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

function removedColumns(before: readonly TableFacts[], after: readonly TableFacts[]): string[] {
  const afterByName = new Map(after.map((table) => [table.name, table]));
  const removed: string[] = [];
  for (const table of before) {
    const current = afterByName.get(table.name);
    if (current === undefined || table.columns.length === 0 || current.columns.length === 0)
      continue;
    for (const column of table.columns) {
      if (!current.columns.includes(column)) removed.push(table.name + "." + column);
    }
  }
  return removed;
}

/** Rule 15: dropping a table or column is destructive and must be confirmed. */
export function destructiveErrors(
  state: EffectiveState,
  requiresConfirmation: boolean,
): ValidationError[] {
  if (!state.patchedPaths.has(SCHEMA_PATH) && !state.deletedPaths.has(SCHEMA_PATH)) return [];
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
      "Set requires_confirmation to true in the response (SPEC §9.2 rule 9 / §9.3 rule 15).",
    ),
  ];
}
