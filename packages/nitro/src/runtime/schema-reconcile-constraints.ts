// The existing-table half of the dev reconcile (D-195, issue #49): defaults, checks,
// foreign keys and indexes the declaration has and the live database lacks or renders
// differently. Additive and replacement only — a replacement drops the SAME named construct
// it immediately re-adds (the release planner's own semantics), so no data is lost. A
// construct the declaration no longer mentions is left alone: removing it is a drop, and
// drops stay approval-gated through .facilis/dev/schema-approvals.json (D-193).

import {
  addCheckSql,
  addForeignKeySql,
  createIndexSql,
  dropConstraintSql,
  dropDefaultSql,
  dropIndexSql,
  setDefaultSql,
  type TableSnapshot,
} from "@facilis.dev/core";
import {
  normalizeSchemaExpression,
  type IndexSnapshot,
  type LiveForeignKeySnapshot,
  type LiveTableSnapshot,
} from "@facilis.dev/db";

/**
 * Defaults, checks and indexes of one existing table. They only reference the table's own
 * columns, so they run right after its missing columns were added.
 */
export function planTableConstraints(declared: TableSnapshot, live: LiveTableSnapshot): string[] {
  const statements: string[] = [];
  planDefaults(declared, live, statements);
  planChecks(declared, live, statements);
  planIndexes(declared, live, statements);
  return statements;
}

/**
 * Foreign keys run in a pass of their own, after every table's columns exist: a key may
 * point at a column another existing table gains in this same reconcile.
 */
export function planTableForeignKeys(declared: TableSnapshot, live: LiveTableSnapshot): string[] {
  const statements: string[] = [];
  const liveByKey = new Map<string, LiveForeignKeySnapshot>();
  for (const foreignKey of live.foreignKeys) {
    liveByKey.set(structuralKey(foreignKey), foreignKey);
  }
  for (const foreignKey of declared.foreignKeys) {
    const current = liveByKey.get(structuralKey(foreignKey));
    if (current === undefined) {
      statements.push(addForeignKeySql(declared.name, foreignKey));
      continue;
    }
    // SET DEFAULT is not renderable by the declared snapshot (SPEC §7.3): replacing the
    // live key would guess an action the declaration never stated, so it is left alone.
    if (current.onDelete === "set default" || current.onUpdate === "set default") continue;
    const onDelete = foreignKey.onDelete ?? "no action";
    const onUpdate = foreignKey.onUpdate ?? "no action";
    if (current.onDelete === onDelete && current.onUpdate === onUpdate) continue;
    statements.push(dropConstraintSql(declared.name, current.name));
    statements.push(addForeignKeySql(declared.name, foreignKey));
  }
  return statements;
}

function planDefaults(declared: TableSnapshot, live: LiveTableSnapshot, statements: string[]): void {
  const liveColumns = new Map(live.columns.map((column) => [column.name, column]));
  for (const column of declared.columns) {
    // Identity/generated columns own their value generation; a plain DEFAULT is not theirs.
    if (column.identity !== undefined || column.generated === true) continue;
    const current = liveColumns.get(column.name);
    if (current === undefined) continue;
    if (normalizeSchemaExpression(column.default) === normalizeSchemaExpression(current.default)) continue;
    statements.push(
      column.default === null
        ? dropDefaultSql(declared.name, column.name)
        : setDefaultSql(declared.name, column.name, column.default),
    );
  }
}

function planChecks(declared: TableSnapshot, live: LiveTableSnapshot, statements: string[]): void {
  const liveChecks = new Map(live.checks.map((check) => [check.name, check]));
  for (const check of declared.checks ?? []) {
    const current = liveChecks.get(check.name);
    if (current === undefined) {
      statements.push(addCheckSql(declared.name, check));
      continue;
    }
    if (normalizeSchemaExpression(current.expression) === normalizeSchemaExpression(check.expression)) continue;
    statements.push(dropConstraintSql(declared.name, current.name));
    statements.push(addCheckSql(declared.name, check));
  }
}

function planIndexes(declared: TableSnapshot, live: LiveTableSnapshot, statements: string[]): void {
  const unsupported = new Set(
    (declared.unsupported ?? [])
      .filter((entry) => entry.construct === "index")
      .map((entry) => entry.name),
  );
  const liveIndexes = new Map(live.indexes.map((index) => [index.name, index]));
  for (const index of declared.indexes ?? []) {
    // An unsupported declaration has no faithful DDL (D-158): never render it, never drop
    // the live index that may carry it.
    if (unsupported.has(index.name)) continue;
    if (index.columns.length === 0 && index.expression === undefined) continue;
    const current = liveIndexes.get(index.name);
    if (current === undefined) {
      statements.push(createIndexSql(declared.name, index));
      continue;
    }
    if (sameIndexDefinition(index, current)) continue;
    statements.push(dropIndexSql(index.name));
    statements.push(createIndexSql(declared.name, index));
  }
}

function sameIndexDefinition(declared: IndexSnapshot, live: LiveTableSnapshot["indexes"][number]): boolean {
  if (declared.unique !== live.unique) return false;
  if (declared.expression !== undefined || live.expression !== null) {
    return (
      normalizeSchemaExpression(declared.expression ?? null) ===
      normalizeSchemaExpression(live.expression)
    );
  }
  return (
    declared.columns.length === live.columns.length &&
    declared.columns.every((column, position) => column === live.columns[position])
  );
}

/** Columns + target identify a key; the actions are what a replacement may change. */
function structuralKey(foreignKey: {
  columns: readonly string[];
  targetTable: string;
  targetColumns: readonly string[];
}): string {
  return JSON.stringify([foreignKey.columns, foreignKey.targetTable, foreignKey.targetColumns]);
}
