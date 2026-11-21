// The project-graph node cards: the page card plus the registration of the analysis and note
// node types (the route card lives in ProjectGraphRouteNode.tsx, the table card in
// ProjectGraphTableNode.tsx, the view card in ProjectGraphViewNode.tsx, the note card in
// ProjectGraphNote.tsx, the shared chrome in ProjectGraphNodeChrome.tsx). Each card names only
// theme role tokens (D-043/D-044); the geometry lives in graph-model.ts and the canvas only
// places them.

import { useContext } from "react";
import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import FileCode from "~icons/lucide/file-code";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { TurnNodeChrome } from "@/facilis/graph-turn-diff";
import { LinkHandles, TurnBadge, nodeClass, turnSourceTitle } from "./ProjectGraphNodeChrome";
import {
  ContractLensContext,
  NodeDiagnosticsMarks,
  contractRingClass,
} from "./ProjectGraphContractMarks";
import {
  CLUSTER_NODE_TYPE,
  ClusterGraphNode,
  type ProjectClusterFlowNode,
} from "./ProjectGraphClusterNode";
import {
  DETAILS_NODE_TYPE,
  ProjectGraphDetailsNode,
  type ProjectDetailsFlowNode,
} from "./ProjectGraphDetailsNode";
import { HUB_NODE_TYPE, ProjectGraphHubNode, type ProjectHubFlowNode } from "./ProjectGraphHubNode";
import { NOTE_NODE_TYPE, ProjectGraphNoteNode, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import { ProjectGraphPageSketch } from "./ProjectGraphPageSketch";
import { RouteGraphNode } from "./ProjectGraphRouteNode";
import { TURN_NODE_TYPE, TurnDiffNode, type ProjectTurnFlowNode } from "./ProjectGraphTurnNode";
import { TableGraphNode } from "./ProjectGraphTableNode";
import { ViewGraphNode } from "./ProjectGraphViewNode";
import { WorkflowGraphNode } from "./ProjectGraphWorkflowNode";
import { GraphLodOverlay, ProjectGraphLodContent, lodSizerClass } from "./ProjectGraphLod";
import { useGraphLod } from "./use-graph-lod";

/** React Flow's data bound wants an object alias, not an interface. */
export type ProjectFlowData = {
  node: ProjectGraphNode;
  collapsed: boolean;
  /** False when the user focus (issue #66) closes over other nodes: the card is drawn at 12%. */
  focused: boolean;
  /** True when the AI focus (D-171) names this card: the outline channel, never a dim. */
  aiOutlined: boolean;
  /** True when edge-kind isolation (issue #63) names no edge touching this card: drawn at 10%. */
  isolated: boolean;
  /** True when an audit-ribbon filter (issue #69) matches none of this node's counters: 40%. */
  auditDimmed: boolean;
  /** True when the impact lens (issue #74) simulates removing THIS card: the danger marker. */
  impactTarget: boolean;
  /** True when the impact lens dims this card (outside target + dependents): drawn at 12%. */
  impactDimmed: boolean;
  /** True while the impact lens badges this table as read by no route (muted observation). */
  neverRead: boolean;
  /** True when the impact lens is secondary: its own badges recede to 30% (epic rule 3). */
  impactSecondary: boolean;
  /** The turn-diff overlay (issue #73); absent/null when the agent lens adds nothing here. */
  turn?: TurnNodeChrome | null;
  /** The data lens's role (issue #70); null when the lens is inactive and no marks draw. */
  dataRole: "dominant" | "secondary" | null;
  /** Compact LOD for the data badges (issue #70): below the zoom threshold, glyph+count only. */
  compactData: boolean;
  /** Edges touching this node in the visible view — the chip's count, derived from the model. */
  edgeCount: number;
  onToggleCollapse: (id: string) => void;
};

export type ProjectAnalysisFlowNode = Node<
  ProjectFlowData,
  "page" | "route" | "table" | "view" | "workflow"
>;

/** The canvas's node union: analysis cards, cluster frames (issue #62), free-floating notes
 * (D-126), the details satellite with its pinned cards (issue #59), hub chips (issue #64) and
 * the turn-diff tombstones/ghosts (issue #73: transient overlays at last-known positions). */
export type ProjectFlowNode =
  | ProjectAnalysisFlowNode
  | ProjectClusterFlowNode
  | ProjectNoteFlowNode
  | ProjectDetailsFlowNode
  | ProjectHubFlowNode
  | ProjectTurnFlowNode;

// The canvas and the custom edge import the handle ids from here; they are re-exported so the
// node files stay the single entry point for the canvas.
export { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodeChrome";

export function PageGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  // The contract lens (issue #69): pages have no contract facts of their own, only attached
  // diagnostics. A stable null context while inactive keeps the card render untouched.
  const contract = useContext(ContractLensContext);
  const level = useGraphLod();
  const node = data.node;
  const page = node.data.kind === "page" ? node.data : null;
  if (page === null) return null;
  const diagnostics = contract?.nodeDiagnostics.get(node.id) ?? [];
  return (
    <div
      data-testid="project-graph-page"
      data-lod={level}
      title={turnSourceTitle(node, data.turn)}
      className={
        nodeClass(
          selected,
          node.matched,
          dragging,
          data.focused,
          data.isolated,
          data.aiOutlined,
          data.auditDimmed,
          contract === null ? "" : contractRingClass(diagnostics),
          data.turn,
          data.impactDimmed,
        ) + " relative w-56"
      }
    >
      <div className={lodSizerClass(level)} aria-hidden={level !== "full"}>
        <div className="flex items-center gap-1.5">
          <FileCode className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{page.pagePath}</span>
          {data.turn != null && <TurnBadge turn={data.turn} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span className="rounded border px-1">
            {t(("projectGraph.pageKind." + page.pageKind) as MessageKey)}
          </span>
          {page.routePaths.slice(0, 3).map((path) => (
            <span
              key={path}
              title={path}
              className="max-w-full truncate rounded border border-brand/40 bg-brand/10 px-1 font-mono text-brand"
            >
              {path}
            </span>
          ))}
          {page.routePaths.length > 3 && <span>+{page.routePaths.length - 3}</span>}
          {page.routePaths.length === 0 && (
            <span className="rounded border border-warning/50 px-1 text-warning">
              {t("projectGraph.pageUnrouted")}
            </span>
          )}
          <span className="ml-auto shrink-0">
            {t("projectGraph.calls", { count: page.callCount })}
          </span>
        </div>
        {page.preview !== null && page.preview.nodes.length > 0 && (
          <ProjectGraphPageSketch preview={page.preview} className="mt-1.5" />
        )}
      </div>
      {contract !== null && (
        <NodeDiagnosticsMarks
          diagnostics={diagnostics}
          compact={contract.compact}
          secondary={contract.secondary}
        />
      )}
      {level !== "full" && (
        <GraphLodOverlay>
          <ProjectGraphLodContent
            node={node}
            edgeCount={data.edgeCount}
            level={level}
            turn={data.turn}
          />
        </GraphLodOverlay>
      )}
      <LinkHandles />
    </div>
  );
}

export const PROJECT_GRAPH_NODE_TYPES: NodeTypes = {
  page: PageGraphNode,
  route: RouteGraphNode,
  table: TableGraphNode,
  view: ViewGraphNode,
  workflow: WorkflowGraphNode,
  [CLUSTER_NODE_TYPE]: ClusterGraphNode,
  [NOTE_NODE_TYPE]: ProjectGraphNoteNode,
  [DETAILS_NODE_TYPE]: ProjectGraphDetailsNode,
  [HUB_NODE_TYPE]: ProjectGraphHubNode,
  [TURN_NODE_TYPE]: TurnDiffNode,
};
