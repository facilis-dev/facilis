// The canvas's node list: the analysis view and the free-floating notes mapped to React Flow
// nodes. Extracted from ProjectGraphCanvas so that file keeps only the library wiring and the
// interaction effects (the 300-line source limit), and so the focus dimming is decided by this
// pure mapping rather than by every card.
//
// A drag in flight wins over the saved layout: merging against the previous node list keeps its
// position (and React Flow's own state) while the pointer is down; only drag stop commits.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphNote } from "@/facilis/graph-types";
import { NOTE_NODE_TYPE, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface ProjectFlowNodesInput {
  readonly view: ProjectGraphView;
  readonly notes: readonly GraphNote[];
  /** The nodes already on the canvas: their React Flow state and any in-flight drag survive. */
  readonly previous: readonly ProjectFlowNode[];
  readonly selectedNodeId: string | null;
  /** The active AI focus (D-171): the outline channel, or null when nothing is outlined. */
  readonly focus: ProjectGraphFocusState | null;
  /** The selection's closure (issue #66): the dimming channel, or null when nothing is dimmed. */
  readonly userFocus: GraphReachability | null;
  /** Edge kinds isolated by the chips (issue #63); empty means no isolation. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly onToggleCollapse: (id: string) => void;
  readonly onEditNote: (id: string, text: string) => void;
  readonly onDeleteNote: (id: string) => void;
}

export function buildProjectGraphFlowNodes({
  view,
  notes,
  previous,
  selectedNodeId,
  focus,
  userFocus,
  isolatedEdgeKinds,
  onToggleCollapse,
  onEditNote,
  onDeleteNote,
}: ProjectFlowNodesInput): ProjectFlowNode[] {
  const existing = new Map(previous.map((node) => [node.id, node]));
  // A request that names only edges outlines their endpoints too: highlighting a connection
  // must mark the two cards it connects (the D-171 semantics, moved to the outline channel).
  const aiEndpoints =
    focus === null
      ? null
      : new Set(
          view.edges
            .filter((edge) => focus.edgeIds.has(edge.id))
            .flatMap((edge) => [edge.source, edge.target]),
        );
  const isAiOutlined = (id: string): boolean =>
    focus !== null && (focus.nodeIds.has(id) || (aiEndpoints?.has(id) ?? false));
  // The user focus dims by membership in the closure; no closure means every card is bright.
  const userNodes = userFocus === null ? null : new Set(userFocus.nodeIds);
  const isFocused = (id: string): boolean => userNodes === null || userNodes.has(id);
  // Isolation (issue #63) keeps every card in place and dims the ones no isolated edge touches:
  // opacity only, so positions, selection and the graph bounds never move.
  const isolationActive = isolatedEdgeKinds.length > 0;
  const isolatedEndpoints = isolationActive
    ? new Set(
        view.edges
          .filter((edge) => isolatedEdgeKinds.includes(edge.kind))
          .flatMap((edge) => [edge.source, edge.target]),
      )
    : null;
  const isIsolated = (id: string): boolean =>
    isolationActive && !(isolatedEndpoints?.has(id) ?? false);
  // The chip's edge count is a fact of the visible view (epic rule 5): each edge counts once
  // per endpoint, a self-loop once. Computed here so every card reads it from its data.
  const edgeCounts = new Map<string, number>();
  for (const edge of view.edges) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    if (edge.target !== edge.source) {
      edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
    }
  }
  const analysis = view.nodes.map((node) => {
    const current = existing.get(node.id);
    const base: ProjectAnalysisFlowNode = {
      id: node.id,
      type: node.kind,
      position: { x: node.position.x, y: node.position.y },
      data: {
        node,
        collapsed: node.collapsed,
        focused: isFocused(node.id),
        aiOutlined: isAiOutlined(node.id),
        isolated: isIsolated(node.id),
        edgeCount: edgeCounts.get(node.id) ?? 0,
        onToggleCollapse,
      },
      draggable: true,
      selected: node.id === selectedNodeId,
    };
    if (current === undefined || current.type === NOTE_NODE_TYPE) return base;
    return {
      ...current,
      ...base,
      position: current.dragging === true ? current.position : base.position,
    };
  });
  // Notes are never part of the reachability closure or the AI request (both validate against
  // the analysis view), so they recede with the rest of the graph whenever a focus is active.
  const noteNodes = notes.map((note) => {
    const current = existing.get(note.id);
    const base: ProjectNoteFlowNode = {
      id: note.id,
      type: NOTE_NODE_TYPE,
      position: { x: note.x, y: note.y },
      data: {
        note,
        focused: isFocused(note.id),
        // Notes are not analysis cards: they always recede while an isolation is active.
        isolated: isolationActive,
        onEditNote,
        onDeleteNote,
      },
      draggable: true,
    };
    if (current === undefined || current.type !== NOTE_NODE_TYPE) return base;
    return {
      ...current,
      ...base,
      position: current.dragging === true ? current.position : base.position,
    };
  });
  return [...analysis, ...noteNodes];
}
