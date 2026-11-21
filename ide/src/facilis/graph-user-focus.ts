// User-focus and isolate semantics for the selected node (issue #66, epic #56). Pure so the
// HUD line, the Esc order and the temporary subgraph are unit-testable without a browser; the
// panel stores the isolate id in the addressable view state (#58) and the canvas draws the
// dimming. Isolation is the ONE sanctioned removal (a temporary subgraph with a breadcrumb and
// a one-step Esc restore); the dimming around it is opacity only, never a position change.
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
  /** The impact lens (issue #74): a simulation overlay, cleared before isolation/selection. */
  readonly impactActive: boolean;
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  readonly aiFocusActive: boolean;
}

export type GraphEscapeAction =
  | "exit-zen"
  | "exit-impact"
  | "exit-isolate"
  | "clear-selection"
  | "clear-ai-focus"
  | null;

/**
 * Esc clears one layer at a time, biggest mode first: zen, then the impact simulation (only
 * the lens and its column go — selection, positions and every other dimming layer stay), then
 * isolation (the full graph returns in ONE step), then the selection, then the AI focus. Null
 * means nothing to clear.
 */
export function graphEscapeAction(context: GraphEscapeContext): GraphEscapeAction {
  if (context.zen) return "exit-zen";
  if (context.impactActive) return "exit-impact";
  if (context.isolatedNode !== null) return "exit-isolate";
  if (context.selection !== null) return "clear-selection";
  if (context.aiFocusActive) return "clear-ai-focus";
  return null;
}

/**
 * The temporary subgraph: only the closure's cards and the edges between them. Positions are
 * copied untouched (spatial constancy, epic rule 2) and the stats are recomputed so the HUD
 * ribbon counts what is actually drawn; nothing is "hidden" inside an isolation, so the
 * hidden counters reset to zero.
 */
export function isolateGraphView(
  view: ProjectGraphView,
  closure: GraphReachability,
): ProjectGraphView {
  const included = new Set(closure.nodeIds);
  const nodes = view.nodes.filter((node) => included.has(node.id));
  const edges = view.edges.filter((edge) => included.has(edge.source) && included.has(edge.target));
  const count = (kind: GraphNodeKind): number => nodes.filter((node) => node.kind === kind).length;
  return {
    nodes,
    edges,
    stats: {
      pages: count("page"),
      routes: count("route"),
      tables: count("table"),
      views: count("view"),
      workflows: count("workflow"),
      edges: edges.length,
      hiddenEdges: 0,
      hiddenNodes: 0,
      matches: nodes.filter((node) => node.matched).length,
      unknownNodes: nodes.filter((node) => node.data.kind !== "page" && node.data.unknown).length,
      pageLinks: edges.filter((edge) => edge.kind === "page-link").length,
      elevatedEdges: edges.filter((edge) => edge.access === "elevated").length,
    },
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
