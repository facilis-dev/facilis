/**
 * Rules 10 `rls-on-scoped-table`, 14 `migration-generated`, 15
 * `destructive-confirmed` and 20 `table-class-declared` (SPEC §9.3), read from the
 * effective code schema.
 *
 * Only tables the project declares itself count (`source.file === db/schema.ts`): the
 * framework tables re-exported from `@facilis.dev/auth` ship their own RLS and must not be
 * re-flagged here. Scope is the analyzer's ScopeFact or a tenant/owner column property.
 */

import { tableClassOf } from "@facilis.dev/analyze";

import { SCHEMA_PATH, type EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { FilePatch, TableFact, ValidationError } from "../types.ts";

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
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

/**
 * Rule 20: every project table in the resulting schema declares its access class
 * (invariant 4, D-136/D-211) — RLS-scoped (`.enableRLS()` plus a policy) or explicitly
 * system-only (the `// system-only` marker). Rule 10 covers scoped tables only; a plain
 * `pgTable` without RLS gets no app-role privilege and its routes fail closed at runtime,
 * so the class must be declared, not inferred. Like rule 10, the check audits every project
 * table in the re-emitted schema, not only the new ones. An unreadable marker (a parser that
 * exposes no comments) downgrades the finding to a warning: never a guessed error.
 */
export function tableClassFindings(state: EffectiveState): {
  errors: ValidationError[];
  warnings: ValidationError[];
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  if (!touchesSchema(state)) return { errors, warnings };
  for (const table of state.afterSchemaTables) {
    const declared = tableClassOf(table);
    if (declared === "rls-scoped" || declared === "system-only") continue;
    if (declared === "rls-no-policies") {
      warnings.push({
        rule: "table-class-declared",
        severity: "warning",
        file: SCHEMA_PATH,
        message:
          'Table "' +
          table.name +
          '" enables RLS but declares no policy in the patched db/schema.ts.',
        fix_hint:
          "Add a policy helper (tenantIsolationPolicy()/ownerIsolationPolicy() or pgPolicy) so the app role can reach its rows (invariant 4, D-136).",
      });
      continue;
    }
    const unreadable = table.unknown.some((entry) => entry.code === "schema-marker");
    if (unreadable) {
      warnings.push({
        rule: "table-class-declared",
        severity: "warning",
        file: SCHEMA_PATH,
        message:
          'Table "' +
          table.name +
          '" has no RLS and its system-only marker cannot be read; the access class is not provable.',
        fix_hint:
          'Declare the class explicitly: .enableRLS() with a policy, or a "// system-only" comment on the line above the declaration (invariant 4, D-136/D-211).',
      });
      continue;
    }
    errors.push(
      error(
        "table-class-declared",
        SCHEMA_PATH,
        'Table "' +
          table.name +
          '" declares no access class in the patched db/schema.ts: no RLS policy and no system-only marker.',
        'Add .enableRLS() and a policy helper (tenantIsolationPolicy()/ownerIsolationPolicy() or pgPolicy), or mark the table system-only with a "// system-only" comment on the line above its declaration. A table without RLS gets no app-role privilege and its routes fail closed at runtime (invariant 4, D-136/D-211).',
      ),
    );
  }
  return { errors, warnings };
}

// The directory is fixed: the folder is retired from generated projects (D-158), so it is not
// configurable and must not come back through the project config.
const RETIRED_MIGRATIONS_DIR = "db/migrations";

/**
 * Rule 14: DDL is generated, never authored (D-158). The release pipeline renders the SQL
 * from the schema diff between two tags, so a hand-written file under the migrations
 * directory can neither be reproduced from the tags nor reviewed as a schema change. A
 * write there is refused before anything lands; the schema is the only input.
 */
export function migrationErrors(patches: readonly FilePatch[]): ValidationError[] {
  const directory = RETIRED_MIGRATIONS_DIR;
  const authored = patches.find((patch) => {
    const path = normalizeProjectPath(patch.path);
    if (!path.startsWith(directory + "/")) return false;
    return patch.action === "create" || patch.action === "update";
  });
  if (authored === undefined) return [];
  return [
    error(
      "migration-generated",
      normalizeProjectPath(authored.path),
      "Migration SQL is generated at release from db/schema.ts, never authored (D-158).",
      "Change db/schema.ts and let the migration system render the DDL: there is no migration file to write under " +
        directory +
        "/.",
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

/** The schema removals in a patch set (rule 15's predicate), for callers that need the
 * fact without the finding (the IDE flags a write destructive, never blocks it). */
export function destructiveChanges(state: EffectiveState): string[] {
  const afterNames = new Set(state.afterSchemaTables.map((table) => table.name));
  const droppedTables = state.beforeSchemaTables
    .map((table) => table.name)
    .filter((name) => !afterNames.has(name));
  const droppedColumns = removedColumns(state.beforeSchemaTables, state.afterSchemaTables);
  return [
    ...droppedTables.map((name) => 'drops table "' + name + '"'),
    ...droppedColumns.map((name) => 'drops column "' + name + '"'),
  ];
}

/** Rule 15: dropping a table or column is destructive and must be confirmed. */
export function destructiveErrors(
  state: EffectiveState,
  requiresConfirmation: boolean,
): ValidationError[] {
  const changes = destructiveChanges(state);
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
