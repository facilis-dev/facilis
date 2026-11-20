// Lens and edge-isolation semantics for the canvas chips (issue #63, epic #56 rules 2-3).
// Pure so the control surface's rules are unit-testable without a browser: the chips component
// maps clicks and keys onto these transitions, the panel stores the result in the view state
// (#58). Isolation is opacity only — it never removes an edge, so positions, selection and the
// graph bounds cannot move (the view model is built without knowing about it).

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphLensId } from "./graph-view-state";
import { GRAPH_EDGE_KINDS } from "./graph-types";

/** One dominant lens plus one secondary (issue #63): a third activation is refused with a hint. */
export const MAX_ACTIVE_LENSES = 2;

export interface LensActivation {
  readonly lenses: readonly GraphLensId[];
  /** True when the activation was refused: the state is unchanged and the UI shows a hint. */
  readonly refused: boolean;
}

/**
 * Toggle a lens. Activating prepends: the new lens is dominant and the previous dominant demotes
 * to secondary (epic rule 3). Removing the dominant promotes the secondary. A third lens is
 * refused, never silently dropped.
 */
export function activateLens(lenses: readonly GraphLensId[], id: GraphLensId): LensActivation {
  if (lenses.includes(id)) {
    return { lenses: lenses.filter((entry) => entry !== id), refused: false };
  }
  if (lenses.length >= MAX_ACTIVE_LENSES) return { lenses, refused: true };
  return { lenses: [id, ...lenses], refused: false };
}

/** The chip's badge: the first active lens is dominant, the second secondary (epic rule 3). */
export function lensRole(
  lenses: readonly GraphLensId[],
  id: GraphLensId,
): "dominant" | "secondary" | null {
  const index = lenses.indexOf(id);
  if (index < 0) return null;
  return index === 0 ? "dominant" : "secondary";
}

/**
 * Edge-kind isolation. A plain click isolates one kind; clicking the sole isolated kind clears
 * the isolation. Shift-click (additive) adds or removes one kind without touching the others.
 */
export function isolateEdgeKind(
  isolated: readonly GraphEdgeKind[],
  kind: GraphEdgeKind,
  additive: boolean,
): readonly GraphEdgeKind[] {
  if (additive) {
    return isolated.includes(kind)
      ? isolated.filter((entry) => entry !== kind)
      : [...isolated, kind];
  }
  if (isolated.length === 1 && isolated[0] === kind) return [];
  return [kind];
}

/** Per-kind edge totals from the analysis: a hidden kind keeps its count on the chip. */
export function countEdgeKinds(
  edges: readonly { readonly kind: GraphEdgeKind }[],
): Record<GraphEdgeKind, number> {
  const counts = Object.fromEntries(GRAPH_EDGE_KINDS.map((kind) => [kind, 0])) as Record<
    GraphEdgeKind,
    number
  >;
  for (const edge of edges) counts[edge.kind] += 1;
  return counts;
}
