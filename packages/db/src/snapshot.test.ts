import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { withRls } from "./rls.ts";
import { schemaSnapshot, type SchemaSnapshot } from "./snapshot.ts";

const authors = pgTable("authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default("untitled"),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
  },
  () => withRls({ tenantColumn: "tenant_id", ownerColumn: "owner_id" }).policies,
).enableRLS();

describe("schemaSnapshot", () => {
  let db: FacilisDb;
  let snapshot: SchemaSnapshot;

  beforeAll(async () => {
    db = await createDb({ schema: { documents, authors } });
    snapshot = await schemaSnapshot(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("lists schema tables in deterministic (name) order", () => {
    expect(snapshot.tables.map((table) => table.name)).toEqual(["authors", "documents"]);
  });

  it("reports columns with type, nullability, defaults and keys", () => {
    const documentTable = snapshot.tables.find((table) => table.name === "documents");
    if (documentTable === undefined) throw new Error("documents table missing");

    const byName = new Map(documentTable.columns.map((column) => [column.name, column]));
    expect(byName.get("id")).toMatchObject({
      type: "uuid",
      notNull: true,
      isPrimaryKey: true,
      default: "gen_random_uuid()",
    });
    expect(byName.get("title")).toMatchObject({
      type: "text",
      notNull: true,
      default: "'untitled'",
    });
    expect(byName.get("author_id")).toMatchObject({ type: "uuid", notNull: true });
  });

  it("reports unique columns and foreign keys", () => {
    const authorTable = snapshot.tables.find((table) => table.name === "authors");
    const documentTable = snapshot.tables.find((table) => table.name === "documents");
    if (authorTable === undefined || documentTable === undefined) {
      throw new Error("fixture tables missing");
    }

    expect(authorTable.columns.find((column) => column.name === "email")?.isUnique).toBe(true);
    expect(documentTable.foreignKeys).toEqual([
      {
        columns: ["author_id"],
        targetTable: "authors",
        targetColumns: ["id"],
        onDelete: "cascade",
      },
    ]);
  });

  it("reports RLS enablement, policies and the detected scope column", () => {
    const documentTable = snapshot.tables.find((table) => table.name === "documents");
    const authorTable = snapshot.tables.find((table) => table.name === "authors");
    if (documentTable === undefined || authorTable === undefined) {
      throw new Error("fixture tables missing");
    }

    expect(documentTable.rlsEnabled).toBe(true);
    expect(documentTable.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(documentTable.policies[0]).toMatchObject({
      command: "ALL",
      withCheck: expect.any(String),
    });
    expect(documentTable.policies[0]?.using).toContain(
      "nullif(current_setting('app.tenant_id', true), '')::uuid",
    );
    expect(documentTable.policies[0]?.sql.startsWith("CREATE POLICY")).toBe(true);
    expect(documentTable.scopeColumn).toEqual({ name: "tenant_id", kind: "tenant" });

    expect(authorTable.rlsEnabled).toBe(false);
    expect(authorTable.policies).toEqual([]);
    expect(authorTable.scopeColumn).toBeUndefined();
  });
});
