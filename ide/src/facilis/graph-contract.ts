// The contract lens's audit semantics (issue #69, epic #56): the ribbon's four counters, their
// filter toggles and the zoom threshold that compacts the card badges. Pure so the counts and
// filters are unit-testable without a browser. The lens renders facts ProjectGraphNodeData already
// holds plus the attached diagnostics — no new analysis rule lives here. Filtering is dimming only
// (like edge-kind isolation, issue #63): the view model never learns about it, so node positions
// cannot move (epic rule 2).

import type { Diagnostic, RouteInputFact } from "@facilis.dev/analyze";
import type { ProjectGraphNode, RouteGraphData } from "./graph-types";

/** The ribbon's four counters, in render order; also the canonical URL order. */
export const AUDIT_FILTER_IDS = ["protected", "missingInput", "unknown", "diagnostics"] as const;
export type AuditFilterId = (typeof AUDIT_FILTER_IDS)[number];

export interface AuditCounts {
  readonly protected: number;
  readonly missingInput: number;
  readonly unknown: number;
  /** Attached error+warning diagnostics summed over the scanned nodes (not the node count). */
  readonly diagnostics: number;
}

export interface NodeAuditFlags {
  readonly protected: boolean;
  readonly missingInput: boolean;
  readonly unknown: boolean;
  readonly diagnostics: boolean;
}

/**
 * A route counts as protected when its facts are readable, the wrapper is valid AND a permission
 * is required: an invalid or unreadable wrapper never counts as protection, an explicitly public
 * route is not protected, and an unknown route is never scored as protected — safety is not
 * asserted from partially unreadable facts (epic rule 5).
 */
export function isProtectedRoute(route: RouteGraphData): boolean {
  return !route.unknown && route.wrapper === "valid" && route.permission.length > 0;
}

export function routeInputPresent(input: RouteInputFact): boolean {
  return input.body || input.form || input.query || input.params;
}

/**
 * The per-node audit scan. An unknown route never counts as "missing input": its input facts are
 * unreadable, not absent — it belongs to the unknown counter instead. Pages carry no unknown flag
 * (the analyzer reads them whole), matching the stats.unknownNodes scan.
 */
export function nodeAuditFlags(
  node: ProjectGraphNode,
  diagnostics: readonly Diagnostic[],
): NodeAuditFlags {
  const data = node.data;
  return {
    protected: data.kind === "route" && isProtectedRoute(data),
    missingInput: data.kind === "route" && !data.unknown && !routeInputPresent(data.input),
    unknown: data.kind !== "page" && data.unknown,
    diagnostics: diagnostics.length > 0,
  };
}

/** The ribbon counters: one scan of the drawn nodes, so the counters always equal the graph. */
export function countAudit(
  nodes: readonly ProjectGraphNode[],
  diagnosticsByNode: ReadonlyMap<string, readonly Diagnostic[]>,
): AuditCounts {
  const counts = { protected: 0, missingInput: 0, unknown: 0, diagnostics: 0 };
  for (const node of nodes) {
    const diagnostics = diagnosticsByNode.get(node.id) ?? [];
    const flags = nodeAuditFlags(node, diagnostics);
    if (flags.protected) counts.protected += 1;
    if (flags.missingInput) counts.missingInput += 1;
    if (flags.unknown) counts.unknown += 1;
    counts.diagnostics += diagnostics.length;
  }
  return counts;
}

/** Toggle one counter in the filter set; the counters are independent (stats-ribbon semantics). */
export function toggleAuditFilter(
  filters: readonly AuditFilterId[],
  id: AuditFilterId,
): readonly AuditFilterId[] {
  return filters.includes(id) ? filters.filter((entry) => entry !== id) : [...filters, id];
}

export function auditFilterActive(filters: readonly AuditFilterId[], id: AuditFilterId): boolean {
  return filters.includes(id);
}

/**
 * Union semantics: a node stays bright when it matches ANY active counter; the empty set filters
 * nothing. Dimming only — the node is never removed, so positions and bounds stay put.
 */
export function nodeMatchesAudit(
  node: ProjectGraphNode,
  diagnostics: readonly Diagnostic[],
  filters: readonly AuditFilterId[],
): boolean {
  if (filters.length === 0) return true;
  const flags = nodeAuditFlags(node, diagnostics);
  return filters.some((id) => flags[id]);
}

/**
 * Below this zoom the contract badges compact to glyph+count (epic rule 4). The semantic-zoom
 * machinery (#60) is not on this branch, so the contract layer carries its own minimal threshold;
 * the rest of the card is untouched until #60 lands.
 */
export const CONTRACT_COMPACT_ZOOM = 0.55;

export function contractLod(zoom: number): "full" | "compact" {
  return zoom < CONTRACT_COMPACT_ZOOM ? "compact" : "full";
}
