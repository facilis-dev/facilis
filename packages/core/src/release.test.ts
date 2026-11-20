import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BreakingChange,
  GitRef,
  ReleasePreview,
  ReleaseWarning,
  RiskClass,
  SchemaDiff,
  SecurityDiff,
} from "./release.ts";
import type { SchemaPlan } from "./schema-plan/types.ts";

describe("release types", () => {
  it("declares the SPEC §7.7 shape", () => {
    const ref: GitRef = { kind: "commit", ref: "HEAD", oid: "0123456789abcdef" };
    const plan: SchemaPlan = {
      batches: [
        {
          id: "001-add-column-todos-done",
          sql: 'ALTER TABLE "todos" ADD COLUMN "done" boolean NOT NULL DEFAULT false',
          risk: "careful",
          requires: ["no_null_rows:todos.done"],
        },
      ],
      risk: "careful",
      destructive: [],
      problems: [],
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
    const warning: ReleaseWarning = {
      kind: "destructive_without_backfill",
      message: "Batch 002-drop-table-old ships a destructive change with no backfill step",
      related: "002-drop-table-old",
    };
    const schema: SchemaDiff = {
      plan,
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
    };
    const preview: ReleasePreview = {
      from: ref,
      to: { ...ref, oid: "fedcba9876543210" },
      generatedAt: new Date(0).toISOString(),
      schema,
      api: null,
      security,
      breaking: [breaking],
      warnings: [warning],
    };

    expect(preview.from.kind).toBe("commit");
    expect(preview.schema.plan.batches[0]?.risk).toBe("careful");
    expectTypeOf<RiskClass>().toEqualTypeOf<"safe" | "careful" | "destructive" | "breaking">();
    expectTypeOf<ReleaseWarning["kind"]>().toEqualTypeOf<
      "destructive_without_backfill" | "policy_broadened"
    >();
  });
});
