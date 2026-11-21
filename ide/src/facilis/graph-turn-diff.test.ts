// The agent turn-diff lens (issue #73), unit-tested without a browser. The required fixture:
// one modified route, one added page, one deleted table — plus the clean-tree, no-base and
// spatial-constancy cases the acceptance criteria name.
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphEdgeKind } from "@facilis.dev/analyze";
import type { GitChange } from "@/vv/scm-session";
import { buildProjectGraphView } from "./graph-model";
import { graphOf, pageNode, routeNode, tableNode } from "./graph-model.test-fixtures";
import {
  INACTIVE_TURN_DIFF,
  TURN_DIFF_BASE_REF,
  computeTurnDiff,
  mergeTurnChanges,
} from "./graph-turn-diff";

const ROOT = "/user/project";

const PAGE = pageNode("src/pages/todos.tsx");
const NEW_PAGE = pageNode("src/pages/reports.tsx");
const ROUTE = routeNode("GET", "/api/todos", { sourceFile: "server/routes/api/todos.get.ts" });
const TODOS = tableNode("todos", { sourceFile: "db/todos.ts" });
const PROJECTS = tableNode("projects", { sourceFile: "db/projects.ts" });

const edge = (id: string, kind: GraphEdgeKind, source: string, target: string): GraphEdge => ({
  id,
  kind,
  source,
  target,
  label: null,
});

const PAGE_ROUTE = edge("e-page-route", "page-route", PAGE.id, ROUTE.id);
const NEW_PAGE_ROUTE = edge("e-new-page-route", "page-route", NEW_PAGE.id, ROUTE.id);
const ROUTE_TABLE = edge("e-route-table", "route-table", ROUTE.id, TODOS.id);
const FK = edge("e-fk", "fk", TODOS.id, PROJECTS.id);

// The clean-tree model at the turn base (D-181): the route, both tables and the old page.
const baseView = buildProjectGraphView({
  graph: graphOf([PAGE, ROUTE, TODOS, PROJECTS], [PAGE_ROUTE, ROUTE_TABLE, FK]),
});
// The working tree after the turn: the route rewritten, a page added, the todos table deleted.
const currentView = buildProjectGraphView({
  graph: graphOf([PAGE, NEW_PAGE, ROUTE, PROJECTS], [PAGE_ROUTE, NEW_PAGE_ROUTE]),
});
const base = { nodes: baseView.nodes, edges: baseView.edges };

const change = (path: string, letter: GitChange["letter"]): GitChange => ({
  path,
  abs: ROOT + "/" + path,
  letter,
});
const MODIFIED = change("server/routes/api/todos.get.ts", "M");
const ADDED = change("src/pages/reports.tsx", "A");
const DELETED = change("db/todos.ts", "D");
const TURN = [MODIFIED, ADDED, DELETED];

function diffOf(changes: readonly GitChange[], withBase = true) {
  return computeTurnDiff({
    root: ROOT,
    changes,
    nodes: currentView.nodes,
    edges: currentView.edges,
    base: withBase ? base : null,
  });
}

describe("mergeTurnChanges", () => {
  it("merges staged and unstaged into one entry per path, staged letter winning", () => {
    const staged = [change("a.ts", "M"), change("b.ts", "A")];
    const unstaged = [change("a.ts", "D"), change("c.ts", "U")];
    expect(mergeTurnChanges(staged, unstaged)).toEqual([
      change("a.ts", "M"),
      change("b.ts", "A"),
      change("c.ts", "U"),
    ]);
  });

  it("is empty for a clean tree", () => {
    expect(mergeTurnChanges([], [])).toEqual([]);
  });
});

describe("computeTurnDiff — the turn fixture", () => {
  const diff = diffOf(TURN);

  it("is active and names HEAD as the base ref (D-181 exposes no other turn base)", () => {
    expect(diff.active).toBe(true);
    expect(diff.baseRef).toBe("HEAD");
    expect(TURN_DIFF_BASE_REF).toBe("HEAD");
  });

  it("marks the rewritten route modified and the new page added, nothing else", () => {
    expect(diff.nodeKinds.get(ROUTE.id)).toBe("modified");
    expect(diff.nodeKinds.get(NEW_PAGE.id)).toBe("added");
    expect(diff.nodeKinds.size).toBe(2);
  });

  it("tombstones the deleted table at its last-known base position", () => {
    expect(diff.tombstones.map((node) => node.id)).toEqual([TODOS.id]);
    expect(diff.tombstoneIds.has(TODOS.id)).toBe(true);
    const atBase = baseView.nodes.find((node) => node.id === TODOS.id);
    expect(diff.tombstones[0].position).toEqual(atBase?.position);
  });

  it("marks edges touching changed or added endpoints as changed", () => {
    expect([...diff.changedEdgeIds].toSorted()).toEqual([NEW_PAGE_ROUTE.id, PAGE_ROUTE.id]);
  });

  it("keeps the deleted table's edges visible as severed (broken) edges", () => {
    expect(diff.severedEdges.map((edge) => edge.id).toSorted()).toEqual([FK.id, ROUTE_TABLE.id]);
    expect(diff.brokenEdgeIds.size).toBe(0);
  });

  it("counts one changed, one added, one deleted file", () => {
    expect(diff.counts).toEqual({ changed: 1, added: 1, deleted: 1 });
  });

  it("lists nothing as unmapped when every changed file is on the graph", () => {
    expect(diff.unmapped).toEqual([]);
  });

  it("never moves a live node: the view is untouched by the overlay", () => {
    const fresh = buildProjectGraphView({
      graph: graphOf([PAGE, NEW_PAGE, ROUTE, PROJECTS], [PAGE_ROUTE, NEW_PAGE_ROUTE]),
    });
    expect(currentView.nodes).toEqual(fresh.nodes);
    expect(diff.tombstones[0].position).toEqual(
      baseView.nodes.find((node) => node.id === TODOS.id)?.position,
    );
  });
});

