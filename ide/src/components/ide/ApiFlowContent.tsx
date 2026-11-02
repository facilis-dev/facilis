// The API Flow canvas (SPEC §10.2, §12 Phase 3): the pure graph model rendered with
// React Flow. Custom nodes only name theme roles (D-043/D-044); React Flow's own chrome
// (edges, handles, controls) is mapped to the same roles through CSS variables.

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import Table2 from "~icons/lucide/table-2";
import { t } from "@/i18n";
import type { ApiMethod } from "@/facilis/api-flow-client";
import {
  METHOD_ORDER,
  type ApiFlowGraph,
  type RouteNodeData,
  type TableNodeData,
} from "@/facilis/api-flow-model";

type RouteFlowNode = Node<RouteNodeData, "route">;
type TableFlowNode = Node<TableNodeData, "table">;
type FlowNode = RouteFlowNode | TableFlowNode;

interface ContentProps {
  graph: ApiFlowGraph;
  onOpenRoute: (data: RouteNodeData) => void;
  onOpenTable: () => void;
  linksDisabled: boolean;
}

// React Flow reads these variables for its own chrome; mapping them to role tokens keeps
// the canvas on one theme block instead of the library's light-only defaults (D-044).
const CANVAS_TOKENS =
  "[--xy-edge-stroke:var(--border)] [--xy-edge-stroke-selected:var(--primary)] " +
  "[--xy-handle-background-color:var(--muted-foreground)] " +
  "[--xy-handle-border-color:var(--background)] " +
  "[--xy-attribution-background-color:transparent] " +
  "[--xy-controls-button-background-color:var(--card)] " +
  "[--xy-controls-button-background-color-hover:var(--accent)] " +
  "[--xy-controls-button-color:var(--foreground)] " +
  "[--xy-controls-button-border-color:var(--border)]";

const METHOD_BADGES: Record<ApiMethod, string> = {
  GET: "border-info/40 bg-info/10 text-info",
  POST: "border-success/40 bg-success/10 text-success",
  PUT: "border-warning/40 bg-warning/10 text-warning",
  PATCH: "border-primary/40 bg-primary/10 text-primary",
  DELETE: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function ApiFlowContent({ graph, onOpenRoute, onOpenTable, linksDisabled }: ContentProps) {
  const nodes: FlowNode[] = [
    ...graph.routes.map((node): RouteFlowNode => ({
      id: node.id,
      type: "route",
      position: node.position,
      data: node.data,
    })),
    ...graph.tables.map((node): TableFlowNode => ({
      id: node.id,
      type: "table",
      position: node.position,
      data: node.data,
    })),
  ];
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    ...(edge.dashed ? { style: { strokeDasharray: "4 2" } } : {}),
  }));
  const onNodeClick: NodeMouseHandler<FlowNode> = (_event, node) => {
    if (linksDisabled) return;
    if (node.type === "route") onOpenRoute(node.data);
    else onOpenTable();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-testid="api-flow-canvas" className={"min-h-0 flex-1 " + CANVAS_TOKENS}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          minZoom={0.2}
          // A revision refetch replaces the nodes: remount so the new graph is fitted
          // instead of keeping the previous viewport (SPEC §12 Phase 3 exit criteria).
          key={nodes.map((node) => node.id).join("|")}
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ApiFlowFooter graph={graph} />
    </div>
  );
}

function RouteNodeView({ data }: NodeProps<RouteFlowNode>) {
  return (
    <div
      data-testid="api-flow-node"
      title={t("apiFlow.openRoute", { route: data.method + " " + data.path })}
      className="w-56 cursor-pointer rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm hover:border-ring"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={
            "shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] font-bold " +
            METHOD_BADGES[data.method]
          }
        >
          {data.method}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{data.path}</span>
      </div>
      {data.summary !== null && (
        <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{data.summary}</p>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        {data.permission.length > 0 && (
          <span
            className="min-w-0 truncate"
            title={t("apiFlow.permission", { permission: data.permission.join(", ") })}
          >
            {data.permission.join(", ")}
          </span>
        )}
        {data.tableCount > 0 && (
          <span className="ml-auto shrink-0">
            {t("apiFlow.routeTables", { count: data.tableCount })}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function TableNodeView({ data }: NodeProps<TableFlowNode>) {
  return (
    <div
      data-testid="api-flow-table"
      title={t("apiFlow.openTable")}
      className="w-40 cursor-pointer rounded-md border bg-muted/40 px-2 py-1.5 shadow-sm hover:border-ring"
    >
      <div className="flex items-center gap-1.5">
        <Table2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
          {data.name}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span>{t("apiFlow.tableColumns", { count: data.columnCount })}</span>
        {data.routeCount > 0 && (
          <span className="ml-auto shrink-0">
            {t("apiFlow.tableRoutes", { count: data.routeCount })}
          </span>
        )}
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { route: RouteNodeView, table: TableNodeView };

function ApiFlowFooter({ graph }: { graph: ApiFlowGraph }) {
  const { routes, tables, edges, byMethod } = graph.stats;
  return (
    <div className="shrink-0 space-y-1 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
      <p>{t("apiFlow.stats", { routes, tables, edges })}</p>
      <ul className="flex flex-wrap items-center gap-1">
        <li className="font-medium text-foreground">{t("apiFlow.legend")}</li>
        <li className="rounded border px-1">{t("apiFlow.legendRoute")}</li>
        <li className="rounded border bg-muted/40 px-1">{t("apiFlow.legendTable")}</li>
        <li className="rounded border border-dashed px-1">{t("apiFlow.legendColumnEdge")}</li>
      </ul>
      <ul className="flex flex-wrap items-center gap-1">
        {METHOD_ORDER.map((method) => {
          const count = byMethod[method];
          if (count === 0) return null;
          return (
            <li key={method} className={"rounded border px-1 font-mono " + METHOD_BADGES[method]}>
              {t("apiFlow.methodCount", { method, count })}
            </li>
          );
        })}
      </ul>
      {graph.warnings.length > 0 && (
        <div>
          <p>{t("apiFlow.warnings", { count: graph.warnings.length })}</p>
          <ul className="max-h-16 space-y-0.5 overflow-y-auto">
            {graph.warnings.map((warning, index) => (
              <li key={index} className="truncate" title={warning.message}>
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
