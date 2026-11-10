import type { ColumnSnapshot, PolicySnapshot, SchemaSnapshot, TableSnapshot } from "@facilis/db";

/**
 * Hand-built declared snapshots for the planner tests. The PGlite round-trip in
 * ./apply.test.ts applies the planned SQL and compares the canonical digest, so these
 * fixtures are also proof that a hand-written snapshot is a valid release input.
 */

export const TENANT_PREDICATE = "\"tenant_id\" = nullif(current_setting('app.tenant_id', true), '')::uuid";
export const OWNER_PREDICATE = "\"owner_id\" = nullif(current_setting('app.user_id', true), '')::uuid";

export function column(name: string, overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot {
  return { name, type: "text", notNull: false, default: null, isPrimaryKey: false, isUnique: false, ...overrides };
}

export function makeTable(name: string, overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return { name, rlsEnabled: false, columns: [], foreignKeys: [], policies: [], ...overrides };
}

export function policyFor(
  name: string,
  tableName: string,
  predicate: string,
  restrictive = false,
): PolicySnapshot {
  const as = restrictive ? " AS RESTRICTIVE" : "";
  return {
    name,
    command: "ALL",
    using: predicate,
    withCheck: predicate,
    sql:
      'CREATE POLICY "' + name + '" ON "' + tableName + '"' + as +
      " FOR ALL TO public USING (" + predicate + ") WITH CHECK (" + predicate + ");",
  };
}

export function usersTable(): TableSnapshot {
  return makeTable("users", {
    columns: [
      column("id", { type: "uuid", notNull: true, default: "gen_random_uuid()", isPrimaryKey: true }),
      column("email", { notNull: true, isUnique: true }),
      column("created_at", { type: "timestamp with time zone", notNull: true, default: "now()" }),
    ],
    primaryKey: ["id"],
    indexes: [{ name: "users_created_at_idx", columns: ["created_at"], unique: false }],
  });
}

export function todosTable(): TableSnapshot {
  return makeTable("todos", {
    rlsEnabled: true,
    columns: [
      column("id", { type: "uuid", notNull: true, default: "gen_random_uuid()", isPrimaryKey: true }),
      column("tenant_id", { type: "uuid", notNull: true }),
      column("owner_id", { type: "uuid", notNull: true }),
      column("author_id", { type: "uuid", notNull: true }),
      column("title", { notNull: true, default: "'untitled'" }),
      column("done", { type: "boolean", notNull: true, default: "false" }),
      column("note"),
    ],
    primaryKey: ["id"],
    foreignKeys: [{ columns: ["author_id"], targetTable: "users", targetColumns: ["id"], onDelete: "cascade" }],
    policies: [
      policyFor("tenant_isolation", "todos", TENANT_PREDICATE, true),
      policyFor("owner_isolation", "todos", OWNER_PREDICATE),
    ],
    scopeColumn: { name: "tenant_id", kind: "tenant" },
    indexes: [
      { name: "todos_title_idx", columns: ["title"], unique: false },
      { name: "todos_done_idx", columns: ["done"], unique: false },
    ],
    checks: [{ name: "todos_title_ck", expression: 'length(("todos"."title")::text) > 0' }],
  });
}

export function baseSnapshot(): SchemaSnapshot {
  return { tables: [usersTable(), todosTable()], enums: [] };
}

/** A copy of a schema with one table replaced (or added). */
export function withTable(source: SchemaSnapshot, replacement: TableSnapshot): SchemaSnapshot {
  const tables = source.tables.filter((entry) => entry.name !== replacement.name);
  return { ...structuredClone(source), tables: [...tables, replacement] };
}

/** A copy of a table with one column patched; copy-on-write, the shared fixtures stay intact. */
export function updateColumn(
  source: TableSnapshot,
  name: string,
  patch: Partial<ColumnSnapshot>,
): TableSnapshot {
  return {
    ...source,
    columns: source.columns.map((entry) =>
      entry.name === name ? Object.assign({}, entry, patch) : entry,
    ),
  };
}

/** A copy of the base schema's scoped table with field overrides. */
export function withTodos(overrides: Partial<TableSnapshot>): SchemaSnapshot {
  return { tables: [{ ...todosTable(), ...overrides }] };
}
