// Domain derivation for the map-and-lens graph surface (D-211, issue #184): a deterministic
// grouping of the analyzer-backed view model, from facts only. The group key is the feature the
// user names (auth, todos, billing, ...): routes take it from their URL path, pages join the
// feature of the routes they call, and tables/views/workflows join the strongest referrer. A
// feature group therefore spans lanes (pages + routes + data) instead of being one category.
// A per-node override wins over every rule, and every assignment reports WHY it landed there so
// the inspector can show the rule instead of a bare name.
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

/** Why a node landed in its group; the inspector renders this so the rule is visible. */
export type DomainReason =
  | "override"
  | "route-path"
  | "route-file"
  | "page-calls"
  | "page-directory"
  | "page-path"
  | "reference"
  | "framework"
  | "core";

export interface DomainAssignment {
  readonly group: string;
  readonly reason: DomainReason;
  /** The fact behind the rule (route path, page path, source file); null when generic. */
  readonly evidence: string | null;
}

/** Edge kinds that carry a reference from a page/route to another node. */
const REFERENCE_KINDS: ReadonlySet<string> = new Set(["route-table", "route-view", "page-route"]);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The feature segment of a URL path: the first non-empty segment, skipping the technical `api`
 * prefix ("/api/auth/login" -> "auth", "/admin/users" -> "admin").
 */
function featureSegment(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first === undefined) return null;
  if (first === "api") return segments[1] ?? null;
  return first;
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

function routeAssignment(node: ProjectGraphNode): DomainAssignment {
  if (node.data.kind === "route") {
    const fromPath = featureSegment(node.data.path);
    if (fromPath !== null)
      return { group: fromPath, reason: "route-path", evidence: node.data.path };
  }
  const fromFile = segmentUnder(node.sourceFile, "server/routes/");
  if (fromFile !== null && fromFile !== "api") {
    return { group: fromFile, reason: "route-file", evidence: node.sourceFile };
  }
  return { group: CORE_DOMAIN, reason: "core", evidence: null };
}

/** The strongest group among a page's outgoing `page-route` calls (feature-first). */
function calledAssignment(
  nodeId: string,
  edges: readonly ProjectGraphEdge[],
  assignments: ReadonlyMap<string, DomainAssignment>,
  routePaths: ReadonlyMap<string, string>,
): DomainAssignment | null {
  const tally = new Map<string, { count: number; evidence: string | null }>();
  for (const edge of edges) {
    if (edge.source !== nodeId || edge.kind !== "page-route") continue;
    const target = assignments.get(edge.target);
    if (target === undefined) continue;
    const current = tally.get(target.group) ?? { count: 0, evidence: null };
    current.count += 1;
    const path = routePaths.get(edge.target) ?? null;
    if (path !== null && (current.evidence === null || compareText(path, current.evidence) < 0)) {
      current.evidence = path;
    }
    tally.set(target.group, current);
  }
  let best: string | null = null;
  let bestCount = 0;
  let evidence: string | null = null;
  for (const [group, entry] of [...tally.entries()].toSorted((a, b) => compareText(a[0], b[0]))) {
    if (entry.count > bestCount) {
      best = group;
      bestCount = entry.count;
      evidence = entry.evidence;
    }
  }
  return best === null ? null : { group: best, reason: "page-calls", evidence };
}

/**
 * A page joins the feature of the routes it calls, so `login`/`register` land in `auth` rather
 * than in `core` just because they sit flat under src/pages. Without calls, its directory (or
 * page path) still names the feature.
 */
function pageAssignment(
  node: ProjectGraphNode,
  edges: readonly ProjectGraphEdge[],
  assignments: ReadonlyMap<string, DomainAssignment>,
  routePaths: ReadonlyMap<string, string>,
): DomainAssignment {
  const called = calledAssignment(node.id, edges, assignments, routePaths);
  if (called !== null) return called;
  const fromDirectory = segmentUnder(node.sourceFile, "src/pages/");
  if (fromDirectory !== null) {
    return { group: fromDirectory, reason: "page-directory", evidence: node.sourceFile };
  }
  if (node.data.kind === "page") {
    const fromPath = featureSegment(node.data.pagePath);
    if (fromPath !== null) {
      return { group: fromPath, reason: "page-path", evidence: node.data.pagePath };
    }
  }
  return { group: CORE_DOMAIN, reason: "core", evidence: null };
}

function referenceAssignment(
  nodeId: string,
  edges: readonly ProjectGraphEdge[],
  assignments: ReadonlyMap<string, DomainAssignment>,
): DomainAssignment {
  const tally = new Map<string, number>();
  for (const edge of edges) {
    if (edge.target !== nodeId || !REFERENCE_KINDS.has(edge.kind)) continue;
    const group = assignments.get(edge.source)?.group;
    if (group === undefined) continue;
    tally.set(group, (tally.get(group) ?? 0) + 1);
  }
  const group = strongest(tally);
  return group === null
    ? { group: CORE_DOMAIN, reason: "core", evidence: null }
    : { group, reason: "reference", evidence: null };
}

/** The highest tally, ties broken lexicographically so edge order never matters. */
function strongest(tally: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [group, count] of [...tally.entries()].toSorted((a, b) => compareText(a[0], b[0]))) {
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

function overrideOf(overrides: Readonly<Record<string, string>>, id: string): string | null {
  const value = overrides[id];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Every node's group and the rule behind it, with user overrides applied first. This is the one
 * derivation: deriveDomains builds the overview/detail groups from it and the inspector shows it.
 */
export function deriveDomainAssignments(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
  overrides: Readonly<Record<string, string>> = {},
): ReadonlyMap<string, DomainAssignment> {
  const assignments = new Map<string, DomainAssignment>();
  const routePaths = new Map<string, string>();
  // Routes first: pages and schema objects both resolve their feature against this map.
  for (const node of nodes) {
    if (node.kind !== "route") continue;
    if (node.data.kind === "route") routePaths.set(node.id, node.data.path);
    const override = overrideOf(overrides, node.id);
    assignments.set(
      node.id,
      override === null
        ? routeAssignment(node)
        : { group: override, reason: "override", evidence: null },
    );
  }
  for (const node of nodes) {
    if (node.kind !== "page") continue;
    const override = overrideOf(overrides, node.id);
    assignments.set(
      node.id,
      override === null
        ? pageAssignment(node, edges, assignments, routePaths)
        : { group: override, reason: "override", evidence: null },
    );
  }
  for (const node of nodes) {
    if (node.kind === "page" || node.kind === "route") continue;
    const override = overrideOf(overrides, node.id);
    if (override !== null) {
      assignments.set(node.id, { group: override, reason: "override", evidence: null });
    } else if (node.kind === "table" && node.data.kind === "table" && node.data.framework) {
      assignments.set(node.id, { group: FRAMEWORK_DOMAIN, reason: "framework", evidence: null });
    } else {
      assignments.set(node.id, referenceAssignment(node.id, edges, assignments));
    }
  }
  return assignments;
}

/**
 * The overview/detail groups: assignments collapsed by group name. Domains come back sorted by
 * name, each with its member ids sorted, so the grid is stable across runs.
 */
export function deriveDomains(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
  overrides: Readonly<Record<string, string>> = {},
): readonly GraphDomain[] {
  const assignments = deriveDomainAssignments(nodes, edges, overrides);
  const members = new Map<string, string[]>();
  for (const node of nodes) {
    const group = assignments.get(node.id)?.group ?? CORE_DOMAIN;
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
