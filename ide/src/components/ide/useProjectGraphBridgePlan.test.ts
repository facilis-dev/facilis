// The bridge population (issue #65 composing #64): concentrated edges belong to the hub's
// geometry and trunk-bundled members share their straight lane — neither is bridged. An
// expanded hub's real edges are no longer concentrated, so they rejoin the population.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, hubIdFor } from "@/facilis/graph-edge-hubs";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { graphOf, routeNode, tableNode } from "@/facilis/graph-model.test-fixtures";
import { bridgePopulation } from "./useProjectGraphBridgePlan";

const TASKS = tableNode("tasks");
function fanOut(count: number) {
  const routes = Array.from({ length: count }, (_, index) =>
    routeNode("GET", "/api/tasks/" + index),
  );
  const edges: GraphEdge[] = routes.map((route, index) => ({
    id: "route-table:" + index,
    kind: "route-table",
    source: route.id,
    target: TASKS.id,
    label: "dbTables",
  }));
  return buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
}

describe("bridgePopulation", () => {
  it("drops every edge the hub overlay concentrates", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, 4, new Set());
    expect(overlay.concentratedEdgeIds.size).toBe(10);
    expect(bridgePopulation(view.edges, overlay)).toEqual([]);
  });

  it("keeps the real edges of an expanded hub (no longer concentrated)", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, 4, new Set([hubIdFor("route-table", TASKS.id)]));
    expect(overlay.concentratedEdgeIds.size).toBe(0);
    expect(bridgePopulation(view.edges, overlay).map((edge) => edge.id)).toEqual(
      view.edges.map((edge) => edge.id),
    );
  });

  it("drops trunk-bundled members: the shared lane is their geometry", () => {
    const view = fanOut(3);
    const overlay = deriveEdgeHubOverlay(view, 4, new Set());
    expect(overlay.bundleLanes.size).toBe(3);
    expect(bridgePopulation(view.edges, overlay)).toEqual([]);
  });

  it("keeps every edge when concentration is off", () => {
    const view = fanOut(10);
    const overlay = deriveEdgeHubOverlay(view, "off", new Set());
    expect(bridgePopulation(view.edges, overlay)).toHaveLength(10);
  });
});
