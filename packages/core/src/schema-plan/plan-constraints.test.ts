import type { ColumnSnapshot, PolicySnapshot, SchemaSnapshot, TableSnapshot } from "@facilis/db";
import { describe, expect, it } from "vitest";

import { planSchema } from "./plan.ts";

const TENANT = "\"tenant_id\" = nullif(current_setting('app.tenant_id', true), '')::uuid";
const OWNER = "\"owner_id\" = nullif(current_setting('app.user_id', true), '')::uuid";

function column(name: string, overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot {
  return { name, type: "text", notNull: false, default: null, isPrimaryKey: false, isUnique: false, ...overrides };
}

function table(name: string, overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return { name, rlsEnabled: false, columns: [], foreignKeys: [], policies: [], ...overrides };
}

function policy(name: string, predicate: string, restrictive = false): PolicySnapshot {
  const as = restrictive ? " AS RESTRICTIVE" : "";
  return {
    name,
    command: "ALL",
    using: predicate,
    withCheck: predicate,
    sql: 'CREATE POLICY "' + name + '" ON "todos"' + as + ' FOR ALL TO public USING (' + predicate + ') WITH CHECK (' + predicate + ');',
  };
}

function todos(): TableSnapshot {
  return table("todos", {
    rlsEnabled: true,
    columns: [
      column("id", { type: "uuid", notNull: true, isPrimaryKey: true }),
      column("tenant_id", { type: "uuid", notNull: true }),
      column("owner_id", { type: "uuid", notNull: true }),
      column("title", { notNull: true }),
      column("done", { type: "boolean", notNull: true, default: "false" }),
    ],
    primaryKey: ["id"],
    policies: [policy("tenant_isolation", TENANT, true), policy("owner_isolation", OWNER)],
    scopeColumn: { name: "tenant_id", kind: "tenant" },
    indexes: [{ name: "todos_title_idx", columns: ["title"], unique: false }],
    checks: [{ name: "todos_title_ck", expression: 'length(("todos"."title")::text) > 0' }],
  });
}

function base(): SchemaSnapshot {
  return { tables: [todos()] };
}

function withTodos(overrides: Partial<TableSnapshot>): SchemaSnapshot {
  return { tables: [{ ...todos(), ...overrides }] };
}

describe("planSchema index and check changes", () => {
  it("adds an index in phase 7", () => {
    const plan = planSchema(base(), withTodos({ indexes: [...(todos().indexes ?? []), { name: "todos_done_idx", columns: ["done"], unique: false }] }));

    expect(plan.batches).toEqual([
      { id: "001-create-index-todos_done_idx", sql: 'CREATE INDEX "todos_done_idx" ON "todos" ("done");', risk: "careful" },
    ]);
  });

  it("drops a removed index", () => {
    const plan = planSchema(base(), withTodos({ indexes: [] }));

    expect(plan.batches).toEqual([
      { id: "001-drop-index-todos_title_idx", sql: 'DROP INDEX "todos_title_idx";', risk: "careful" },
    ]);
  });

  it("replaces a changed index definition (drop in phase 1, create in phase 7)", () => {
    const plan = planSchema(
      base(),
      withTodos({ indexes: [{ name: "todos_title_idx", columns: ["done"], unique: true }] }),
    );

    expect(plan.batches).toEqual([
      { id: "001-drop-index-todos_title_idx", sql: 'DROP INDEX "todos_title_idx";', risk: "careful" },
      {
        id: "002-create-index-todos_title_idx",
        sql: 'CREATE UNIQUE INDEX "todos_title_idx" ON "todos" ("done");',
        risk: "careful",
      },
    ]);
  });

  it("adds a check constraint", () => {
    const checks = [...(todos().checks ?? []), { name: "todos_done_ck", expression: '"done" = true' }];
    const plan = planSchema(base(), withTodos({ checks }));

    expect(plan.batches).toEqual([
      {
        id: "001-add-check-todos-todos_done_ck",
        sql: 'ALTER TABLE "todos" ADD CONSTRAINT "todos_done_ck" CHECK ("done" = true);',
        risk: "careful",
      },
    ]);
  });

  it("replaces a changed check constraint (drop in phase 1, add in phase 5)", () => {
    const checks = [{ name: "todos_title_ck", expression: '"title" <> \'\'' }];
    const plan = planSchema(base(), withTodos({ checks }));

    expect(plan.batches.map((batch) => batch.id)).toEqual([
      "001-drop-check-todos-todos_title_ck",
      "002-add-check-todos-todos_title_ck",
    ]);
  });

  it("drops a removed check constraint", () => {
    const plan = planSchema(base(), withTodos({ checks: [] }));

    expect(plan.batches).toEqual([
      {
        id: "001-drop-check-todos-todos_title_ck",
        sql: 'ALTER TABLE "todos" DROP CONSTRAINT "todos_title_ck";',
        risk: "careful",
      },
    ]);
  });
});

describe("planSchema foreign key changes", () => {
  const selfFk = { columns: ["owner_id"], targetTable: "todos", targetColumns: ["id"] };

  it("adds a foreign key with the derived name", () => {
    const plan = planSchema(base(), withTodos({ foreignKeys: [selfFk] }));

    expect(plan.batches).toEqual([
      {
        id: "001-add-fk-todos-owner_id",
        sql: 'ALTER TABLE "todos" ADD CONSTRAINT "fk__todos__owner_id__todos__id" FOREIGN KEY ("owner_id") REFERENCES "todos" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;',
        risk: "careful",
      },
    ]);
  });

  it("drops a removed foreign key by the same derived name", () => {
    const plan = planSchema(withTodos({ foreignKeys: [selfFk] }), base());

    expect(plan.batches).toEqual([
      {
        id: "001-drop-fk-todos-owner_id",
        sql: 'ALTER TABLE "todos" DROP CONSTRAINT "fk__todos__owner_id__todos__id";',
        risk: "careful",
      },
    ]);
  });

  it("replaces a changed foreign key (drop first, then add)", () => {
    const plan = planSchema(
      withTodos({ foreignKeys: [selfFk] }),
      withTodos({ foreignKeys: [{ ...selfFk, onDelete: "cascade" }] }),
    );

    expect(plan.batches.map((batch) => [batch.id, batch.risk])).toEqual([
      ["001-drop-fk-todos-owner_id", "careful"],
      ["002-add-fk-todos-owner_id", "careful"],
    ]);
    expect(plan.batches[1]?.sql).toContain("ON DELETE CASCADE ON UPDATE NO ACTION;");
  });
});

describe("planSchema policy and RLS changes", () => {
  it("adds a new policy to a scoped table", () => {
    const rolePolicy = policy("role_access", '"admin" = any(current_setting(\'app.roles\', true)::jsonb)');
    const plan = planSchema(base(), withTodos({ policies: [...(todos().policies ?? []), rolePolicy] }));

    expect(plan.batches).toEqual([{ id: "001-create-policy-todos-role_access", sql: rolePolicy.sql, risk: "safe" }]);
  });

  it("refuses a scoped policy that loses the app scope predicate (broadening)", () => {
    const broadened = policy("tenant_isolation", '"true"', true);
    const plan = planSchema(base(), withTodos({ policies: [broadened, policy("owner_isolation", OWNER)] }));

    expect(plan.batches).toEqual([]);
    expect(plan.problems).toEqual([
      { code: "policy_unsafe", table: "todos", construct: "policy:tenant_isolation" },
    ]);
  });

  it("replaces a changed policy: DROP in phase 1, CREATE in phase 6", () => {
    const changed = policy("tenant_isolation", TENANT + ' and "done" = true', true);
    const plan = planSchema(base(), withTodos({ policies: [changed, policy("owner_isolation", OWNER)] }));

    expect(plan.batches.map((batch) => [batch.id, batch.risk])).toEqual([
      ["001-drop-policy-todos-tenant_isolation", "careful"],
      ["002-create-policy-todos-tenant_isolation", "safe"],
    ]);
  });

  it("refuses removing a policy from a scoped table", () => {
    const plan = planSchema(base(), withTodos({ policies: [policy("tenant_isolation", TENANT, true)] }));

    expect(plan.batches).toEqual([]);
    expect(plan.problems).toEqual([
      { code: "policy_unsafe", table: "todos", construct: "policy:owner_isolation" },
    ]);
  });

  it("refuses disabling RLS on a scoped table", () => {
    const plan = planSchema(base(), withTodos({ rlsEnabled: false }));

    expect(plan.batches).toEqual([]);
    expect(plan.problems).toEqual([{ code: "policy_unsafe", table: "todos", construct: "rls" }]);
  });

  it("drops a policy and disables RLS on a table that was not scoped", () => {
    const events = table("events", {
      rlsEnabled: true,
      columns: [column("id", { type: "uuid", notNull: true, isPrimaryKey: true })],
      primaryKey: ["id"],
      policies: [policy("events_read", '"id" is not null')],
    });
    const plan = planSchema({ tables: [events] }, { tables: [{ ...events, rlsEnabled: false, policies: [] }] });

    expect(plan.batches.map((batch) => [batch.id, batch.risk])).toEqual([
      ["001-drop-policy-events-events_read", "careful"],
      ["002-disable-rls-events", "careful"],
    ]);
    expect(plan.problems).toEqual([]);
  });

  it("enables RLS on an existing table that was not scoped", () => {
    const events = table("events", {
      columns: [column("id", { type: "uuid", notNull: true, isPrimaryKey: true })],
      primaryKey: ["id"],
    });
    const plan = planSchema({ tables: [events] }, { tables: [{ ...events, rlsEnabled: true }] });

    expect(plan.batches).toEqual([
      { id: "001-enable-rls-events", sql: 'ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;', risk: "careful" },
    ]);
  });
});

describe("planSchema unique constraints", () => {
  it("adds and drops a table-level unique constraint", () => {
    const unique = { name: "todos_title_unique", columns: ["title"] };
    const added = planSchema(base(), withTodos({ uniqueConstraints: [unique] }));
    const dropped = planSchema(withTodos({ uniqueConstraints: [unique] }), base());

    expect(added.batches).toEqual([
      {
        id: "001-add-unique-todos-todos_title_unique",
        sql: 'ALTER TABLE "todos" ADD CONSTRAINT "todos_title_unique" UNIQUE ("title");',
        risk: "careful",
      },
    ]);
    expect(dropped.batches).toEqual([
      {
        id: "001-drop-unique-todos-todos_title_unique",
        sql: 'ALTER TABLE "todos" DROP CONSTRAINT "todos_title_unique";',
        risk: "careful",
      },
    ]);
  });

  it("adds and drops a column-level unique constraint under the derived name", () => {
    const withUnique = withTodos({
      columns: todos().columns.map((entry) => (entry.name === "title" ? Object.assign({}, entry, { isUnique: true }) : entry)),
    });
    const added = planSchema(base(), withUnique);
    const dropped = planSchema(withUnique, base());

    expect(added.batches).toEqual([
      {
        id: "001-add-unique-todos-title",
        sql: 'ALTER TABLE "todos" ADD CONSTRAINT "uniq__todos__title" UNIQUE ("title");',
        risk: "careful",
      },
    ]);
    expect(dropped.batches).toEqual([
      {
        id: "001-drop-unique-todos-title",
        sql: 'ALTER TABLE "todos" DROP CONSTRAINT "uniq__todos__title";',
        risk: "careful",
      },
    ]);
  });
});
