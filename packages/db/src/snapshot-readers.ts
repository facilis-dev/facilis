import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable, type PgColumn } from "drizzle-orm/pg-core";

import { DEFAULT_OWNER_COLUMNS, DEFAULT_TENANT_COLUMNS } from "./client.ts";
import { policyCreateSql } from "./rls.ts";
import type {
  ColumnSnapshot,
  IndexSnapshot,
  PolicyCommand,
  ScopeColumnSnapshot,
  TableSnapshot,
  UnsupportedDeclarationSnapshot,
} from "./snapshot.ts";

/**
 * The read half of the declared snapshot: Drizzle's table config -> the public shapes in
 * ./snapshot.ts. Kept separate so the contract file stays a contract.
 */

const dialect = new PgDialect();

export function snapshotTable(table: PgTable, enums: Map<string, string[]>): TableSnapshot {
  const config = getTableConfig(table);
  const primaryKey = primaryKeyColumns(config);
  const columns = config.columns.map((column) => snapshotColumn(column, primaryKey, enums));
  const unsupported: UnsupportedDeclarationSnapshot[] = [];
  const indexes = config.indexes.map((index) => snapshotIndex(index, config.name, unsupported));
  const snapshot: TableSnapshot = {
    name: config.name,
    rlsEnabled: config.enableRLS,
    columns,
    foreignKeys: config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      const onDelete = toForeignKeyAction(foreignKey.onDelete);
      const onUpdate = toForeignKeyAction(foreignKey.onUpdate);
      return {
        columns: reference.columns.map((column) => column.name),
        targetTable: getTableConfig(reference.foreignTable).name,
        targetColumns: reference.foreignColumns.map((column) => column.name),
        ...(onDelete === undefined ? {} : { onDelete }),
        ...(onUpdate === undefined ? {} : { onUpdate }),
      };
    }),
    policies: config.policies.map((policy) => ({
      name: policy.name,
      command: (policy.for ?? "all").toUpperCase() as PolicyCommand,
      using: policy.using === undefined ? null : dialect.sqlToQuery(policy.using).sql,
      withCheck: policy.withCheck === undefined ? null : dialect.sqlToQuery(policy.withCheck).sql,
      sql: policyCreateSql(config.name, policy),
    })),
    primaryKey,
    indexes,
    checks: config.checks.map((check) => ({
      name: check.name,
      expression: dialect.sqlToQuery(check.value).sql,
    })),
    uniqueConstraints: config.uniqueConstraints.map((constraint) => ({
      name:
        constraint.name ?? constraint.getName() ?? derivedUniqueName(config.name, constraint.columns),
      columns: constraint.columns.map((column) => column.name),
    })),
  };

  if (unsupported.length > 0) snapshot.unsupported = unsupported;
  const scopeColumn = detectScopeColumn(columns.map((column) => column.name));
  if (scopeColumn !== undefined) snapshot.scopeColumn = scopeColumn;
  return snapshot;
}

/** The table's ordered PK: a table-level `primaryKey()` wins over column-level `.primaryKey()`. */
function primaryKeyColumns(config: ReturnType<typeof getTableConfig>): string[] {
  const tableLevel = config.primaryKeys[0];
  if (tableLevel !== undefined) return tableLevel.columns.map((column) => column.name);
  return config.columns.filter((column) => column.primary).map((column) => column.name);
}

function snapshotColumn(
  column: PgColumn,
  primaryKey: readonly string[],
  enums: Map<string, string[]>,
): ColumnSnapshot {
  const type = column.getSQLType();
  const snapshot: ColumnSnapshot = {
    name: column.name,
    type,
    notNull: column.notNull,
    default: renderDefault(column.default, type),
    // A composite (table-level) PK is declared on the table, not on its columns, so
    // `column.primary` alone would disagree with the live catalog's indisprimary view.
    isPrimaryKey: column.primary || primaryKey.includes(column.name),
    isUnique: column.isUnique,
  };
  if (column.generatedIdentity !== undefined) snapshot.identity = column.generatedIdentity.type;
  if (column.generated !== undefined) snapshot.generated = true;
  const enumValues = column.enumValues;
  if (enumValues !== undefined && enumValues.length > 0) {
    recordEnum(enums, column.getSQLType().replace(/\[\]$/, ""), enumValues);
  }
  return snapshot;
}

/**
 * Enum columns expose their values and their SQL type is the enum name (`mood` or
 * `mood[]`). Two columns of the same enum must agree; a conflict is a broken declaration,
 * so it throws instead of picking one.
 */
function recordEnum(enums: Map<string, string[]>, name: string, values: readonly string[]): void {
  const existing = enums.get(name);
  if (existing === undefined) {
    enums.set(name, [...values]);
    return;
  }
  if (existing.length !== values.length || existing.some((value, index) => value !== values[index])) {
    throw new Error(
      `schema declares enum "${name}" with conflicting values: [${existing.join(", ")}] vs [${values.join(", ")}]`,
    );
  }
}

