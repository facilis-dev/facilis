// The project-graph node cards: page and workflow, plus the registration of the analysis and
// note node types (the route card lives in ProjectGraphRouteNode.tsx, the table card in
// ProjectGraphTableNode.tsx, the view card in ProjectGraphViewNode.tsx, the note card in
// ProjectGraphNote.tsx, the shared chrome in ProjectGraphNodeChrome.tsx). Each card names only
// theme role tokens (D-043/D-044); the geometry lives in graph-model.ts and the canvas only
// places them.

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import FileCode from "~icons/lucide/file-code";
import WorkflowIcon from "~icons/lucide/workflow";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { LinkHandles, UnknownBadge, nodeClass, sourceTitle } from "./ProjectGraphNodeChrome";
import { NOTE_NODE_TYPE, ProjectGraphNoteNode, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import { ProjectGraphPageSketch } from "./ProjectGraphPageSketch";
import { RouteGraphNode } from "./ProjectGraphRouteNode";
import { TableGraphNode } from "./ProjectGraphTableNode";
import { ViewGraphNode } from "./ProjectGraphViewNode";

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
  /** The data lens's role (issue #70); null when the lens is inactive and no marks draw. */
  dataRole: "dominant" | "secondary" | null;
  /** Compact LOD (issue #70): below the zoom threshold the badges keep glyph+count only. */
  compactData: boolean;
  onToggleCollapse: (id: string) => void;
};

export type ProjectAnalysisFlowNode = Node<
  ProjectFlowData,
  "page" | "route" | "table" | "view" | "workflow"
>;

/** The canvas's node union: the analysis cards plus the free-floating notes (D-126). */
export type ProjectFlowNode = ProjectAnalysisFlowNode | ProjectNoteFlowNode;

// The canvas and the custom edge import the handle ids from here; they are re-exported so the
// node files stay the single entry point for the canvas.
export { LINK_SOURCE_HANDLE_ID, LINK_TARGET_HANDLE_ID } from "./ProjectGraphNodeChrome";

export function PageGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  const node = data.node;
  const page = node.data.kind === "page" ? node.data : null;
  if (page === null) return null;
  return (
    <div
      data-testid="project-graph-page"
      title={sourceTitle(node)}
      className={
        nodeClass(selected, node.matched, dragging, data.focused, data.isolated, data.aiOutlined) +
        " w-56"
      }
    >
      <div className="flex items-center gap-1.5">
        <FileCode className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{page.pagePath}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
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
      <LinkHandles />
    </div>
  );
}

const MAX_VISIBLE_WORKFLOW_STEPS = 4;

export function WorkflowGraphNode({
  data,
  selected,
  dragging,
}: NodeProps<ProjectAnalysisFlowNode>) {
  const node = data.node;
  const workflow = node.data.kind === "workflow" ? node.data : null;
  if (workflow === null) return null;
  const shown = workflow.steps.slice(0, MAX_VISIBLE_WORKFLOW_STEPS);
  const more = workflow.steps.length - shown.length;
  return (
    <div
      data-testid="project-graph-workflow"
      title={sourceTitle(node)}
      className={
        nodeClass(selected, node.matched, dragging, data.focused, data.isolated, data.aiOutlined) +
        " w-64"
      }
    >
      <div className="flex items-center gap-1.5">
        <WorkflowIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
          {workflow.name}
        </span>
        {workflow.unknown && <UnknownBadge />}
        <span className="shrink-0 text-[9px] text-muted-foreground">
          {t("projectGraph.workflow.steps", { count: workflow.steps.length })}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t pt-1">
          {shown.map((step) => (
            <li key={step.index} className="flex items-center gap-1 text-[9px]">
              <span className="shrink-0 text-muted-foreground">{step.index + 1}.</span>
              <span className="shrink-0 rounded border px-1 text-muted-foreground">
                {t(("projectGraph.workflow." + step.kind) as MessageKey)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{step.name ?? "?"}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-0.5 text-[9px] text-muted-foreground">
          {t("projectGraph.workflow.more", { count: more })}
        </p>
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
  [NOTE_NODE_TYPE]: ProjectGraphNoteNode,
};
