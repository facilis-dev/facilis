// The migration the framework generates for a schema patch (D-109).
//
// The IDE has no drizzle-kit: the generated project ships db/migrations/*.sql and Nitro
// applies them at dev boot. The model must not write SQL itself, so this module turns the
// analyzer's pre/post schema facts into the migration drizzle-kit would have produced.
//
// Pure and testable: facts in, statements out. The rendering lives in migration-sql.ts;
// this module owns the diff and the statements that must run after every table exists.

import type { Analysis, ColumnFact, TableFact } from "@facilis/analyze";
import {
  columnSql,
  defaultClause,
  foreignKeyStatement,
  policyStatements,
  quote,
  type MigrationProblem,
} from "./migration-sql";

export type { MigrationProblem } from "./migration-sql";

export type SchemaMigrationResult =
  | { readonly ok: true; readonly statements: readonly string[] }
  | { readonly ok: false; readonly problems: readonly MigrationProblem[] };

function signature(...parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

function constraintSignature(table: TableFact): string {
  return signature(
    table.primaryKey,
    table.columns.filter((column) => column.unique).map((column) => column.name),
    table.foreignKeys.map((fk) =>
      signature(fk.columns, fk.targetTable, fk.targetColumns, fk.onDelete, fk.onUpdate),
    ),
    table.rlsEnabled,
    table.policies.map((policy) => signature(policy.name, policy.command, policy.restrictive)),
  );
}

function databaseSignature(column: ColumnFact): string {
  return signature(column.type, column.notNull, column.default?.kind, column.default?.value);
}

/** CREATE TABLE plus the statements that must run after every table exists. */
function createTable(
  table: TableFact,
  config: Analysis["config"],
  problems: MigrationProblem[],
): { create: string | null; after: string[] } {
  if (table.unknown.length > 0) {
    problems.push({
      message: 'table "' + table.name + '" has declarations the framework cannot read.',
      fixHint:
        "Declare the table with pgTable and documented column builders so its DDL can be generated.",
    });
    return { create: null, after: [] };
  }
  const columns = table.columns.map((column) => columnSql(column, problems));
  if (columns.some((sql) => sql === null)) return { create: null, after: [] };
  const constraints: string[] = [];
  if (table.primaryKey.length > 0) {
    constraints.push(
      "CONSTRAINT " +
        quote(table.name + "_" + table.primaryKey.join("_") + "_pk") +
        " PRIMARY KEY(" +
        table.primaryKey.map(quote).join(", ") +
        ")",
    );
  }
  for (const column of table.columns) {
    if (!column.unique) continue;
    constraints.push(
      "CONSTRAINT " +
        quote(table.name + "_" + column.name + "_unique") +
        " UNIQUE(" +
        quote(column.name) +
        ")",
    );
  }
  const lines = [...columns.filter((sql): sql is string => sql !== null), ...constraints];
  return {
    create: "CREATE TABLE " + quote(table.name) + " (\n\t" + lines.join(",\n\t") + "\n);",
    after: [
      ...policyStatements(table, config, problems),
      ...table.foreignKeys.map((fk) => foreignKeyStatement(table, fk)),
    ],
  };
}

/** ALTER statements for a table that already existed before the patch. */
function alterTable(before: TableFact, after: TableFact, problems: MigrationProblem[]): string[] {
  const table = quote(after.name);
  if (constraintSignature(before) !== constraintSignature(after)) {
    problems.push({
      message:
        'the patch changes the keys, foreign keys or RLS policies of existing table "' +
        after.name +
        '".',
      fixHint:
        "Keep the existing primary key, unique columns, foreign keys and isolation policies; change columns only, or add a new table instead.",
    });
    return [];
  }
  const statements: string[] = [];
  const beforeColumns = new Map(before.columns.map((column) => [column.name, column]));
  const afterColumns = new Map(after.columns.map((column) => [column.name, column]));
  for (const column of before.columns) {
    if (!afterColumns.has(column.name)) {
      statements.push("ALTER TABLE " + table + " DROP COLUMN " + quote(column.name) + ";");
    }
  }
  for (const column of after.columns) {
    const previous = beforeColumns.get(column.name);
    if (previous === undefined) {
      const rendered = columnSql(column, problems);
      if (rendered === null) continue;
      const hasDefault = column.default !== null || column.builder === "tenantColumn";
      if (column.notNull && !hasDefault) {
        problems.push({
          message:
            'column "' +
            column.name +
            '" is NOT NULL without a default on existing table "' +
            after.name +
            '".',
          fixHint:
            "Give the column a default (or make it nullable): existing rows need a value before NOT NULL can apply.",
        });
        continue;
      }
      statements.push("ALTER TABLE " + table + " ADD COLUMN " + rendered + ";");
      continue;
    }
    if (previous.unknown.length > 0 || column.unknown.length > 0) {
      problems.push({
        message:
          'column "' +
          column.name +
          '" on "' +
          after.name +
          '" has facts the framework cannot read.',
        fixHint: "Use documented builders with static arguments so the change can be migrated.",
      });
      continue;
    }
    const columnRef = "ALTER TABLE " + table + " ALTER COLUMN " + quote(column.name);
    if (previous.type !== column.type) {
      statements.push(columnRef + " TYPE " + column.type + ";");
    }
    if (databaseSignature(previous) !== databaseSignature(column)) {
      const clause = defaultClause(column, problems);
      statements.push(
        clause === null ? columnRef + " DROP DEFAULT;" : columnRef + " SET DEFAULT " + clause + ";",
      );
    }
    if (previous.notNull !== column.notNull) {
      statements.push(columnRef + (column.notNull ? " SET NOT NULL;" : " DROP NOT NULL;"));
    }
  }
  return statements;
}

/** The migration statements for a schema patch; empty when the schema did not change. */
export function schemaMigration(input: {
  readonly before: Analysis;
  readonly after: Analysis;
}): SchemaMigrationResult {
  const problems: MigrationProblem[] = [];
  const creates: string[] = [];
  const afterAll: string[] = [];
  const alters: string[] = [];
  const beforeTables = new Map(input.before.tables.map((table) => [table.name, table]));
  const afterTables = new Map(input.after.tables.map((table) => [table.name, table]));
  for (const table of input.after.tables) {
    const previous = beforeTables.get(table.name);
    if (previous === undefined) {
      const created = createTable(table, input.after.config, problems);
      if (created.create !== null) creates.push(created.create);
      afterAll.push(...created.after);
      continue;
    }
    alters.push(...alterTable(previous, table, problems));
  }
  for (const table of input.before.tables) {
    if (!afterTables.has(table.name)) {
      alters.push("DROP TABLE " + quote(table.name) + ";");
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, statements: [...creates, ...alters, ...afterAll] };
}
