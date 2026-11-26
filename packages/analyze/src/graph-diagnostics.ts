// The graph's diagnostic fact set (D-220, issue #189): stable codes plus structured params,
// never prose. The IDE resolves each code through its own i18n catalogue (D-043/D-219), so the
// same facts render in every locale and a new language never touches the analyzer.
//
// The derivation is pure and deterministic: the same facts always produce the same diagnostics,
// sorted by node id and then code, so the IDE's lens answers and counts are stable across runs.

import type { GraphNode, HttpMethod, ProjectGraph, RouteFact, TableFact } from "./types.ts";
import { routeId, tableId } from "./graph-ids.ts";

/** Every stable diagnostic code the graph can emit. Never rename: the IDE maps them to i18n. */
export const GRAPH_DIAGNOSTIC_CODES = [
  "publicWrite",
  "publicAdmin",
  "tableNoRls",
  "elevated",
  "shared",
  "unknown",
] as const;

export type GraphDiagnosticCode = (typeof GRAPH_DIAGNOSTIC_CODES)[number];

/** The structured params each code carries; the IDE interpolates them, never the analyzer. */
export interface GraphDiagnosticParamMap {
  readonly publicWrite: { readonly method: HttpMethod };
  readonly publicAdmin: Record<string, never>;
  readonly tableNoRls: { readonly table: string };
  readonly elevated: Record<string, never>;
  readonly shared: { readonly count: number; readonly domains: readonly string[] };
  readonly unknown: Record<string, never>;
}

/** One diagnostic about one graph node, as a code plus its params. */
export type GraphDiagnostic = {
  readonly [Code in GraphDiagnosticCode]: {
    readonly nodeId: string;
    readonly code: Code;
    readonly params: GraphDiagnosticParamMap[Code];
  };
}[GraphDiagnosticCode];

export interface GraphDiagnosticsInput {
  readonly graph: ProjectGraph;
  readonly routes: readonly RouteFact[];
  readonly tables: readonly TableFact[];
}

const WRITE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CORE_DOMAIN = "core";
const FRAMEWORK_DOMAIN = "framework";
/** Edge kinds that make one domain reference a node owned by another. */
const REFERENCE_KINDS: ReadonlySet<string> = new Set([
  "route-table",
  "route-view",
  "page-route",
  "page-link",
  "view-base",
  "fk",
  "relation",
]);

function isPublic(route: RouteFact): boolean {
  return route.permission !== null && route.permission.length === 0;
}

function exposesAdmin(path: string): boolean {
  return path.split("/").includes("admin");
}

function isFrameworkSource(file: string): boolean {
  return file.replaceAll("\\", "/").startsWith("node_modules/");
}

function firstPathSegment(path: string): string | null {
  for (const segment of path.split("/")) if (segment.length > 0) return segment;
  return null;
}

/** The directory segment right under a marker ("src/pages/admin/x.tsx" -> "admin"). */
function segmentUnder(sourceFile: string | null, marker: string): string | null {
  if (sourceFile === null) return null;
  const normalized = sourceFile.replaceAll("\\", "/");
  const at = normalized.indexOf(marker);
  if (at < 0) return null;
  const rest = normalized.slice(at + marker.length);
  if (!rest.includes("/")) return null;
  const segment = rest.slice(0, rest.indexOf("/"));
  return segment.length > 0 ? segment : null;
}

