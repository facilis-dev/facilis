// The project graph's node ids (D-092): one spelling shared by the node builder in graph.ts
// and the edge builder in graph-edges.ts, so an edge endpoint can never drift from its node.
import type { RouteFact } from "./types.ts";

const NODE_PREFIX = { page: "page:", route: "route:", table: "table:", view: "view:" } as const;

export function tableId(name: string): string {
  return NODE_PREFIX.table + name;
}

export function viewId(name: string): string {
  return NODE_PREFIX.view + name;
}

export function routeId(route: RouteFact): string {
  return NODE_PREFIX.route + route.method + " " + route.path;
}

export function pageId(path: string): string {
  return NODE_PREFIX.page + path;
}
