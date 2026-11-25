// Domain derivation for the map-and-lens graph surface (D-211, issue #184): a deterministic
// grouping of the analyzer-backed view model, from facts only. Pages and routes are grouped by
// their file location; tables, views and workflows join the group that references them most.
// Pure: no React, no IO, so the same graph always produces the same domains.

import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";

/** One domain of the overview: a name and the ids of the nodes that belong to it. */
export interface GraphDomain {
  readonly name: string;
  readonly nodeIds: readonly string[];
}

/** The fallback group for nodes no rule places elsewhere. */
export const CORE_DOMAIN = "core";
/** Framework tables (data.framework) always form their own group. */
export const FRAMEWORK_DOMAIN = "framework";

/** Edge kinds that carry a reference from a page/route to another node. */
const REFERENCE_KINDS: ReadonlySet<string> = new Set(["route-table", "route-view", "page-route"]);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first non-empty segment of a URL path ("/admin/users" -> "admin"). */
function firstPathSegment(path: string): string | null {
  for (const segment of path.split("/")) {
    if (segment.length > 0) return segment;
  }
  return null;
}

/**
 * The directory segment right under a marker directory ("src/pages/admin/x.tsx" -> "admin").
 * A file directly in the marker directory has no segment and yields null.
 */
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

function pageGroup(node: ProjectGraphNode): string {
  return segmentUnder(node.sourceFile, "src/pages/") ?? CORE_DOMAIN;
}

function routeGroup(node: ProjectGraphNode): string {
  const fromFile = segmentUnder(node.sourceFile, "server/routes/");
  if (fromFile !== null) return fromFile;
  if (node.data.kind === "route") {
    const fromPath = firstPathSegment(node.data.path);
    if (fromPath !== null) return fromPath;
  }
  return CORE_DOMAIN;
}

/**
 * The group with the most incoming references from pages/routes; ties break lexicographically
 * so the assignment never depends on edge order. No references means the core group.
 */
function referencedGroup(
  nodeId: string,
  edges: readonly ProjectGraphEdge[],
  groupOf: ReadonlyMap<string, string>,
): string {
  const tally = new Map<string, number>();
  for (const edge of edges) {
    if (edge.target !== nodeId || !REFERENCE_KINDS.has(edge.kind)) continue;
    const group = groupOf.get(edge.source);
    if (group === undefined) continue;
    tally.set(group, (tally.get(group) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [group, count] of [...tally.entries()].toSorted((a, b) => compareText(a[0], b[0]))) {
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best ?? CORE_DOMAIN;
}

/**
 * Derive the domains of a graph: pages by their directory under src/pages, routes by their
 * directory under server/routes (else the first path segment), schema objects and workflows by
 * their strongest referencing group, framework tables in "framework". Domains come back sorted
 * by name, each with its member ids sorted, so the overview grid is stable across runs.
 */
export function deriveDomains(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): readonly GraphDomain[] {
  const groupOf = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "page") groupOf.set(node.id, pageGroup(node));
    else if (node.kind === "route") groupOf.set(node.id, routeGroup(node));
  }
  for (const node of nodes) {
    if (node.kind === "page" || node.kind === "route") continue;
    if (node.kind === "table" && node.data.kind === "table" && node.data.framework) {
      groupOf.set(node.id, FRAMEWORK_DOMAIN);
      continue;
    }
    groupOf.set(node.id, referencedGroup(node.id, edges, groupOf));
  }
  const members = new Map<string, string[]>();
  for (const node of nodes) {
    const group = groupOf.get(node.id) ?? CORE_DOMAIN;
    const list = members.get(group);
    if (list === undefined) members.set(group, [node.id]);
    else list.push(node.id);
  }
  return [...members.entries()]
    .toSorted((a, b) => compareText(a[0], b[0]))
    .map(([name, nodeIds]) => ({ name, nodeIds: nodeIds.toSorted(compareText) }));
}

/** Node id -> domain name, for the layout and the cross-domain port grouping. */
export function domainIndex(domains: readonly GraphDomain[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const domain of domains) {
    for (const id of domain.nodeIds) index.set(id, domain.name);
  }
  return index;
}
