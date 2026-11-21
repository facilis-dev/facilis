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
//
// The agent lens's turn diff (issue #73) is data here too: a live card carries its change kind,
// a deleted base node becomes a tombstone card at its last-known position, and phase-2 ghosts
// append below the graph (inert while no plan source exists). Nothing moves a live node, and a
// tombstone is never persisted: the layout only ever learns analysis ids (epic rule 2).

import type { Diagnostic, GraphEdgeKind } from "@facilis.dev/analyze";
import { nodeMatchesAudit, type AuditFilterId } from "@/facilis/graph-contract";
import type { HubIsolation } from "@/facilis/graph-edge-hubs";
import { lensRole } from "@/facilis/graph-lens-state";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { GraphNote } from "@/facilis/graph-types";
import type { GraphLensId } from "@/facilis/graph-view-state";
import type { TurnNodeChrome, TurnOverlay } from "@/facilis/graph-turn-diff";
import { clusterOfNodes } from "@/facilis/graph-clusters";
import { CLUSTER_NODE_TYPE, type ProjectClusterFlowNode } from "./ProjectGraphClusterNode";
import { NOTE_NODE_TYPE, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import {
  buildTurnExtras,
  buildTurnNode,
  tombstoneIndex,
  type TurnNodeChannels,
} from "./project-graph-turn-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

/** The drilled-into cluster (issue #62): its members stay bright, everything else recedes. */
export interface ProjectGraphDrill {
  readonly clusterId: string;
  readonly nodeIds: ReadonlySet<string>;
}

/** The data lens's canvas inputs (issue #70), bundled so the canvas carries one prop. */
export interface ProjectFlowDataState {
  /** Active lenses (issue #63 registry): the data lens's role decides the card marks. */
  readonly activeLenses: readonly GraphLensId[];
  /** Compact LOD for the data badges: zoom below the threshold. */
  readonly compactData: boolean;
}

/** The contract lens's dimming inputs (issue #69), bundled so the canvas carries one prop.
 * The badges and the ring read the lens context instead; only the audit dimming is decided
 * here, by the same pure mapping that owns every other dim channel. */
export interface ProjectFlowContractState {
  /** Audit-ribbon filters; empty means no audit dimming. */
  readonly auditFilters: readonly AuditFilterId[];
  /** The one-to-one diagnostics join; an absent id means no attached diagnostics. */
  readonly nodeDiagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
}

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
  /** The active drill-down (issue #62), or null when the whole graph is equally bright. */
  readonly drill: ProjectGraphDrill | null;
  /** Hub hover isolation (issue #64): only the hub's routes and target stay bright. */
  readonly hubIsolation: HubIsolation | null;
  /** The contract lens's inputs (issue #69); absent means no audit dimming. */
  readonly contract?: ProjectFlowContractState;
  /** The data lens's inputs (issue #70); absent means no lens, no marks. */
  readonly data?: ProjectFlowDataState;
  /** The agent lens overlay (issue #73); absent/null/inactive draws exactly as without it. */
  readonly turn?: TurnOverlay | null;
  readonly onToggleCollapse: (id: string) => void;
  readonly onToggleClusterCollapse: (id: string) => void;
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
  drill,
  hubIsolation,
  contract,
  data,
  turn = null,
  onToggleCollapse,
  onToggleClusterCollapse,
  onEditNote,
  onDeleteNote,
}: ProjectFlowNodesInput): ProjectFlowNode[] {
  const existing = new Map(previous.map((node) => [node.id, node]));
  // The data lens (issue #70) is badges and stroke only, like isolation: this mapping decides
  // the marks' role, the view model never learns about it, so positions hold (epic rule 2).
  const dataRole = lensRole(data?.activeLenses ?? [], "data");
  const compactData = data?.compactData ?? false;
  // The agent lens (issue #73): the derived diff plus its role fade. Off/inactive adds nothing.
  const turnDiff = turn?.diff ?? null;
  const turnSecondary = turn?.secondary ?? false;
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
  // A drill (issue #62) and a hub hover (issue #64) compose with it: an outsider of any active
  // isolation recedes, never two brightened.
  const userNodes = userFocus === null ? null : new Set(userFocus.nodeIds);
  const isFocused = (id: string): boolean =>
    (userNodes === null || userNodes.has(id)) &&
    (drill === null || drill.nodeIds.has(id)) &&
    (hubIsolation === null || hubIsolation.nodeIds.has(id));
  // Isolation (issue #63) keeps every card in place and dims the ones no isolated edge touches:
  // opacity only, so positions, selection and the graph bounds never move.
  const isolationActive = isolatedEdgeKinds.length > 0;
  // A severed turn-diff edge still touches its tombstone: keep it in the isolation set so the
  // tombstone stays as bright as the broken connection that keeps it on the graph.
  const isolationEdges =
    turnDiff !== null && turnDiff.active ? [...view.edges, ...turnDiff.severedEdges] : view.edges;
  const isolatedEndpoints = isolationActive
    ? new Set(
        isolationEdges
          .filter((edge) => isolatedEdgeKinds.includes(edge.kind))
          .flatMap((edge) => [edge.source, edge.target]),
      )
    : null;
  const isIsolated = (id: string): boolean =>
    isolationActive && !(isolatedEndpoints?.has(id) ?? false);
  // The contract lens's audit filters (issue #69) dim like isolation: opacity only, the view
  // model never learns about them, so positions hold (epic rule 2). Notes and cluster frames
  // are not contract subjects — only the analysis cards carry the channel.
  const auditFilters = contract?.auditFilters ?? [];
  const auditActive = auditFilters.length > 0;
  const nodeDiagnostics = contract?.nodeDiagnostics;
  // The chip's edge count is a fact of the visible view (epic rule 5): each edge counts once
  // per endpoint, a self-loop once. Computed here so every card reads it from its data.
  const edgeCounts = new Map<string, number>();
  for (const edge of view.edges) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    if (edge.target !== edge.source) {
      edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
    }
  }
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
    },
  }));
  // Tombstones: deleted base nodes. The id may still be in the live model (a stale analysis),
  // in which case the live card is replaced in place — same id, same position, no second card.
  const channels: TurnNodeChannels = {
    focused: isFocused,
    isolated: isIsolated,
    secondary: turnSecondary,
  };
  const tombstones = tombstoneIndex(turn);
  const analysis = view.nodes.map((node): ProjectFlowNode => {
    // A deleted base node the stale analysis still draws is tombstoned in place, at its live
    // position — never re-layout, never a second card for the same id (epic rule 2).
    const tombstone = tombstones?.get(node.id);
    if (tombstone !== undefined) {
      return buildTurnNode(
        node.id,
        "deleted",
        node.label,
        node.sourceFile,
        node.position,
        channels,
      );
    }
    const changeKind =
      turnDiff !== null && turnDiff.active ? turnDiff.nodeKinds.get(node.id) : undefined;
    const chrome: TurnNodeChrome | null =
      changeKind === undefined ? null : { kind: changeKind, secondary: turnSecondary };
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
        aiOutlined: isAiOutlined(node.id),
        isolated: isIsolated(node.id),
        auditDimmed:
          auditActive && !nodeMatchesAudit(node, nodeDiagnostics?.get(node.id) ?? [], auditFilters),
        turn: chrome,
        dataRole,
        compactData,
        edgeCount: edgeCounts.get(node.id) ?? 0,
        onToggleCollapse,
      },
      draggable: true,
      selected: node.id === selectedNodeId,
    };
    // A different type for the same id means a lens-only card here (a tombstone in place), so
    // the previous card's state must not be merged onto a live card's data.
    if (current === undefined || current.type !== node.kind) return base;
    return {
      ...current,
      ...base,
      position: current.dragging === true ? current.position : base.position,
    };
  });

  // Base-only tombstones come from the clean-tree snapshot; phase-2 ghosts stay inert.
  const extra = buildTurnExtras(turn, view, channels);
  // Notes are never part of the reachability closure or the AI request (both validate against
  // the analysis view), so they recede with the rest of the graph whenever a focus or drill is
  // active.
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
  // Frames first: React Flow paints parents under their compound children.
  return [...clusterNodes, ...analysis, ...extra, ...noteNodes];
}
