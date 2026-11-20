import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "@/facilis/graph-model";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  graphOf,
} from "@/facilis/graph-model.test-fixtures";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-types";
import {
  allEdgeKindsHidden,
  edgeKindTotals,
  filterViewByNodeKinds,
  toggleAllEdgeKinds,
  toggleKind,
} from "./graph-ribbon-filters";

describe("toggleKind", () => {
  it("adds an absent kind without mutating the saved list", () => {
    const hidden = ["fk"] as const;
    const next = toggleKind(hidden, "relation");
    expect(next).toEqual(["fk", "relation"]);
    expect(hidden).toEqual(["fk"]);
  });

  it("removes a present kind (the counter toggles back on)", () => {
    expect(toggleKind(["fk", "relation"], "fk")).toEqual(["relation"]);
  });
});

describe("the edges master counter", () => {
  it("hides every kind at once, then restores them all", () => {
    const all = toggleAllEdgeKinds(["fk"]);
    expect(all).toEqual([...GRAPH_EDGE_KINDS]);
    expect(allEdgeKindsHidden(all)).toBe(true);
    expect(toggleAllEdgeKinds(all)).toEqual([]);
    expect(allEdgeKindsHidden([])).toBe(false);
  });
});

describe("edgeKindTotals", () => {
  it("counts every kind, zero included, so hidden chips keep their total", () => {
    const totals = edgeKindTotals([{ kind: "fk" }, { kind: "fk" }, { kind: "page-route" }]);
    expect(totals.fk).toBe(2);
    expect(totals["page-route"]).toBe(1);
    expect(totals["view-base"]).toBe(0);
  });
});

describe("filterViewByNodeKinds", () => {
  const graph = graphOf(
    [PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS],
    [
      { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
      {
        id: "route-table:1",
        kind: "route-table",
        source: GET.id,
        target: TODOS.id,
        label: "dbTables",
      },
      {
        id: "route-view:1",
        kind: "route-view",
        source: GET.id,
        target: ACTIVE_TODOS.id,
        label: "dbTables",
      },
      {
        id: "view-base:1",
        kind: "view-base",
        source: ACTIVE_TODOS.id,
        target: TODOS.id,
        label: null,
      },
      {
        id: "fk:1",
        kind: "fk",
        source: TODOS.id,
        target: PROJECTS.id,
        label: "todos -> projects.id",
      },
    ],
  );
  const view = buildProjectGraphView({ graph });

  it("returns the same view when nothing is hidden", () => {
    expect(filterViewByNodeKinds(view, [])).toBe(view);
  });

  it("drops the kind's cards and every edge that pointed at them", () => {
    const filtered = filterViewByNodeKinds(view, ["table"]);
    expect(filtered.nodes.some((node) => node.kind === "table")).toBe(false);
    // route-table, view-base and fk all touched a table; page-route and route-view survive.
    expect(filtered.edges.map((edge) => edge.kind)).toEqual(["page-route", "route-view"]);
    expect(filtered.stats.tables).toBe(0);
    expect(filtered.stats.edges).toBe(2);
  });

  it("keeps node positions stable (spatial constancy while filtering)", () => {
    const filtered = filterViewByNodeKinds(view, ["page"]);
    const route = filtered.nodes.find((node) => node.id === GET.id);
    const original = view.nodes.find((node) => node.id === GET.id);
    expect(route?.position).toEqual(original?.position);
  });

  it("recounts matches and leaves the other filters' hidden counts alone", () => {
    const searched = buildProjectGraphView({ graph, query: "todos" });
    const filtered = filterViewByNodeKinds(searched, ["view"]);
    expect(filtered.stats.views).toBe(0);
    expect(filtered.stats.matches).toBe(filtered.nodes.filter((node) => node.matched).length);
    expect(filtered.stats.hiddenEdges).toBe(searched.stats.hiddenEdges);
    expect(filtered.stats.hiddenNodes).toBe(searched.stats.hiddenNodes);
  });

  it("can hide several kinds at once", () => {
    const filtered = filterViewByNodeKinds(view, ["page", "workflow", "view"]);
    expect(filtered.nodes.map((node) => node.kind).sort()).toEqual(["route", "table", "table"]);
    expect(filtered.edges.map((edge) => edge.kind)).toEqual(["route-table", "fk"]);
  });
});
