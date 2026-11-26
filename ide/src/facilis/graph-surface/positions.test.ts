// Stability regressions for the map-and-lens surface (D-219, issue #185, killing #145):
// layout is a pure function of the dataset (never the camera or the search query), saved positions
// pin nodes across sibling add/remove/hide and edge filters, a dropped node sticks after rebuild,
// and the saved viewport is restored instead of silently re-fitting (D-127).
import { describe, expect, it } from "vitest";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "../graph-model.ts";
import { GET, PAGE, TODOS, graphOf, pageNode } from "../graph-model.test-fixtures.ts";
import { matchGraphNodes } from "../graph-search.ts";
import { emptyGraphLayout, roundCoordinate } from "../graph-layout-file.ts";
import { withNodePosition } from "../graph-layout.ts";
import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "../graph-types.ts";
import {
  cameraFromViewport,
  fitCamera,
  restoreCamera,
  viewportFromCamera,
  zoomCamera,
  type SurfaceCamera,
} from "./camera.ts";
import { detailLayout } from "./detail.ts";
import {
  detailWithSavedPositions,
  setNodeRect,
  snapDropToColumn,
  surfaceLayoutKey,
} from "./positions.ts";
import { buildDetailScene, type DetailScene } from "./scene.ts";

function node(kind: GraphNodeKind, id: string, label = id): ProjectGraphNode {
  const base = {
    id,
    kind,
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
  };
  switch (kind) {
    case "page":
      return {
        ...base,
        data: { kind, pagePath: "/" + id, pageKind: "page", callCount: 0, routePaths: [], preview: null },
      };
    case "route":
      return {
        ...base,
        data: {
          kind,
          method: "GET",
          path: "/" + id,
          permission: [],
          wrapper: "valid",
          description: null,
          input: { body: false, form: false, query: false, params: false },
          pathParams: [],
          dbTables: [],
          elevations: [],
          unknown: false,
        },
      };
    case "table":
      return {
        ...base,
        data: { kind, table: id, columns: [], rlsEnabled: true, framework: false, scope: null, policies: [], unknown: false },
      };
    case "view":
      return {
        ...base,
        data: { kind, view: id, tables: [], permission: null, access: "invoker", unknown: false, usedByRoutes: [] },
      };
    case "workflow":
      return { ...base, data: { kind, name: id, steps: [], unknown: false } };
  }
}

function edge(id: string, kind: ProjectGraphEdge["kind"], source: string, target: string): ProjectGraphEdge {
  return { id, kind, source, target, label: null };
}

/** A single-domain detail scene: every node lives in "core", so lanes are pages | routes | data. */
function sceneOf(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
  saved: Readonly<Record<string, { x: number; y: number }>> = {},
): DetailScene {
  const domainOf = new Map(nodes.map((entry) => [entry.id, "core"] as const));
  return buildDetailScene("core", nodes, domainOf, edges, saved);
}

const DATASET = [node("page", "p1"), node("page", "p2"), node("route", "r1"), node("table", "t1")];
const EDGES = [edge("e1", "page-route", "p1", "r1"), edge("e2", "route-table", "r1", "t1")];

function rects(scene: DetailScene): [string, { x: number; y: number }][] {
  return [...scene.layout.positions.entries()]
    .map(([id, rect]) => [id, { x: rect.x, y: rect.y }] as [string, { x: number; y: number }])
    .toSorted((a, b) => (a[0] < b[0] ? -1 : 1));
}

describe("surfaceLayoutKey (search never re-runs layout)", () => {
  it("is unchanged by a search match pass: dimming never moves or rebuilds nodes", () => {
    const graph = graphOf([PAGE, GET, TODOS]);
    const view = buildProjectGraphView({ graph });
    const before = surfaceLayoutKey(view);
    const nodesBefore = view.nodes;
    const matched = matchGraphNodes(view.nodes, "pages");
    expect(matched.size).toBeGreaterThan(0);
    expect(matched.size).toBeLessThan(view.nodes.length);
    // The match pass reads the cached model: same node objects, same fingerprint, same positions.
    expect(view.nodes).toBe(nodesBefore);
    expect(surfaceLayoutKey(view)).toBe(before);
    const pos = (entry: ProjectGraphView) => entry.nodes.map((node) => [node.id, node.position]);
    expect(pos(view)).toEqual(pos(buildProjectGraphView({ graph })));
  });

  it("changes when a saved position or the dataset changes", () => {
    const graph = graphOf([PAGE, GET, TODOS]);
    const base = buildProjectGraphView({ graph });
    const moved = buildProjectGraphView({ graph, positions: { "table:todos": { x: 900, y: 40 } } });
    const grown = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, pageNode("src/pages/extra.tsx")]) });
    expect(surfaceLayoutKey(moved)).not.toBe(surfaceLayoutKey(base));
    expect(surfaceLayoutKey(grown)).not.toBe(surfaceLayoutKey(base));
  });
});

