// Issue #62 acceptance: clusters derive deterministically from the analysis (three fixture
// groups), a collapse hides children and bundles the boundary crossings, expanding restores
// the exact positions, search auto-expands matching clusters, and the lone "other" cluster
// never collapses. The layout budget lives in graph-cluster-layout.test.ts.

import { describe, expect, it } from "vitest";
import type { GraphEdge, ProjectGraph } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "./graph-model";
import {
  GRAPH_CLUSTER_PREFIX,
  OTHER_CLUSTER_KEY,
  collapseClusterEdges,
  deriveClusters,
  folderOf,
} from "./graph-clusters";
import { GRAPH_CLUSTER_SUPER_SIZE } from "./graph-cluster-layout";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
  workflowNode,
} from "./graph-model.test-fixtures";

const cid = (key: string): string => GRAPH_CLUSTER_PREFIX + key;

/** Three route groups: two feature directories under routes/ and one explicit (billing) group. */
function threeGroupGraph(): ProjectGraph {
  const routes = [
    routeNode("GET", "/api/todos", { sourceFile: "server/routes/api/todos/index.get.ts" }),
    routeNode("POST", "/api/todos", { sourceFile: "server/routes/api/todos/index.post.ts" }),
    routeNode("GET", "/api/todos/{id}", { sourceFile: "server/routes/api/todos/[id].get.ts" }),
    routeNode("POST", "/api/auth/login", { sourceFile: "server/routes/api/auth/login.post.ts" }),
    routeNode("GET", "/api/auth/session", { sourceFile: "server/routes/api/auth/session.get.ts" }),
    routeNode("GET", "/invoices", { sourceFile: "server/routes/(billing)/invoices/index.get.ts" }),
    routeNode("GET", "/invoices/{id}", {
      sourceFile: "server/routes/(billing)/invoices/[id].get.ts",
    }),
  ];
  const tables = [
    tableNode("todos"),
    tableNode("todo_files"),
    tableNode("users"),
    tableNode("invoices"),
  ];
  const pages = [
    pageNode("src/pages/todos.tsx"),
    pageNode("src/pages/login.tsx"),
    pageNode("src/pages/billing.tsx"),
  ];
  const edges: GraphEdge[] = [];
  const calls: readonly [number, readonly number[]][] = [
    [0, [0, 1, 2]],
    [1, [3, 4]],
    [2, [5, 6]],
  ];
  for (const [page, targets] of calls) {
    for (const target of targets) {
      edges.push({
        id: "page-route:" + pages[page].id + ":" + routes[target].id,
        kind: "page-route",
        source: pages[page].id,
        target: routes[target].id,
        label: null,
      });
    }
  }
  for (const route of routes) {
    if (route.data.kind !== "route") continue;
    for (const table of route.data.dbTables) {
      edges.push({
        id: "route-table:" + route.id + ":" + table,
        kind: "route-table",
        source: route.id,
        target: "table:" + table,
        label: null,
      });
    }
  }
  edges.push({
    id: "fk:0",
    kind: "fk",
    source: "table:todo_files",
    target: "table:todos",
    label: null,
  });
  return graphOf([...pages, ...routes, ...tables], edges);
}

