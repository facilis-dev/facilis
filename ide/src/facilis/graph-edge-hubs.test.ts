// Issue #64 acceptance: a 10-route fan-out concentrates into ONE hub with count 10; expanding
// restores the individual edges and their labels; collapsing restores the hub. The overlay is
// render-only: stats and node positions never change, and only route-table/route-view kinds
// concentrate.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import {
  HUB_SIZE,
  deriveEdgeHubOverlay,
  hubEdgeIdFor,
  hubIdFor,
  hubIsolation,
  isHubArtefactId,
  placeHub,
  toggleExpandedHub,
} from "./graph-edge-hubs";
import { nodeRect } from "./graph-edge-geometry";
import { GRAPH_CARD_SIZES } from "./graph-layout-engine";
import { buildProjectGraphView } from "./graph-model";
import { graphOf, routeNode, tableNode, viewNode } from "./graph-model.test-fixtures";
import type { ProjectGraphView } from "./graph-types";

const TASKS = tableNode("tasks");

/** Ten routes reading one table: the issue's hairball fixture. */
function fanOut(count: number, kind: "route-table" | "route-view" = "route-table"): ProjectGraphView {
  const routes = Array.from({ length: count }, (_, index) =>
    routeNode("GET", "/api/tasks/" + index, { dbTables: ["tasks"] }),
  );
  const target = kind === "route-table" ? TASKS : viewNode("task_list", { tables: ["tasks"] });
  const edges: GraphEdge[] = routes.map((route, index) => ({
    id: kind + ":" + index,
    kind,
    source: route.id,
    target: target.id,
    label: "dbTables",
  }));
  return buildProjectGraphView({ graph: graphOf([...routes, target], edges) });
}

const NO_EXPANDED = new Set<string>();

describe("deriveEdgeHubOverlay threshold", () => {
  it("concentrates 10 routes into one hub with count 10 (threshold 4)", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, 4, NO_EXPANDED);
    expect(overlay.hubs).toHaveLength(1);
    const hub = overlay.hubs[0];
    expect(hub?.id).toBe(hubIdFor("route-table", TASKS.id));
    expect(hub?.count).toBe(10);
    expect(hub?.sources).toHaveLength(10);
    expect(hub?.expanded).toBe(false);
    // 10 route->hub edges + ONE hub->target count edge replace the 10 real edges.
    expect(overlay.edges.filter((edge) => edge.type === "hub-source")).toHaveLength(10);
    const trunk = overlay.edges.filter((edge) => edge.type === "hub-target");
    expect(trunk).toHaveLength(1);
    expect(trunk[0]?.type === "hub-target" && trunk[0].count).toBe(10);
    expect(trunk[0]?.type === "hub-target" && trunk[0].id).toBe(
      hubEdgeIdFor("route-table", TASKS.id),
    );
    expect(overlay.concentratedEdgeIds.size).toBe(10);
    expect(overlay.edges.filter((edge) => edge.type === "real")).toHaveLength(0);
  });

  it("does not concentrate exactly the threshold (4 routes, threshold 4)", () => {
    const overlay = deriveEdgeHubOverlay(fanOut(4), 4, NO_EXPANDED);
    expect(overlay.hubs).toHaveLength(0);
    expect(overlay.edges.every((edge) => edge.type === "real")).toBe(true);
  });

  it("concentrates above 8 and not at 8 (threshold 8)", () => {
    expect(deriveEdgeHubOverlay(fanOut(10), 8, NO_EXPANDED).hubs).toHaveLength(1);
    expect(deriveEdgeHubOverlay(fanOut(8), 8, NO_EXPANDED).hubs).toHaveLength(0);
  });

  it("off keeps every real edge and derives no hubs", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, "off", NO_EXPANDED);
    expect(overlay.hubs).toHaveLength(0);
    expect(overlay.edges).toHaveLength(10);
    expect(overlay.concentratedEdgeIds.size).toBe(0);
    expect(overlay.bundleLanes.size).toBe(0);
  });

  it("counts DISTINCT routes: 5 edges from 4 routes stay below threshold 4", () => {
    const routes = Array.from({ length: 4 }, (_, index) =>
      routeNode("GET", "/api/tasks/" + index),
    );
    const edges: GraphEdge[] = routes.map((route, index) => ({
      id: "route-table:" + index,
      kind: "route-table",
      source: route.id,
      target: TASKS.id,
      label: "dbTables",
    }));
    // A second edge from the first route (e.g. an elevated write) must not tip the count.
    edges.push({
      id: "route-table:extra",
      kind: "route-table",
      source: routes[0]?.id ?? "",
      target: TASKS.id,
      label: "dbTables",
      access: "elevated",
    });
    const view = buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
    expect(deriveEdgeHubOverlay(view, 4, NO_EXPANDED).hubs).toHaveLength(0);
  });

  it("concentrates route-view fan-outs and leaves fk/relation/view-base untouched", () => {
    const view = fanOut(10, "route-view");
    const overlay = deriveEdgeHubOverlay(view, 4, NO_EXPANDED);
    expect(overlay.hubs[0]?.kind).toBe("route-view");
    expect(overlay.hubs[0]?.id).toBe("hub:route-view:view:task_list");

    const other: GraphEdge[] = [
      { id: "fk:1", kind: "fk", source: TASKS.id, target: "table:projects", label: null },
      { id: "relation:1", kind: "relation", source: TASKS.id, target: "table:projects", label: null },
      { id: "view-base:1", kind: "view-base", source: "view:v", target: TASKS.id, label: null },
    ];
    const mixed = buildProjectGraphView({
      graph: graphOf(
        [...Array.from({ length: 10 }, (_, i) => routeNode("GET", "/api/tasks/" + i)), TASKS,
          tableNode("projects"), viewNode("v")],
        [
          ...Array.from({ length: 10 }, (_, i): GraphEdge => ({
            id: "route-table:" + i,
            kind: "route-table",
            source: "route:GET /api/tasks/" + i,
            target: TASKS.id,
            label: "dbTables",
          })),
          ...other,
        ],
      ),
    });
    const mixedOverlay = deriveEdgeHubOverlay(mixed, 4, NO_EXPANDED);
    const real = mixedOverlay.edges.filter((edge) => edge.type === "real");
    expect(real.map((edge) => edge.edge.id).toSorted()).toEqual(
      other.map((edge) => edge.id).toSorted(),
    );
  });
});

