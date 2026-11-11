// Edge and filter coverage split from graph-model.test.ts so every test module stays under the
// 300-line source limit: every kind passes through, hidden kinds are dropped and counted.
import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  graphOf,
  pageNode,
} from "./graph-model.test-fixtures";

describe("buildProjectGraphView edges and filters", () => {
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
        id: "view-base:2",
        kind: "view-base",
        source: ACTIVE_TODOS.id,
        target: PROJECTS.id,
        label: null,
      },
      {
        id: "fk:1",
        kind: "fk",
        source: TODOS.id,
        target: PROJECTS.id,
        label: "todos -> projects.id",
      },
      { id: "relation:1", kind: "relation", source: TODOS.id, target: PROJECTS.id, label: "one" },
    ],
  );

  it("passes every edge through when nothing is hidden", () => {
    const view = buildProjectGraphView({ graph });
    expect(view.edges.map((edge) => edge.kind)).toEqual([
      "page-route",
      "route-table",
      "route-view",
      "view-base",
      "view-base",
      "fk",
      "relation",
    ]);
    expect(view.stats).toMatchObject({
      edges: 7,
      hiddenEdges: 0,
      pages: 1,
      routes: 1,
      tables: 2,
      views: 1,
    });
  });

  it("drops hidden edge kinds and counts them", () => {
    const view = buildProjectGraphView({ graph, hiddenEdgeKinds: ["fk", "relation"] });
    expect(view.edges.map((edge) => edge.kind)).toEqual([
      "page-route",
      "route-table",
      "route-view",
      "view-base",
      "view-base",
    ]);
    expect(view.stats.hiddenEdges).toBe(2);
    expect(view.stats.edges).toBe(5);
  });

  it("filters the view edges like any other kind", () => {
    const view = buildProjectGraphView({
      graph,
      hiddenEdgeKinds: ["route-view", "view-base"],
    });
    expect(view.edges.map((edge) => edge.kind)).toEqual([
      "page-route",
      "route-table",
      "fk",
      "relation",
    ]);
    expect(view.stats.hiddenEdges).toBe(3);
  });

  it("drops edges whose endpoints the graph does not contain", () => {
    const view = buildProjectGraphView({
      graph: graphOf(
        [GET],
        [
          {
            id: "page-route:ghost",
            kind: "page-route",
            source: "page:gone.tsx",
            target: GET.id,
            label: null,
          },
        ],
      ),
    });
    expect(view.edges).toEqual([]);
    expect(view.nodes.map((node) => node.id)).toEqual([GET.id]);
  });

  it("keeps explicit page-link edges and counts them", () => {
    const about = pageNode("src/pages/about.tsx", 0);
    const link = {
      id: "page-link:about",
      kind: "page-link" as const,
      source: PAGE.id,
      target: about.id,
      label: "/about",
    };
    const view = buildProjectGraphView({ graph: graphOf([PAGE, about, GET], [link]) });
    expect(view.edges).toEqual([link]);
    expect(view.stats.pageLinks).toBe(1);
    expect(view.stats.pages).toBe(2);
  });

  it("keeps a real page even when it calls no API", () => {
    const empty = pageNode("src/pages/empty.tsx", 0);
    const view = buildProjectGraphView({
      graph: graphOf(
        [empty, GET],
        [
          {
            id: "page-route:empty",
            kind: "page-route",
            source: empty.id,
            target: GET.id,
            label: null,
          },
        ],
      ),
    });
    expect(view.nodes.map((node) => node.id)).toEqual([empty.id, GET.id]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["page-route:empty"]);
    expect(view.stats.pages).toBe(1);
  });
});
