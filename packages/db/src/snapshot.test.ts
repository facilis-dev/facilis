import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
  (table) => [
    ...withRls({ tenantColumn: "tenant_id", ownerColumn: "owner_id" }).policies,
    // An expression index is not representable in the v1 IndexSnapshot: it must be carried
    // as unsupported, never dropped from the declared snapshot.
    index("documents_title_lower_idx").on(sql`lower(${table.title})`),
  ],
).enableRLS();

const eventKind = pgEnum("event_kind", ["login", "logout"]);

const events = pgTable(
  "events",
  {
    tenantId: uuid("tenant_id").notNull(),
    sequence: integer("sequence").generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    kind: eventKind("kind").notNull(),
    payload: text("payload"),
    normalized: text("normalized").generatedAlwaysAs(sql`lower(${sql.identifier("payload")})`),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.sequence] }),
    index("events_occurred_at_idx").on(table.occurredAt),
    uniqueIndex("events_kind_payload_idx").on(table.kind, table.payload),
    unique("events_unique_kind_payload").on(table.kind, table.payload),
    check("events_payload_ck", sql`length(${table.payload}) <= 1000`),
  ],
);

describe("schemaSnapshot", () => {
  let db: FacilisDb;
  let snapshot: SchemaSnapshot;

  beforeAll(async () => {
    db = await createDb({ schema: { documents, authors, events } });
    snapshot = await schemaSnapshot(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("lists schema tables in deterministic (name) order", () => {
    expect(snapshot.tables.map((table) => table.name)).toEqual(["authors", "documents", "events"]);
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

  it("reports the ordered primary key, including a composite table-level PK", () => {
    const eventTable = snapshot.tables.find((table) => table.name === "events");
    const authorTable = snapshot.tables.find((table) => table.name === "authors");
    if (eventTable === undefined || authorTable === undefined) {
      throw new Error("fixture tables missing");
    }

    expect(eventTable.primaryKey).toEqual(["tenant_id", "sequence"]);
    expect(authorTable.primaryKey).toEqual(["id"]);
    expect(eventTable.columns.find((column) => column.name === "tenant_id")?.isPrimaryKey).toBe(
      true,
    );
    expect(eventTable.columns.find((column) => column.name === "sequence")?.isPrimaryKey).toBe(true);
  });

  it("reports indexes, checks and table-level unique constraints", () => {
    const eventTable = snapshot.tables.find((table) => table.name === "events");
    if (eventTable === undefined) throw new Error("events table missing");

    expect(eventTable.indexes).toEqual([
      { name: "events_occurred_at_idx", columns: ["occurred_at"], unique: false },
      { name: "events_kind_payload_idx", columns: ["kind", "payload"], unique: true },
    ]);
    expect(eventTable.uniqueConstraints).toEqual([
      { name: "events_unique_kind_payload", columns: ["kind", "payload"] },
    ]);
    expect(eventTable.checks?.map((entry) => entry.name)).toEqual(["events_payload_ck"]);
    expect(eventTable.checks?.[0]?.expression).toContain('length("events"."payload")');
  });

  it("collects enum types and flags identity/generated columns", () => {
    const eventTable = snapshot.tables.find((table) => table.name === "events");
    if (eventTable === undefined) throw new Error("events table missing");

    expect(snapshot.enums).toEqual([{ name: "event_kind", values: ["login", "logout"] }]);
    expect(eventTable.columns.find((column) => column.name === "sequence")?.identity).toBe("always");
    expect(eventTable.columns.find((column) => column.name === "normalized")?.generated).toBe(true);
    expect(eventTable.columns.find((column) => column.name === "kind")?.type).toBe("event_kind");
  });

  it("carries index shapes the v1 snapshot cannot represent as unsupported", () => {
    const documentTable = snapshot.tables.find((table) => table.name === "documents");
    if (documentTable === undefined) throw new Error("documents table missing");

    expect(documentTable.unsupported).toEqual([
      { construct: "index", name: "documents_title_lower_idx" },
    ]);
    expect(documentTable.indexes).toEqual([
      { name: "documents_title_lower_idx", columns: [], unique: false },
    ]);
  });
});