describe("expand / collapse (session-scoped)", () => {
  it("expanding shows the 10 individual edges with their labels; the chip stays to collapse", () => {
    const view = fanOut(10);
    const hubId = hubIdFor("route-table", TASKS.id);
    const expanded = toggleExpandedHub(NO_EXPANDED, hubId);
    const overlay = deriveEdgeHubOverlay(view, 4, expanded);
    const real = overlay.edges.filter((edge) => edge.type === "real");
    expect(real).toHaveLength(10);
    expect(real.every((edge) => edge.showLabel)).toBe(true);
    expect(real.every((edge) => edge.edge.label === "dbTables")).toBe(true);
    expect(overlay.edges.some((edge) => edge.type === "hub-target")).toBe(false);
    expect(overlay.concentratedEdgeIds.size).toBe(0);
    // The hub remains as the collapse control, flagged expanded.
    expect(overlay.hubs).toHaveLength(1);
    expect(overlay.hubs[0]?.expanded).toBe(true);
  });

  it("collapsing restores the hub and its single count edge", () => {
    const view = fanOut(10);
    const hubId = hubIdFor("route-table", TASKS.id);
    const expanded = toggleExpandedHub(NO_EXPANDED, hubId);
    const collapsed = toggleExpandedHub(expanded, hubId);
    const overlay = deriveEdgeHubOverlay(view, 4, collapsed);
    expect(overlay.hubs[0]?.expanded).toBe(false);
    expect(overlay.edges.filter((edge) => edge.type === "hub-source")).toHaveLength(10);
    expect(overlay.edges.filter((edge) => edge.type === "hub-target")).toHaveLength(1);
  });

  it("toggleExpandedHub is a pure set toggle", () => {
    const first = toggleExpandedHub(NO_EXPANDED, "hub:a");
    expect(first.has("hub:a")).toBe(true);
    expect(NO_EXPANDED.size).toBe(0);
    const second = toggleExpandedHub(first, "hub:a");
    expect(second.has("hub:a")).toBe(false);
    expect(first.has("hub:a")).toBe(true);
  });
});

