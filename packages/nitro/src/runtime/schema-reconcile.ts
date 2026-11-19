// Dev schema reconcile (D-193, docs/MIGRATION-PLAN.md P5): the dev database is materialized
// from db/schema.ts at boot instead of from hand-written SQL, which is what lets the AI edit
// the schema without writing a migration.
//
// The reconcile is ADDITIVE by design. Tables, columns, defaults, checks, foreign keys,
// indexes, policies and RLS that the declaration has and the database lacks are created with
// the release planner's own renderers, so a table created at boot and one created by a release
// artifact cannot drift. A changed construct is replaced (drop + re-add of the same name),
// which loses no data (D-195). Destructive DDL is
// never inferred: a drop runs only when the user confirmed that exact change from the IDE and
// it is recorded in .facilis/dev/schema-approvals.json (SCHEMA_APPROVALS_PATH). An unconfirmed
// drop is skipped, so a hand edit of db/schema.ts can never delete data at boot.
//
// Everything here is dev-only: a Postgres target never reaches this module, the deploy owns
// the DDL there (db-bootstrap.ts).

import {
  addColumnSql,
  addForeignKeySql,
  createIndexSql,
  createPolicySql,
  createTableSql,
  dropColumnSql,
  dropTableSql,
  enableRlsSql,
  quote,
  quoteLiteral,
  type ManifestWarning,
  type SchemaSnapshot,
  type TableSnapshot,
} from "@facilis.dev/core";
import {
  applyStatements,
  liveSchemaSnapshot,
  schemaSnapshot,
  type FacilisDb,
  type LiveSchemaSnapshot,
  type LiveTableSnapshot,
} from "@facilis.dev/db";

import { planTableConstraints, planTableForeignKeys } from "./schema-reconcile-constraints.ts";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}

/** One line of the statement for a warning, so a failed batch is identifiable. */
function headline(statement: string): string {
  const flat = statement.replaceAll(/\s+/gu, " ").trim();
  return flat.length > 120 ? flat.slice(0, 117) + "..." : flat;
}

/** `CREATE TYPE` has no IF NOT EXISTS, so the duplicate case is swallowed in a DO block. */
function createEnumSql(name: string, values: readonly string[]): string {
  return (
    "DO $$ BEGIN CREATE TYPE " +
    quote(name) +
    " AS ENUM (" +
    values.map(quoteLiteral).join(", ") +
    "); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
  );
}

function liveTablesByName(live: LiveSchemaSnapshot): Map<string, LiveTableSnapshot> {
  return new Map(live.tables.map((table) => [table.name, table]));
}

function columnNames(table: LiveTableSnapshot): Set<string> {
  return new Set(table.columns.map((column) => column.name));
}

/**
 * The statements that bring `live` up to `declared`: missing enums, tables (with their
 * foreign keys, indexes, RLS and policies) and columns, plus the drops the user approved.
 * Pure, so the planner is tested without a database.
 */
export function planReconcile(
  declared: SchemaSnapshot,
  live: LiveSchemaSnapshot,
  approvals: readonly string[],
): string[] {
  const liveByName = liveTablesByName(live);
  const created: TableSnapshot[] = [];
  const existing: TableSnapshot[] = [];
  for (const table of declared.tables) {
    if (liveByName.has(table.name)) existing.push(table);
    else created.push(table);
  }

  const statements: string[] = [];
  for (const entry of declared.enums ?? [])
    statements.push(createEnumSql(entry.name, entry.values));
  for (const table of created) statements.push(createTableSql(table));
  // A table's foreign key may point at a table created in this same pass, so the constraints
  // come after every CREATE TABLE.
  for (const table of created) {
    for (const foreignKey of table.foreignKeys) {
      statements.push(addForeignKeySql(table.name, foreignKey));
    }
    for (const index of table.indexes ?? []) statements.push(createIndexSql(table.name, index));
  }
  for (const table of created) {
    if (table.rlsEnabled) statements.push(enableRlsSql(table.name));
    for (const policy of table.policies) statements.push(createPolicySql(policy));
  }
  for (const table of existing) {
    const current = liveByName.get(table.name);
    if (current === undefined) continue;
    const columns = columnNames(current);
    for (const column of table.columns) {
      if (!columns.has(column.name)) statements.push(addColumnSql(table.name, column));
    }
    statements.push(...planTableConstraints(table, current));
    if (table.rlsEnabled && !current.rlsEnabled) statements.push(enableRlsSql(table.name));
    const policies = new Set(current.policies.map((policy) => policy.name));
    for (const policy of table.policies) {
      if (!policies.has(policy.name)) statements.push(createPolicySql(policy));
    }
  }
  // Foreign keys come last: one may reference a column another existing table gained above.
  for (const table of existing) {
    const current = liveByName.get(table.name);
    if (current === undefined) continue;
    statements.push(...planTableForeignKeys(table, current));
  }

  const approved = new Set(approvals);
  for (const table of live.tables) {
    const declaredTable = declared.tables.find((entry) => entry.name === table.name);
    if (declaredTable === undefined) {
      if (approved.has(`drops table "${table.name}"`)) statements.push(dropTableSql(table.name));
      continue;
    }
    const columns = new Set(declaredTable.columns.map((column) => column.name));
    for (const column of table.columns) {
      if (columns.has(column.name)) continue;
      if (approved.has(`drops column "${table.name}.${column.name}"`)) {
        statements.push(dropColumnSql(table.name, column.name));
      }
    }
  }
  return statements;
}

/**
 * Materialize the declared schema onto the dev database. A statement that fails (a NOT NULL
 * column on a table with rows, an unsupported declaration) becomes a manifest warning instead
 * of a failed boot: the app still starts, and /__facilis/dev/schema shows the drift.
 */
export async function reconcileDeclaredSchema(
  db: FacilisDb,
  approvals: readonly string[],
  warnings: ManifestWarning[],
): Promise<void> {
  let declared: SchemaSnapshot;
  let live: LiveSchemaSnapshot;
  try {
    [declared, live] = await Promise.all([schemaSnapshot(db), liveSchemaSnapshot(db)]);
  } catch (error) {
    warnings.push(
      warning("schema_reconcile_failed", `Could not read the schema: ${describe(error)}`),
    );
    return;
  }
  const statements = planReconcile(declared, live, approvals);
  for (const statement of statements) {
    try {
      await applyStatements(db, [statement]);
    } catch (error) {
      warnings.push(
        warning(
          "schema_reconcile_failed",
          `Could not apply "${headline(statement)}": ${describe(error)}`,
        ),
      );
    }
  }
}
