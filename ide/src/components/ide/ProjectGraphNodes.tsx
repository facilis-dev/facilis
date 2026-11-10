// The project-graph node cards: page and table, plus the registration of the analysis and note
// node types (the route card lives in ProjectGraphRouteNode.tsx, the note card in
// ProjectGraphNote.tsx, the shared chrome in ProjectGraphNodeChrome.tsx). Each card names only
// theme role tokens (D-043/D-044); the geometry lives in graph-model.ts and the canvas only
// places them.

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import FileCode from "~icons/lucide/file-code";
import Table2 from "~icons/lucide/table-2";
import { t, type MessageKey } from "@/i18n";
import type { ColumnMarker, ProjectGraphNode } from "@/facilis/graph-model";
import { LinkHandles, UnknownBadge, nodeClass, sourceTitle } from "./ProjectGraphNodeChrome";
import { NOTE_NODE_TYPE, ProjectGraphNoteNode, type ProjectNoteFlowNode } from "./ProjectGraphNote";
import { RouteGraphNode } from "./ProjectGraphRouteNode";

/** React Flow's data bound wants an object alias, not an interface. */
export type ProjectFlowData = {
  node: ProjectGraphNode;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
};

export type ProjectAnalysisFlowNode = Node<ProjectFlowData, "page" | "route" | "table">;

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
      className={nodeClass(selected, node.matched, dragging) + " w-56"}
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
        <p className="mt-0.5 text-[9px] text-muted-foreground">
          {t("projectGraph.preview.sections", { count: page.preview.nodes.length })}
        </p>
      )}
      <LinkHandles />
    </div>
  );
}

const MAX_VISIBLE_COLUMNS = 8;

function ColumnMarkers({ markers }: { markers: readonly ColumnMarker[] }) {
  if (markers.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {markers.map((marker) => (
        <span key={marker} className="rounded border px-0.5 text-[8px] leading-tight">
          {t(("projectGraph.marker." + marker) as MessageKey)}
        </span>
      ))}
    </span>
  );
}

export function TableGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  const node = data.node;
  const table = node.data.kind === "table" ? node.data : null;
  if (table === null) return null;
  const shown = data.collapsed ? [] : table.columns.slice(0, MAX_VISIBLE_COLUMNS);
  const more = table.columns.length - shown.length;
  return (
    <div
      data-testid="project-graph-table"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched, dragging) + " w-60"}
    >
      <div className="flex items-center gap-1.5">
        <Table2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
          {table.table}
        </span>
        {table.unknown && <UnknownBadge />}
        <button
          type="button"
          className="nodrag flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
          aria-label={data.collapsed ? t("projectGraph.expand") : t("projectGraph.collapse")}
          title={data.collapsed ? t("projectGraph.expand") : t("projectGraph.collapse")}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapse(node.id);
          }}
        >
          {data.collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span
          className={
            "rounded border px-1 " +
            (table.rlsEnabled ? "border-success/50 text-success" : "border-warning/50 text-warning")
          }
        >
          {table.rlsEnabled ? t("projectGraph.rls") : t("projectGraph.noRls")}
        </span>
        {table.framework && (
          <span
            className="rounded border border-border px-1 text-muted-foreground"
            title={t("projectGraph.framework")}
          >
            {t("projectGraph.framework")}
          </span>
        )}
        {table.scope !== null && (
          <span className="min-w-0 truncate">
            {t("projectGraph.scope", {
              column: table.scope.column,
              kind: t(("projectGraph.scopeKind." + table.scope.kind) as MessageKey),
            })}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {t("projectGraph.columns", { count: table.columns.length })}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t pt-1">
          {shown.map((column) => (
            <li key={column.property} className="flex items-center gap-1 text-[9px]">
              <span className="min-w-0 flex-1 truncate font-mono">{column.property}</span>
              <span className="shrink-0 truncate text-muted-foreground">{column.type}</span>
              <ColumnMarkers markers={column.markers} />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-0.5 text-[9px] text-muted-foreground">
          {t("projectGraph.moreColumns", { count: more })}
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
  [NOTE_NODE_TYPE]: ProjectGraphNoteNode,
};
