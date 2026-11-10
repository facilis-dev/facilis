import type { SchemaSnapshot, TableSnapshot } from "@facilis/db";
import { describe, expect, it } from "vitest";

import { baseSnapshot, column, makeTable, todosTable, updateColumn, withTable } from "./fixtures.ts";
import { planSchema } from "./plan.ts";

const GOLDEN_IDS = [
  "001-create-table-todos",
  "002-create-table-users",
  "003-add-fk-todos-author_id",
  "004-enable-rls-todos",
  "005-create-policy-todos-owner_isolation",
  "006-create-policy-todos-tenant_isolation",
  "007-create-index-todos_done_idx",
  "008-create-index-todos_title_idx",
  "009-create-index-users_created_at_idx",
];

const GOLDEN_SQL = [
  "CREATE TABLE \"todos\" (\n  \"id\" uuid DEFAULT gen_random_uuid() NOT NULL,\n  \"tenant_id\" uuid NOT NULL,\n  \"owner_id\" uuid NOT NULL,\n  \"author_id\" uuid NOT NULL,\n  \"title\" text DEFAULT 'untitled' NOT NULL,\n  \"done\" boolean DEFAULT false NOT NULL,\n  \"note\" text,\n  CONSTRAINT \"pk__todos__id\" PRIMARY KEY (\"id\"),\n  CONSTRAINT \"todos_title_ck\" CHECK (length((\"todos\".\"title\")::text) > 0)\n);",
  "CREATE TABLE \"users\" (\n  \"id\" uuid DEFAULT gen_random_uuid() NOT NULL,\n  \"email\" text NOT NULL,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  CONSTRAINT \"pk__users__id\" PRIMARY KEY (\"id\"),\n  CONSTRAINT \"uniq__users__email\" UNIQUE (\"email\")\n);",
  "ALTER TABLE \"todos\" ADD CONSTRAINT \"fk__todos__author_id__users__id\" FOREIGN KEY (\"author_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE ON UPDATE NO ACTION;",
  "ALTER TABLE \"todos\" ENABLE ROW LEVEL SECURITY;",
  'CREATE POLICY "owner_isolation" ON "todos" FOR ALL TO public USING ("owner_id" = nullif(current_setting(\'app.user_id\', true), \'\')::uuid) WITH CHECK ("owner_id" = nullif(current_setting(\'app.user_id\', true), \'\')::uuid);',
  'CREATE POLICY "tenant_isolation" ON "todos" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting(\'app.tenant_id\', true), \'\')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting(\'app.tenant_id\', true), \'\')::uuid);',
  'CREATE INDEX "todos_done_idx" ON "todos" ("done");',
  'CREATE INDEX "todos_title_idx" ON "todos" ("title");',
  'CREATE INDEX "users_created_at_idx" ON "users" ("created_at");',
];

describe("planSchema golden plan", () => {
  it("plans an empty database to the users+todos schema with exact SQL", () => {
    const plan = planSchema({ tables: [] }, baseSnapshot());

    expect(plan.problems).toEqual([]);
    expect(plan.batches.map((batch) => batch.id)).toEqual(GOLDEN_IDS);
    expect(plan.batches.map((batch) => batch.sql)).toEqual(GOLDEN_SQL);
    expect(plan.batches.map((batch) => batch.risk)).toEqual([
      "safe", "safe", "careful", "careful", "safe", "safe", "careful", "careful", "careful",
    ]);
    expect(plan.risk).toBe("careful");
    expect(plan.destructive).toEqual([]);
  });

  it("is deterministic: table order in the snapshot does not change the plan", () => {
    const plan = planSchema({ tables: [] }, baseSnapshot());
    const shuffled: SchemaSnapshot = { tables: baseSnapshot().tables.toReversed(), enums: [] };

    expect(planSchema({ tables: [] }, shuffled)).toEqual(plan);
    expect(planSchema({ tables: [] }, baseSnapshot())).toEqual(plan);
  });

  it("uses ordered column names for a composite primary key", () => {
    const events = makeTable("events", {
      columns: [
        column("tenant_id", { type: "uuid", notNull: true, isPrimaryKey: true }),
        column("seq", { type: "integer", notNull: true, isPrimaryKey: true }),
      ],
      primaryKey: ["tenant_id", "seq"],
    });
    const plan = planSchema({ tables: [] }, { tables: [events] });

    expect(plan.batches[0]?.sql).toContain('PRIMARY KEY ("tenant_id", "seq")');
  });
});