describe("saved-position overrides", () => {
  it("pins a node over the automatic swimlane placement", () => {
    const scene = sceneOf(DATASET, EDGES, { p1: { x: 500, y: 40 } });
    expect(scene.layout.positions.get("p1")).toMatchObject({ x: 500, y: 40 });
    // The others keep their automatic placement.
    const auto = sceneOf(DATASET, EDGES);
    expect(scene.layout.positions.get("r1")).toEqual(auto.layout.positions.get("r1"));
  });

  it("preserves the layout instance when nothing is overridden (no needless rebuild)", () => {
    const auto = detailLayout({ domain: "core", nodes: DATASET, domainOf: new Map(DATASET.map((n) => [n.id, "core"])), edges: EDGES });
    expect(detailWithSavedPositions(auto, {}).layout).toBe(auto);
    // p1 is a fixture member, so its automatic rect always exists.
    const p1 = auto.positions.get("p1")!;
    expect(detailWithSavedPositions(auto, { p1: { x: p1.x, y: p1.y } }).layout).toBe(auto);
  });

  it("ignores non-finite saved positions and keeps columns from the automatic placement", () => {
    const scene = sceneOf(DATASET, EDGES, { p1: { x: Number.NaN, y: 0 }, p2: { x: 2000, y: 0 } });
    const auto = sceneOf(DATASET, EDGES);
    expect(scene.layout.positions.get("p1")).toEqual(auto.layout.positions.get("p1"));
    expect(scene.columns).toEqual(auto.columns);
    expect(scene.columns).not.toContain(2000);
  });
});

describe("snapDropToColumn (lanes stay separate)", () => {
  it("snaps x to the nearest column and keeps the dropped y, rounded", () => {
    const scene = sceneOf(DATASET, EDGES);
    const columns = scene.columns;
    const target = columns[1] ?? 0;
    const snapped = snapDropToColumn(columns, target + 10, 123.456);
    expect(snapped.x).toBe(target);
    expect(snapped.y).toBe(roundCoordinate(123.456));
  });

  it("a drop between two lanes picks the nearer one", () => {
    const columns = [0, 366, 732];
    expect(snapDropToColumn(columns, 100, 0).x).toBe(0);
    expect(snapDropToColumn(columns, 300, 0).x).toBe(366);
    expect(snapDropToColumn(columns, 600, 0).x).toBe(732);
  });

  it("with no columns keeps the drop as-is", () => {
    expect(snapDropToColumn([], 12.345, -6.789)).toEqual({ x: 12.35, y: -6.79 });
  });
});

