// The API Flow's pure view model (SPEC §10.2, §12 Phase 3; D-087): the OpenAPI
// operations, the tables their `x-db-*` metadata touches, and the client files that
// consume them, laid out as three deterministic columns — pages → routes → tables.
//
// Free of React and fetch so the grouping/layout rules stay testable; the node sizes
// are exported so a test can prove node rectangles never overlap in a column.

import type { ApiFlowData, ApiFlowWarning, ApiMethod, ApiOperation } from "./api-flow-client";
import type { ApiConsumerRef, ApiFlowConsumers } from "./api-flow-consumers";
import {
  collectEdges,
  collectTableUsage,
  compareStrings,
  routeNodeId,
  tableNodeId,
  tablesFor,
} from "./api-flow-tables";

/** Badge/legend order for the per-method counts. */
export const METHOD_ORDER: readonly ApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Fixed node sizes (px) — the layout stacks rows by these, never by measured heights. */
export const FLOW_NODE_SIZE = {
  page: { width: 240, height: 56 },
  route: { width: 280, height: 96 },
  table: { width: 180, height: 56 },
} as const;

const COLUMN_GAP = 90;
const ROW_GAP = 16;
const LANE_GAP = 40;
const MAX_PER_LANE = 6;
const ROUTE_X = FLOW_NODE_SIZE.page.width + COLUMN_GAP;
const ROOT_RESOURCE = "root";

/** The data a route node carries; a type alias so it satisfies React Flow's data bound. */
export type RouteNodeData = {
  method: ApiMethod;
  path: string;
  /** First segment after `/api`, or `root` for an ungrouped route. */
  resource: string;
  summary: string | null;
  permission: string[];
  /** Distinct tables the route declares through `x-db-tables`/`x-db-columns`. */
  tableCount: number;
  sourceFile: string | null;
  /** Client files that reach this route (directly or through one import hop). */
  consumers: readonly ApiConsumerRef[];
  /** No client file references this route (the scan is textual, so it is a hint). */
  unused: boolean;
};

/** The data a table node carries. */
export type TableNodeData = {
  name: string;
  columnCount: number;
  routeCount: number;
};

/** The data a page node carries (one client file that uses at least one route). */
export type PageNodeData = {
  path: string;
  kind: ApiConsumerRef["kind"];
  /** The module the page reaches the URL through, when the reference is indirect. */
  via: string | null;
  routeCount: number;
};

export interface ApiRouteNode {
  id: string;
  data: RouteNodeData;
  position: { x: number; y: number };
}

export interface ApiTableNode {
  id: string;
  data: TableNodeData;
  position: { x: number; y: number };
}

export interface ApiPageNode {
  id: string;
  data: PageNodeData;
  position: { x: number; y: number };
}

export interface ApiFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Page→route reached through an import (indirect), or column-only route→table link. */
  dashed: boolean;
}

export interface ApiFlowStats {
  routes: number;
  tables: number;
  pages: number;
  edges: number;
  byMethod: Record<ApiMethod, number>;
}

/** What the inspector currently shows (node ids, not node objects: the graph is rebuilt on refresh). */
export type ApiFlowSelection =
  | { readonly kind: "page"; readonly id: string }
  | { readonly kind: "route"; readonly id: string }
  | { readonly kind: "table"; readonly id: string };

export interface ApiFlowGraph {
  pages: ApiPageNode[];
  routes: ApiRouteNode[];
  tables: ApiTableNode[];
  edges: ApiFlowEdge[];
  stats: ApiFlowStats;
  warnings: ApiFlowWarning[];
  /** The facade answered 200 with an `openapi-unavailable` warning (SPEC §6.9). */
  openapiUnavailable: boolean;
}

/** Build the panel's graph: pages, routes grouped by resource, tables, edges and counts. */
export function buildApiFlowGraph(
  data: ApiFlowData,
  consumers: ApiFlowConsumers | null = null,
): ApiFlowGraph {
  const operations = [...data.operations].toSorted(compareOperations);
  const consumersByRoute = consumers?.byRoute ?? {};
  const { pages, links } = buildPages(operations, consumersByRoute);
  const unused = new Set(consumers?.unusedRoutes ?? []);

  const lanes = laneCount(operations);
  const laneOf = assignLanes(operations, lanes);
  const laneRows = Array.from({ length: lanes }, () => 0);
  const routes = operations.map((operation) => {
    const resource = resourceOf(operation.path);
    const lane = laneOf.get(resource) ?? 0;
    const row = laneRows[lane] ?? 0;
    laneRows[lane] = row + 1;
    const y = row * (FLOW_NODE_SIZE.route.height + ROW_GAP);
    const x = ROUTE_X + lane * (FLOW_NODE_SIZE.route.width + LANE_GAP);
    const id = routeNodeId(operation);
    return {
      id,
      data: {
        method: operation.method,
        path: operation.path,
        resource,
        summary: operation.summary,
        permission: operation.permission,
        tableCount: tablesFor(operation).length,
        sourceFile: operation.sourceFile,
        consumers: consumersByRoute[id] ?? [],
        unused: unused.has(id),
      },
      position: { x, y },
    } satisfies ApiRouteNode;
  });

  const tableX = ROUTE_X + lanes * (FLOW_NODE_SIZE.route.width + LANE_GAP) - LANE_GAP + COLUMN_GAP;
  const usage = collectTableUsage(operations);
  const tables = [...usage.keys()].toSorted(compareStrings).map((name, index) => {
    const entry = usage.get(name);
    return {
      id: tableNodeId(name),
      data: {
        name,
        columnCount: entry?.columns.size ?? 0,
        routeCount: entry?.routes.size ?? 0,
      },
      position: { x: tableX, y: index * (FLOW_NODE_SIZE.table.height + ROW_GAP) },
    } satisfies ApiTableNode;
  });

  const edges = [...collectConsumerEdges(links), ...collectEdges(operations)];
  const byMethod: Record<ApiMethod, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
  for (const operation of operations) byMethod[operation.method] += 1;

  return {
    pages,
    routes,
    tables,
    edges,
    warnings: data.warnings,
    stats: {
      routes: routes.length,
      tables: tables.length,
      pages: pages.length,
      edges: edges.length,
      byMethod,
    },
    openapiUnavailable: data.warnings.some((warning) => warning.code === "openapi-unavailable"),
  };
}

