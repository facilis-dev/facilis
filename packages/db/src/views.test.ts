import { sql } from "drizzle-orm";
import { integer, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import {
  applyViews,
  collectViewMetadata,
  defineView,
  isFacilisView,
  viewCreateStatement,
  viewDefinitionStatement,
  viewMetadata,
  ViewDefinitionError,
  type ViewMetadata,
} from "./views.ts";

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

const ownedDocuments = defineView({
  name: "owned_documents",
  columns: { id: uuid(), title: text(), owner_id: uuid() },
  query: sql`select id, title, owner_id from documents`,
  tables: ["documents"],
});

function metadataOf(view: unknown): ViewMetadata {
  const metadata = viewMetadata(view);
  if (metadata === null) throw new Error("expected a view declaration");
  return metadata;
}

async function openProjectDb(): Promise<FacilisDb> {
  const db = await createDb();
  await applyStatements(db, [
    "CREATE TABLE documents (id uuid PRIMARY KEY, title text NOT NULL, owner_id uuid NOT NULL)",
    "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
    "CREATE POLICY owner_isolation ON documents FOR ALL USING " +
      "(owner_id = nullif(current_setting('app.user_id', true), '')::uuid)",
  ]);
  await db.db.execute(sql`
    insert into documents (id, title, owner_id) values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a-1', ${OWNER_A}),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b-1', ${OWNER_B})
  `);
  await ensureAppRole(db);
  return db;
}

describe("defineView", () => {
  it("returns a Drizzle view branded with its declaration", () => {
    expect(isFacilisView(ownedDocuments)).toBe(true);
    const metadata = metadataOf(ownedDocuments);
    expect(metadata.name).toBe("owned_documents");
    expect(metadata.tables).toEqual(["documents"]);
  });

  it("skips non-view exports and deduplicates by name", () => {
    const declarations = collectViewMetadata([{ a: ownedDocuments, b: ownedDocuments, n: 42 }]);
    expect(declarations.map((declaration) => declaration.name)).toEqual(["owned_documents"]);
  });

  it("rejects a name that is not a lowercase SQL identifier", () => {
    expect(() => viewDefinitionStatement("Bad Name", "select 1 as n")).toThrowError(
      ViewDefinitionError,
    );
    try {
      viewDefinitionStatement("Bad Name", "select 1 as n");
    } catch (error) {
      expect((error as ViewDefinitionError).code).toBe("invalid_name");
    }
  });

  it("rejects an interpolated value: the DDL inlines the query and has no parameters", () => {
    const parameterised = defineView({
      name: "owned_by_a",
      columns: { id: uuid() },
      query: sql`select id from documents where owner_id = ${OWNER_A}`,
    });
    expect(() => viewCreateStatement(metadataOf(parameterised))).toThrowError(/must be static/);
  });

  it("rejects a write and a second statement in a view query", () => {
    expect(() => viewDefinitionStatement("x", "delete from documents")).toThrowError(
      ViewDefinitionError,
    );
    expect(() => viewDefinitionStatement("x", "select 1 as n; drop table documents")).toThrowError(
      ViewDefinitionError,
    );
  });
});

describe("applyViews over PGlite", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await openProjectDb();
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates the view and grants the policy-scoped role, and the view follows the base table's RLS", async () => {
    const result = await applyViews(db, { ownedDocuments });
    expect(result.created).toEqual(["owned_documents"]);
    expect(result.failed).toEqual([]);

    const rows = await runWithPolicyScope(db, { userId: OWNER_A }, (tx) =>
      tx.select().from(ownedDocuments),
    );
    expect(rows.map((row) => row.title)).toEqual(["a-1"]);
  });

  it("shows why security_invoker is mandatory: a plain view bypasses RLS", async () => {
    await db.db.execute(
      sql.raw("create view leaky_documents as select id, title, owner_id from documents"),
    );
    await db.db.execute(sql.raw("grant select on leaky_documents to facilis_app"));

    const leaky = await runWithPolicyScope(db, { userId: OWNER_A }, (tx) =>
      tx.execute(sql`select title from leaky_documents order by title`),
    );
    expect(leaky.rows).toHaveLength(2);
  });

  it("retries failures once so a view can select from another view declared later", async () => {
    const onTop = defineView({
      name: "documents_titles",
      columns: { n: integer(), title: text() },
      query: sql`select count(*)::int as n, min(title) as title from documents`,
    });
    const fromTop = defineView({
      name: "top_titles",
      columns: { n: integer(), title: text() },
      query: sql`select n, title from documents_titles`,
    });

    const result = await applyViews(db, { fromTop, onTop });
    expect(result.failed).toEqual([]);
    expect(result.created.toSorted()).toEqual(["documents_titles", "top_titles"]);

    const rows = await runWithPolicyScope(db, { userId: OWNER_A }, (tx) =>
      tx.execute(sql`select title from top_titles`),
    );
    expect(rows.rows).toEqual([{ title: "a-1" }]);
  });

  it("reports a broken declaration as data instead of throwing", async () => {
    const broken = defineView({
      name: "missing_table_view",
      columns: { id: uuid() },
      query: sql`select id from table_that_does_not_exist`,
    });
    const result = await applyViews(db, { broken });
    expect(result.created).toEqual([]);
    expect(result.failed.map((failure) => failure.name)).toEqual(["missing_table_view"]);
    expect(result.failed[0]?.error).toMatch(/table_that_does_not_exist/);
  });

  it("is idempotent: a second apply replaces the view without error", async () => {
    const first = await applyViews(db, { ownedDocuments });
    const second = await applyViews(db, { ownedDocuments });
    expect(first.failed).toEqual([]);
    expect(second.created).toEqual(["owned_documents"]);
  });
});
