import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import {
  createLiveView,
  QueryExecutionError,
  runReadOnlyQuery,
  toJsonValue,
} from "./query-console.ts";
import { viewMetadata } from "./views.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";

let db: FacilisDb;

beforeEach(async () => {
  db = await createDb();
  await applyStatements(db, [
    "CREATE TABLE notes (id uuid PRIMARY KEY, title text NOT NULL, owner_id uuid NOT NULL, meta jsonb, seen_at timestamptz)",
    "ALTER TABLE notes ENABLE ROW LEVEL SECURITY",
    "CREATE POLICY owner_isolation ON notes FOR ALL USING " +
      "(owner_id = nullif(current_setting('app.user_id', true), '')::uuid)",
    // A SELECT that writes through a function passes the prefix check; only the read-only
    // transaction can stop it, which is exactly the boundary this module owns.
    "CREATE FUNCTION write_note() RETURNS void AS $$ " +
      "insert into notes (id, title, owner_id) values " +
      "(gen_random_uuid(), 'from-function', '11111111-1111-1111-1111-111111111111') $$ LANGUAGE sql",
  ]);
  await db.db.execute(sql`
    insert into notes (id, title, owner_id, meta, seen_at) values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'first', ${OWNER}, '{"tags":["a"]}'::jsonb, '2026-11-06T10:00:00Z'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'second', ${OWNER}, null, null)
  `);
  await ensureAppRole(db);
});

afterEach(async () => {
  await db.close();
});

describe("runReadOnlyQuery", () => {
  it("returns columns with their Postgres type names and JSON-safe rows", async () => {
    const result = await runReadOnlyQuery(
      db,
      "select id, title, meta, seen_at from notes order by title",
    );

    expect(result.columns).toEqual([
      { name: "id", pgType: "uuid" },
      { name: "title", pgType: "text" },
      { name: "meta", pgType: "jsonb" },
      { name: "seen_at", pgType: "timestamptz" },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.rows[0]?.[0]).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(result.rows[0]?.[2]).toEqual({ tags: ["a"] });
    // Timestamps leave as ISO strings, never Date objects.
    expect(typeof result.rows[0]?.[3]).toBe("string");
  });

  it("caps the preview and flags truncation", async () => {
    const result = await runReadOnlyQuery(db, "select title from notes order by title", 1);
    expect(result.rows).toEqual([["first"]]);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(1);
  });

  it("rejects a write statement before touching the database", async () => {
    await expect(runReadOnlyQuery(db, "delete from notes")).rejects.toBeInstanceOf(
      QueryExecutionError,
    );
    const rows = await db.db.execute(sql`select count(*)::int as n from notes`);
    expect(rows.rows).toEqual([{ n: 2 }]);
  });

  it("rejects a data-modifying CTE and leaves the table untouched", async () => {
    await expect(
      runReadOnlyQuery(db, "with gone as (delete from notes returning id) select id from gone"),
    ).rejects.toMatchObject({ code: "query_failed" });
    const rows = await db.db.execute(sql`select count(*)::int as n from notes`);
    expect(rows.rows).toEqual([{ n: 2 }]);
  });

  it("rejects a SELECT that writes through a function: the read-only transaction is the boundary", async () => {
    await expect(runReadOnlyQuery(db, "select write_note()")).rejects.toThrowError(
      /read-only transaction/,
    );
    const rows = await db.db.execute(sql`select count(*)::int as n from notes`);
    expect(rows.rows).toEqual([{ n: 2 }]);
  });

  it("reports a SQL error as query_failed", async () => {
    await expect(runReadOnlyQuery(db, "select * from missing_table")).rejects.toMatchObject({
      code: "query_failed",
    });
  });
});

describe("createLiveView", () => {
  it("creates the view with security_invoker and grants the policy role", async () => {
    await createLiveView(
      db,
      "own_notes",
      "select id, title, owner_id from notes where title <> 'hidden'",
    );
    const result = await runReadOnlyQuery(db, "select title from own_notes order by title");
    expect(result.rows).toEqual([["first"], ["second"]]);

    const rls = await runWithPolicyScope(db, { userId: OWNER }, (tx) =>
      tx.execute(sql`select title from own_notes order by title`),
    );
    expect(rls.rows).toEqual([{ title: "first" }, { title: "second" }]);
  });

  it("rejects an invalid name and a non-read-only query", async () => {
    await expect(createLiveView(db, "Bad Name", "select 1")).rejects.toMatchObject({
      code: "invalid_name",
    });
    await expect(createLiveView(db, "x", "delete from notes")).rejects.toMatchObject({
      code: "invalid_sql",
    });
  });

  it("reports a name already used by a table as create_failed", async () => {
    await expect(createLiveView(db, "notes", "select 1 as n")).rejects.toMatchObject({
      code: "create_failed",
    });
  });
});

describe("toJsonValue", () => {
  it("normalises values JSON cannot represent", () => {
    expect(toJsonValue(10n)).toBe("10");
    expect(toJsonValue(new Date("2026-11-06T10:00:00.000Z"))).toBe("2026-11-06T10:00:00.000Z");
    expect(toJsonValue(Number.NaN)).toBeNull();
    expect(toJsonValue(new Uint8Array([255, 0]))).toBe("\\xff00");
    expect(toJsonValue({ nested: [1n, null] })).toEqual({ nested: ["1", null] });
  });

  it("leaves view metadata readable on a declaration", () => {
    // A guard for the brand: module namespaces are the only way the runtime finds views.
    expect(viewMetadata({ not: "a view" })).toBeNull();
    expect(toJsonValue(undefined)).toBeNull();
  });
});
