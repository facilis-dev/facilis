import { diagnostic } from "../diagnostics.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { Diagnostic, ForeignKeyFact, TableFact } from "../types.ts";
import type { TableDraft } from "./schema-tables.ts";

export interface TableLookup {
  /** `file#binding` -> table name; the key keeps same-named bindings in different modules apart. */
  readonly byBinding: ReadonlyMap<string, string>;
  readonly byName: ReadonlyMap<string, TableDraft>;
}

export function buildTableLookup(drafts: readonly TableDraft[]): TableLookup {
  const byBinding = new Map<string, string>();
  const byName = new Map<string, TableDraft>();
  for (const draft of drafts) {
    if (draft.binding !== null) {
      byBinding.set(draft.fact.source.file + "#" + draft.binding, draft.fact.name);
    }
    byName.set(draft.fact.name, draft);
  }
  return { byBinding, byName };
}

/**
 * Add lookups for tables a DSL call expands to but the analysis does not emit: a generated
 * `fileLinks` FK points at the framework's `facilis_files`, whose source is absent from a
 * release-ref map. The extra tables resolve FK targets only; they never reach `tables`.
 */
export function withFrameworkTables(
  lookup: TableLookup,
  tables: readonly TableDraft[],
): TableLookup {
  if (tables.length === 0) return lookup;
  const byBinding = new Map(lookup.byBinding);
  const byName = new Map(lookup.byName);
  for (const table of tables) {
    if (!byName.has(table.fact.name)) byName.set(table.fact.name, table);
    if (table.binding === null) continue;
    const key = table.fact.source.file + "#" + table.binding;
    if (!byBinding.has(key)) byBinding.set(key, table.fact.name);
  }
  return { byBinding, byName };
}

/** Resolve a table identifier used in the DSL (local const or any project/framework import). */
export function resolveTableBinding(
  graph: ModuleGraph,
  filePath: string,
  local: string,
  lookup: TableLookup,
): string | null {
  const binding = graph.resolveBinding(filePath, local);
  if (binding !== null) {
    const table = lookup.byBinding.get(binding.file + "#" + binding.name);
    if (table !== undefined) return table;
  }
  return lookup.byBinding.get(filePath + "#" + local) ?? null;
}

export function finalizeTables(
  graph: ModuleGraph,
  drafts: readonly TableDraft[],
  lookup: TableLookup,
): { tables: TableFact[]; diagnostics: Diagnostic[] } {
  const tables: TableFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const draft of drafts) {
    const foreignKeys: ForeignKeyFact[] = [];
    for (const reference of draft.references) {
      const table = draft.fact.name;
      const targetTable = resolveTableBinding(
        graph,
        draft.fact.source.file,
        reference.target.binding,
        lookup,
      );
      if (targetTable === null) {
        diagnostics.push(
          diagnostic(
            "fk-target-known",
            "warning",
            'table "' + table + '" references unknown table "' + reference.target.binding + '"',
            reference.target.source,
          ),
        );
        continue;
      }
      const targetDraft = lookup.byName.get(targetTable);
      const knownColumn = targetDraft?.fact.columns.some(
        (column) => column.property === reference.target.property,
      );
      if (knownColumn !== true) {
        diagnostics.push(
          diagnostic(
            "fk-target-known",
            "warning",
            'table "' +
              table +
              '" references unknown column "' +
              targetTable +
              "." +
              reference.target.property +
              '"',
            reference.target.source,
          ),
        );
        continue;
      }
      foreignKeys.push({
        columns: [reference.column],
        targetTable,
        targetColumns: [reference.target.property],
        onDelete: reference.target.onDelete,
        onUpdate: reference.target.onUpdate,
        source: reference.target.source,
      });
    }
    tables.push({ ...draft.fact, foreignKeys });
  }
  return { tables, diagnostics };
}