describe("planSchema table and column changes", () => {
  it("creates an added table", () => {
    const comments = makeTable("comments", {
      columns: [
        column("id", { type: "uuid", notNull: true, isPrimaryKey: true }),
        column("body", { notNull: true }),
      ],
      primaryKey: ["id"],
    });
    const plan = planSchema(baseSnapshot(), withTable(baseSnapshot(), comments));

    expect(plan.batches).toEqual([
      {
        id: "001-create-table-comments",
        sql: 'CREATE TABLE "comments" (\n  "id" uuid NOT NULL,\n  "body" text NOT NULL,\n  CONSTRAINT "pk__comments__id" PRIMARY KEY ("id")\n);',
        risk: "safe",
      },
    ]);
  });

  it("adds a nullable column", () => {
    const target = withTable(baseSnapshot(), {
      ...todosTable(),
      columns: [...todosTable().columns, column("due_date", { type: "timestamp with time zone" })],
    });
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([
      {
        id: "001-add-column-todos-due_date",
        sql: 'ALTER TABLE "todos" ADD COLUMN "due_date" timestamp with time zone;',
        risk: "careful",
      },
    ]);
  });

  it("adds a column with a default and NOT NULL in one batch (default backfills)", () => {
    const target = withTable(baseSnapshot(), {
      ...todosTable(),
      columns: [...todosTable().columns, column("priority", { type: "integer", notNull: true, default: "0" })],
    });
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([
      {
        id: "001-add-column-todos-priority",
        sql: 'ALTER TABLE "todos" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;',
        risk: "careful",
      },
    ]);
  });

  it("sets NOT NULL on an existing column with a row-count requirement", () => {
    const target = withTable(baseSnapshot(), updateColumn(todosTable(), "note", { notNull: true }));
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([
      {
        id: "001-set-not-null-todos-note",
        sql: 'ALTER TABLE "todos" ALTER COLUMN "note" SET NOT NULL;',
        risk: "careful",
        requires: ["no_null_rows:todos.note"],
      },
    ]);
  });

  it("drops a column into a destructive batch", () => {
    const existing = todosTable();
    const target = withTable(baseSnapshot(), {
      ...existing,
      columns: existing.columns.filter((entry) => entry.name !== "note"),
    });
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([
      { id: "001-drop-column-todos-note", sql: 'ALTER TABLE "todos" DROP COLUMN "note";', risk: "destructive" },
    ]);
    expect(plan.risk).toBe("destructive");
    expect(plan.destructive).toEqual(["001-drop-column-todos-note"]);
  });

  it("drops the index of a dropped column in phase 1, before the DROP COLUMN", () => {
    const existing = todosTable();
    const target = withTable(baseSnapshot(), {
      ...existing,
      columns: existing.columns.filter((entry) => entry.name !== "done"),
      indexes: existing.indexes?.filter((entry) => entry.name !== "todos_done_idx"),
    });
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches.map((batch) => [batch.id, batch.risk])).toEqual([
      ["001-drop-index-todos_done_idx", "careful"],
      ["002-drop-column-todos-done", "destructive"],
    ]);
    expect(plan.destructive).toEqual(["002-drop-column-todos-done"]);
  });

  it("drops a table policies, check and indexes before dropping the table", () => {
    const plan = planSchema(baseSnapshot(), { tables: [baseSnapshot().tables[0] as TableSnapshot], enums: [] });

    expect(plan.batches.map((batch) => batch.id)).toEqual([
      "001-drop-policy-todos-owner_isolation",
      "002-drop-policy-todos-tenant_isolation",
      "003-drop-check-todos-todos_title_ck",
      "004-drop-index-todos_done_idx",
      "005-drop-index-todos_title_idx",
      "006-drop-table-todos",
    ]);
    expect(plan.risk).toBe("destructive");
    expect(plan.destructive).toEqual(["006-drop-table-todos"]);
  });

  it("treats a column type change as destructive", () => {
    const target = withTable(baseSnapshot(), updateColumn(todosTable(), "title", { type: "varchar(120)" }));
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([
      {
        id: "001-alter-type-todos-title",
        sql: 'ALTER TABLE "todos" ALTER COLUMN "title" TYPE varchar(120) USING "title"::varchar(120);',
        risk: "destructive",
      },
    ]);
    expect(plan.destructive).toEqual(["001-alter-type-todos-title"]);
  });

  it("creates a new enum type before the column that uses it", () => {
    const existing = todosTable();
    const withEnumColumn = withTable(baseSnapshot(), {
      ...existing,
      columns: [...existing.columns, column("priority_level", { type: "priority", notNull: true, default: "'low'" })],
    });
    const target: SchemaSnapshot = { ...withEnumColumn, enums: [{ name: "priority", values: ["low", "high"] }] };
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches.map((batch) => [batch.id, batch.risk])).toEqual([
      ["001-create-type-priority", "safe"],
      ["002-add-column-todos-priority_level", "careful"],
    ]);
    expect(plan.batches[0]?.sql).toBe('CREATE TYPE "priority" AS ENUM (\'low\', \'high\');');
  });

  it("refuses a changed enum value set", () => {
    const plan = planSchema(
      { tables: [], enums: [{ name: "priority", values: ["low"] }] },
      { tables: [], enums: [{ name: "priority", values: ["low", "high"] }] },
    );

    expect(plan.batches).toEqual([]);
    expect(plan.problems).toEqual([{ code: "unsupported_change", construct: "enum:priority" }]);
  });

  it("refuses a removed enum type", () => {
    const plan = planSchema({ tables: [], enums: [{ name: "priority", values: ["low"] }] }, { tables: [] });

    expect(plan.problems).toEqual([{ code: "unsupported_change", construct: "enum:priority" }]);
  });

  it("refuses an identity column", () => {
    const existing = todosTable();
    const target = withTable(baseSnapshot(), {
      ...existing,
      columns: [...existing.columns, column("seq", { type: "integer", notNull: true, identity: "always" })],
    });
    const plan = planSchema(baseSnapshot(), target);

    expect(plan.batches).toEqual([]);
    expect(plan.problems).toEqual([
      { code: "unsupported_declaration", table: "todos", column: "seq", construct: "identity:seq" },
    ]);
  });
});