describe("computeTurnDiff — the ribbon's unmapped list", () => {
  it("lists a changed file the analyzer does not map, without dropping it", () => {
    const diff = diffOf([...TURN, change("README.md", "M")]);
    expect(diff.unmapped).toEqual(["README.md"]);
    expect(diff.counts).toEqual({ changed: 2, added: 1, deleted: 1 });
  });

  it("counts a tombstoned file as mapped, not as unmapped", () => {
    expect(diffOf(TURN).unmapped).toEqual([]);
  });
});

describe("computeTurnDiff — clean tree and missing base", () => {
  it("is inactive on a clean tree: the graph renders as without the lens", () => {
    const diff = diffOf([]);
    expect(diff).toBe(INACTIVE_TURN_DIFF);
    expect(diff.active).toBe(false);
    expect(diff.nodeKinds.size).toBe(0);
    expect(diff.tombstones).toEqual([]);
    expect(diff.counts).toEqual({ changed: 0, added: 0, deleted: 0 });
  });

  it("shows no tombstone and no severed edge without a base snapshot (no guessing)", () => {
    const diff = diffOf(TURN, false);
    expect(diff.active).toBe(true);
    expect(diff.tombstones).toEqual([]);
    expect(diff.severedEdges).toEqual([]);
    // The deleted file is honestly "not on the graph" until a base snapshot can place it.
    expect(diff.unmapped).toEqual(["db/todos.ts"]);
    expect(diff.nodeKinds.get(ROUTE.id)).toBe("modified");
  });

  it("tombstones only base nodes: a file added and deleted within the turn gets none", () => {
    // The stale analysis still draws the new page while its file is already deleted again.
    const diff = diffOf([change("src/pages/reports.tsx", "D")]);
    expect(diff.tombstones).toEqual([]);
    expect(diff.nodeKinds.has(NEW_PAGE.id)).toBe(false);
    expect(diff.counts).toEqual({ changed: 0, added: 0, deleted: 1 });
  });

  it("tombstones a deleted node the stale analysis still draws, at its live position", () => {
    const dragged = buildProjectGraphView({
      graph: graphOf([PAGE, ROUTE, TODOS, PROJECTS], [PAGE_ROUTE, ROUTE_TABLE, FK]),
      positions: { [TODOS.id]: { x: 999, y: 888 } },
    });
    const diff = computeTurnDiff({
      root: ROOT,
      changes: [DELETED],
      nodes: dragged.nodes,
      edges: dragged.edges,
      base,
    });
    expect(diff.tombstones.map((node) => node.id)).toEqual([TODOS.id]);
    expect(diff.tombstones[0].position).toEqual({ x: 999, y: 888 });
    // The live edge to the tombstoned node reads broken, not changed.
    expect(diff.brokenEdgeIds.has(ROUTE_TABLE.id)).toBe(true);
    expect(diff.changedEdgeIds.has(ROUTE_TABLE.id)).toBe(false);
  });
});

describe("computeTurnDiff — letters and ghosts", () => {
  it("reads an untracked file (U) as added", () => {
    const diff = diffOf([change("src/pages/reports.tsx", "U")]);
    expect(diff.nodeKinds.get(NEW_PAGE.id)).toBe("added");
    expect(diff.counts).toEqual({ changed: 0, added: 1, deleted: 0 });
  });

  it("emits ghosts only for plan paths that are neither live nodes nor written changes", () => {
    const diff = computeTurnDiff({
      root: ROOT,
      changes: TURN,
      nodes: currentView.nodes,
      edges: currentView.edges,
      base,
      planPaths: [
        "src/pages/planned.tsx",
        "src/pages/todos.tsx",
        "server/routes/api/todos.get.ts",
        "src/pages/planned.tsx",
      ],
    });
    expect(diff.ghosts).toEqual([{ path: "src/pages/planned.tsx" }]);
  });

  it("is inert without plan paths (all of phase 1)", () => {
    expect(diffOf(TURN).ghosts).toEqual([]);
  });

  it("matches an absolute sourceFile against the repo-relative change path", () => {
    const absolute = buildProjectGraphView({
      graph: graphOf([
        { ...ROUTE, sourceFile: ROOT + "/server/routes/api/todos.get.ts" },
        PROJECTS,
      ]),
    });
    const diff = computeTurnDiff({
      root: ROOT,
      changes: [MODIFIED],
      nodes: absolute.nodes,
      edges: absolute.edges,
    });
    expect(diff.nodeKinds.get(ROUTE.id)).toBe("modified");
    expect(diff.unmapped).toEqual([]);
  });
});
