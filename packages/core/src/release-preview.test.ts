import { describe, expect, it } from "vitest";

import type { SchemaSnapshot, TableSnapshot } from "@facilis.dev/db";

import type { GitRef, ReleasePreview } from "./release.ts";
import {
  buildReleasePreview,
  type ReleaseRouteFact,
  type ReleaseSnapshot,
} from "./release-preview.ts";
import {
  baseSnapshot,
  column,
  makeTable,
  policyFor,
  TENANT_PREDICATE,
  todosTable,
  updateColumn,
  usersTable,
  withTable,
} from "./schema-plan/fixtures.ts";
import { planSchema } from "./schema-plan/plan.ts";

const FROM: GitRef = { kind: "commit", ref: "HEAD~1", oid: "1111111111111111" };
const TO: GitRef = { kind: "commit", ref: "HEAD", oid: "2222222222222222" };
const EMPTY: SchemaSnapshot = { tables: [], enums: [] };

function snapshot(schema: SchemaSnapshot, routes: ReleaseRouteFact[] = []): ReleaseSnapshot {
  return { schema, routes };
}

function route(overrides: Partial<ReleaseRouteFact> = {}): ReleaseRouteFact {
  return {
    method: "GET",
    path: "/api/todos",
    sourceFile: "server/routes/api/todos/index.get.ts",
    ...overrides,
  };
}

function previewOf(
  before: SchemaSnapshot,
  after: SchemaSnapshot,
  routes: ReleaseRouteFact[] = [],
): ReleasePreview {
  return buildReleasePreview({ from: FROM, to: TO, before: snapshot(before), after: snapshot(after, routes) });
}

/** todos with one column dropped, one retyped and one added: the add/drop/change pair. */
function changedTodos(): TableSnapshot {
  const retyped = updateColumn(todosTable(), "title", { type: "varchar" });
  return {
    ...retyped,
    columns: [
      ...retyped.columns.filter((entry) => entry.name !== "note"),
      column("priority", { type: "integer" }),
    ],
  };
}