/** The group with the most incoming references; ties break lexicographically (stable). */
function referencedGroup(
  nodeId: string,
  graph: ProjectGraph,
  groupOf: ReadonlyMap<string, string>,
): string {
  const tally = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.target !== nodeId || !REFERENCE_KINDS.has(edge.kind)) continue;
    const group = groupOf.get(edge.source);
    if (group !== undefined) tally.set(group, (tally.get(group) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [group, count] of [...tally.entries()].toSorted((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best ?? CORE_DOMAIN;
}

/** Mirror the surface's domain rules so a shared node is judged against the groups users see. */
function domainGroups(graph: ProjectGraph): ReadonlyMap<string, string> {
  const groupOf = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind === "page") {
      groupOf.set(node.id, segmentUnder(node.sourceFile, "src/pages/") ?? CORE_DOMAIN);
    } else if (node.kind === "route") {
      const fromFile = segmentUnder(node.sourceFile, "server/routes/");
      const fromPath = node.data.kind === "route" ? firstPathSegment(node.data.path) : null;
      groupOf.set(node.id, fromFile ?? fromPath ?? CORE_DOMAIN);
    }
  }
  for (const node of graph.nodes) {
    if (node.kind === "page" || node.kind === "route") continue;
    if (node.kind === "table" && node.data.kind === "table" && node.data.framework) {
      groupOf.set(node.id, FRAMEWORK_DOMAIN);
      continue;
    }
    groupOf.set(node.id, referencedGroup(node.id, graph, groupOf));
  }
  return groupOf;
}

/**
 * Cross-group coupling, like the validated preview: a node counts the distinct domains of its
 * neighbours on either side of an edge, never its own group. Two or more other groups means a
 * change here ripples across the project.
 */
function sharedDiagnostics(graph: ProjectGraph): GraphDiagnostic[] {
  const groupOf = domainGroups(graph);
  const neighbors = new Map<string, Set<string>>();
  const link = (id: string, other: string): void => {
    const groups = neighbors.get(id) ?? new Set<string>();
    groups.add(other);
    neighbors.set(id, groups);
  };
  for (const edge of graph.edges) {
    if (!REFERENCE_KINDS.has(edge.kind)) continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  const diagnostics: GraphDiagnostic[] = [];
  for (const [nodeId, adjacent] of neighbors) {
    const own = groupOf.get(nodeId);
    const domains = new Set<string>();
    for (const otherId of adjacent) {
      const other = groupOf.get(otherId);
      if (other !== undefined && other !== own) domains.add(other);
    }
    if (domains.size < 2) continue;
    const sorted = [...domains].toSorted();
    diagnostics.push({
      nodeId,
      code: "shared",
      params: { count: sorted.length, domains: sorted },
    });
  }
  return diagnostics;
}

function hasUnknown(node: GraphNode): boolean {
  return node.data.kind !== "page" && node.data.unknown;
}

function compareDiagnostics(left: GraphDiagnostic, right: GraphDiagnostic): number {
  if (left.nodeId !== right.nodeId) return left.nodeId < right.nodeId ? -1 : 1;
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

/**
 * Derive every graph diagnostic from the analyzed facts. Route and table facts are read directly
 * because the graph node data normalizes an unreadable permission to [] (unknown, not public) and
 * hides a table's source file; the graph itself supplies the shared/unknown node facts.
 */
export function buildGraphDiagnostics({
  graph,
  routes,
  tables,
}: GraphDiagnosticsInput): readonly GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  for (const route of routes) {
    const nodeId = routeId(route);
    if (isPublic(route)) {
      if (WRITE_METHODS.has(route.method)) {
        diagnostics.push({ nodeId, code: "publicWrite", params: { method: route.method } });
      }
      if (exposesAdmin(route.path)) {
        diagnostics.push({ nodeId, code: "publicAdmin", params: {} });
      }
    }
    if (route.elevations.length > 0) {
      diagnostics.push({ nodeId, code: "elevated", params: {} });
    }
  }
  for (const table of tables) {
    if (isFrameworkSource(table.source.file) || table.rlsEnabled) continue;
    diagnostics.push({
      nodeId: tableId(table.name),
      code: "tableNoRls",
      params: { table: table.name },
    });
  }
  diagnostics.push(...sharedDiagnostics(graph));
  for (const node of graph.nodes) {
    if (hasUnknown(node)) diagnostics.push({ nodeId: node.id, code: "unknown", params: {} });
  }
  return diagnostics.toSorted(compareDiagnostics);
}
