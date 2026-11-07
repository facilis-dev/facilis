import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { liveSchemaSnapshot, type LiveSchemaSnapshot } from "./live-schema.ts";
import { applyStatements } from "./migrator.ts";
import { tenantIsolationPolicy } from "./rls.ts";
import { canonicalColumnType, diffSchemaSnapshots, type SchemaDrift } from "./schema-drift.ts";
import { schemaSnapshot, type SchemaSnapshot } from "./snapshot.ts";

const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    done: varchar("done").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  () => [tenantIsolationPolicy()],
).enableRLS();

function codeSnapshot(): SchemaSnapshot {
  return {
    tables: [
      {
        name: "todos",
        rlsEnabled: true,
        columns: [
          {
            name: "id",
            type: "uuid",
            notNull: true,
            default: null,
            isPrimaryKey: true,
            isUnique: false,
          },
          {
            name: "title",
            type: "varchar(120)",
            notNull: true,
            default: null,
            isPrimaryKey: false,
            isUnique: false,
          },
          {
            name: "done",
            type: "boolean",
            notNull: true,
            default: null,
            isPrimaryKey: false,
            isUnique: false,
          },
        ],
        foreignKeys: [],
        policies: [
          {
            name: "tenant_isolation",
            command: "ALL",
            using: `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`,
            withCheck: `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`,
            sql: "CREATE POLICY tenant_isolation ON todos AS RESTRICTIVE FOR ALL USING (...) WITH CHECK (...);",
          },
        ],
        scopeColumn: { name: "tenant_id", kind: "tenant" },
      },
    ],
  };
}

function liveSnapshot(
  overrides: Partial<LiveSchemaSnapshot["tables"][number]> = {},
): LiveSchemaSnapshot {
  return {
    tables: [
      {
        name: "todos",
        rlsEnabled: true,
        columns: [
          { name: "id", type: "uuid", notNull: true, default: null, isPrimaryKey: true },
          {
            name: "title",
            type: "character varying(120)",
            notNull: true,
            default: null,
            isPrimaryKey: false,
          },
          { name: "done", type: "boolean", notNull: true, default: null, isPrimaryKey: false },
        ],
        policies: [
          {
            name: "tenant_isolation",
            command: "ALL",
            restrictive: true,
            roles: ["public"],
            using: `(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
            withCheck: `(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
          },
        ],
        ...overrides,
      },
    ],
  };
}

function kinds(drift: readonly SchemaDrift[]): string[] {
  return drift.map((entry) => entry.kind);
}

describe("canonicalColumnType", () => {
  it("collapses Drizzle and catalog spellings onto one form", () => {
    expect(canonicalColumnType("character varying(120)")).toBe("varchar(120)");
    expect(canonicalColumnType("varchar(120)")).toBe("varchar(120)");
    expect(canonicalColumnType("timestamp without time zone")).toBe("timestamp");
    expect(canonicalColumnType("timestamp with time zone")).toBe("timestamp with time zone");
    expect(canonicalColumnType("numeric(10, 2)")).toBe("numeric(10,2)");
    expect(canonicalColumnType("serial")).toBe("integer");
    expect(canonicalColumnType("integer")).toBe("integer");
    expect(canonicalColumnType("text[]")).toBe("text[]");
    expect(canonicalColumnType("character(2)")).toBe("char(2)");
  });
});

describe("diffSchemaSnapshots", () => {
  it("reports no drift when the catalog re-renders the code schema", () => {
    expect(diffSchemaSnapshots(codeSnapshot(), liveSnapshot())).toEqual([]);
  });

  it("reports missing and extra tables", () => {
    const live = liveSnapshot();
    live.tables.push({ name: "ghost", rlsEnabled: false, columns: [], policies: [] });
    const code = codeSnapshot();
    code.tables.push({
      name: "planned",
      rlsEnabled: false,
      columns: [],
      foreignKeys: [],
      policies: [],
    });

    const drift = diffSchemaSnapshots(code, live);
    expect(kinds(drift)).toEqual(["table_extra", "table_missing"]);
    expect(drift.map((entry) => entry.table).toSorted()).toEqual(["ghost", "planned"]);
  });

  it("reports missing/extra columns and type or nullability changes", () => {
    const live = liveSnapshot({
      columns: [
        { name: "id", type: "uuid", notNull: true, default: null, isPrimaryKey: true },
        { name: "title", type: "text", notNull: true, default: null, isPrimaryKey: false },
        { name: "done", type: "boolean", notNull: false, default: null, isPrimaryKey: false },
        { name: "surprise", type: "integer", notNull: false, default: null, isPrimaryKey: false },
      ],
    });
    const drift = diffSchemaSnapshots(codeSnapshot(), live);
    expect(kinds(drift).toSorted()).toEqual(["column_extra", "column_nullability", "column_type"]);
    expect(drift.find((entry) => entry.kind === "column_type")).toMatchObject({
      column: "title",
      expected: "varchar(120)",
      actual: "text",
    });
    expect(drift.find((entry) => entry.kind === "column_extra")?.column).toBe("surprise");
  });

  it("reports RLS off on a scoped table and missing or changed policies", () => {
    const live = liveSnapshot();
    const current = live.tables[0];
    if (current === undefined) throw new Error("todos table missing");
    live.tables[0] = {
      ...current,
      rlsEnabled: false,
      policies: [
        {
          name: "tenant_isolation",
          command: "SELECT",
          restrictive: false,
          roles: ["public"],
          using: null,
          withCheck: null,
        },
        {
          name: "manual_policy",
          command: "ALL",
          restrictive: false,
          roles: ["public"],
          using: null,
          withCheck: null,
        },
      ],
    };
    const drift = diffSchemaSnapshots(codeSnapshot(), live);
    expect(kinds(drift).toSorted()).toEqual(["policy_changed", "policy_extra", "rls_disabled"]);
  });
});

describe("diffSchemaSnapshots against a real PGlite database", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb({ schema: { todos } });
    const code = await schemaSnapshot(db);
    const policies = code.tables.flatMap((table) => table.policies.map((policy) => policy.sql));
    await applyStatements(db, [
      `CREATE TABLE todos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        owner_id uuid NOT NULL,
        title varchar(120) NOT NULL,
        done varchar NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        note text
      )`,
      "ALTER TABLE todos ENABLE ROW LEVEL SECURITY",
      ...policies,
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("reports no drift for a migrated database", async () => {
    const code = await schemaSnapshot(db);
    const live = await liveSchemaSnapshot(db);
    expect(diffSchemaSnapshots(code, live)).toEqual([]);
  });

  it("reports drift after the database drifts from the schema", async () => {
    await applyStatements(db, [
      "ALTER TABLE todos DISABLE ROW LEVEL SECURITY",
      "DROP POLICY tenant_isolation ON todos",
      "ALTER TABLE todos ALTER COLUMN title TYPE text",
      "ALTER TABLE todos ALTER COLUMN note SET NOT NULL",
      "ALTER TABLE todos ADD COLUMN surprise integer",
      "CREATE TABLE ghost (id integer)",
    ]);
    const code = await schemaSnapshot(db);
    const live = await liveSchemaSnapshot(db);
    const drift = diffSchemaSnapshots(code, live);
    expect(drift.map((entry) => entry.kind).toSorted()).toEqual([
      "column_extra",
      "column_nullability",
      "column_type",
      "policy_missing",
      "rls_disabled",
      "table_extra",
    ]);
  });
});