describe("buildReleasePreview schema lens", () => {
  // Acceptance (a): for the same snapshot pair the IDE plan IS the artifact plan.
  const pairs: readonly (readonly [string, SchemaSnapshot, SchemaSnapshot])[] = [
    ["empty -> declared", EMPTY, baseSnapshot()],
    ["add table", baseSnapshot(), withTable(baseSnapshot(), makeTable("notes", { columns: [column("id"), column("body")] }))],
    ["drop table", baseSnapshot(), { tables: [usersTable()], enums: [] }],
    ["add/drop/change columns", baseSnapshot(), withTable(baseSnapshot(), changedTodos())],
    ["identical", baseSnapshot(), baseSnapshot()],
  ];
  it.each(pairs)("equals planSchema(from, to): %s", (_name, before, after) => {
    const preview = previewOf(before, after);
    expect(preview.schema.plan).toEqual(planSchema(before, after));
  });

  it("renders the empty -> declared plan as shippable batches", () => {
    const preview = previewOf(EMPTY, baseSnapshot());
    expect(preview.schema.plan.problems).toEqual([]);
    expect(preview.schema.plan.batches.length).toBeGreaterThan(0);
    expect(preview.schema.plan.batches[0]?.id).toMatch(/^001-/);
    expect(preview.schema.plan.risk).not.toBe("breaking");
    expect(preview.schema.summary.addedTables).toBe(2);
  });

  it("summarises added, dropped and altered schema objects", () => {
    const retyped = updateColumn(todosTable(), "title", { type: "varchar" });
    const after = withTable(
      withTable(baseSnapshot(), {
        ...retyped,
        columns: retyped.columns.filter((entry) => entry.name !== "note"),
        policies: [policyFor("tenant_isolation", "todos", "true")],
      }),
      makeTable("notes", {
        columns: [column("id"), column("body")],
        policies: [policyFor("notes_scope", "notes", TENANT_PREDICATE)],
      }),
    );
    // The scoped-policy regression fails the plan closed; the summary still reports it all.
    const preview = previewOf(baseSnapshot(), after);
    expect(preview.schema.summary).toEqual({
      addedTables: 1,
      droppedTables: 0,
      addedColumns: 2,
      droppedColumns: 1,
      alteredColumns: 1,
      addedPolicies: 1,
      droppedPolicies: 1,
      alteredPolicies: 1,
    });
  });

  it("fails closed on an unsupported declaration: problems, no batches, no SQL", () => {
    const after = withTable(
      baseSnapshot(),
      makeTable("weird", {
        columns: [column("id")],
        unsupported: [{ construct: "index", name: "weird_partial_idx" }],
      }),
    );
    const preview = previewOf(baseSnapshot(), after);
    expect(preview.schema.plan).toEqual(planSchema(baseSnapshot(), after));
    expect(preview.schema.plan.problems).toEqual([
      { code: "unsupported_declaration", table: "weird", construct: "index:weird_partial_idx" },
    ]);
    expect(preview.schema.plan.batches).toEqual([]);
    expect(preview.schema.plan.destructive).toEqual([]);
  });

  it("fails closed on an identity column the v1 generator cannot render", () => {
    const after = withTable(
      baseSnapshot(),
      makeTable("counters", { columns: [column("id", { identity: "always" })] }),
    );
    const preview = previewOf(baseSnapshot(), after);
    expect(preview.schema.plan.problems).toEqual([
      { code: "unsupported_declaration", table: "counters", column: "id", construct: "identity:id" },
    ]);
    expect(preview.schema.plan.batches).toEqual([]);
  });

  it("keeps a drop in use by routes in the breaking lens, never in the plan risk", () => {
    const before = baseSnapshot();
    const after = withTable(baseSnapshot(), {
      ...todosTable(),
      columns: todosTable().columns.filter((entry) => entry.name !== "title"),
    });
    const preview = previewOf(before, after, [route({ dbColumns: ["todos.title"] })]);
    expect(preview.breaking).toEqual([
      expect.objectContaining({
        kind: "dropped_column_in_use",
        table: "todos",
        column: "title",
        routes: [{ method: "GET", path: "/api/todos" }],
      }),
    ]);
    // The plan stays the artifact plan: risk is destructive, no batch is lifted to breaking.
    expect(preview.schema.plan).toEqual(planSchema(before, after));
    expect(preview.schema.plan.risk).toBe("destructive");
    expect(preview.schema.plan.batches.some((batch) => batch.risk === "breaking")).toBe(false);
  });

  it("reports the security diff from the declared policies and RLS flags", () => {
    const before = baseSnapshot();
    const after = withTable(baseSnapshot(), {
      ...todosTable(),
      rlsEnabled: false,
      policies: [...todosTable().policies, policyFor("extra_read", "todos", TENANT_PREDICATE)],
    });
    const preview = previewOf(before, after);
    expect(preview.security.policiesAdded.map((policy) => policy.name)).toEqual(["extra_read"]);
    expect(preview.security.policiesAdded[0]?.sql).toContain("CREATE POLICY");
    expect(preview.security.rlsDisabled).toEqual([{ table: "todos" }]);
    // Disabling RLS on a scoped table is unsafe: the plan fails closed alongside the lens.
    expect(preview.schema.plan.problems).toEqual([
      { code: "policy_unsafe", table: "todos", construct: "rls" },
    ]);
  });

  it("warns per destructive batch, per dropped policy and per broadened clause", () => {
    // The policy changes sit on a non-scoped table: on a scoped table the planner would
    // fail the release closed (policy_unsafe) and there would be no batches to warn about.
    const logs = makeTable("logs", {
      columns: [column("id")],
      policies: [
        policyFor("logs_read", "logs", TENANT_PREDICATE),
        policyFor("logs_write", "logs", TENANT_PREDICATE),
      ],
    });
    const before: SchemaSnapshot = {
      tables: [usersTable(), todosTable(), logs, makeTable("archive", { columns: [column("id")] })],
      enums: [],
    };
    const after: SchemaSnapshot = {
      tables: [usersTable(), todosTable(), { ...logs, policies: [policyFor("logs_read", "logs", "true")] }],
      enums: [],
    };
    const preview = previewOf(before, after);
    expect(preview.schema.plan.problems).toEqual([]);
    const dropBatch = preview.schema.plan.batches.find((batch) => batch.sql.startsWith("DROP TABLE"));
    expect(dropBatch).toBeDefined();
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "destructive_without_backfill", related: dropBatch?.id }),
        expect.objectContaining({ kind: "policy_broadened", related: "logs.logs_write" }),
        expect.objectContaining({ kind: "policy_broadened", related: "logs.logs_read" }),
      ]),
    );
  });

  it("diffs routes by method and path, flagging changed known fields", () => {
    const before = snapshot(EMPTY, [
      route({ permission: "todos:read", dbTables: ["todos"] }),
      route({ method: "POST", path: "/api/todos", dbTables: ["todos"] }),
      route({ method: "DELETE", path: "/api/todos/:id", dbTables: ["todos"] }),
    ]);
    const after = snapshot(EMPTY, [
      route({ permission: ["todos:read", "todos:write"], dbTables: ["todos"] }),
      route({ method: "PATCH", path: "/api/todos/:id", dbTables: ["todos"] }),
      route({ method: "GET", path: "/api/notes" }),
    ]);
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.api?.added.map((entry) => entry.method + " " + entry.path)).toEqual([
      "GET /api/notes",
      "PATCH /api/todos/:id",
    ]);
    expect(preview.api?.removed.map((entry) => entry.method + " " + entry.path)).toEqual([
      "DELETE /api/todos/:id",
      "POST /api/todos",
    ]);
    expect(preview.api?.changed).toEqual([expect.objectContaining({ fields: ["permission"] })]);
  });

  it("carries rawSql into route refs and flags a change only when both refs know it", () => {
    const before = snapshot(EMPTY, [route({ rawSql: false })]);
    const after = snapshot(EMPTY, [route({ rawSql: true })]);
    const current = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(current.api?.changed).toEqual([
      expect.objectContaining({
        fields: ["rawSql"],
        before: expect.objectContaining({ rawSql: false }),
        after: expect.objectContaining({ rawSql: true }),
      }),
    ]);
    // A route parsed from a filename has no rawSql: unknown never reads as "changed".
    const unknown = snapshot(EMPTY, [route()]);
    const legacy = buildReleasePreview({ from: FROM, to: TO, before: unknown, after });
    expect(legacy.api?.changed).toEqual([]);
  });

  it("is empty and deterministic for identical snapshots", () => {
    const value = snapshot(baseSnapshot(), [route()]);
    const preview = buildReleasePreview({
      from: FROM,
      to: TO,
      before: value,
      after: value,
      generatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(preview).toEqual<ReleasePreview>({
      from: FROM,
      to: TO,
      generatedAt: "2026-11-02T00:00:00.000Z",
      schema: {
        plan: { batches: [], risk: "safe", destructive: [], problems: [] },
        summary: {
          addedTables: 0,
          droppedTables: 0,
          addedColumns: 0,
          droppedColumns: 0,
          alteredColumns: 0,
          addedPolicies: 0,
          droppedPolicies: 0,
          alteredPolicies: 0,
        },
      },
      api: { added: [], removed: [], changed: [] },
      security: { policiesAdded: [], policiesDropped: [], policiesChanged: [], rlsDisabled: [] },
      breaking: [],
      warnings: [],
    });
  });
});
