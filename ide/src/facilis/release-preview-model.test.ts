import { describe, expect, it } from "vitest";
import type {
  BreakingChange,
  GitRef,
  ReleasePreview,
  RiskClass,
  SchemaPlan,
  SchemaPlanBatch,
} from "./release-engine";
import {
  buildReleaseView,
  changedRouteLabel,
  EMPTY_REF_INVENTORY,
  lensPreset,
  lensPresets,
  newestTag,
  routeLabel,
  type ReleaseRefInventory,
} from "./release-preview-model";

const OID = "a".repeat(40);

function ref(name: string, kind: GitRef["kind"] = "branch"): GitRef {
  return { kind, ref: name, oid: OID };
}

function batch(id: string, risk: RiskClass): SchemaPlanBatch {
  return { id, sql: 'ALTER TABLE "x" ADD COLUMN "y" text', risk };
}

function plan(overrides: Partial<SchemaPlan> = {}): SchemaPlan {
  return {
    batches: [batch("001-a", "safe"), batch("002-b", "careful"), batch("003-c", "destructive")],
    risk: "destructive",
    destructive: ["003-c"],
    problems: [],
    ...overrides,
  };
}

const BREAKING: BreakingChange = {
  kind: "dropped_column_in_use",
  table: "x",
  column: "y",
  routes: [{ method: "GET", path: "/api/x" }],
  message: "GET /api/x reads x.y",
};

const ZERO_SUMMARY = {
  addedTables: 0,
  droppedTables: 0,
  addedColumns: 0,
  droppedColumns: 0,
  alteredColumns: 0,
  addedPolicies: 0,
  droppedPolicies: 0,
  alteredPolicies: 0,
};

function preview(overrides: Partial<ReleasePreview> = {}): ReleasePreview {
  return {
    from: ref("HEAD", "commit"),
    to: ref("WORKTREE", "commit"),
    generatedAt: "2026-11-02T00:00:00.000Z",
    schema: {
      plan: plan(),
      summary: { ...ZERO_SUMMARY, addedTables: 1, addedColumns: 2 },
    },
    api: { added: [{ method: "GET", path: "/api/x" }], removed: [], changed: [] },
    security: { policiesAdded: [], policiesDropped: [], policiesChanged: [], rlsDisabled: [] },
    breaking: [BREAKING],
    warnings: [],
    ...overrides,
  };
}

function refs(patch: Partial<ReleaseRefInventory> = {}): ReleaseRefInventory {
  return { ...EMPTY_REF_INVENTORY, head: ref("HEAD", "commit"), ...patch };
}

describe("buildReleaseView", () => {
  it("counts batch risks, lifts the overall risk with the breaking lens", () => {
    const view = buildReleaseView(preview());
    // 3 batches + 1 breaking change: the breaking chip counts the lens, not a batch.
    expect(view.counts).toEqual({ safe: 1, careful: 1, destructive: 1, breaking: 1, total: 4 });
    expect(view.plan.batches).toHaveLength(3);
    expect(view.risk).toBe("breaking");
    expect(view.api.added).toHaveLength(1);
    expect(view.empty).toBe(false);
    expect(view.summary.addedTables).toBe(1);
  });

  it("keeps the plan verbatim and shows the plan risk when nothing is breaking", () => {
    const source = preview({ breaking: [] });
    const view = buildReleaseView(source);
    expect(view.plan).toEqual(source.schema.plan);
    expect(view.risk).toBe("destructive");
    expect(view.counts.breaking).toBe(0);
    expect(view.plan.destructive).toEqual(["003-c"]);
  });

  it("fails closed: problems render, no batch is presented as shippable", () => {
    const failed = plan({
      batches: [],
      risk: "safe",
      destructive: [],
      problems: [{ code: "unsupported_declaration", table: "x", construct: "index:x_partial" }],
    });
    const view = buildReleaseView(
      preview({ schema: { plan: failed, summary: ZERO_SUMMARY }, api: null, breaking: [] }),
    );
    expect(view.plan.problems).toHaveLength(1);
    expect(view.plan.batches).toEqual([]);
    expect(view.counts.total).toBe(0);
    // A fail-closed plan is never "nothing changed".
    expect(view.empty).toBe(false);
  });

  it("treats a missing API diff as an empty one", () => {
    const view = buildReleaseView(preview({ api: null }));
    expect(view.api).toEqual({ added: [], removed: [], changed: [] });
  });

  it("is empty only when nothing at all changed", () => {
    const empty = preview({
      schema: {
        plan: { batches: [], risk: "safe", destructive: [], problems: [] },
        summary: ZERO_SUMMARY,
      },
      api: null,
      breaking: [],
    });
    expect(buildReleaseView(empty).empty).toBe(true);
    const declaredOnly = preview({
      schema: { plan: empty.schema.plan, summary: { ...ZERO_SUMMARY, addedTables: 1 } },
      api: null,
      breaking: [],
    });
    expect(buildReleaseView(declaredOnly).empty).toBe(false);
  });

  it("labels routes with method and path", () => {
    expect(routeLabel({ method: "get", path: "/api/x" })).toBe("GET /api/x");
    expect(
      changedRouteLabel({
        before: { method: "GET", path: "/api/x" },
        after: { method: "GET", path: "/api/y" },
        fields: ["sourceFile"],
      }),
    ).toEqual({ before: "GET /api/x", after: "GET /api/y" });
  });
});

describe("lens presets", () => {
  it("offers the working-copy lens only when HEAD exists", () => {
    expect(lensPreset("working", refs())).toEqual({
      id: "working",
      from: "HEAD",
      to: "WORKTREE",
      reason: null,
    });
    expect(lensPreset("working", EMPTY_REF_INVENTORY)).toMatchObject({
      from: null,
      reason: "no-head",
    });
  });

  it("compares the current branch with origin, else falls back to origin/main", () => {
    expect(
      lensPreset("remote", refs({ currentBranch: "feature/x", branches: ["main", "origin/main", "origin/feature/x"] })),
    ).toMatchObject({ from: "origin/feature/x", to: "HEAD" });
    expect(
      lensPreset("remote", refs({ currentBranch: "feature/x", branches: ["main", "origin/main"] })),
    ).toMatchObject({ from: "origin/main", to: "HEAD" });
    expect(
      lensPreset("remote", refs({ currentBranch: "main", branches: ["main"] })),
    ).toMatchObject({ from: null, reason: "remote-missing" });
  });

  it("uses the newest tag, or the configured release.ref, against origin/main", () => {
    const inventory = refs({ branches: ["origin/main"], tags: ["v0.9.0", "v0.10.0", "v0.2.0"] });
    expect(newestTag(inventory.tags)).toBe("v0.10.0");
    expect(lensPreset("tag", inventory)).toMatchObject({ from: "v0.10.0", to: "origin/main" });
    expect(lensPreset("tag", inventory, { releaseRef: "v0.9.0" })).toMatchObject({
      from: "v0.9.0",
      to: "origin/main",
    });
    expect(lensPreset("tag", refs({ branches: ["main"], tags: ["v1.0.0"] }))).toMatchObject({
      from: "v1.0.0",
      to: "HEAD",
    });
    expect(lensPreset("tag", refs({ tags: [] }))).toMatchObject({ from: null, reason: "tag-missing" });
  });

  it("lists the three lenses in display order", () => {
    expect(lensPresets(refs()).map((preset) => preset.id)).toEqual(["working", "remote", "tag"]);
  });
});
