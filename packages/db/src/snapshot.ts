import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import type { FacilisDb } from "./client.ts";
import { snapshotTable } from "./snapshot-readers.ts";

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
  /**
   * Identity columns are readable but not renderable by the v1 generator
   * (`GENERATED ... AS IDENTITY` sequence options are lost in this projection), so the
   * flag is carried and the P2 planner refuses instead of writing a plain column.
   */
  identity?: "always" | "byDefault";
  /** Generated/computed columns: same fail-closed treatment, no faithful v1 DDL. */
  generated?: true;
}

export interface ForeignKeySnapshot {
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  onDelete?: "cascade" | "set null" | "restrict" | "no action";
  onUpdate?: "cascade" | "set null" | "restrict" | "no action";
}

export interface IndexSnapshot {
  name: string;
  /** Plain column names only; any other index shape lands in `unsupported`. */
  columns: string[];
  unique: boolean;
}

export interface CheckSnapshot {
  name: string;
  /** Rendered with PgDialect, like `default`; columns may stay table-qualified. */
  expression: string;
}

/** A table-level `unique()`, distinct from a column's `isUnique`. */
export interface UniqueConstraintSnapshot {
  name: string;
  columns: string[];
}

export interface EnumSnapshot {
  name: string;
  values: string[];
}

/**
 * A declaration the snapshot can read but the v1 shapes above cannot represent (expression,
 * partial or method-specific indexes; `ON DELETE SET DEFAULT`). It is carried, never
 * dropped, so the P2 generator can fail the release closed instead of silently ignoring it
 * (D-145: an unsupported declaration fails the release, never degrades silently).
 */
export interface UnsupportedDeclarationSnapshot {
  construct: "index" | "foreign_key";
  name: string;
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
  /** Ordered column names of the primary key; empty when the table has none. */
  primaryKey?: string[];
  indexes?: IndexSnapshot[];
  checks?: CheckSnapshot[];
  uniqueConstraints?: UniqueConstraintSnapshot[];
  unsupported?: UnsupportedDeclarationSnapshot[];
}

export interface SchemaSnapshot {
  tables: TableSnapshot[];
  /** Enum types referenced by columns, deduped by name. */
  enums?: EnumSnapshot[];
}

/**
 * Derives the SPEC §7.3 schema snapshot from the Drizzle schema namespace passed to
 * `createDb`. No database round-trip: the code schema is the source of truth, as in
 * SPEC §11.1's code↔live comparison.
 */
export async function schemaSnapshot(db: FacilisDb): Promise<SchemaSnapshot> {
  const enums = new Map<string, string[]>();
  const tables = Object.values(db.schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => snapshotTable(table, enums))
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return {
    tables,
    enums: [...enums.entries()]
      .map(([name, values]) => ({ name, values }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}
