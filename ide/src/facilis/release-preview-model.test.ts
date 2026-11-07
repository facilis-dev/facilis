import { describe, expect, it } from "vitest";
import type { GitRef, MigrationStatement, ReleasePreview } from "./release-engine";
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

function statement(risk: MigrationStatement["risk"]): MigrationStatement {
  return {
    sql: "ALTER TABLE x ADD COLUMN y text",
    kind: "add_column",
    risk,
    affectedTable: "x",
    affectedColumns: ["y"],
    reason: "test fixture",
  };
}

function preview(overrides: Partial<ReleasePreview> = {}): ReleasePreview {
  return {
    from: ref("HEAD", "commit"),
    to: ref("WORKTREE", "commit"),
    generatedAt: "2026-11-02T00:00:00.000Z",
    schema: {
      statements: [statement("safe"), statement("careful"), statement("destructive"), statement("breaking")],
      summary: {
        addedTables: 1,
        droppedTables: 0,
        addedColumns: 2,
        droppedColumns: 0,
        alteredColumns: 0,
        addedPolicies: 0,
        droppedPolicies: 0,
        alteredPolicies: 0,
      },
    },
    api: { added: [{ method: "GET", path: "/api/x" }], removed: [], changed: [] },
    security: { policiesAdded: [], policiesDropped: [], policiesChanged: [], rlsDisabled: [] },
    breaking: [],
    warnings: [],
    ...overrides,
  };
}

function refs(patch: Partial<ReleaseRefInventory> = {}): ReleaseRefInventory {
  return { ...EMPTY_REF_INVENTORY, head: ref("HEAD", "commit"), ...patch };
}

describe("buildReleaseView", () => {
  it("counts the statements per risk class and keeps the engine's sections", () => {
    const view = buildReleaseView(preview());
    expect(view.counts).toEqual({ safe: 1, careful: 1, destructive: 1, breaking: 1, total: 4 });
    expect(view.statements).toHaveLength(4);
    expect(view.api.added).toHaveLength(1);
    expect(view.empty).toBe(false);
    expect(view.summary.addedTables).toBe(1);
  });

  it("treats a missing API diff as an empty one", () => {
    const view = buildReleaseView(preview({ api: null }));
    expect(view.api).toEqual({ added: [], removed: [], changed: [] });
  });

  it("is empty only when nothing at all changed", () => {
    const empty = preview({
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
      api: null,
    });
    expect(buildReleaseView(empty).empty).toBe(true);
    const declaredOnly = preview({
      schema: { statements: [], summary: { ...empty.schema.summary, addedTables: 1 } },
      api: null,
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
