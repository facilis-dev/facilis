// The details satellite hook's input contract (issue #59), split from useProjectGraphDetails so
// that file stays under the 300-line source limit as lenses land — the same split pattern as the
// HUD slots and the flow builders. Every lens that tints or annotates a card threads its state
// through here, including the agent lens's transient turn-diff overlay (issue #73).

import type { Dispatch, RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ImpactOverlay } from "@/facilis/graph-impact";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphReachability } from "@/facilis/graph-reachability";
import type { PinnedDetailsAction, PinnedDetailsCard } from "@/facilis/graph-satellite";
import type { GraphNote } from "@/facilis/graph-types";
import type { TurnOverlay } from "@/facilis/graph-turn-diff";
import type { ProjectCanvasEdge } from "./ProjectGraphDetailsLinkEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import type {
  ProjectFlowContractState,
  ProjectFlowDataState,
  ProjectGraphDrill,
} from "./project-graph-flow-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import type { ProjectGraphHubsState } from "./useProjectGraphHubs";

export interface PinRequest {
  readonly nonce: number;
  readonly nodeId: string;
}

export interface UseProjectGraphDetailsInput {
  view: ProjectGraphView;
  notes: readonly GraphNote[];
  focus: ProjectGraphFocusState | null;
  /** The selection's closure (issue #66): the dimming channel, null when nothing is selected. */
  userFocus: GraphReachability | null;
  /** Edge kinds isolated by the chips (issue #63): dimming only, never a removal. */
  isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The contract lens's inputs (issue #69): audit dimming + the diagnostics join. */
  contract: ProjectFlowContractState;
  /** The data lens's inputs (issue #70): marks on the table/view cards, never a move. */
  data: ProjectFlowDataState;
  /** The agent lens overlay (issue #73): tombstones at last-known positions, never a move. */
  turn: TurnOverlay | null;
  /** The impact simulation overlay (issue #74): opacity/badges/danger strokes, never a move. */
  impact: ImpactOverlay | null;
  /** The active cluster drill-down (issue #62), or null when nothing is drilled. */
  drill: ProjectGraphDrill | null;
  /** The concentration overlay + session hub state (issue #64); its chips join the node list. */
  hubs: ProjectGraphHubsState;
  selectedNodeId: string | null;
  /** Below the breakpoint the details render as a sheet; no satellite is drawn. */
  sheetMode: boolean;
  pinned: readonly PinnedDetailsCard[];
  dispatchPinned: Dispatch<PinnedDetailsAction>;
  /** The sheet's pin button asks through a nonce, like the HUD's add-note. */
  pinRequest: PinRequest | null;
  details: ReadonlyMap<string, NodeDetails>;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge> | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The panel's measured container width: the side flip and the first placement need it. */
  containerWidth: number;
  onSelectNode: (id: string | null) => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleClusterCollapse: (id: string) => void;
  onEditNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
}