describe("deriveClusters", () => {
  it("groups the fixture into the three route features, deterministically", () => {
    const graph = threeGroupGraph();
    const clusters = deriveClusters(graph.nodes, graph.edges);
    expect(clusters.map((cluster) => cluster.key)).toEqual([
      "api/auth",
      "api/todos",
      "billing",
      "db",
      "todo",
    ]);
    const todos = clusters.find((cluster) => cluster.key === "api/todos");
    expect(todos?.counts).toEqual({ page: 1, route: 3, table: 0, view: 0, workflow: 0 });
    expect(todos?.nodeIds).toContain("page:src/pages/todos.tsx");
    expect(clusters).toEqual(deriveClusters(graph.nodes, graph.edges));
    // Node order in the analysis must not change the derivation.
    expect(deriveClusters(graph.nodes.toReversed(), graph.edges)).toEqual(clusters);
  });

  it("an explicit (group) directory wins over the directory above the route file", () => {
    const graph = threeGroupGraph();
    const clusters = deriveClusters(graph.nodes, graph.edges);
    const billing = clusters.find((cluster) => cluster.key === "billing");
    expect(billing?.nodeIds).toContain("route:GET /invoices");
    expect(billing?.nodeIds).toContain("route:GET /invoices/{id}");
  });

  it("falls back to the first path segment, then the source folder, then other", () => {
    const rootRoute = routeNode("GET", "/health", { sourceFile: "server/routes/health.get.ts" });
    const noSource = { ...routeNode("GET", "/api/x"), sourceFile: null };
    const ungroupable = { ...routeNode("GET", "/"), sourceFile: null };
    const clusters = deriveClusters([rootRoute, noSource, ungroupable], []);
    expect(clusters.map((cluster) => cluster.key)).toEqual(["api", "health", OTHER_CLUSTER_KEY]);
  });

  it("tables and views cluster by schema prefix, else their folder", () => {
    const nodes = [
      tableNode("todo_files"),
      tableNode("todos"),
      viewNode("active_todos"),
      viewNode("v0"),
      workflowNode("purge"),
    ];
    const clusters = deriveClusters(nodes, []);
    expect(clusters.map((cluster) => cluster.key)).toEqual([
      "active",
      "db",
      "todo",
      "views",
      "workflows",
    ]);
  });

  it("pages join the dominant route cluster; ties break lexicographically", () => {
    const graph = threeGroupGraph();
    const tied = pageNode("src/pages/mixed.tsx");
    const edges: GraphEdge[] = [
      {
        id: "e1",
        kind: "page-route",
        source: tied.id,
        target: "route:GET /api/todos",
        label: null,
      },
      {
        id: "e2",
        kind: "page-route",
        source: tied.id,
        target: "route:GET /api/auth/session",
        label: null,
      },
    ];
    const clusters = deriveClusters([...graph.nodes, tied], [...graph.edges, ...edges]);
    const auth = clusters.find((cluster) => cluster.key === "api/auth");
    expect(auth?.nodeIds).toContain(tied.id);
    const orphan = pageNode("src/pages/orphan.tsx");
    const withOrphan = deriveClusters([...graph.nodes, orphan], graph.edges);
    const other = withOrphan.find((cluster) => cluster.key === OTHER_CLUSTER_KEY);
    expect(other?.nodeIds).toEqual([orphan.id]);
  });

  it("every node lands in exactly one cluster (a partition)", () => {
    const graph = threeGroupGraph();
    const clusters = deriveClusters(graph.nodes, graph.edges);
    const seen = clusters.flatMap((cluster) => cluster.nodeIds);
    expect(seen.toSorted()).toEqual(graph.nodes.map((node) => node.id).toSorted());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("counts the edges crossing each boundary, not the internal ones", () => {
    const graph = threeGroupGraph();
    const clusters = deriveClusters(graph.nodes, graph.edges);
    const crossing = Object.fromEntries(clusters.map((c) => [c.key, c.crossingEdges]));
    // page-route edges stay inside their feature; route-table and the fk cross.
    expect(crossing).toEqual({ "api/auth": 2, "api/todos": 3, billing: 2, db: 8, todo: 1 });
  });

  it("a lone other cluster is not collapsible; with peers it is", () => {
    const lone = { ...routeNode("GET", "/"), sourceFile: null };
    const alone = deriveClusters([lone], []);
    expect(alone).toHaveLength(1);
    expect(alone[0]?.collapsible).toBe(false);
    const mixed = deriveClusters([lone, tableNode("todos")], []);
    expect(mixed.find((c) => c.key === OTHER_CLUSTER_KEY)?.collapsible).toBe(true);
  });

  it("folderOf names the parent directory basename", () => {
    expect(folderOf("db/schema.ts")).toBe("db");
    expect(folderOf("db/views/v0.ts")).toBe("views");
    expect(folderOf("schema.ts")).toBeNull();
    expect(folderOf(null)).toBeNull();
  });
});

describe("collapse and expand", () => {
  const graph = threeGroupGraph();
  const enabled = { enabled: true, collapsed: [] as string[] };

  it("hides the children and draws a super-node of the chip size", () => {
    const view = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("api/todos")] },
    });
    const cluster = view.clusters.find((c) => c.key === "api/todos");
    expect(cluster?.collapsed).toBe(true);
    expect(cluster?.size).toEqual({ ...GRAPH_CLUSTER_SUPER_SIZE });
    for (const id of cluster?.nodeIds ?? []) {
      expect(view.nodes.some((node) => node.id === id)).toBe(false);
    }
    // The other clusters keep their children.
    expect(view.nodes.some((node) => node.id === "route:GET /api/auth/session")).toBe(true);
  });

  it("replaces N parallel crossing edges with one boundary edge carrying their count", () => {
    const view = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("api/todos")] },
    });
    const bundled = view.edges.filter((edge) => edge.source === cid("api/todos"));
    expect(bundled).toHaveLength(1);
    expect(bundled[0]?.target).toBe("table:todos");
    expect(bundled[0]?.count).toBe(3);
    expect(bundled[0]?.kind).toBe("route-table");
    // Internal page-route edges dropped with the children.
    expect(
      view.edges.some((edge) => edge.kind === "page-route" && edge.source === cid("api/todos")),
    ).toBe(false);
  });

  it("expanding restores the exact previous positions", () => {
    const baseline = buildProjectGraphView({ graph, clusters: enabled });
    const collapseA = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("api/todos")] },
    });
    const collapseBoth = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("api/todos"), cid("billing")] },
    });
    // Expanding billing lands back on the exact view from before it was collapsed.
    const restored = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("api/todos")] },
    });
    expect(restored).toEqual(collapseA);
    expect(buildProjectGraphView({ graph, clusters: enabled })).toEqual(baseline);
    expect(collapseBoth).not.toEqual(collapseA);
  });

  it("search auto-expands a matching cluster and dims the rest", () => {
    const view = buildProjectGraphView({
      graph,
      query: "login",
      clusters: { ...enabled, collapsed: [cid("api/auth"), cid("api/todos")] },
    });
    const auth = view.clusters.find((c) => c.key === "api/auth");
    const todos = view.clusters.find((c) => c.key === "api/todos");
    expect(auth?.collapsed).toBe(false);
    expect(auth?.matched).toBe(true);
    expect(todos?.collapsed).toBe(true);
    expect(todos?.matched).toBe(false);
    expect(view.nodes.some((node) => node.id === "route:POST /api/auth/login")).toBe(true);
    const session = view.nodes.find((node) => node.id === "route:GET /api/auth/session");
    expect(session?.matched).toBe(false);
  });

  it("a forced expansion (drill-down) overrides the collapse list", () => {
    const view = buildProjectGraphView({
      graph,
      clusters: { ...enabled, collapsed: [cid("billing")], forceExpanded: [cid("billing")] },
    });
    expect(view.clusters.find((c) => c.key === "billing")?.collapsed).toBe(false);
  });

  it("a lone other cluster ignores the collapse list", () => {
    const lone = { ...routeNode("GET", "/"), sourceFile: null };
    const view = buildProjectGraphView({
      graph: graphOf([lone]),
      clusters: { enabled: true, collapsed: [cid(OTHER_CLUSTER_KEY)] },
    });
    expect(view.clusters[0]?.collapsed).toBe(false);
    expect(view.nodes).toHaveLength(1);
  });

  it("collapseClusterEdges keeps untouched edges and re-anchors the boundary ones", () => {
    const view = buildProjectGraphView({ graph, clusters: enabled });
    const edges = collapseClusterEdges(view.edges, view.clusters, new Set([cid("db")]));
    const intoDb = edges.filter((edge) => edge.target === cid("db"));
    // Seven distinct routes still draw seven edges (different sources), plus the fk.
    expect(intoDb).toHaveLength(8);
    expect(intoDb.find((edge) => edge.kind === "fk")?.source).toBe("table:todo_files");
    const untouched = edges.filter((edge) => edge.kind === "page-route");
    expect(untouched).toHaveLength(7);
    expect(untouched.every((edge) => edge.count === undefined)).toBe(true);
  });

  it("collapsing both ends bundles parallel crossings into one counted edge", () => {
    const view = buildProjectGraphView({ graph, clusters: enabled });
    const collapsed = new Set([cid("db"), cid("api/todos"), cid("api/auth"), cid("billing")]);
    const edges = collapseClusterEdges(view.edges, view.clusters, collapsed);
    const intoDb = edges.filter((edge) => edge.target === cid("db"));
    // One bundle per source feature plus the fk: 3 + 2 + 2 crossings and one relation.
    expect(intoDb).toHaveLength(4);
    expect(intoDb.find((edge) => edge.source === cid("api/todos"))?.count).toBe(3);
    expect(intoDb.find((edge) => edge.source === cid("api/auth"))?.count).toBe(2);
    expect(intoDb.find((edge) => edge.source === cid("billing"))?.count).toBe(2);
    // Every page-route edge became internal to a collapsed cluster: all dropped.
    expect(edges.some((edge) => edge.kind === "page-route")).toBe(false);
  });
});
