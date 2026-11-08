// SQL rendering for the framework-generated migrations (D-109): column definitions,
// defaults, RLS policies and foreign keys, in the shapes @facilis/db's RLS plugin and
// drizzle-kit produce. The diff that decides *which* statements to emit lives in
// schema-migration.ts; this module only renders facts as SQL.
//
// Facts come from the analyzer. A fact the analyzer marks unknown is a problem, never a
// guess: the turn loop turns the problem into a repair finding for the model.

import type { ColumnFact, ConfigFacts, ForeignKeyFact, TableFact } from "@facilis/analyze";

export interface MigrationProblem {
  /** Model-facing detail: what the framework cannot render, and why. */
  readonly message: string;
  /** What the model should change in db/schema.ts instead. */
  readonly fixHint: string;
}

/** How `tenantColumn()` fills the column (packages/db/src/tenant-column.ts, D-040). */
export const TENANT_DEFAULT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

const NUMERIC_TYPES = new Set([
  "integer",
  "smallint",
  "bigint",
  "real",
  "double precision",
  "numeric",
  "serial",
  "bigserial",
  "smallserial",
]);

const TENANT_PREDICATE = (column: string) =>
  column + " = nullif(current_setting('app.tenant_id', true), '')::uuid";
const OWNER_PREDICATE = (column: string) =>
  column + " = nullif(current_setting('app.user_id', true), '')::uuid";

