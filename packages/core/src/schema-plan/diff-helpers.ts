import type { ColumnSnapshot, EnumSnapshot, SchemaSnapshot, TableSnapshot } from "@facilis/db";

import type { BatchDraft } from "./draft.ts";
import { compareText } from "./render.ts";
import type { SchemaPlanProblem } from "./types.ts";

/** Mutable state shared by the phase functions; `plan.ts` owns the order. */
export interface PlanContext {
  fromTables: Map<string, TableSnapshot>;
  toTables: Map<string, TableSnapshot>;
  fromEnums: Map<string, EnumSnapshot>;
  toEnums: Map<string, EnumSnapshot>;
  drafts: BatchDraft[];
  problems: SchemaPlanProblem[];
}

export function createContext(from: SchemaSnapshot, to: SchemaSnapshot): PlanContext {
  return {
    fromTables: new Map(from.tables.map((table) => [table.name, table])),
    toTables: new Map(to.tables.map((table) => [table.name, table])),
    fromEnums: new Map((from.enums ?? []).map((entry) => [entry.name, entry])),
    toEnums: new Map((to.enums ?? []).map((entry) => [entry.name, entry])),
    drafts: [],
    problems: [],
  };
}

/** Sorted enum entries of a side; deterministic whatever order the snapshot was built in. */
export function enumList(source: Map<string, EnumSnapshot>): EnumSnapshot[] {
  return [...source.values()].toSorted((left, right) => compareText(left.name, right.name));
}

export function tableList(source: Map<string, TableSnapshot>): TableSnapshot[] {
  return [...source.values()].toSorted(byTableName);
}

function byTableName(left: TableSnapshot, right: TableSnapshot): number {
  return compareText(left.name, right.name);
}

/** Tables present before and after: column/constraint/RLS changes happen here. */
export function survivingTables(context: PlanContext): TableSnapshot[] {
  return tableList(context.toTables).filter((table) => context.fromTables.has(table.name));
}

/** Tables only in `to`: created in phase 2. */
export function addedTables(context: PlanContext): TableSnapshot[] {
  return tableList(context.toTables).filter((table) => !context.fromTables.has(table.name));
}

/** Tables only in `from`: policies/constraints/indexes dropped in phase 1, table in phase 9. */
export function removedTables(context: PlanContext): TableSnapshot[] {
  return tableList(context.fromTables).filter((table) => !context.toTables.has(table.name));
}

export function columnsByName(table: TableSnapshot): Map<string, ColumnSnapshot> {
  return new Map(table.columns.map((column) => [column.name, column]));
}

/** Ordered names of the `from` columns that disappear while the table survives. */
export function droppedColumns(table: TableSnapshot, next: TableSnapshot): string[] {
  const kept = new Set(next.columns.map((column) => column.name));
  return table.columns.filter((column) => !kept.has(column.name)).map((column) => column.name);
}

/** RLS-scoped tables are the ones D-136 protects; `scopeColumn` is how the snapshot marks them. */
export function isScoped(table: TableSnapshot | undefined): boolean {
  return table?.scopeColumn !== undefined;
}

export function hasColumns(table: TableSnapshot, columns: readonly string[]): boolean {
  const names = new Set(table.columns.map((column) => column.name));
  return columns.every((column) => names.has(column));
}

export function addDraft(context: PlanContext, draft: BatchDraft): void {
  context.drafts.push(draft);
}
