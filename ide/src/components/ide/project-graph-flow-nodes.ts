// The canvas's node list: the analysis view and the free-floating notes mapped to React Flow
// nodes. Extracted from ProjectGraphCanvas so that file keeps only the library wiring and the
// interaction effects (the 300-line source limit), and so the focus dimming is decided by this
// pure mapping rather than by every card.
//
// A drag in flight wins over the saved layout: merging against the previous node list keeps its
// position (and React Flow's own state) while the pointer is down; only drag stop commits.

import type { Diagnostic, GraphEdgeKind } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphNote } from "@/facilis/graph-types";
import { nodeMatchesAudit, type AuditFilterId } from "@/facilis/graph-contract";
import { lensRole } from "@/facilis/graph-lens-state";
import type { GraphLensId } from "@/facilis/graph-view-state";
import { NOTE_NODE_TYPE, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

/** The contract lens's canvas inputs (issue #69), bundled so the canvas carries one prop. */
export interface ProjectFlowContractState {
  /** Active lenses (issue #63 registry): the contract lens's role decides the card marks. */
  readonly activeLenses: readonly GraphLensId[];
  /** Audit-ribbon filters; empty means no audit dimming. */
  readonly auditFilters: readonly AuditFilterId[];
  /** The one-to-one diagnostics join; an absent id means no attached diagnostics. */
  readonly nodeDiagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
  /** Compact LOD for the contract badges: zoom below the threshold. */
  readonly compactContract: boolean;
}

export interface ProjectFlowNodesInput {
  readonly view: ProjectGraphView;
  readonly notes: readonly GraphNote[];
  /** The nodes already on the canvas: their React Flow state and any in-flight drag survive. */
  readonly previous: readonly ProjectFlowNode[];
  readonly selectedNodeId: string | null;
  /** The active AI focus (D-171), or null when every card is equally bright. */
  readonly focus: ProjectGraphFocusState | null;
  /** Edge kinds isolated by the chips (issue #63); empty means no isolation. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The contract lens's inputs (issue #69); absent means no lens, no marks, no dimming. */
  readonly contract?: ProjectFlowContractState;
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
  isolatedEdgeKinds,
  contract,
  onToggleCollapse,
  onEditNote,
  onDeleteNote,
}: ProjectFlowNodesInput): ProjectFlowNode[] {
  const {
    activeLenses = [],
    auditFilters = [],
    nodeDiagnostics,
    compactContract = false,
  } = contract ?? {};
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
  // The contract lens (issue #69) is opacity and badges only, like isolation: the mapping decides
  // the dimming and the marks' role, the view model never learns about either, so positions hold.
  const contractRole = lensRole(activeLenses, "contract");
  const auditActive = auditFilters.length > 0;
  const analysis = view.nodes.map((node) => {
    const current = existing.get(node.id);
    const diagnostics = nodeDiagnostics?.get(node.id) ?? [];
    const base: ProjectAnalysisFlowNode = {
      id: node.id,
      type: node.kind,
      position: { x: node.position.x, y: node.position.y },
      data: {
        node,
        collapsed: node.collapsed,
        focused: isFocused(node.id),
        isolated: isIsolated(node.id),
        contractRole,
        compactContract,
        auditDimmed: auditActive && !nodeMatchesAudit(node, diagnostics, auditFilters),
        diagnostics,
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
      data: {
        note,
        focused: isFocused(note.id),
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
