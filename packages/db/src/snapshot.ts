import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable, type PgColumn } from "drizzle-orm/pg-core";

import { DEFAULT_OWNER_COLUMNS, DEFAULT_TENANT_COLUMNS, type FacilisDb } from "./client.ts";
import { policyCreateSql } from "./rls.ts";

/** SPEC §7.3 taxonomy. Core re-exports these types as the manifest contract. */
export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export interface PolicySnapshot {
  name: string;
  command: PolicyCommand;
  using: string | null;
  withCheck: string | null;
  sql: string;
}

export interface ColumnSnapshot {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
}

export interface ForeignKeySnapshot {
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  onDelete?: "cascade" | "set null" | "restrict" | "no action";
  onUpdate?: "cascade" | "set null" | "restrict" | "no action";
}

export interface ScopeColumnSnapshot {
  name: string;
  kind: "tenant" | "owner";
}

export interface TableSnapshot {
  name: string;
  rlsEnabled: boolean;
  columns: ColumnSnapshot[];
  foreignKeys: ForeignKeySnapshot[];
  policies: PolicySnapshot[];
  scopeColumn?: ScopeColumnSnapshot;
}

export interface SchemaSnapshot {
  tables: TableSnapshot[];
}

const dialect = new PgDialect();

/**
 * Derives the SPEC §7.3 schema snapshot from the Drizzle schema namespace passed to
 * `createDb`. No database round-trip: the code schema is the source of truth, as in
 * SPEC §11.1's code↔live comparison.
 */
export async function schemaSnapshot(db: FacilisDb): Promise<SchemaSnapshot> {
  const tables = Object.values(db.schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => snapshotTable(table))
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return { tables };
}

function snapshotTable(table: PgTable): TableSnapshot {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => snapshotColumn(column));
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
  };

  const scopeColumn = detectScopeColumn(columns.map((column) => column.name));
  if (scopeColumn !== undefined) snapshot.scopeColumn = scopeColumn;
  return snapshot;
}

function snapshotColumn(column: PgColumn): ColumnSnapshot {
  return {
    name: column.name,
    type: column.getSQLType(),
    notNull: column.notNull,
    default: renderDefault(column.default),
    isPrimaryKey: column.primary,
    isUnique: column.isUnique,
  };
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

function renderDefault(value: PgColumn["default"]): string | null {
  if (value === undefined) return null;
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  if (typeof value === "string") return quoteLiteral(value);
  if (value instanceof Date) return quoteLiteral(value.toISOString());
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
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
