// The project-graph node cards: page, route and table. Each card names only theme role
// tokens (D-043/D-044); the geometry lives in graph-model.ts and the canvas only places them.

import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import FileCode from "~icons/lucide/file-code";
import Route from "~icons/lucide/route";
import Table2 from "~icons/lucide/table-2";
import { t, type MessageKey } from "@/i18n";
import type { ColumnMarker, ProjectGraphNode } from "@/facilis/graph-model";

/** React Flow's data bound wants an object alias, not an interface. */
export type ProjectFlowData = {
  node: ProjectGraphNode;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
};

export type ProjectFlowNode = Node<ProjectFlowData, "page" | "route" | "table">;

const NODE_BASE =
  "cursor-pointer rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm ";

function nodeClass(selected: boolean, matched: boolean): string {
  const border = selected ? "border-primary ring-1 ring-primary" : "hover:border-ring";
  return NODE_BASE + border + (matched ? "" : " opacity-40");
}

function sourceTitle(node: ProjectGraphNode): string {
  return t("projectGraph.openSource", { source: node.sourceFile ?? node.label });
}

function MethodBadge({ method }: { method: string }) {
  const tone =
    method === "GET"
      ? "border-info/40 bg-info/10 text-info"
      : method === "POST"
        ? "border-success/40 bg-success/10 text-success"
        : method === "PUT"
          ? "border-warning/40 bg-warning/10 text-warning"
          : method === "PATCH"
            ? "border-primary/40 bg-primary/10 text-primary"
            : method === "DELETE"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted text-muted-foreground";
  return (
    <span className={"shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] font-bold " + tone}>
      {method}
    </span>
  );
}

function UnknownBadge() {
  return (
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}

export function PageGraphNode({ data, selected }: NodeProps<ProjectFlowNode>) {
  const node = data.node;
  const page = node.data.kind === "page" ? node.data : null;
  if (page === null) return null;
  return (
    <div
      data-testid="project-graph-page"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched) + " w-56"}
    >
      <div className="flex items-center gap-1.5">
        <FileCode className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{page.pagePath}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="rounded border px-1">
          {t(("projectGraph.pageKind." + page.pageKind) as MessageKey)}
        </span>
        <span>{t("projectGraph.calls", { count: page.callCount })}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function RouteGraphNode({ data, selected }: NodeProps<ProjectFlowNode>) {
  const node = data.node;
  const route = node.data.kind === "route" ? node.data : null;
  if (route === null) return null;
  return (
    <div
      data-testid="project-graph-route"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched) + " w-64"}
    >
      <div className="flex items-center gap-1.5">
        <MethodBadge method={route.method} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{route.path}</span>
        {route.unknown && <UnknownBadge />}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <Route className="size-2.5 shrink-0" />
        <span className="min-w-0 truncate">
          {route.permission.length === 0 ? t("projectGraph.public") : route.permission.join(", ")}
        </span>
        {route.wrapper !== "valid" && (
          <span
            className={
              "ml-auto shrink-0 rounded border px-1 " +
              (route.wrapper === "invalid"
                ? "border-destructive/50 text-destructive"
                : "border-warning/50 text-warning")
            }
          >
            {t(("projectGraph.wrapper." + route.wrapper) as MessageKey)}
          </span>
        )}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
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

export function TableGraphNode({ data, selected }: NodeProps<ProjectFlowNode>) {
  const node = data.node;
  const table = node.data.kind === "table" ? node.data : null;
  if (table === null) return null;
  const shown = data.collapsed ? [] : table.columns.slice(0, MAX_VISIBLE_COLUMNS);
  const more = table.columns.length - shown.length;
  return (
    <div
      data-testid="project-graph-table"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched) + " w-60"}
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
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const PROJECT_GRAPH_NODE_TYPES: NodeTypes = {
  page: PageGraphNode,
  route: RouteGraphNode,
  table: TableGraphNode,
};
