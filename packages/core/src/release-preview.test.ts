import { describe, expect, it } from "vitest";

import type { GitRef, ReleasePreview } from "./release.ts";
import {
  buildReleasePreview,
  type ReleaseRouteFact,
  type ReleaseSnapshot,
  type ReleaseTableFact,
} from "./release-preview.ts";

const FROM: GitRef = { kind: "commit", ref: "HEAD~1", oid: "1111111111111111" };
const TO: GitRef = { kind: "commit", ref: "HEAD", oid: "2222222222222222" };

function table(
  name: string,
  columns: string[],
  policies: string[] = [],
  scoped = false,
  rlsEnabled = scoped,
): ReleaseTableFact {
  return {
    name,
    columns,
    policies: policies.map((policy) => ({ name: policy })),
    rlsEnabled,
    scoped,
  };
}

function snapshot(
  tables: ReleaseTableFact[],
  routes: ReleaseRouteFact[] = [],
  migrations: { path: string; sql: string }[] = [],
): ReleaseSnapshot {
  return { schema: { tables }, routes, migrations };
}

function migration(path: string, sql: string): { path: string; sql: string } {
  return { path, sql };
}

function route(overrides: Partial<ReleaseRouteFact> = {}): ReleaseRouteFact {
  return {
    method: "GET",
    path: "/api/todos",
    sourceFile: "server/routes/api/todos/index.get.ts",
    ...overrides,
  };
}

describe("buildReleasePreview", () => {
  it("summarises added and dropped schema objects", () => {
    const before = snapshot([table("todos", ["id", "title"], ["tenant_isolation"], true)]);
    const after = snapshot([
      table("todos", ["id", "done"], ["tenant_isolation"], true),
      table("notes", ["id", "body"], ["tenant_isolation"], true),
    ]);
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.schema.summary).toEqual({
      addedTables: 1,
      droppedTables: 0,
      addedColumns: 3,
      droppedColumns: 1,
      alteredColumns: 0,
      addedPolicies: 1,
      droppedPolicies: 0,
      alteredPolicies: 0,
    });
  });

  it("keeps only the migrations that ship, classified statement by statement", () => {
    const before = snapshot(
      [table("todos", ["id"])],
      [],
      [migration("db/migrations/0001_init.sql", "CREATE TABLE todos (id uuid);")],
    );
    const after = snapshot(
      [table("todos", ["id", "done"])],
      [],
      [
        migration("db/migrations/0001_init.sql", "CREATE TABLE todos (id uuid);"),
        migration(
          "db/migrations/0002_done.sql",
          "ALTER TABLE todos ADD COLUMN done boolean NOT NULL; DROP TABLE notes;",
        ),
      ],
    );
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.schema.statements).toHaveLength(2);
    expect(preview.schema.statements[0]).toMatchObject({
      kind: "add_column",
      risk: "careful",
      affectedTable: "todos",
    });
    expect(preview.schema.statements[1]).toMatchObject({ kind: "drop_table", risk: "destructive" });
  });

  it("lifts a drop to breaking when a route still reads the entity", () => {
    const before = snapshot([table("todos", ["id", "title"])]);
    const after = snapshot(
      [table("todos", ["id"])],
      [route({ dbColumns: ["todos.title"] })],
      [migration("db/migrations/0002_drop_title.sql", "ALTER TABLE todos DROP COLUMN title;")],
    );
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.breaking).toEqual([
      expect.objectContaining({
        kind: "dropped_column_in_use",
        table: "todos",
        column: "title",
        routes: [{ method: "GET", path: "/api/todos" }],
      }),
    ]);
    expect(preview.schema.statements[0]?.risk).toBe("breaking");
  });

  it("reports the security diff and flags RLS been disabled", () => {
    const before = snapshot([table("todos", ["id"], ["tenant_isolation"], true)]);
    const after = snapshot([
      table("todos", ["id"], ["tenant_isolation", "owner_isolation"], true, false),
      table("notes", ["id"], ["notes_scope"], true),
    ]);
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.security.policiesAdded.map((policy) => policy.name)).toEqual([
      "owner_isolation",
      "notes_scope",
    ]);
    expect(preview.security.rlsDisabled).toEqual([{ table: "todos" }]);
  });

  it("diffs routes by method and path, flagging changed known fields", () => {
    const before = snapshot(
      [],
      [
        route({ permission: "todos:read", dbTables: ["todos"] }),
        route({ method: "POST", path: "/api/todos", dbTables: ["todos"] }),
        route({ method: "DELETE", path: "/api/todos/:id", dbTables: ["todos"] }),
      ],
    );
    const after = snapshot(
      [],
      [
        route({ permission: ["todos:read", "todos:write"], dbTables: ["todos"] }),
        route({ method: "PATCH", path: "/api/todos/:id", dbTables: ["todos"] }),
        route({ method: "GET", path: "/api/notes" }),
      ],
    );
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
    const before = snapshot([], [route({ rawSql: false })]);
    const after = snapshot([], [route({ rawSql: true })]);
    const current = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(current.api?.changed).toEqual([
      expect.objectContaining({
        fields: ["rawSql"],
        before: expect.objectContaining({ rawSql: false }),
        after: expect.objectContaining({ rawSql: true }),
      }),
    ]);

    // A route parsed from a filename has no rawSql: unknown never reads as "changed".
    const unknown = snapshot([], [route()]);
    const legacy = buildReleasePreview({ from: FROM, to: TO, before: unknown, after });
    expect(legacy.api?.changed).toEqual([]);
  });

  it("collects pending-migration and destructive warnings", () => {
    const after = snapshot(
      [table("todos", ["id"])],
      [],
      [
        migration(
          "db/migrations/0002_cleanup.sql",
          "DROP TABLE old_todos; DROP POLICY old_policy ON todos;",
        ),
      ],
    );
    const preview = buildReleasePreview({
      from: FROM,
      to: TO,
      before: snapshot([table("todos", ["id"])]),
      after,
      pendingMigrations: ["db/migrations/0002_cleanup.sql"],
    });
    expect(preview.warnings.map((warning) => warning.kind).toSorted()).toEqual([
      "destructive_without_backfill",
      "pending_migrations_on_target",
      "policy_broadened",
    ]);
  });

  it("reports a broadened policy when the scoping clause disappears", () => {
    const before = snapshot([
      {
        ...table("todos", ["id"]),
        policies: [
          {
            name: "tenant_isolation",
            sql: "USING (tenant_id = current_setting('app.tenant_id')::uuid)",
          },
        ],
      },
    ]);
    const after = snapshot([
      {
        ...table("todos", ["id"]),
        policies: [{ name: "tenant_isolation", sql: "USING (true)" }],
      },
    ]);
    const preview = buildReleasePreview({ from: FROM, to: TO, before, after });
    expect(preview.security.policiesChanged[0]?.direction).toBe("broadened");
    expect(preview.warnings.some((warning) => warning.kind === "policy_broadened")).toBe(true);
  });

  it("is empty and deterministic for identical snapshots", () => {
    const files = [migration("db/migrations/0001_init.sql", "CREATE TABLE todos (id uuid);")];
    const snapshotValue = snapshot([table("todos", ["id"])], [route()], files);
    const preview = buildReleasePreview({
      from: FROM,
      to: TO,
      before: snapshotValue,
      after: snapshotValue,
      generatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(preview).toEqual<ReleasePreview>({
      from: FROM,
      to: TO,
      generatedAt: "2026-11-02T00:00:00.000Z",
      schema: {
        statements: [],
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
