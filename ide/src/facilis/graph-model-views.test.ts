// View-node coverage split from graph-model.test.ts so every test module stays under the
// 300-line source limit: the view data mapping, its route usage and the unknown badge.
import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import { ACTIVE_TODOS, GET, graphOf, routeNode, viewNode } from "./graph-model.test-fixtures";

describe("buildProjectGraphView view data", () => {
  it("maps a view's permission, access mode, base tables and unknown badge", () => {
    const opaque = viewNode("opaque", { access: null, unknown: true });
    const view = buildProjectGraphView({ graph: graphOf([ACTIVE_TODOS, opaque]) });
    const active = view.nodes.find((node) => node.id === ACTIVE_TODOS.id)?.data;
    if (active?.kind !== "view") throw new Error("expected a view node");
    expect(active).toEqual({
      kind: "view",
      view: "active_todos",
      tables: ["todos", "projects"],
      permission: "todos:read",
      access: "definer",
      unknown: false,
      usedByRoutes: [],
    });
    const broken = view.nodes.find((node) => node.id === opaque.id)?.data;
    if (broken?.kind !== "view") throw new Error("expected a view node");
    expect(broken).toMatchObject({ access: null, permission: null, unknown: true });
    expect(view.stats.views).toBe(2);
    expect(view.stats.unknownNodes).toBe(1);
  });

  it("computes usedByRoutes from the incoming route-view edges, sorted and deduplicated", () => {
    const post = routeNode("POST", "/api/reports");
    const view = buildProjectGraphView({
      graph: graphOf(
        [GET, post, ACTIVE_TODOS],
        [
          {
            id: "route-view:1",
            kind: "route-view",
            source: GET.id,
            target: ACTIVE_TODOS.id,
            label: "dbTables",
          },
          {
            id: "route-view:2",
            kind: "route-view",
            source: post.id,
            target: ACTIVE_TODOS.id,
            label: "dbTables",
            access: "elevated",
          },
          // A duplicate cannot list the same route twice.
          {
            id: "route-view:1b",
            kind: "route-view",
            source: GET.id,
            target: ACTIVE_TODOS.id,
            label: "dbTables",
          },
        ],
      ),
    });
    const data = view.nodes.find((node) => node.id === ACTIVE_TODOS.id)?.data;
    if (data?.kind !== "view") throw new Error("expected a view node");
    expect(data.usedByRoutes).toEqual([
      { id: GET.id, label: "GET /api/todos" },
      { id: post.id, label: "POST /api/reports" },
    ]);
    expect(view.stats.elevatedEdges).toBe(1);
  });

  it("counts view nodes that no route uses with an empty usedByRoutes", () => {
    const view = buildProjectGraphView({ graph: graphOf([ACTIVE_TODOS]) });
    const data = view.nodes[0]?.data;
    if (data?.kind !== "view") throw new Error("expected a view node");
    expect(data.usedByRoutes).toEqual([]);
  });
});
