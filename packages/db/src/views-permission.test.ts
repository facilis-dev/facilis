import { sql } from "drizzle-orm";
import { integer, PgDialect, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import {
  applyViews,
  defineView,
  viewCreateStatement,
  viewDefinitionStatement,
  viewMetadata,
  ViewDefinitionError,
  type ViewMetadata,
} from "./views.ts";

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

const stats = defineView({
  name: "todo_stats",
  columns: { total: integer() },
  query: sql`select count(*)::int as total from todos`,
  permission: "stats:read",
  tables: ["todos"],
});

const titles = defineView({
  name: "todo_titles",
  columns: { title: text() },
  query: sql`select title from todos`,
  tables: ["todos"],
});

function metadataOf(view: unknown): ViewMetadata {
  const metadata = viewMetadata(view);
  if (metadata === null) throw new Error("expected a view declaration");
  return metadata;
}

async function openDb(): Promise<FacilisDb> {
  const db = await createDb();
  await applyStatements(db, [
    "CREATE TABLE todos (id uuid PRIMARY KEY, title text NOT NULL, owner_id uuid NOT NULL)",
    "ALTER TABLE todos ENABLE ROW LEVEL SECURITY",
    "CREATE POLICY owner_isolation ON todos FOR ALL USING " +
      "(owner_id = nullif(current_setting('app.user_id', true), '')::uuid)",
    "INSERT INTO todos (id, title, owner_id) VALUES " +
      `('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-1', '${OWNER_A}'), ` +
      `('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-1', '${OWNER_B}')`,
  ]);
  await ensureAppRole(db);
  return db;
}

describe("permission views", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await openDb();
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("records the mode on the declaration", () => {
    expect(metadataOf(stats)).toMatchObject({
      permission: "stats:read",
      access: "definer",
    });
    expect(metadataOf(titles)).toMatchObject({ permission: null, access: "invoker" });
  });

  it("emits a definer view whose only gate is the declared permission", () => {
    const compiled = new PgDialect().sqlToQuery(viewCreateStatement(metadataOf(stats)));

    expect(compiled.params).toEqual([]);
    expect(compiled.sql).toContain("with (security_invoker = false)");
    expect(compiled.sql).toContain(
      'select * from (select count(*)::int as total from todos) as "q"',
    );
    expect(compiled.sql).toContain("current_setting('app.permissions', true)");
    expect(compiled.sql).toContain("? 'stats:read'");
  });

  it("keeps the invoker form when no permission is declared", () => {
    const compiled = new PgDialect().sqlToQuery(viewCreateStatement(metadataOf(titles)));
    expect(compiled.sql).toContain("with (security_invoker = true)");
    expect(compiled.sql).not.toContain("app.permissions");
  });

  it("rejects a malformed permission as a data error", () => {
    expect(() => viewDefinitionStatement("x", "select 1 as n", "Stats:Read")).toThrowError(
      ViewDefinitionError,
    );
    try {
      viewDefinitionStatement("x", "select 1 as n", "Stats:Read");
    } catch (error) {
      expect((error as ViewDefinitionError).code).toBe("invalid_permission");
    }
  });

  it("fails a view whose permission is not declared in the config, as data", async () => {
    const result = await applyViews(db, { stats }, { permissions: ["other:read"] });

    expect(result.created).toEqual([]);
    expect(result.failed.map((failure) => failure.name)).toEqual(["todo_stats"]);
    expect(result.failed[0]?.error).toMatch(/stats:read.*not declared/);
  });

  it("returns cross-owner rows only when app.permissions carries the view permission", async () => {
    const applied = await applyViews(db, { stats }, { permissions: ["stats:read"] });
    expect(applied.failed).toEqual([]);

    const denied = await runWithPolicyScope(db, { userId: OWNER_A, permissions: [] }, (tx) =>
      tx.select().from(stats),
    );
    expect(denied).toEqual([]);

    const allowed = await runWithPolicyScope(
      db,
      { userId: OWNER_A, permissions: ["stats:read"] },
      (tx) => tx.select().from(stats),
    );
    // The definer view bypasses the base tables' owner RLS: both owners' rows count.
    expect(allowed).toEqual([{ total: 2 }]);
  });

  it("keeps an invoker view on the base tables' permissions", async () => {
    const applied = await applyViews(db, { titles }, { permissions: [] });
    expect(applied.failed).toEqual([]);

    const rows = await runWithPolicyScope(
      db,
      { userId: OWNER_A, permissions: ["stats:read"] },
      (tx) => tx.select().from(titles),
    );
    expect(rows).toEqual([{ title: "a-1" }]);
  });

  it("exposes the scope's permissions in app.permissions and clears them after commit", async () => {
    const inside = await runWithPolicyScope(
      db,
      { userId: OWNER_A, permissions: ["stats:read", "todos:read"] },
      (tx) => tx.execute(sql.raw("select current_setting('app.permissions', true) as permissions")),
    );
    expect(inside.rows[0]).toEqual({ permissions: '["stats:read","todos:read"]' });

    const outside = await db.db.execute(
      sql.raw("select current_setting('app.permissions', true) as permissions"),
    );
    expect(outside.rows[0]).toEqual({ permissions: "" });
  });
});
