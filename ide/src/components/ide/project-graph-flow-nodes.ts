// The canvas's node list: the analysis view and the free-floating notes mapped to React Flow
// nodes. Extracted from ProjectGraphCanvas so that file keeps only the library wiring and the
// interaction effects (the 300-line source limit), and so the focus dimming is decided by this
// pure mapping rather than by every card.
//
// A drag in flight wins over the saved layout: merging against the previous node list keeps its
// position (and React Flow's own state) while the pointer is down; only drag stop commits.

import type { ProjectGraphView } from "@/facilis/graph-model";
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
  /** The active AI focus (D-171), or null when every card is equally bright. */
  readonly focus: ProjectGraphFocusState | null;
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
  onToggleCollapse,
  onEditNote,
  onDeleteNote,
}: ProjectFlowNodesInput): ProjectFlowNode[] {
  const existing = new Map(previous.map((node) => [node.id, node]));
  // A request that names only edges keeps their endpoints bright too: highlighting a connection
  // must not dim the two cards it connects.
  const focusedEndpoints =
    focus === null
      ? null
      : new Set(
          view.edges
            .filter((edge) => focus.edgeIds.has(edge.id))
            .flatMap((edge) => [edge.source, edge.target]),
        );
  // The canvas dims by this flag instead of knowing the request: a card is bright when either
  // nothing is focused or it is part of the focus.
  const isFocused = (id: string): boolean =>
    focus === null || focus.nodeIds.has(id) || (focusedEndpoints?.has(id) ?? false);
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
  // Notes are never filtered by the search or the focus ids, so they are not in any focus set:
  // they recede with the rest of the graph when a request is active.
  const noteNodes = notes.map((note) => {
    const current = existing.get(note.id);
    const base: ProjectNoteFlowNode = {
      id: note.id,
      type: NOTE_NODE_TYPE,
      position: { x: note.x, y: note.y },
      data: { note, focused: isFocused(note.id), onEditNote, onDeleteNote },
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
