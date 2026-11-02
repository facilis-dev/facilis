import { sql } from "drizzle-orm";

import type { FacilisDb } from "./client.ts";
import { MIGRATION_TRACKING_TABLE } from "./migrator.ts";

/**
 * Tables this package owns for its own bookkeeping. They exist in every migrated database
 * but never in the project schema, so they would otherwise show up as permanent drift.
 */
const INTERNAL_TABLES: ReadonlySet<string> = new Set([MIGRATION_TRACKING_TABLE]);

/**
 * Live database introspection (SPEC §11.1): the catalog side of the code↔live diff.
 *
 * Everything here reads Postgres system catalogs, never the Drizzle schema, so the
 * snapshot describes the database the running project is actually talking to (PGlite in
 * dev, Postgres in production). Tables are restricted to the connection's current schema:
 * Facilis projects keep their tables in `public`, and framework-internal schemas such as
 * `drizzle` must not show up as drift.
 */

export interface LiveColumnSnapshot {
  name: string;
  /** `format_type()` rendering, e.g. `character varying(120)` or `timestamp with time zone`. */
  type: string;
  notNull: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface LivePolicySnapshot {
  name: string;
  /** SQL command the policy applies to: ALL, SELECT, INSERT, UPDATE or DELETE. */
  command: string;
  /** RESTRICTIVE policies are AND-ed with the permissive ones (D-008). */
  restrictive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

export interface LiveTableSnapshot {
  name: string;
  rlsEnabled: boolean;
  columns: LiveColumnSnapshot[];
  policies: LivePolicySnapshot[];
}

export interface LiveSchemaSnapshot {
  tables: LiveTableSnapshot[];
}

/**
 * One row per column; table-level attributes (`relrowsecurity`) repeat on every row and
 * are lifted onto the table when the first column is seen.
 */
const COLUMNS_QUERY = sql`
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    a.attname as column_name,
    format_type(a.atttypid, a.atttypmod) as column_type,
    a.attnotnull as not_null,
    pg_get_expr(d.adbin, d.adrelid) as column_default,
    exists (
      select 1
      from pg_index i
      where i.indrelid = c.oid and i.indisprimary and a.attnum = any (i.indkey)
    ) as is_primary_key
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = current_schema()
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
  order by c.relname, a.attnum
`;

/** `pg_policies` is the catalog view over `pg_policy`; it renders each qualifier as SQL. */
const POLICIES_QUERY = sql`
  select tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname = current_schema()
  order by tablename, policyname
`;

/** Introspect the live database behind a Facilis project. */
export async function liveSchemaSnapshot(db: FacilisDb): Promise<LiveSchemaSnapshot> {
  const columnResult = await db.db.execute(COLUMNS_QUERY);
  const tables = new Map<string, LiveTableSnapshot>();
  for (const row of columnResult.rows) {
    const tableName = readText(row, "table_name");
    const columnName = readText(row, "column_name");
    if (tableName === null || columnName === null || INTERNAL_TABLES.has(tableName)) continue;
    const table = tableFor(tables, tableName);
    table.rlsEnabled = row["rls_enabled"] === true;
    table.columns.push({
      name: columnName,
      type: readText(row, "column_type") ?? "",
      notNull: row["not_null"] === true,
      default: readText(row, "column_default"),
      isPrimaryKey: row["is_primary_key"] === true,
    });
  }

  const policyResult = await db.db.execute(POLICIES_QUERY);
  for (const row of policyResult.rows) {
    const tableName = readText(row, "tablename");
    const policyName = readText(row, "policyname");
    if (tableName === null || policyName === null || INTERNAL_TABLES.has(tableName)) continue;
    tableFor(tables, tableName).policies.push({
      name: policyName,
      command: (readText(row, "cmd") ?? "ALL").toUpperCase(),
      restrictive: (readText(row, "permissive") ?? "").toUpperCase() === "RESTRICTIVE",
      roles: readTextArray(row, "roles"),
      using: readText(row, "qual"),
      withCheck: readText(row, "with_check"),
    });
  }

  return {
    tables: [...tables.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

function tableFor(tables: Map<string, LiveTableSnapshot>, name: string): LiveTableSnapshot {
  const existing = tables.get(name);
  if (existing !== undefined) return existing;
  const table: LiveTableSnapshot = { name, rlsEnabled: false, columns: [], policies: [] };
  tables.set(name, table);
  return table;
}

function readText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readTextArray(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