// ── pages (the client side) ─────────────────────────────────────────────────────────

interface PageLink {
  pageId: string;
  routeId: string;
  dashed: boolean;
}

function buildPages(
  operations: readonly ApiOperation[],
  consumersByRoute: Readonly<Record<string, readonly ApiConsumerRef[]>>,
): { pages: ApiPageNode[]; links: PageLink[] } {
  const known = new Set(operations.map(routeNodeId));
  const byPath = new Map<string, { ref: ApiConsumerRef; routes: Set<string> }>();
  const links: PageLink[] = [];
  const seenLinks = new Set<string>();
  for (const [routeId, refs] of Object.entries(consumersByRoute)) {
    if (!known.has(routeId)) continue;
    for (const ref of refs) {
      const entry = byPath.get(ref.path);
      if (entry === undefined) {
        byPath.set(ref.path, { ref, routes: new Set([routeId]) });
      } else {
        entry.routes.add(routeId);
        if (entry.ref.via === null && ref.via !== null) entry.ref = ref;
      }
      const link = pageNodeId(ref.path) + "->" + routeId;
      if (seenLinks.has(link)) continue;
      seenLinks.add(link);
      links.push({ pageId: pageNodeId(ref.path), routeId, dashed: ref.via !== null });
    }
  }
  const ordered = [...byPath.entries()].toSorted((left, right) => {
    const byKind = kindOrder(left[1].ref.kind) - kindOrder(right[1].ref.kind);
    return byKind !== 0 ? byKind : compareStrings(left[0], right[0]);
  });
  const pages = ordered.map(([path, entry], index) => ({
    id: pageNodeId(path),
    data: { path, kind: entry.ref.kind, via: entry.ref.via, routeCount: entry.routes.size },
    position: { x: 0, y: index * (FLOW_NODE_SIZE.page.height + ROW_GAP) },
  }));
  return { pages, links };
}

function laneCount(operations: readonly ApiOperation[]): number {
  if (operations.length <= 12) return 1;
  return Math.min(4, Math.max(2, Math.ceil(operations.length / MAX_PER_LANE)));
}

/** Distribute the resources over the lanes, greedily keeping the lanes the same height. */
function assignLanes(operations: readonly ApiOperation[], lanes: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const resource = resourceOf(operation.path);
    counts.set(resource, (counts.get(resource) ?? 0) + 1);
  }
  const load = Array.from({ length: lanes }, () => 0);
  const laneOf = new Map<string, number>();
  for (const resource of [...counts.keys()].toSorted(compareResources)) {
    let best = 0;
    for (let lane = 1; lane < lanes; lane += 1) {
      if ((load[lane] ?? 0) < (load[best] ?? 0)) best = lane;
    }
    laneOf.set(resource, best);
    load[best] = (load[best] ?? 0) + (counts.get(resource) ?? 0);
  }
  return laneOf;
}

function kindOrder(kind: ApiConsumerRef["kind"]): number {
  return kind === "page" ? 0 : kind === "component" ? 1 : kind === "lib" ? 2 : 3;
}

function collectConsumerEdges(links: readonly PageLink[]): ApiFlowEdge[] {
  return links.map((link) => ({
    id: "edge:" + link.pageId + "->" + link.routeId,
    source: link.pageId,
    target: link.routeId,
    dashed: link.dashed,
  }));
}

// ── ids ────────────────────────────────────────────────────────────────────────────

function pageNodeId(path: string): string {
  return "page:" + path;
}

function resourceOf(path: string): string {
  const match = /^\/api(?=\/|$)(?:\/([^/]+))?/.exec(path);
  return match?.[1] ?? ROOT_RESOURCE;
}

function compareResources(left: string, right: string): number {
  if (left === ROOT_RESOURCE) return right === ROOT_RESOURCE ? 0 : -1;
  if (right === ROOT_RESOURCE) return 1;
  return compareStrings(left, right);
}

function compareOperations(left: ApiOperation, right: ApiOperation): number {
  const byResource = compareResources(resourceOf(left.path), resourceOf(right.path));
  if (byResource !== 0) return byResource;
  const byPath = compareStrings(left.path, right.path);
  if (byPath !== 0) return byPath;
  return METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method);
}
