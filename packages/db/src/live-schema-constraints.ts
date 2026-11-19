import { sql } from "drizzle-orm";

import type { FacilisDb } from "./client.ts";

/**
 * The constraint half of the live introspection (SPEC §11.1, D-195): indexes, foreign keys
 * and checks read from `pg_index`/`pg_constraint`, so the dev reconcile can converge an
 * existing table onto the declaration instead of only adding columns. Defaults already ride
 * on the column rows. Everything here describes what the database has; the comparison against
 * the declaration lives in the reconcile planner, never in the reader.
 */

export interface LiveIndexSnapshot {
  name: string;
  /** Ordered plain column names; empty for a single-expression index. */
  columns: string[];
  unique: boolean;
  /** Catalog rendering of a single-expression index, e.g. `lower((title)::text)`. */
  expression: string | null;
}

export interface LiveForeignKeySnapshot {
  /** The catalog name: a legacy migration may not use the derived `fk__...` spelling. */
  name: string;
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  /** Full action names (`no action`, `restrict`, `cascade`, `set null`, `set default`). */
  onDelete: string;
  onUpdate: string;
}

export interface LiveCheckSnapshot {
  name: string;
  /** `pg_get_constraintdef` minus the CHECK wrapper; the catalog re-renders the expression. */
  expression: string;
}

export interface LiveConstraintRows {
  indexes: (LiveIndexSnapshot & { table: string })[];
  foreignKeys: (LiveForeignKeySnapshot & { table: string })[];
  checks: (LiveCheckSnapshot & { table: string })[];
}

/**
 * Indexes that back a constraint (PK, unique) are not declaration indexes: the snapshot
 * models those as `primaryKey`/`isUnique`/`uniqueConstraints`, so reading them here would
 * invent live-only indexes the reconcile must then leave alone.
 */
const INDEXES_QUERY = sql`
  select
    t.relname as table_name,
    i.relname as index_name,
    ix.indisunique as is_unique,
    ix.indnatts as natts,
    (
      select array_agg(a.attname order by k.ord)
      from unnest(ix.indkey::smallint[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum and a.attnum > 0
    ) as column_names,
    pg_get_expr(ix.indexprs, ix.indrelid) as expression
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class t on t.oid = ix.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = current_schema()
    and t.relkind = 'r'
    and not ix.indisprimary
    and not exists (select 1 from pg_constraint c where c.conindid = ix.indexrelid)
  order by t.relname, i.relname
`;

/**
 * `confkey` is empty when the reference names no columns (it targets the primary key),
 * so the target columns fall back to the referenced table's PK in declared order.
 */
const FOREIGN_KEYS_QUERY = sql`
  select
    t.relname as table_name,
    c.conname as constraint_name,
    (
      select array_agg(a.attname order by k.ord)
      from unnest(c.conkey::smallint[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    ) as column_names,
    rt.relname as target_table,
    (
      select array_agg(a.attname order by k.ord)
      from unnest((
        case when c.confkey::text = ''
        then (select i.indkey from pg_index i where i.indrelid = c.confrelid and i.indisprimary limit 1)
        else c.confkey end
      )::smallint[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = rt.oid and a.attnum = k.attnum
    ) as target_columns,
    c.confdeltype as on_delete,
    c.confupdtype as on_update
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_class rt on rt.oid = c.confrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f'
    and n.nspname = current_schema()
    and t.relkind = 'r'
  order by t.relname, c.conname
`;

const CHECKS_QUERY = sql`
  select
    t.relname as table_name,
    c.conname as constraint_name,
    pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'c'
    and n.nspname = current_schema()
    and t.relkind = 'r'
  order by t.relname, c.conname
`;

const FOREIGN_KEY_ACTIONS: Readonly<Record<string, string>> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

/** Read indexes, foreign keys and checks of every ordinary table in the current schema. */
export async function readLiveConstraints(db: FacilisDb): Promise<LiveConstraintRows> {
  const rows: LiveConstraintRows = { indexes: [], foreignKeys: [], checks: [] };

  const indexResult = await db.db.execute(INDEXES_QUERY);
  for (const row of indexResult.rows) {
    const table = readText(row, "table_name");
    const name = readText(row, "index_name");
    if (table === null || name === null) continue;
    const columns = readTextArray(row, "column_names");
    const rawExpression = readText(row, "expression");
    const natts = Number(row["natts"]);
    // Only the shapes the declared snapshot can render are described faithfully: plain
    // columns, or exactly one expression. Anything else stays empty so the planner treats
    // it as a definition change rather than guessing a partial rendering.
    const expression = rawExpression !== null && natts === 1 && columns.length === 0 ? rawExpression : null;
    rows.indexes.push({
      table,
      name,
      columns: expression === null && rawExpression === null ? columns : [],
      unique: row["is_unique"] === true,
      expression,
    });
  }

  const fkResult = await db.db.execute(FOREIGN_KEYS_QUERY);
  for (const row of fkResult.rows) {
    const table = readText(row, "table_name");
    const name = readText(row, "constraint_name");
    const targetTable = readText(row, "target_table");
    if (table === null || name === null || targetTable === null) continue;
    rows.foreignKeys.push({
      table,
      name,
      columns: readTextArray(row, "column_names"),
      targetTable,
      targetColumns: readTextArray(row, "target_columns"),
      onDelete: FOREIGN_KEY_ACTIONS[String(row["on_delete"])] ?? "no action",
      onUpdate: FOREIGN_KEY_ACTIONS[String(row["on_update"])] ?? "no action",
    });
  }

  const checkResult = await db.db.execute(CHECKS_QUERY);
  for (const row of checkResult.rows) {
    const table = readText(row, "table_name");
    const name = readText(row, "constraint_name");
    if (table === null || name === null) continue;
    const definition = readText(row, "definition") ?? "";
    rows.checks.push({
      table,
      name,
      expression: definition.replace(/^check\s*\(/iu, "").replace(/\)\s*$/u, ""),
    });
  }

  return rows;
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
