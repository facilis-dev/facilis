// User-focus and isolate semantics for the selected node (issue #66, epic #56). Pure so the
// HUD line, the Esc order and the dimming closure are unit-testable without a browser; the
// panel stores the isolate id in the addressable view state (#58) and the canvas draws the
// dimming. Isolation is DIM-ONLY (F.5, epic rule 2): non-closure cards recede to 12% exactly
// like the selection's context highlight, but the mode persists in the URL until a one-step
// Esc — nothing is ever removed, moved or tombstoned, and no breadcrumb navigation exists.
//
// The AI focus (D-171, graph-focus.ts) is a separate overlay: it outlines, the user focus dims,
// and the two compose. Nothing here touches the AI module state.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "./graph-types";
import type { GraphReachability } from "./graph-reachability";

/** Outside the selection's closure every card and edge recedes to 12% (issue #66). */
export const USER_FOCUS_OPACITY = 0.12;

export interface GraphEscapeContext {
  readonly zen: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  readonly aiFocusActive: boolean;
}

export type GraphEscapeAction =
  "exit-zen" | "exit-isolate" | "clear-selection" | "clear-ai-focus" | null;

/**
 * Esc clears one layer at a time, biggest mode first: zen, then isolation (the full graph
 * returns to full brightness in ONE step), then the selection, then the AI focus. Null means
 * nothing to clear.
 */
export function graphEscapeAction(context: GraphEscapeContext): GraphEscapeAction {
  if (context.zen) return "exit-zen";
  if (context.isolatedNode !== null) return "exit-isolate";
  if (context.selection !== null) return "clear-selection";
  if (context.aiFocusActive) return "clear-ai-focus";
  return null;
}

/**
 * Compose the two dimming closures into the single set the canvas highlights (F.5). Isolate
 * restricts the bright world to its closure; the selection's context highlight then applies
 * within it — a card stays bright only when BOTH closures name it, the dim-only analogue of
 * the branch's "select inside the isolated subgraph". Either closure alone dims when the
 * other is absent; two nulls mean nothing is dimmed. Sorted ids in, sorted ids out.
 */
export function composeUserFocus(
  isolateClosure: GraphReachability | null,
  selectionClosure: GraphReachability | null,
): GraphReachability | null {
  if (isolateClosure === null) return selectionClosure;
  if (selectionClosure === null) return isolateClosure;
  const selectionNodes = new Set(selectionClosure.nodeIds);
  const selectionEdges = new Set(selectionClosure.edgeIds);
  return {
    nodeIds: isolateClosure.nodeIds.filter((id) => selectionNodes.has(id)),
    edgeIds: isolateClosure.edgeIds.filter((id) => selectionEdges.has(id)),
  };
}

export interface GraphClosureSummary {
  /** The highlighted node count, including the selected node itself. */
  readonly total: number;
  readonly pages: number;
  readonly routes: number;
  readonly tables: number;
  readonly views: number;
  readonly workflows: number;
}

/** The HUD's closure line, derived from the same set the canvas highlights (criterion 3). */
export function closureSummary(
  view: ProjectGraphView,
  closure: GraphReachability,
): GraphClosureSummary {
  const included = new Set(closure.nodeIds);
  const nodes = view.nodes.filter((node) => included.has(node.id));
  const count = (kind: GraphNodeKind): number => nodes.filter((node) => node.kind === kind).length;
  return {
    total: nodes.length,
    pages: count("page"),
    routes: count("route"),
    tables: count("table"),
    views: count("view"),
    workflows: count("workflow"),
  };
}
