// Layout fixtures for issue #61: an example project shaped like the todo app the IDE smoke
// boots (pages, routes, schema, workflows with the edge kinds between them) and a synthetic
// 60-route/20-table project for the layout benchmark. Not a test module (the name does not
// match Vitest's test glob), and not imported by the app.

import type { GraphEdge, GraphNode, ProjectGraph } from "@facilis.dev/analyze";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
  workflowNode,
} from "./graph-model.test-fixtures";

const EXAMPLE_PAGES = [
  "src/pages/index.tsx",
  "src/pages/todos.tsx",
  "src/pages/projects.tsx",
  "src/pages/settings.tsx",
];

const EXAMPLE_ROUTES: readonly { path: string; tables: readonly string[]; page: number }[] = [
  { path: "/api/todos", tables: ["todos"], page: 1 },
  { path: "/api/todos/{id}", tables: ["todos"], page: 1 },
  { path: "/api/projects", tables: ["projects"], page: 2 },
  { path: "/api/projects/{id}", tables: ["projects"], page: 2 },
  { path: "/api/comments", tables: ["comments", "todos"], page: 1 },
  { path: "/api/comments/{id}", tables: ["comments"], page: 1 },
  { path: "/api/tags", tables: ["tags", "todo_tags"], page: 1 },
  { path: "/api/users", tables: ["users"], page: 3 },
  { path: "/api/users/{id}", tables: ["users"], page: 3 },
  { path: "/api/auth/login", tables: ["users", "sessions"], page: 0 },
  { path: "/api/auth/me", tables: ["users"], page: 0 },
  { path: "/api/stats", tables: ["projects", "todos"], page: 2 },
];

const EXAMPLE_FKS: readonly [string, string][] = [
  ["todos", "projects"],
  ["comments", "todos"],
  ["comments", "users"],
  ["todo_tags", "todos"],
  ["todo_tags", "tags"],
  ["sessions", "users"],
  ["tasks", "projects"],
];

/** The example project: 4 pages, 24 routes, 8 tables, 2 views, 2 workflows. */
export function exampleProjectGraph(): ProjectGraph {
  const pages = EXAMPLE_PAGES.map((path) => pageNode(path, 2));
  const routes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  EXAMPLE_ROUTES.forEach((route, index) => {
    for (const method of ["GET", "POST"] as const) {
      const node = routeNode(method, route.path, { dbTables: route.tables });
      routes.push(node);
      edges.push({
        id: "page-route:" + index + ":" + method,
        kind: "page-route",
        source: pages[route.page].id,
        target: node.id,
        label: null,
      });
      for (const table of route.tables) {
        edges.push({
          id: "route-table:" + node.id + ":" + table,
          kind: "route-table",
          source: node.id,
          target: "table:" + table,
          label: null,
        });
      }
    }
  });
  const tables = [
    "todos",
    "projects",
    "comments",
    "tags",
    "todo_tags",
    "users",
    "sessions",
    "tasks",
  ].map((name) => tableNode(name));
  const views = [
    viewNode("active_todos", { tables: ["todos", "projects"] }),
    viewNode("project_stats", { tables: ["projects", "todos"] }),
  ];
  const workflows = [workflowNode("purge"), workflowNode("onboard")];
  EXAMPLE_FKS.forEach(([from, to], index) => {
    edges.push({
      id: "fk:" + index,
      kind: "fk",
      source: "table:" + from,
      target: "table:" + to,
      label: null,
    });
  });
  for (const view of views) {
    if (view.data.kind !== "view") continue;
    for (const table of view.data.tables) {
      edges.push({
        id: "view-base:" + view.id + ":" + table,
        kind: "view-base",
        source: view.id,
        target: "table:" + table,
        label: null,
      });
    }
  }
  edges.push(
    {
      id: "route-view:1",
      kind: "route-view",
      source: "route:GET /api/todos",
      target: "view:active_todos",
      label: null,
    },
    {
      id: "route-view:2",
      kind: "route-view",
      source: "route:GET /api/stats",
      target: "view:project_stats",
      label: null,
    },
    { id: "page-link:1", kind: "page-link", source: pages[0].id, target: pages[1].id, label: null },
    { id: "page-link:2", kind: "page-link", source: pages[0].id, target: pages[2].id, label: null },
  );
  return graphOf([...pages, ...routes, ...tables, ...views, ...workflows], edges);
}

/** The benchmark project: 60 routes over 20 tables, plus pages, views and workflows. */
export function largeProjectGraph(): ProjectGraph {
  const pages = [0, 1, 2, 3].map((index) => pageNode("src/pages/p" + index + ".tsx", 1));
  const tables = Array.from({ length: 20 }, (_unused, index) =>
    tableNode("t" + String(index).padStart(2, "0")),
  );
  const routes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let index = 0; index < 30; index += 1) {
    const path = "/api/r" + String(index).padStart(2, "0");
    for (const method of ["GET", "POST"] as const) {
      const node = routeNode(method, path, {
        dbTables: ["t" + String(index % 20).padStart(2, "0")],
      });
      routes.push(node);
      edges.push({
        id: "page-route:" + node.id,
        kind: "page-route",
        source: pages[index % 4].id,
        target: node.id,
        label: null,
      });
      edges.push({
        id: "route-table:" + node.id,
        kind: "route-table",
        source: node.id,
        target: "table:t" + String(index % 20).padStart(2, "0"),
        label: null,
      });
    }
  }
  for (let index = 0; index + 1 < 20; index += 1) {
    edges.push({
      id: "fk:" + index,
      kind: "fk",
      source: "table:t" + String(index).padStart(2, "0"),
      target: "table:t" + String(index + 1).padStart(2, "0"),
      label: null,
    });
  }
  const views = [viewNode("v0"), viewNode("v1"), viewNode("v2")];
  const workflows = [workflowNode("w0"), workflowNode("w1")];
  return graphOf([...pages, ...routes, ...tables, ...views, ...workflows], edges);
}
