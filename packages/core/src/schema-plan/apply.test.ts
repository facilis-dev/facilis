import {
  applyStatements,
  createDb,
  declaredDigestSchema,
  digestSchema,
  liveDigestSchema,
  liveSchemaSnapshot,
  type ColumnSnapshot,
  type FacilisDb,
  type PolicySnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
} from "@facilis/db";
import { afterAll, describe, expect, it } from "vitest";

import { planSchema } from "./plan.ts";

/**
 * PGlite round-trip: the planned SQL must build the declared schema from an empty database.
 * The proof is the canonical digest — the same function the deploy fingerprint uses.
 */

const TENANT = "\"tenant_id\" = nullif(current_setting('app.tenant_id', true), '')::uuid";
const OWNER = "\"owner_id\" = nullif(current_setting('app.user_id', true), '')::uuid";

const databases: FacilisDb[] = [];

async function emptyDb(): Promise<FacilisDb> {
  const db = await createDb();
  databases.push(db);
  return db;
}

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
});

function column(name: string, overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot {
  return { name, type: "text", notNull: false, default: null, isPrimaryKey: false, isUnique: false, ...overrides };
}

function table(name: string, overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return { name, rlsEnabled: false, columns: [], foreignKeys: [], policies: [], ...overrides };
}

function policy(name: string, tableName: string, predicate: string, restrictive = false): PolicySnapshot {
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

function users(): TableSnapshot {
  return table("users", {
    columns: [
      column("id", { type: "uuid", notNull: true, default: "gen_random_uuid()", isPrimaryKey: true }),
      column("email", { notNull: true, isUnique: true }),
      column("created_at", { type: "timestamp with time zone", notNull: true, default: "now()" }),
    ],
    primaryKey: ["id"],
    indexes: [{ name: "users_created_at_idx", columns: ["created_at"], unique: false }],
  });
}

function base(): SchemaSnapshot {
  return {
    tables: [
      users(),
      table("todos", {
        rlsEnabled: true,
        columns: [
          column("id", { type: "uuid", notNull: true, default: "gen_random_uuid()", isPrimaryKey: true }),
          column("tenant_id", { type: "uuid", notNull: true }),
          column("owner_id", { type: "uuid", notNull: true }),
          column("author_id", { type: "uuid", notNull: true }),
          column("title", { notNull: true, default: "'untitled'" }),
          column("done", { type: "boolean", notNull: true, default: "false" }),
        ],
        primaryKey: ["id"],
        foreignKeys: [{ columns: ["author_id"], targetTable: "users", targetColumns: ["id"], onDelete: "cascade" }],
        policies: [
          policy("tenant_isolation", "todos", TENANT, true),
          policy("owner_isolation", "todos", OWNER),
        ],
        scopeColumn: { name: "tenant_id", kind: "tenant" },
        indexes: [{ name: "todos_title_idx", columns: ["title"], unique: false }],
        checks: [{ name: "todos_title_ck", expression: 'length(("todos"."title")::text) > 0' }],
      }),
    ],
    enums: [],
  };
}

function richer(): SchemaSnapshot {
  return {
    enums: [{ name: "priority", values: ["low", "high"] }],
    tables: [
      users(),
      table("items", {
        rlsEnabled: true,
        columns: [
          column("tenant_id", { type: "uuid", notNull: true, isPrimaryKey: true }),
          column("seq", { type: "integer", notNull: true, isPrimaryKey: true }),
          column("owner_id", { type: "uuid", notNull: true }),
          column("priority", { type: "priority", notNull: true, default: "'low'" }),
          column("created_at", { type: "timestamp with time zone", notNull: true, default: "now()" }),
        ],
        primaryKey: ["tenant_id", "seq"],
        foreignKeys: [{ columns: ["owner_id"], targetTable: "users", targetColumns: ["id"], onDelete: "restrict" }],
        policies: [policy("tenant_isolation", "items", TENANT, true)],
        scopeColumn: { name: "tenant_id", kind: "tenant" },
        indexes: [
          { name: "items_priority_idx", columns: ["priority"], unique: false },
          { name: "items_owner_priority_idx", columns: ["owner_id", "priority"], unique: true },
        ],
        checks: [{ name: "items_seq_ck", expression: '("items"."seq" > 0)' }],
        uniqueConstraints: [{ name: "items_owner_seq_unique", columns: ["owner_id", "seq"] }],
      }),
    ],
  };
}

function appliedSql(target: SchemaSnapshot): { batches: string[]; problems: unknown[] } {
  const plan = planSchema({ tables: [] }, target);
  return { batches: plan.batches.map((batch) => batch.sql), problems: plan.problems };
}

describe("planned SQL round-trips through PGlite", () => {
  it("builds users+todos and matches the declared digest", async () => {
    const target = base();
    const { batches, problems } = appliedSql(target);
    expect(problems).toEqual([]);
    expect(batches.length).toBeGreaterThan(0);

    const db = await emptyDb();
    await applyStatements(db, batches);

    const live = await liveSchemaSnapshot(db);
    const declaredDigest = digestSchema(declaredDigestSchema(target));
    const liveDigest = digestSchema(liveDigestSchema(live));
    expect(liveDigest).toBe(declaredDigest);
  }, 60_000);

  it("builds a richer schema with enums, indexes, checks, unique constraints and FKs", async () => {
    const target = richer();
    const { batches, problems } = appliedSql(target);
    expect(problems).toEqual([]);

    const db = await emptyDb();
    await applyStatements(db, batches);

    const live = await liveSchemaSnapshot(db);
    const declaredDigest = digestSchema(declaredDigestSchema(target));
    const liveDigest = digestSchema(liveDigestSchema(live));
    expect(liveDigest).toBe(declaredDigest);
  }, 60_000);
});
