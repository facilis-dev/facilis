import { describe, expect, it } from "vitest";
import {
  addGraphNote,
  emptyGraphLayout,
  mergeGraphLayout,
  parseGraphLayout,
  resetGraphLayoutPositions,
  withCollapsed,
  withEdgeCurve,
  withHiddenEdgeKind,
  withNodePosition,
  withNotePosition,
  withNoteText,
  withViewport,
  withoutGraphNote,
  type GraphLayoutFile,
} from "./graph-layout";
import { GRAPH_LAYOUT_VERSION } from "./graph-layout-file";

const NOTE = "note:11111111-1111-4111-8111-111111111111";

const note = (text = "hello") => ({ id: NOTE, x: 10, y: 20, text });

const layout = (overrides: Partial<GraphLayoutFile> = {}): GraphLayoutFile => ({
  ...emptyGraphLayout(),
  ...overrides,
});

describe("parseGraphLayout (v1/v2 migration)", () => {
  it("reads every field of a version-1 file and upgrades it to the current schema", () => {
    const parsed = parseGraphLayout(
      JSON.stringify({
        version: 1,
        nodes: { "table:todos": { x: 10, y: 20 } },
        hiddenEdges: ["relation", "fk"],
        collapsed: { "table:todos": true },
        viewport: { x: 1, y: 2, zoom: 0.8 },
      }),
    );
    expect(parsed.source).toBe("ok");
    expect(parsed.layout).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      nodes: { "table:todos": { x: 10, y: 20 } },
      hiddenEdges: ["fk", "relation"],
      collapsed: { "table:todos": true },
      edgeCurves: {},
      notes: {},
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it("reads the edge curves of a version-2 file", () => {
    const parsed = parseGraphLayout(
      JSON.stringify({ version: 2, nodes: {}, edgeCurves: { "fk:1": { x: 12, y: -4 } } }),
    );
    expect(parsed.source).toBe("ok");
    expect(parsed.layout.edgeCurves).toEqual({ "fk:1": { x: 12, y: -4 } });
  });

  it("treats a missing or blank file as no saved layout", () => {
    for (const text of ["", "   ", null, undefined]) {
      const parsed = parseGraphLayout(text);
      expect(parsed.source).toBe("missing");
      expect(parsed.layout).toEqual(emptyGraphLayout());
    }
  });

  it("reports corrupt JSON and an unknown version as invalid", () => {
    for (const text of [
      "{",
      "[]",
      JSON.stringify({ version: 3, nodes: {} }),
      JSON.stringify({ nodes: {} }),
    ]) {
      expect(parseGraphLayout(text).source).toBe("invalid");
    }
    expect(parseGraphLayout("{").layout).toEqual(emptyGraphLayout());
  });

  it("ignores malformed entries instead of throwing", () => {
    const parsed = parseGraphLayout(
      JSON.stringify({
        version: 1,
        nodes: { good: { x: 1, y: 2 }, bad: { x: "1", y: 2 }, missing: { x: 1 } },
        hiddenEdges: ["fk", "not-a-kind", 3],
        collapsed: { good: true, bad: "yes" },
        edgeCurves: { "edge:good": { x: 3, y: 4 }, "edge:bad": { x: "3", y: 4 } },
        viewport: { x: 0, y: 0, zoom: 0 },
      }),
    );
    expect(parsed.source).toBe("ok");
    expect(parsed.layout.nodes).toEqual({ good: { x: 1, y: 2 } });
    expect(parsed.layout.hiddenEdges).toEqual(["fk"]);
    expect(parsed.layout.collapsed).toEqual({ good: true });
    expect(parsed.layout.edgeCurves).toEqual({ "edge:good": { x: 3, y: 4 } });
    expect(parsed.layout.viewport).toBeUndefined();
  });
});

describe("mutations", () => {
  it("moves a node and preserves identity for a no-op", () => {
    const before = layout();
    const moved = withNodePosition(before, "table:todos", { x: 7, y: 8 });
    expect(moved.nodes).toEqual({ "table:todos": { x: 7, y: 8 } });
    expect(before.nodes).toEqual({});
    expect(withNodePosition(moved, "table:todos", { x: 7, y: 8 })).toBe(moved);
  });

  it("collapses a node and keeps a no-op identity", () => {
    const value = withCollapsed(layout(), "table:todos", true);
    expect(value.collapsed).toEqual({ "table:todos": true });
    expect(withCollapsed(value, "table:todos", true)).toBe(value);
  });

  it("hides and shows an edge kind in canonical order", () => {
    let value = withHiddenEdgeKind(layout(), "relation", true);
    value = withHiddenEdgeKind(value, "fk", true);
    expect(value.hiddenEdges).toEqual(["fk", "relation"]);
    expect(withHiddenEdgeKind(value, "fk", false).hiddenEdges).toEqual(["relation"]);
  });

  it("keeps the view edge kinds at the end of the canonical order", () => {
    let value = withHiddenEdgeKind(layout(), "view-base", true);
    value = withHiddenEdgeKind(value, "route-view", true);
    value = withHiddenEdgeKind(value, "fk", true);
    expect(value.hiddenEdges).toEqual(["fk", "route-view", "view-base"]);
    expect(withHiddenEdgeKind(value, "route-view", false).hiddenEdges).toEqual(["fk", "view-base"]);
  });

  it("stores the viewport but ignores an invalid zoom", () => {
    const value = withViewport(layout(), { x: 4, y: 5, zoom: 0.5 });
    expect(value.viewport).toEqual({ x: 4, y: 5, zoom: 0.5 });
    expect(withViewport(value, { x: 0, y: 0, zoom: 0 })).toBe(value);
  });

  it("adds, edits, moves and deletes notes immutably", () => {
    const before = layout();
    const added = addGraphNote(before, note());
    expect(before.notes).toEqual({});
    expect(added.notes[NOTE]).toEqual(note());
    const edited = withNoteText(added, NOTE, "hello!");
    expect(edited.notes[NOTE]?.text).toBe("hello!");
    expect(withNoteText(edited, NOTE, "hello!")).toBe(edited);
    const moved = withNotePosition(edited, NOTE, { x: 1, y: 2 });
    expect(moved.notes[NOTE]).toMatchObject({ x: 1, y: 2 });
    expect(withNotePosition(moved, NOTE, { x: 1, y: 2 })).toBe(moved);
    expect(withNotePosition(moved, "note:missing", { x: 1, y: 2 })).toBe(moved);
    const without = withoutGraphNote(moved, NOTE);
    expect(without.notes).toEqual({});
    expect(withoutGraphNote(without, NOTE)).toBe(without);
  });

  it("resets positions, curves and collapse but keeps filters and notes", () => {
    const value = layout({
      nodes: { "table:todos": { x: 1, y: 2 } },
      collapsed: { "table:todos": true },
      hiddenEdges: ["relation"],
      edgeCurves: { "fk:1": { x: 2, y: 3 } },
      notes: { [NOTE]: note() },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(resetGraphLayoutPositions(value)).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      nodes: {},
      hiddenEdges: ["relation"],
      collapsed: {},
      edgeCurves: {},
      notes: { [NOTE]: note() },
    });
  });

  it("keeps an edge curve exactly at the reset distance", () => {
    const value = withEdgeCurve(layout(), "fk:1", { x: 0.5, y: 0 });
    expect(value.edgeCurves["fk:1"]).toEqual({ x: 0.5, y: 0 });
  });
});

describe("mergeGraphLayout", () => {
  it("drops stale node ids, collapse flags and edge kinds but keeps notes", () => {
    const value = layout({
      nodes: { "table:known": { x: 1, y: 2 }, "table:stale": { x: 9, y: 9 } },
      collapsed: { "table:known": true, "table:stale": true },
      hiddenEdges: ["fk", "relation"],
      edgeCurves: { "fk:1": { x: 3, y: 4 } },
      notes: { [NOTE]: note() },
    });
    const merged = mergeGraphLayout(value, {
      nodeIds: new Set(["table:known"]),
      edgeKinds: ["fk"],
    });
    expect(merged.nodes).toEqual({ "table:known": { x: 1, y: 2 } });
    expect(merged.collapsed).toEqual({ "table:known": true });
    expect(merged.hiddenEdges).toEqual(["fk"]);
    expect(merged.edgeCurves).toEqual({ "fk:1": { x: 3, y: 4 } });
    expect(merged.notes).toEqual({ [NOTE]: note() });
  });

  it("drops stale curves only when the panel sees the current graph", () => {
    const value = layout({ edgeCurves: { "fk:gone": { x: 1, y: 1 } } });
    expect(mergeGraphLayout(value, { nodeIds: new Set() }).edgeCurves).toEqual({
      "fk:gone": { x: 1, y: 1 },
    });
  });
});
