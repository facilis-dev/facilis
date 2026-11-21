import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import { ACTIVE_TODOS, GET, PAGE, TODOS, WORKFLOW, graphOf } from "./graph-model.test-fixtures";

const GRAPH = graphOf([PAGE, GET, TODOS, ACTIVE_TODOS, WORKFLOW]);
const kindsOf = (kinds?: readonly ("page" | "route" | "table" | "view" | "workflow")[]) =>
  buildProjectGraphView({ graph: GRAPH, kinds }).nodes.map((node) => node.kind);

describe("buildProjectGraphView kind filter (issue #57)", () => {
  it("draws every kind when no filter is given", () => {
    expect(kindsOf()).toEqual(["page", "route", "table", "view", "workflow"]);
  });

  it("treats an empty kind list as no filter", () => {
    expect(kindsOf([])).toEqual(["page", "route", "table", "view", "workflow"]);
  });

  it("isolates a single kind", () => {
    expect(kindsOf(["table"])).toEqual(["table"]);
    const view = buildProjectGraphView({ graph: GRAPH, kinds: ["table"] });
    expect(view.stats.tables).toBe(1);
    expect(view.stats.pages).toBe(0);
  });

  it("isolates several kinds at once", () => {
    expect(kindsOf(["page", "route"])).toEqual(["page", "route"]);
  });

  it("drops edges that touch a kind-filtered node", () => {
    const graph = graphOf(
      [PAGE, GET, TODOS],
      [
        { id: "e1", source: PAGE.id, target: GET.id, kind: "page-route", label: null },
        { id: "e2", source: GET.id, target: TODOS.id, kind: "route-table", label: null },
      ],
    );
    const view = buildProjectGraphView({ graph, kinds: ["route"] });
    expect(view.nodes.map((node) => node.kind)).toEqual(["route"]);
    expect(view.edges).toEqual([]);
  });

  it("never counts kind-filtered nodes as D-179 hidden nodes", () => {
    const view = buildProjectGraphView({ graph: GRAPH, kinds: ["table"], tableVisibility: "all" });
    expect(view.stats.hiddenNodes).toBe(0);
  });
});
