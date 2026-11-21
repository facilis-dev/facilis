// The data lens's semantics (issue #70, epic #56): the ribbon's three counters, the table
// scope classification and the FK-neighbourhood closure a table selection highlights. Pure so
// the counts and the highlight are unit-testable without a browser. The lens renders facts
// ProjectGraphNodeData already holds — no new analysis rule lives here. Like the contract lens
// (#69) and edge-kind isolation (#63), every effect is opacity, badges or stroke: the view model
// never learns about the lens, so node positions cannot move (epic rule 2).

import {
  reachabilityClosure,
  type GraphReachability,
  type ReachabilityInput,
} from "./graph-reachability";
import type { ProjectGraphEdge, ProjectGraphNode, TableGraphData } from "./graph-types";

/**
 * The ribbon's three counters, in render order. They scan the VISIBLE view (hidden kinds and
 * filters already applied by graph-model.ts), so they always equal what the canvas draws —
 * the same contract as stats.elevatedEdges, which uses the identical edge predicate.
 */
export interface DataCounts {
  /** Readable tables with no tenant/owner scope column. */
  readonly unscopedTables: number;
  /** Views whose readable access mode is definer (a declared permission bypasses invoker RLS). */
  readonly definerViews: number;
  /** Edges reached through audited elevation; equals stats.elevatedEdges by construction. */
  readonly elevatedEdges: number;
}

/**
 * One scan of the drawn nodes and edges. An unknown table never counts as "no scope": its
 * scope fact is unreadable, not absent (epic rule 5) — it belongs to the unknown badge instead.
 * A definer view counts on its positive access fact alone: access === null is the unreadable
 * mode and is never scored as definer.
 */
export function countDataLens(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): DataCounts {
  const counts = { unscopedTables: 0, definerViews: 0, elevatedEdges: 0 };
  for (const node of nodes) {
    const data = node.data;
    if (data.kind === "table" && !data.unknown && data.scope === null) counts.unscopedTables += 1;
    if (data.kind === "view" && data.access === "definer") counts.definerViews += 1;
  }
  for (const edge of edges) {
    if (edge.access === "elevated") counts.elevatedEdges += 1;
  }
  return counts;
}

/** The scope badge's four states; unknown is first-class, never a silent "none" (epic rule 5). */
export type TableScopeState = "tenant" | "owner" | "none" | "unknown";

export function tableScopeState(table: TableGraphData): TableScopeState {
  if (table.unknown) return "unknown";
  return table.scope === null ? "none" : table.scope.kind;
}

/**
 * The FK neighbourhood of a table selection: the reachability closure (#66) over ONLY the
 * fk/relation edges. Restricting the input before the call reuses the module unchanged — its
 * walks already treat fk/relation as undirected (D-171), so the neighbourhood is the whole
 * schema mesh the table belongs to, cycle-safe and sorted. A ghost id degrades to null.
 */
export function fkNeighbourhood(
  input: ReachabilityInput,
  fromId: string,
): GraphReachability | null {
  const schemaEdges = input.edges.filter((edge) => edge.kind === "fk" || edge.kind === "relation");
  return reachabilityClosure({ nodes: input.nodes, edges: schemaEdges }, fromId);
}

/**
 * Below this zoom the data badges compact to glyph+count and the elevated edge label keeps
 * only its lock glyph (epic rule 4), exactly like CONTRACT_COMPACT_ZOOM.
 */
export const DATA_COMPACT_ZOOM = 0.55;

export function dataLod(zoom: number): "full" | "compact" {
  return zoom < DATA_COMPACT_ZOOM ? "compact" : "full";
}
