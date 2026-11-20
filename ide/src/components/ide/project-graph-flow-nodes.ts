// The canvas's node list: the analysis view, the feature-cluster frames (issue #62) and the
// free-floating notes mapped to React Flow nodes. Extracted from ProjectGraphCanvas so that
// file keeps only the library wiring and the interaction effects (the 300-line source limit),
// and so the focus/drill dimming is decided by this pure mapping rather than by every card.
//
// Cluster members become compound children (parentId + extent: "parent"): their stored
// positions are absolute, so the mapper subtracts the frame origin and the canvas adds it
// back on drag stop. A drag in flight wins over the saved layout: merging against the
// previous node list keeps its position (and React Flow's own state) while the pointer is
// down; only drag stop commits.

import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphNote } from "@/facilis/graph-types";
import { clusterOfNodes } from "@/facilis/graph-clusters";
import { NOTE_NODE_TYPE, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import {
  CLUSTER_NODE_TYPE,
  type ProjectClusterFlowNode,
} from "./ProjectGraphClusterNode";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

/** The drilled-into cluster (issue #62): its members stay bright, everything else recedes. */
export interface ProjectGraphDrill {
  readonly clusterId: string;
  readonly nodeIds: ReadonlySet<string>;
}

export interface ProjectFlowNodesInput {
  readonly view: ProjectGraphView;
  readonly notes: readonly GraphNote[];
  /** The nodes already on the canvas: their React Flow state and any in-flight drag survive. */
  readonly previous: readonly ProjectFlowNode[];
  readonly selectedNodeId: string | null;
  /** The active AI focus (D-171), or null when every card is equally bright. */
  readonly focus: ProjectGraphFocusState | null;
  /** The active drill-down, or null when the whole graph is equally bright. */
  readonly drill: ProjectGraphDrill | null;
  readonly onToggleCollapse: (id: string) => void;
  readonly onToggleClusterCollapse: (id: string) => void;
  readonly onDrillCluster: (id: string) => void;
  readonly onEditNote: (id: string, text: string) => void;
  readonly onDeleteNote: (id: string) => void;
}

export function buildProjectGraphFlowNodes({
  view,
  notes,
  previous,
  selectedNodeId,
  focus,
  drill,
  onToggleCollapse,
  onToggleClusterCollapse,
  onDrillCluster,
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
  // nothing is focused or it is part of the focus, and a drill never brightens outsiders.
  const isFocused = (id: string): boolean =>
    (focus === null || focus.nodeIds.has(id) || (focusedEndpoints?.has(id) ?? false)) &&
    (drill === null || drill.nodeIds.has(id));
  const clusterOf = clusterOfNodes(view.clusters);
  const frameOf = new Map(view.clusters.map((cluster) => [cluster.id, cluster]));
  const clusterNodes: ProjectClusterFlowNode[] = view.clusters.map((cluster) => ({
    id: cluster.id,
    type: CLUSTER_NODE_TYPE,
    position: { x: cluster.position.x, y: cluster.position.y },
    // The frame reserves its box; the origin is derived, so it is never draggable/persisted.
    draggable: false,
    selectable: true,
    selected: cluster.id === selectedNodeId,
    style: { width: cluster.size.width, height: cluster.size.height },
    data: {
      cluster,
      focused: drill === null || drill.clusterId === cluster.id,
      onToggleCollapse: onToggleClusterCollapse,
      onDrill: onDrillCluster,
    },
  }));
  const analysis = view.nodes.map((node) => {
    const current = existing.get(node.id);
    const clusterId = clusterOf.get(node.id);
    const frame = clusterId === undefined ? undefined : frameOf.get(clusterId);
    // Compound child: React Flow wants the position relative to its parent frame.
    const position =
      frame === undefined
        ? { x: node.position.x, y: node.position.y }
        : { x: node.position.x - frame.position.x, y: node.position.y - frame.position.y };
    const base: ProjectAnalysisFlowNode = {
      id: node.id,
      type: node.kind,
      position,
      // Explicit undefined clears a stale parent when grouping is switched off mid-session.
      parentId: frame?.id,
      extent: frame === undefined ? undefined : ("parent" as const),
      data: {
        node,
        collapsed: node.collapsed,
        focused: isFocused(node.id),
        onToggleCollapse,
      },
      draggable: true,
      selected: node.id === selectedNodeId,
    };
    if (current === undefined || current.type === NOTE_NODE_TYPE || current.type === CLUSTER_NODE_TYPE) {
      return base;
    }
    return {
      ...current,
      ...base,
      position: current.dragging === true ? current.position : base.position,
    };
  });
  // Notes are never filtered by the search or the focus ids, so they are not in any focus set:
  // they recede with the rest of the graph when a request or a drill is active.
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
  // Frames first: React Flow paints parents under their compound children.
  return [...clusterNodes, ...analysis, ...noteNodes];
}
