import {
  addDraft,
  addedTables,
  columnsByName,
  droppedColumns,
  enumList,
  removedTables,
  survivingTables,
  tableList,
  type PlanContext,
} from "./diff-helpers.ts";
import { slug } from "./draft.ts";
import { addProblem } from "./problems.ts";
import {
  addColumnSql,
  alterColumnTypeSql,
  createTableSql,
  dropColumnSql,
  dropDefaultSql,
  dropNotNullSql,
  dropTableSql,
  foreignKeyName,
  quote,
  quoteLiteral,
  setDefaultSql,
  setNotNullSql,
} from "./render.ts";

/**
 * Phases that work on whole declarations: unsupported constructs, CREATE TYPE/TABLE and
 * added columns (phase 2), column tightening (phase 4), destructive drops (phase 9).
 */
export function planDeclarationProblems(context: PlanContext): void {
  planEnums(context);
  planUnsupportedDeclarations(context);
  planPrimaryKeyChanges(context);
}

/**
 * Enum changes are fail-closed in v1: adding a value needs ALTER TYPE ADD VALUE (unsupported
 * inside a transaction) and removing one is impossible without recreating the type, so a
 * value-set change is a problem, never a guessed ALTER.
 */
function planEnums(context: PlanContext): void {
  for (const entry of enumList(context.toEnums)) {
    const previous = context.fromEnums.get(entry.name);
    if (previous === undefined) continue;
    if (!sameValues(previous.values, entry.values)) {
      addProblem(context, "unsupported_change", { construct: `enum:${entry.name}` });
    }
  }
  for (const entry of enumList(context.fromEnums)) {
    if (!context.toEnums.has(entry.name)) {
      addProblem(context, "unsupported_change", { construct: `enum:${entry.name}` });
    }
  }
}

/** Identity/generated columns, advanced index shapes and dangling FKs cannot be rendered v1. */
function planUnsupportedDeclarations(context: PlanContext): void {
  for (const table of tableList(context.toTables)) {
    for (const column of table.columns) {
      if (column.identity !== undefined) {
        addProblem(context, "unsupported_declaration", {
          table: table.name,
          column: column.name,
          construct: `identity:${column.name}`,
        });
      }
      if (column.generated === true) {
        addProblem(context, "unsupported_declaration", {
          table: table.name,
          column: column.name,
          construct: `generated:${column.name}`,
        });
      }
    }
    // An advanced declaration that was already there needs no DDL, so it must not block a
    // release forever; only new shapes (or renamed/redefined ones) fail closed.
    const previousUnsupported = new Set(
      (context.fromTables.get(table.name)?.unsupported ?? []).map(
        (entry) => `${entry.construct}:${entry.name}`,
      ),
    );
    for (const unsupported of table.unsupported ?? []) {
      const token = `${unsupported.construct}:${unsupported.name}`;
      if (previousUnsupported.has(token)) continue;
      addProblem(context, "unsupported_declaration", { table: table.name, construct: token });
    }
    for (const foreignKey of table.foreignKeys) {
      const target = context.toTables.get(foreignKey.targetTable);
      const targetColumns = target === undefined ? undefined : columnsByName(target);
      const dangling =
        targetColumns === undefined ||
        foreignKey.targetColumns.some((column) => !targetColumns.has(column));
      if (dangling) {
        addProblem(context, "unsupported_change", {
          table: table.name,
          construct: `foreign_key:${foreignKeyName(table.name, foreignKey)}`,
        });
      }
    }
  }
}

/** Changing a primary key on an existing table is not renderable in v1 (add/drop only on create). */
function planPrimaryKeyChanges(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const before = previous.primaryKey ?? [];
    const after = table.primaryKey ?? [];
    if (!sameValues(before, after)) {
      addProblem(context, "unsupported_change", { table: table.name, construct: "primary_key" });
    }
  }
}

/** Phase 2: CREATE TYPE for new enums, CREATE TABLE, ADD COLUMN (nullable/defaulted). */
export function planCreates(context: PlanContext): void {
  for (const entry of enumList(context.toEnums)) {
    if (context.fromEnums.has(entry.name)) continue;
    addDraft(context, {
      slug: slug("create-type", entry.name),
      sql: `CREATE TYPE ${quote(entry.name)} AS ENUM (${entry.values.map(quoteLiteral).join(", ")});`,
      risk: "safe",
    });
  }
  for (const table of addedTables(context)) {
    addDraft(context, { slug: slug("create-table", table.name), sql: createTableSql(table), risk: "safe" });
  }
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const before = columnsByName(previous);
    for (const column of table.columns) {
      if (before.has(column.name) || column.identity !== undefined || column.generated === true) continue;
      const requires =
        column.notNull && column.default === null
          ? [`no_null_rows:${table.name}.${column.name}`]
          : undefined;
      addDraft(context, {
        slug: slug("add-column", table.name, column.name),
        sql: addColumnSql(table.name, column),
        risk: "careful",
        ...(requires === undefined ? {} : { requires }),
      });
    }
  }
}

/** Phase 4: type/default/nullability changes on columns that already existed. */
export function planAlterColumns(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const before = columnsByName(previous);
    for (const column of table.columns) {
      const old = before.get(column.name);
      if (old === undefined) continue;
      if (old.identity !== undefined && column.identity === undefined) {
        addProblem(context, "unsupported_change", {
          table: table.name,
          column: column.name,
          construct: `identity:${column.name}`,
        });
        continue;
      }
      if (old.generated === true && column.generated !== true) {
        addProblem(context, "unsupported_change", {
          table: table.name,
          column: column.name,
          construct: `generated:${column.name}`,
        });
        continue;
      }
      if (column.identity !== undefined || column.generated === true) continue;
      if (old.type !== column.type) {
        addDraft(context, {
          slug: slug("alter-type", table.name, column.name),
          sql: alterColumnTypeSql(table.name, column.name, column.type),
          risk: "destructive",
        });
      }
      if (old.default !== column.default) {
        addDraft(context, {
          slug: slug(column.default === null ? "drop-default" : "set-default", table.name, column.name),
          sql:
            column.default === null
              ? dropDefaultSql(table.name, column.name)
              : setDefaultSql(table.name, column.name, column.default),
          risk: "careful",
        });
      }
      if (old.notNull !== column.notNull) {
        addDraft(context, {
          slug: slug(column.notNull ? "set-not-null" : "drop-not-null", table.name, column.name),
          sql: column.notNull ? setNotNullSql(table.name, column.name) : dropNotNullSql(table.name, column.name),
          risk: "careful",
          ...(column.notNull
            ? { requires: [`no_null_rows:${table.name}.${column.name}`] }
            : {}),
        });
      }
    }
  }
}

/** Phase 9: the destructive batches run last, after every dependent drop in phase 1. */
export function planDestructiveDrops(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    for (const column of droppedColumns(previous, table)) {
      addDraft(context, {
        slug: slug("drop-column", table.name, column),
        sql: dropColumnSql(table.name, column),
        risk: "destructive",
      });
    }
  }
  for (const table of removedTables(context)) {
    addDraft(context, { slug: slug("drop-table", table.name), sql: dropTableSql(table.name), risk: "destructive" });
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}