/**
 * Indexes are representable when they are a plain (optionally unique) b-tree over plain
 * columns, or a single SQL expression (the `lower(email)` case). Every other shape is
 * recorded as unsupported rather than misrendered.
 */
function snapshotIndex(
  index: ReturnType<typeof getTableConfig>["indexes"][number],
  tableName: string,
  unsupported: UnsupportedDeclarationSnapshot[],
): IndexSnapshot {
  const config = index.config;
  const columns = config.columns.map(indexColumnName);
  const expressions = config.columns.map(indexExpression);
  // A single expression is the only expression shape the flat snapshot can render: a mixed
  // or multi-expression index would lose the order between columns and expressions.
  const expression = config.columns.length === 1 ? (expressions[0] ?? null) : null;
  const hasExpression = expressions.some((entry) => entry !== null);
  const name = config.name ?? derivedIndexName(tableName, columns, expression, config.unique);
  const unsupportedShape =
    config.concurrently === true ||
    config.only === true ||
    config.where !== undefined ||
    config.with !== undefined ||
    (config.method !== undefined && config.method !== "btree") ||
    config.columns.some(
      (_, position) => columns[position] === null && expressions[position] === null,
    ) ||
    (hasExpression && expression === null);
  if (unsupportedShape) {
    unsupported.push({ construct: "index", name });
    return { name, columns: [], unique: config.unique };
  }
  if (expression !== null) {
    return { name, columns: [], unique: config.unique, expression };
  }
  return {
    name,
    columns: columns.filter((column): column is string => column !== null),
    unique: config.unique,
  };
}

/**
 * Drizzle keeps an expression index member as an `SQL` object instead of a `PgColumn`.
 * Its rendered SQL is the only faithful description of the index; a parameterized
 * expression is not replayable inside CREATE INDEX and stays unsupported.
 */
function indexExpression(column: unknown): string | null {
  if (!is(column, SQL)) return null;
  const query = dialect.sqlToQuery(column);
  return query.params.length === 0 ? query.sql : null;
}

function derivedIndexName(
  tableName: string,
  columns: readonly (string | null)[],
  expression: string | null,
  unique: boolean,
): string {
  let element = columns.filter((column): column is string => column !== null).join("_");
  if (expression !== null) {
    element =
      expression.replaceAll(/[^a-zA-Z0-9]+/gu, "_").replaceAll(/^_+|_+$/gu, "").toLowerCase() ||
      "expression";
  }
  return `${tableName}_${element}_${unique ? "unique_" : ""}idx`;
}

/** An index member that is not a plain ordered column returns null (unsupported shape). */
function indexColumnName(column: unknown): string | null {
  if (typeof column !== "object" || column === null) return null;
  const candidate = column as {
    name?: unknown;
    indexConfig?: { order?: unknown; nulls?: unknown; opClass?: unknown };
  };
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  const extra = candidate.indexConfig;
  // Drizzle fills the ascending defaults explicitly (`asc`/`last`); anything else is a
  // shape the plain-column rendering below would silently drop.
  const unsupported =
    extra !== undefined &&
    ((extra.order !== undefined && extra.order !== "asc") ||
      (extra.nulls !== undefined && extra.nulls !== "last") ||
      extra.opClass !== undefined);
  return unsupported ? null : candidate.name;
}

function derivedUniqueName(tableName: string, columns: readonly { name: string }[]): string {
  return `${tableName}_${columns.map((column) => column.name).join("_")}_unique`;
}

/**
 * SPEC §7.3 does not model SQL's SET DEFAULT, and "no action" is Postgres' default, so
 * both are omitted rather than invented or echoed as noise.
 */
function toForeignKeyAction(
  action: "cascade" | "restrict" | "no action" | "set null" | "set default" | undefined,
): "cascade" | "set null" | "restrict" | undefined {
  switch (action) {
    case "cascade":
    case "restrict":
    case "set null":
      return action;
    default:
      return undefined;
  }
}

function renderDefault(value: PgColumn["default"], type: string): string | null {
  if (value === undefined) return null;
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  if (typeof value === "string") return quoteLiteral(value);
  if (value instanceof Date) return quoteLiteral(value.toISOString());
  // Drizzle stores a json/jsonb default as the JS value (an object or an array). The planner
  // renders this string AS SQL, so an unquoted {} or [] would be a syntax error; the literal
  // needs its jsonb/json cast, exactly as the generated DDL would carry it.
  if (typeof value === "object" && value !== null) {
    const json = quoteLiteral(JSON.stringify(value));
    return type === "json" || type === "jsonb" ? json + "::" + type : json;
  }
  return String(value);
}

function detectScopeColumn(columnNames: readonly string[]): ScopeColumnSnapshot | undefined {
  const tenant = columnNames.find((name) => DEFAULT_TENANT_COLUMNS.includes(name));
  if (tenant !== undefined) return { name: tenant, kind: "tenant" };
  const owner = columnNames.find((name) => DEFAULT_OWNER_COLUMNS.includes(name));
  if (owner !== undefined) return { name: owner, kind: "owner" };
  return undefined;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