describe("stability regressions (#145 / #185)", () => {
  it("pan and zoom are pure camera transforms: node positions are untouched", () => {
    const scene = sceneOf(DATASET, EDGES);
    const before = rects(scene);
    let camera: SurfaceCamera = { tx: 0, ty: 0, scale: 1 };
    camera = zoomCamera(camera, 100, 100, 1.5);
    camera = { ...camera, tx: camera.tx + 240, ty: camera.ty - 120 };
    camera = zoomCamera(camera, 50, 50, 0.5);
    expect(camera.scale).not.toBe(1);
    expect(rects(scene)).toEqual(before);
    // A fresh build of the same dataset is identical: the cache and a recompute agree.
    expect(rects(sceneOf(DATASET, EDGES))).toEqual(before);
  });

  it("filtering edges never moves nodes (ports may change)", () => {
    const full = sceneOf(DATASET, EDGES);
    // EDGES is a non-empty fixture; keep its first edge only.
    const filtered = sceneOf(DATASET, [EDGES[0]!]);
    expect(rects(filtered)).toEqual(rects(full));
  });

  it("adding a sibling does not shift unrelated saved positions", () => {
    const saved = { p1: { x: 500, y: 40 }, r1: { x: 900, y: -20 } };
    const before = sceneOf(DATASET, EDGES, saved);
    const after = sceneOf([...DATASET, node("page", "p3")], EDGES, saved);
    expect(after.layout.positions.get("p1")).toEqual(before.layout.positions.get("p1"));
    expect(after.layout.positions.get("r1")).toEqual(before.layout.positions.get("r1"));
  });

  it("removing or hiding a sibling does not shift unrelated saved positions", () => {
    const saved = { p1: { x: 500, y: 40 }, r1: { x: 900, y: -20 } };
    const grown = [...DATASET, node("page", "p3")];
    const before = sceneOf(grown, EDGES, saved);
    const removed = sceneOf(DATASET, EDGES, saved);
    expect(removed.layout.positions.get("p1")).toEqual(before.layout.positions.get("p1"));
    expect(removed.layout.positions.get("r1")).toEqual(before.layout.positions.get("r1"));
  });

  it("a dropped position sticks after the scene rebuilds (no snap-back to auto)", () => {
    const auto = sceneOf(DATASET, EDGES);
    // p1 is a fixture member, so its automatic rect always exists.
    const autoRect = auto.layout.positions.get("p1")!;
    // Simulate the release: snap the drop to a column, commit it through the saved layout.
    const snapped = snapDropToColumn(auto.columns, autoRect.x + 400, 77.7);
    const layout = withNodePosition(emptyGraphLayout(), "p1", snapped);
    const rebuilt = sceneOf(DATASET, EDGES, layout.nodes);
    expect(rebuilt.layout.positions.get("p1")).toMatchObject(snapped);
    expect(rebuilt.layout.positions.get("p1")).not.toEqual(autoRect);
    // Every other node is exactly where the automatic layout put it.
    for (const id of ["p2", "r1", "t1"]) {
      expect(rebuilt.layout.positions.get(id)).toEqual(auto.layout.positions.get(id));
    }
  });

  it("setNodeRect moves only the dragged node's working rect (live edge follow)", () => {
    const scene = sceneOf(DATASET, EDGES);
    const before = rects(scene);
    setNodeRect(scene.layout.positions, "p1", 1234, 5678);
    expect(scene.layout.positions.get("p1")).toMatchObject({ x: 1234, y: 5678 });
    const others = before.filter(([id]) => id !== "p1");
    const after = rects(scene).filter(([id]) => id !== "p1");
    expect(after).toEqual(others);
  });
});

describe("viewport restore (D-127)", () => {
  const bounds = { x: 0, y: 0, w: 800, h: 600 };

  it("round-trips the camera through the persisted viewport names", () => {
    const camera: SurfaceCamera = { tx: 12, ty: -34, scale: 1.4 };
    expect(cameraFromViewport(viewportFromCamera(camera))).toEqual(camera);
  });

  it("restores a saved viewport instead of re-fitting", () => {
    const saved = { x: 200, y: -80, zoom: 1.75 };
    const camera = restoreCamera({ saved, bounds, width: 1000, height: 800 });
    expect(camera).toEqual({ tx: 200, ty: -80, scale: 1.75 });
    expect(camera).not.toEqual(fitCamera(bounds, 1000, 800, { maxScale: 1.1 }));
  });

  it("prefers the session camera over the saved viewport", () => {
    const session: SurfaceCamera = { tx: 5, ty: 6, scale: 0.9 };
    const camera = restoreCamera({ session, saved: { x: 1, y: 2, zoom: 2 }, bounds, width: 1000, height: 800 });
    expect(camera).toEqual(session);
  });

  it("fits only a first-ever open, and ignores an invalid saved zoom", () => {
    const fit = fitCamera(bounds, 1000, 800, { maxScale: 1.1 });
    expect(restoreCamera({ bounds, width: 1000, height: 800 })).toEqual(fit);
    expect(restoreCamera({ saved: { x: 0, y: 0, zoom: 0 }, bounds, width: 1000, height: 800 })).toEqual(fit);
    expect(restoreCamera({ saved: { x: 0, y: 0, zoom: Number.NaN }, bounds, width: 1000, height: 800 })).toEqual(fit);
  });
});