describe("render-only invariants", () => {
  it("stats are computed on the real edges and never change when concentrating", () => {
    const view = fanOut(10);
    const before = { ...view.stats };
    deriveEdgeHubOverlay(view, 4, NO_EXPANDED);
    deriveEdgeHubOverlay(view, 8, NO_EXPANDED);
    deriveEdgeHubOverlay(view, "off", NO_EXPANDED);
    expect(view.stats).toEqual(before);
    expect(view.stats.edges).toBe(10);
    expect(view.edges).toHaveLength(10);
  });

  it("concentration never moves a real node", () => {
    const view = fanOut(10);
    const positions = view.nodes.map((node) => ({ ...node.position }));
    deriveEdgeHubOverlay(view, 4, NO_EXPANDED);
    expect(view.nodes.map((node) => node.position)).toEqual(positions);
  });

  it("hub artefact ids are recognisable and never collide with analyzer ids", () => {
    expect(isHubArtefactId("hub:route-table:table:tasks")).toBe(true);
    expect(isHubArtefactId("hub-edge:route-table:table:tasks")).toBe(true);
    expect(isHubArtefactId("route-table:1")).toBe(false);
    expect(isHubArtefactId("table:tasks")).toBe(false);
  });
});

describe("hub placement", () => {
  it("is deterministic and sits in the corridor between the sources and the target", () => {
    const view = fanOut(10);
    const first = deriveEdgeHubOverlay(view, 4, NO_EXPANDED).hubs[0];
    const second = deriveEdgeHubOverlay(view, 4, NO_EXPANDED).hubs[0];
    expect(first?.position).toEqual(second?.position);
    const target = view.nodes.find((node) => node.id === TASKS.id);
    const routes = view.nodes.filter((node) => node.kind === "route");
    expect(target).toBeDefined();
    if (target === undefined || first === undefined) return;
    const sourceRight = Math.max(
      ...routes.map((node) => node.position.x + GRAPH_CARD_SIZES.route.width),
    );
    const hubCenterX = first.position.x + HUB_SIZE.width / 2;
    expect(hubCenterX).toBeGreaterThan(sourceRight);
    expect(hubCenterX).toBeLessThan(target.position.x);
  });

  it("does not overlap any card in the fan-out fixture", () => {
    const view = fanOut(10);
    const hub = deriveEdgeHubOverlay(view, 4, NO_EXPANDED).hubs[0];
    expect(hub).toBeDefined();
    if (hub === undefined) return;
    const hubRect = nodeRect(hub.position, HUB_SIZE.width, HUB_SIZE.height);
    for (const node of view.nodes) {
      const size = GRAPH_CARD_SIZES[node.kind];
      const rect = nodeRect(node.position, size.width, size.height);
      const overlapX =
        Math.abs(hubRect.center.x - rect.center.x) < (hubRect.width + rect.width) / 2;
      const overlapY =
        Math.abs(hubRect.center.y - rect.center.y) < (hubRect.height + rect.height) / 2;
      expect(overlapX && overlapY).toBe(false);
    }
  });

  it("falls back above/below the target when the corridor slot is occupied", () => {
    const target = nodeRect({ x: 600, y: 200 }, 240, 80);
    const source = nodeRect({ x: 0, y: 210 }, 256, 60);
    // A blocker fills the corridor at the sources' mean height.
    const blocker = nodeRect({ x: 380, y: 200 }, 60, 80);
    const position = placeHub([source], target, [source, target, blocker]);
    const hubCenterY = position.y + HUB_SIZE.height / 2;
    expect(hubCenterY).not.toBe(240);
  });
});

describe("hubIsolation", () => {
  it("names the hub, its routes, its target and its edges for hover dimming", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, 4, NO_EXPANDED);
    const hub = overlay.hubs[0];
    expect(hub).toBeDefined();
    if (hub === undefined) return;
    const isolation = hubIsolation(overlay, hub.id);
    expect(isolation).not.toBeNull();
    expect(isolation?.nodeIds.has(hub.id)).toBe(true);
    expect(isolation?.nodeIds.has(TASKS.id)).toBe(true);
    for (const source of hub.sources) expect(isolation?.nodeIds.has(source)).toBe(true);
    expect(isolation?.nodeIds.size).toBe(12);
    for (const edge of hub.edges) expect(isolation?.edgeIds.has(edge.id)).toBe(true);
    expect(isolation?.edgeIds.has(hubEdgeIdFor(hub.kind, hub.target))).toBe(true);
    expect(hubIsolation(overlay, null)).toBeNull();
    expect(hubIsolation(overlay, "hub:missing")).toBeNull();
  });
});
