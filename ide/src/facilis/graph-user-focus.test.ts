// The user-focus semantics (issue #66): the Esc layer order, the dim-only isolate composition
// (F.5) and the HUD summary. Pure tests — the panel wiring is proved by the browser gate.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "./graph-types";
import { reachabilityClosure, type GraphReachability } from "./graph-reachability";
import {
  USER_FOCUS_OPACITY,
  closureSummary,
  composeUserFocus,
  graphEscapeAction,
} from "./graph-user-focus";

const node = (id: string, kind: ProjectGraphNode["kind"], x: number): ProjectGraphNode => ({
  id,
  kind,
  label: id,
  sourceFile: null,
  position: { x, y: 7 },
  data:
    kind === "page"
      ? {
          kind: "page",
          pagePath: id,
          pageKind: "page",
          callCount: 0,
          routePaths: [],
          preview: null,
        }
      : kind === "table"
        ? {
            kind: "table",
            table: id,
            columns: [],
            rlsEnabled: true,
            framework: false,
            scope: null,
            policies: [],
            unknown: false,
          }
        : {
            kind: "route",
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
  matched: true,
  collapsed: false,
});

// page → route → table a ↔ table b (cycle); p links onward to x, which is outside a's cone.
const view: ProjectGraphView = {
  nodes: [
    node("p", "page", 0),
    node("r", "route", 100),
    node("a", "table", 200),
    node("b", "table", 300),
    node("x", "page", 400),
  ],
  edges: [
    { id: "e1", kind: "page-route", source: "p", target: "r", label: null },
    { id: "e2", kind: "route-table", source: "r", target: "a", label: null },
    { id: "e3", kind: "fk", source: "a", target: "b", label: null },
    { id: "e4", kind: "relation", source: "b", target: "a", label: null },
    { id: "e5", kind: "page-link", source: "p", target: "x", label: null },
  ],
  stats: {
    pages: 2,
    routes: 1,
    tables: 2,
    views: 0,
    workflows: 0,
    edges: 5,
    hiddenEdges: 0,
    hiddenNodes: 0,
    matches: 5,
    unknownNodes: 0,
    pageLinks: 1,
    elevatedEdges: 0,
  },
  clusters: [],
  layoutSize: { width: 624, height: 167 },
};

/** The fixture ids are all visible, so a null closure is a broken fixture, not a case. */
function closureOf(id: string): GraphReachability {
  const closure = reachabilityClosure(view, id);
  if (closure === null) throw new Error("fixture id not visible: " + id);
  return closure;
}

describe("graphEscapeAction", () => {
  const ctx = {
    zen: false,
    impactActive: false,
    isolatedNode: null,
    selection: null,
    drill: null,
    aiFocusActive: false,
  };

  it("clears nothing when no layer is active", () => {
    expect(graphEscapeAction(ctx)).toBeNull();
  });

  it("clears one layer at a time: isolate, then selection, then AI focus", () => {
    const all = {
      zen: false,
      impactActive: false,
      isolatedNode: "a",
      selection: "a",
      drill: null,
      aiFocusActive: true,
    };
    expect(graphEscapeAction(all)).toBe("exit-isolate");
    expect(graphEscapeAction({ ...all, isolatedNode: null })).toBe("clear-selection");
    expect(graphEscapeAction({ ...all, isolatedNode: null, selection: null })).toBe(
      "clear-ai-focus",
    );
    expect(
      graphEscapeAction({ ...all, isolatedNode: null, selection: null, aiFocusActive: false }),
    ).toBeNull();
  });

  it("leaves zen first, the bigger mode change", () => {
    expect(
      graphEscapeAction({
        zen: true,
        impactActive: true,
        isolatedNode: "a",
        selection: "a",
        drill: null,
        aiFocusActive: true,
      }),
    ).toBe("exit-zen");
  });

  it("exits the impact simulation before isolation, selection and AI focus (issue #74)", () => {
    const all = {
      zen: false,
      impactActive: true,
      isolatedNode: "a",
      selection: "a",
      drill: null,
      aiFocusActive: true,
    };
    expect(graphEscapeAction(all)).toBe("exit-impact");
    expect(graphEscapeAction({ ...all, impactActive: false })).toBe("exit-isolate");
    expect(graphEscapeAction({ ...all, impactActive: false, isolatedNode: null })).toBe(
      "clear-selection",
    );
    expect(
      graphEscapeAction({
        ...all,
        impactActive: false,
        isolatedNode: null,
        selection: null,
      }),
    ).toBe("clear-ai-focus");
  });

  it("exiting impact keeps the selection and isolation: only the lens goes (criterion 5)", () => {
    const action = graphEscapeAction({ ...ctx, impactActive: true, selection: "a" });
    expect(action).toBe("exit-impact");
    // The panel removes only the impact lens and its column; the next Esc still sees them all.
    expect(graphEscapeAction({ ...ctx, impactActive: false, selection: "a" })).toBe(
      "clear-selection",
    );
    expect(
      graphEscapeAction({ ...ctx, impactActive: true, isolatedNode: "a", selection: "a" }),
    ).toBe("exit-impact");
  });

  it("the drill owns Esc after the selection and before the AI focus (issue #62)", () => {
    const drilled = { ...ctx, drill: "cluster:api/todos", aiFocusActive: true };
    expect(graphEscapeAction(drilled)).toBe("exit-drill");
    expect(graphEscapeAction({ ...drilled, selection: "a" })).toBe("clear-selection");
    expect(graphEscapeAction({ ...drilled, isolatedNode: "a" })).toBe("exit-isolate");
    expect(graphEscapeAction({ ...drilled, drill: null })).toBe("clear-ai-focus");
  });

  it("exiting isolation keeps the selection: full brightness returns in one step", () => {
    const action = graphEscapeAction({ ...ctx, isolatedNode: "a", selection: "a" });
    expect(action).toBe("exit-isolate");
    // The panel only nulls the isolate id; selection is untouched by this action.
    expect(graphEscapeAction({ ...ctx, isolatedNode: null, selection: "a" })).toBe(
      "clear-selection",
    );
  });
});

describe("composeUserFocus (dim-only isolate, F.5)", () => {
  it("returns the selection closure when nothing is isolated", () => {
    expect(composeUserFocus(null, closureOf("a"))).toEqual(closureOf("a"));
  });

  it("keeps the isolate closure dimming when the selection clears", () => {
    // The mode outlives the selection: outsiders stay dimmed until Esc exits isolate.
    expect(composeUserFocus(closureOf("a"), null)).toEqual(closureOf("a"));
  });

  it("dims nothing when neither channel is active", () => {
    expect(composeUserFocus(null, null)).toBeNull();
  });

  it("isolating the selected node changes nothing visually (same closure)", () => {
    const closure = closureOf("a");
    expect(composeUserFocus(closure, closure)).toEqual(closure);
  });

  it("intersects: a selection inside the isolate dims the rest of the closure", () => {
    // Isolate on a (closure p, r, a, b); select p (closure p, r, a, b, x): the bright set is
    // their intersection — x stays dimmed by the isolate, exactly as the branch's subgraph
    // would have drawn it, but no card is removed.
    const composed = composeUserFocus(closureOf("a"), closureOf("p"));
    expect(composed?.nodeIds).toEqual(["a", "b", "p", "r"]);
    expect(composed?.edgeIds).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("keeps sorted, duplicate-free ids (deterministic like the closures)", () => {
    const composed = composeUserFocus(closureOf("a"), closureOf("b"));
    expect(composed?.nodeIds).toEqual([...(composed?.nodeIds ?? [])].toSorted());
    expect(new Set(composed?.nodeIds).size).toBe(composed?.nodeIds.length);
  });
});

describe("closureSummary", () => {
  it("counts exactly the highlighted nodes, per kind", () => {
    const closure = closureOf("a");
    const summary = closureSummary(view, closure);
    expect(summary).toEqual({ total: 4, pages: 1, routes: 1, tables: 2, views: 0, workflows: 0 });
    expect(summary.total).toBe(closure.nodeIds.length);
  });

  it("stops at the cone boundary: a page's onward link is not its reacher", () => {
    // p → x makes p the only reacher of x; r is DOWNSTREAM of p, so it is not x's context.
    const summary = closureSummary(view, closureOf("x"));
    expect(summary).toEqual({ total: 2, pages: 2, routes: 0, tables: 0, views: 0, workflows: 0 });
  });
});

describe("USER_FOCUS_OPACITY", () => {
  it("is the 12% the issue mandates", () => {
    expect(USER_FOCUS_OPACITY).toBe(0.12);
  });
});
