// Index one graph dataset for the answer functions (issue #190). Domains come from the same
// pure derivation the map/lens canvas uses, so "shared across groups" means the same groups the
// overview shows; incoming/outgoing maps keep every question linear in the incident edges.

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import type { NodeDetails } from "../graph-details";
import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "../graph-types";
import { deriveDomains, domainIndex } from "./domains.ts";
import type { GraphAnswerContext } from "./answers-types";

export function createAnswerContext(
  view: ProjectGraphView,
  details: ReadonlyMap<string, NodeDetails>,
  diagnostics: readonly GraphDiagnostic[],
  groups: Readonly<Record<string, string>> = {},
): GraphAnswerContext {
  const byId = new Map(view.nodes.map((node) => [node.id, node] as const));
  const outgoing = new Map<string, ProjectGraphEdge[]>();
  const incoming = new Map<string, ProjectGraphEdge[]>();
  for (const edge of view.edges) {
    const from = outgoing.get(edge.source);
    if (from === undefined) outgoing.set(edge.source, [edge]);
    else from.push(edge);
    const to = incoming.get(edge.target);
    if (to === undefined) incoming.set(edge.target, [edge]);
    else to.push(edge);
  }
  return {
    view,
    details,
    diagnostics,
    byId,
    domainOf: domainIndex(deriveDomains(view.nodes, view.edges, groups)),
    outgoing,
    incoming,
  };
}

/** Nodes reached by an edge list, de-duplicated and sorted by label then id. */
export function edgeNodes(
  edges: readonly ProjectGraphEdge[] | undefined,
  ctx: GraphAnswerContext,
  end: "source" | "target",
): readonly ProjectGraphNode[] {
  if (edges === undefined) return [];
  const seen = new Set<string>();
  const nodes: ProjectGraphNode[] = [];
  for (const edge of edges) {
    const id = end === "source" ? edge.source : edge.target;
    if (seen.has(id)) continue;
    const node = ctx.byId.get(id);
    if (node === undefined) continue;
    seen.add(id);
    nodes.push(node);
  }
  return nodes.toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function edgeTargets(
  edges: readonly ProjectGraphEdge[] | undefined,
  ctx: GraphAnswerContext,
): readonly ProjectGraphNode[] {
  return edgeNodes(edges, ctx, "target");
}

export function edgeSources(
  edges: readonly ProjectGraphEdge[] | undefined,
  ctx: GraphAnswerContext,
): readonly ProjectGraphNode[] {
  return edgeNodes(edges, ctx, "source");
}

/** The relation name a table/view node declares in the SQL namespace, if it has one. */
export function relationNameOf(node: ProjectGraphNode): string | null {
  if (node.data.kind === "table") return node.data.table;
  if (node.data.kind === "view") return node.data.view;
  return null;
}

/** A route's HTTP method is the only read/write fact the analyzer carries per relation use. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function accessOfRoute(node: ProjectGraphNode): "read" | "write" | null {
  if (node.data.kind !== "route") return null;
  return WRITE_METHODS.has(node.data.method) ? "write" : "read";
}

export function mergeAccess(
  current: "read" | "write" | "read-write" | null,
  next: "read" | "write",
): "read" | "write" | "read-write" {
  if (current === null || current === next) return next;
  return "read-write";
}