export function quote(identifier: string): string {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

export function columnMatches(column: ColumnFact, names: readonly string[]): boolean {
  const property = column.property.replaceAll("_", "").replaceAll("-", "").toLowerCase();
  const sqlName = column.name.replaceAll("_", "").replaceAll("-", "").toLowerCase();
  return names.some((name) => {
    const candidate = name.replaceAll("_", "").replaceAll("-", "").toLowerCase();
    return candidate === property || candidate === sqlName;
  });
}

export function tenantColumnOf(table: TableFact, config: ConfigFacts): ColumnFact | undefined {
  return (
    table.columns.find((column) => column.builder === "tenantColumn") ??
    table.columns.find((column) => columnMatches(column, config.tenantColumns))
  );
}

export function ownerColumnOf(table: TableFact, config: ConfigFacts): ColumnFact | undefined {
  return table.columns.find((column) => columnMatches(column, config.ownerColumns));
}

function literalDefault(column: ColumnFact, value: string, problems: MigrationProblem[]): string {
  if (column.type === "boolean") {
    if (value === "true" || value === "false") return value;
    problems.push({
      message: 'boolean column "' + column.name + '" has a non-boolean default "' + value + '".',
      fixHint: "Use a true/false literal with .default() so the migration can render it.",
    });
    return "false";
  }
  if (NUMERIC_TYPES.has(column.type)) {
    if (/^-?\d+(\.\d+)?$/.test(value)) return value;
    problems.push({
      message: 'numeric column "' + column.name + '" has a non-numeric default "' + value + '".',
      fixHint: "Use a numeric literal with .default() so the migration can render it.",
    });
    return "0";
  }
  if (value === "null") return "null";
  return "'" + value.replaceAll("'", "''") + "'";
}

/** The DEFAULT clause, or null when the column has none. */
export function defaultClause(column: ColumnFact, problems: MigrationProblem[]): string | null {
  const declared = column.default;
  if (declared === null) return null;
  switch (declared.kind) {
    case "now":
      return "now()";
    case "random":
      if (!column.type.startsWith("uuid")) {
        problems.push({
          message: 'defaultRandom() on "' + column.name + '" is only rendered for uuid columns.',
          fixHint: "Use .defaultRandom() on a uuid column, or give the column an explicit default.",
        });
        return null;
      }
      return "gen_random_uuid()";
    case "literal":
      return literalDefault(column, declared.value ?? "null", problems);
    case "unknown":
      problems.push({
        message:
          'the default of "' + column.name + '" is a SQL expression the framework cannot render.',
        fixHint:
          "Use .default(), .defaultNow() or .defaultRandom(); a custom SQL default belongs in a hand-written migration.",
      });
      return null;
  }
}

/** One column definition for CREATE TABLE / ADD COLUMN. Null when a fact is missing. */
export function columnSql(column: ColumnFact, problems: MigrationProblem[]): string | null {
  if (column.unknown.length > 0 || column.type === "unknown") {
    problems.push({
      message:
        'column "' + column.name + '" uses a builder or arguments outside the documented DSL.',
      fixHint:
        "Use a documented pg-core builder with static arguments so the migration can be generated.",
    });
    return null;
  }
  // tenantColumn() is uuid(name).notNull().default(tenantDefaultSql()) inside @facilis/db:
  // the analyzer sees the helper call, not those methods, so its DDL is known here.
  if (column.builder === "tenantColumn") {
    return quote(column.name) + " uuid NOT NULL DEFAULT " + TENANT_DEFAULT;
  }
  let rendered = quote(column.name) + " " + column.type;
  if (column.primaryKey) rendered += " PRIMARY KEY";
  const clause = defaultClause(column, problems);
  if (clause !== null) rendered += " DEFAULT " + clause;
  if (column.notNull) rendered += " NOT NULL";
  return rendered;
}

function policyStatement(
  name: string,
  table: string,
  kind: "RESTRICTIVE" | "PERMISSIVE",
  predicate: string,
): string {
  return (
    "CREATE POLICY " +
    quote(name) +
    " ON " +
    quote(table) +
    " AS " +
    kind +
    " FOR ALL TO public USING (" +
    predicate +
    ") WITH CHECK (" +
    predicate +
    ");"
  );
}

/** RLS and its policies for a table the patch creates. */
export function policyStatements(
  table: TableFact,
  config: ConfigFacts,
  problems: MigrationProblem[],
): string[] {
  if (!table.rlsEnabled) return [];
  const statements = ["ALTER TABLE " + quote(table.name) + " ENABLE ROW LEVEL SECURITY;"];
  for (const policy of table.policies) {
    if (policy.unknown.length > 0) {
      problems.push({
        message: 'policy "' + policy.name + '" on "' + table.name + '" could not be read.',
        fixHint: "Use tenantIsolationPolicy()/ownerIsolationPolicy() so its SQL can be generated.",
      });
      continue;
    }
    if (policy.name === "tenant_isolation") {
      const column = tenantColumnOf(table, config);
      if (!policy.restrictive || policy.command !== "ALL" || column === undefined) {
        problems.push({
          message: 'policy "tenant_isolation" on "' + table.name + '" has an unexpected shape.',
          fixHint:
            "Use tenantIsolationPolicy() unchanged; its column comes from .tenantColumn() or config.db.tenantColumns.",
        });
        continue;
      }
      statements.push(
        policyStatement(
          "tenant_isolation",
          table.name,
          "RESTRICTIVE",
          TENANT_PREDICATE(quote(column.name)),
        ),
      );
      continue;
    }
    if (policy.name === "owner_isolation") {
      const column = ownerColumnOf(table, config);
      if (policy.restrictive || policy.command !== "ALL" || column === undefined) {
        problems.push({
          message: 'policy "owner_isolation" on "' + table.name + '" has an unexpected shape.',
          fixHint:
            "Use ownerIsolationPolicy() on a table with an owner column (config.db.ownerColumns).",
        });
        continue;
      }
      statements.push(
        policyStatement(
          "owner_isolation",
          table.name,
          "PERMISSIVE",
          OWNER_PREDICATE(quote(column.name)),
        ),
      );
      continue;
    }
    problems.push({
      message:
        'policy "' + policy.name + '" on "' + table.name + '" is not a standard isolation policy.',
      fixHint:
        "Use tenantIsolationPolicy()/ownerIsolationPolicy(); a custom pgPolicy expression is not generated automatically.",
    });
  }
  return statements;
}

function actionSql(action: string | null): string {
  return action === null ? "no action" : action;
}

export function foreignKeyStatement(table: TableFact, fk: ForeignKeyFact): string {
  const name = [table.name, ...fk.columns, fk.targetTable, ...fk.targetColumns, "fk"].join("_");
  return (
    "ALTER TABLE " +
    quote(table.name) +
    " ADD CONSTRAINT " +
    quote(name) +
    " FOREIGN KEY (" +
    fk.columns.map(quote).join(", ") +
    ") REFERENCES " +
    quote(fk.targetTable) +
    "(" +
    fk.targetColumns.map(quote).join(", ") +
    ") ON DELETE " +
    actionSql(fk.onDelete) +
    " ON UPDATE " +
    actionSql(fk.onUpdate) +
    ";"
  );
}
