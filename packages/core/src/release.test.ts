import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BreakingChange,
  GitRef,
  MigrationStatement,
  ReleasePreview,
  RiskClass,
  SecurityDiff,
} from "./release.ts";

describe("release types", () => {
  it("declares the SPEC §7.7 shape", () => {
    const ref: GitRef = { kind: "commit", ref: "HEAD", oid: "0123456789abcdef" };
    const statement: MigrationStatement = {
      sql: "ALTER TABLE todos ADD COLUMN done boolean NOT NULL DEFAULT false",
      kind: "add_column",
      risk: "careful",
      affectedTable: "todos",
      affectedColumns: ["done"],
      reason: "non-null column without a default needs a backfill plan",
    };
    const breaking: BreakingChange = {
      kind: "dropped_column_in_use",
      table: "todos",
      column: "title",
      routes: [{ method: "GET", path: "/api/todos" }],
      message: "GET /api/todos selects todos.title",
    };
    const security: SecurityDiff = {
      policiesAdded: [],
      policiesDropped: [],
      policiesChanged: [],
      rlsDisabled: [],
    };
    const preview: ReleasePreview = {
      from: ref,
      to: { ...ref, oid: "fedcba9876543210" },
      generatedAt: new Date(0).toISOString(),
      schema: {
        statements: [statement],
        summary: {
          addedTables: 0,
          droppedTables: 0,
          addedColumns: 1,
          droppedColumns: 0,
          alteredColumns: 0,
          addedPolicies: 0,
          droppedPolicies: 0,
          alteredPolicies: 0,
        },
      },
      api: null,
      security,
      breaking: [breaking],
      warnings: [],
    };

    expect(preview.from.kind).toBe("commit");
    expect(preview.schema.statements[0]?.risk).toBe("careful");
    expectTypeOf<RiskClass>().toEqualTypeOf<"safe" | "careful" | "destructive" | "breaking">();
  });
});
