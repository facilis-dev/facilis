import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { liveSchemaSnapshot, type LiveSchemaSnapshot } from "./live-schema.ts";
import { applyStatements } from "./migrator.ts";
import { ownerIsolationPolicy, tenantIsolationPolicy } from "./rls.ts";
import {
  canonicalDigestJson,
  declaredDigestSchema,
  digestSchema,
  liveDigestSchema,
  normalizeDefault,
  SCHEMA_DIGEST_VERSION,
  type DigestColumn,
  type DigestSchema,
} from "./schema-digest.ts";
import { schemaSnapshot, type SchemaSnapshot } from "./snapshot.ts";
import { tenantColumn } from "./tenant-column.ts";

const DIGEST = /^v1:sha256:[0-9a-f]{64}$/;

const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    done: boolean("done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
).enableRLS();

// The project's canonical tenant column: its default is a GUC-reading expression, the
// hardest default to reconcile between Drizzle's rendering and the catalog's.
const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    body: text("body").notNull(),
  },
  () => [tenantIsolationPolicy()],
).enableRLS();

describe("schema digest", () => {
  let db: FacilisDb;
  let declared: SchemaSnapshot;
  let live: LiveSchemaSnapshot;
  let declaredDigest: string;
  let liveDigest: string;

  beforeAll(async () => {
    db = await createDb({ schema: { items, notes } });
    declared = await schemaSnapshot(db);
    const policies = declared.tables.flatMap((table) => table.policies.map((policy) => policy.sql));
    await applyStatements(db, [
      `CREATE TABLE items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        owner_id uuid NOT NULL,
        title text NOT NULL,
        note text,
        done boolean NOT NULL DEFAULT false,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )`,
      "ALTER TABLE items ENABLE ROW LEVEL SECURITY",
      `CREATE TABLE notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
        body text NOT NULL
      )`,
      "ALTER TABLE notes ENABLE ROW LEVEL SECURITY",
      ...policies,
    ]);
    live = await liveSchemaSnapshot(db);
    declaredDigest = digestSchema(declaredDigestSchema(declared));
    liveDigest = digestSchema(liveDigestSchema(live));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("digests the declared schema and the database it produces identically", () => {
    expect(declaredDigest).toBe(liveDigest);
  });

  it("is stable across independent snapshots of the same schema", async () => {
    const again = digestSchema(declaredDigestSchema(await schemaSnapshot(db)));
    const liveAgain = digestSchema(liveDigestSchema(await liveSchemaSnapshot(db)));

    expect(again).toBe(declaredDigest);
    expect(liveAgain).toBe(liveDigest);
  });

  it("spells a versioned sha256 digest", () => {
    expect(SCHEMA_DIGEST_VERSION).toBe(1);
    expect(declaredDigest).toMatch(DIGEST);
    expect(liveDigest).toMatch(DIGEST);
  });

  it("hashes canonical JSON with sorted keys and no whitespace", () => {
    const json = canonicalDigestJson(declaredDigestSchema(declared));

    // No pretty-printing whitespace: no space ever follows a JSON punctuation character.
    expect(json).not.toMatch(/[{}[\],:]\s/);
    expect(Object.keys(JSON.parse(json))).toEqual(["digestVersion", "tables"]);
    const table = JSON.parse(json).tables[0] as Record<string, unknown>;
    expect(Object.keys(table)).toEqual(["columns", "name", "policies", "rlsEnabled"]);
  });

  it("changes when a column type, nullability or default changes", () => {
    expect(digestWithColumn("title", { type: "varchar(120)" })).not.toBe(declaredDigest);
    expect(digestWithColumn("title", { notNull: false })).not.toBe(declaredDigest);
    expect(digestWithColumn("title", { default: "'untitled'" })).not.toBe(declaredDigest);
    expect(digestWithColumn("id", { isPrimaryKey: false })).not.toBe(declaredDigest);
  });

  it("ignores column order and policy order", () => {
    // The projection sorts: a source snapshot in any order must digest identically.
    const reordered: SchemaSnapshot = structuredClone(declared);
    const reorderedLive: LiveSchemaSnapshot = structuredClone(live);
    for (const table of reordered.tables) {
      table.columns.reverse();
      table.policies.reverse();
    }
    for (const table of reorderedLive.tables) {
      table.columns.reverse();
      table.policies.reverse();
    }
    reordered.tables.reverse();
    reorderedLive.tables.reverse();

    expect(digestSchema(declaredDigestSchema(reordered))).toBe(declaredDigest);
    expect(digestSchema(liveDigestSchema(reorderedLive))).toBe(liveDigest);
  });

  it("produces different digests for different schemas", () => {
    const base = declaredDigestSchema(declared);
    const extraColumn: DigestSchema = {
      ...base,
      tables: base.tables.map((table) => ({
        ...table,
        columns: [
          ...table.columns,
          {
            name: "archived_at",
            type: "timestamp with time zone",
            notNull: false,
            default: null,
            isPrimaryKey: false,
          },
        ],
      })),
    };
    const firstTable = base.tables[0];
    if (firstTable === undefined) throw new Error("items table missing");
    const otherTable: DigestSchema = {
      ...base,
      tables: [...base.tables, { ...firstTable, name: "other_items" }],
    };

    expect(digestSchema(extraColumn)).not.toBe(declaredDigest);
    expect(digestSchema(otherTable)).not.toBe(declaredDigest);
  });

  function digestWithColumn(columnName: string, patch: Partial<DigestColumn>): string {
    const base = declaredDigestSchema(declared);
    const tables = base.tables.map((table) => ({
      name: table.name,
      rlsEnabled: table.rlsEnabled,
      columns: table.columns.map((column) =>
        column.name === columnName ? { ...column, ...patch } : column,
      ),
      policies: table.policies,
    }));
    return digestSchema({ digestVersion: base.digestVersion, tables });
  }
});

describe("normalizeDefault", () => {
  const equivalentPairs: readonly [string, string][] = [
    ["'untitled'", "'untitled'::text"],
    ["false", "false"],
    ["gen_random_uuid()", "gen_random_uuid()"],
    ["now()", "now()"],
    ["CURRENT_TIMESTAMP", "now()"],
    ["0", "0"],
    ["'It''s'", "'It''s'::character varying"],
    [
      "nullif(current_setting('app.tenant_id', true), '')::uuid",
      "(NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid",
    ],
  ];

  it("folds the catalog spells onto the Drizzle ones", () => {
    for (const [declaredValue, catalogValue] of equivalentPairs) {
      expect(normalizeDefault(catalogValue)).toBe(normalizeDefault(declaredValue));
    }
  });

  it("keeps real default differences", () => {
    expect(normalizeDefault("'Draft'")).not.toBe(normalizeDefault("'draft'"));
    expect(normalizeDefault("'true'")).not.toBe(normalizeDefault("true"));
    expect(normalizeDefault("0")).not.toBe(normalizeDefault("'0'"));
    expect(normalizeDefault(null)).toBeNull();
  });
});
