// The API Flow canvas (D-085/D-087): pages → routes → tables in three columns, rendered
// with React Flow. Custom nodes only name theme roles (D-043/D-044); React Flow's own
// chrome is mapped to the same roles through CSS variables. Clicking a node selects it for
// the inspector, double-clicking opens its file.

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
import FileCode from "~icons/lucide/file-code";
import Table2 from "~icons/lucide/table-2";
import { t } from "@/i18n";
import { METHOD_BADGES } from "./api-flow-badges";
import {
  METHOD_ORDER,
  type ApiFlowGraph,
  type ApiFlowSelection,
  type ApiPageNode,
  type ApiRouteNode,
  type PageNodeData,
  type RouteNodeData,
  type TableNodeData,
} from "@/facilis/api-flow-model";

type PageFlowNode = Node<PageNodeData, "page">;
type RouteFlowNode = Node<RouteNodeData, "route">;
type TableFlowNode = Node<TableNodeData, "table">;
type FlowNode = PageFlowNode | RouteFlowNode | TableFlowNode;

interface ContentProps {
  graph: ApiFlowGraph;
  selected: ApiFlowSelection | null;
  onSelect: (selection: ApiFlowSelection) => void;
  onOpenRoute: (node: ApiRouteNode) => void;
  onOpenPage: (node: ApiPageNode) => void;
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

export function ApiFlowContent({
  graph,
  selected,
  onSelect,
  onOpenRoute,
  onOpenPage,
  onOpenTable,
  linksDisabled,
}: ContentProps) {
  const nodes: FlowNode[] = [
    ...graph.pages.map((node): PageFlowNode => ({
      id: node.id,
      type: "page",
      position: node.position,
      data: node.data,
    })),
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
  const findSelection = (node: FlowNode): ApiFlowSelection =>
    node.type === "page"
      ? { kind: "page", id: node.id }
      : node.type === "table"
        ? { kind: "table", id: node.id }
        : { kind: "route", id: node.id };
  const onNodeClick: NodeMouseHandler<FlowNode> = (_event, node) => {
    if (!linksDisabled) onSelect(findSelection(node));
  };
  const onNodeDoubleClick: NodeMouseHandler<FlowNode> = (_event, node) => {
    if (linksDisabled) return;
    if (node.type === "page") {
      const page = graph.pages.find((entry) => entry.id === node.id);
      if (page !== undefined) onOpenPage(page);
    } else if (node.type === "table") {
      onOpenTable();
    } else {
      const route = graph.routes.find((entry) => entry.id === node.id);
      if (route !== undefined) onOpenRoute(route);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-testid="api-flow-canvas" className={"min-h-0 flex-1 " + CANVAS_TOKENS}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={false}
          nodesConnectable={false}
          minZoom={0.15}
          // A refetch replaces the graph: remount so the new one is fitted instead of
          // keeping the previous viewport (SPEC §12 Phase 3 exit criteria).
          key={nodes.map((node) => node.id + (selected?.id === node.id ? "*" : "")).join("|")}
        >
          <Background color="var(--border)" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ApiFlowFooter graph={graph} />
    </div>
  );
}

function PageNodeView({ data, selected }: NodeProps<PageFlowNode>) {
  return (
    <div
      data-testid="api-flow-page"
      title={t("apiFlow.openPage", { path: data.path })}
      className={
        "w-56 cursor-pointer rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm " +
        (selected ? "border-primary ring-1 ring-primary" : "hover:border-ring")
      }
    >
      <div className="flex items-center gap-1.5">
        <FileCode className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{data.path}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="rounded border px-1">{data.kind}</span>
        <span>{t("apiFlow.pageRoutes", { count: data.routeCount })}</span>
        {data.via !== null && (
          <span
            className="min-w-0 truncate"
            title={t("apiFlow.inspector.via", { module: data.via })}
          >
            {t("apiFlow.inspector.via", { module: data.via })}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RouteNodeView({ data, selected }: NodeProps<RouteFlowNode>) {
  return (
    <div
      data-testid="api-flow-node"
      title={t("apiFlow.openRoute", { route: data.method + " " + data.path })}
      className={
        "w-64 cursor-pointer rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm " +
        (selected ? "border-primary ring-1 ring-primary" : "hover:border-ring")
      }
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
        {data.unused && (
          <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
            {t("apiFlow.list.unused")}
          </span>
        )}
      </div>
      {data.summary !== null && (
        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{data.summary}</p>
      )}
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span>{t("apiFlow.consumersCount", { count: data.consumers.length })}</span>
        {data.tableCount > 0 && (
          <span className="ml-auto shrink-0">
            {t("apiFlow.routeTables", { count: data.tableCount })}
          </span>
        )}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function TableNodeView({ data, selected }: NodeProps<TableFlowNode>) {
  return (
    <div
      data-testid="api-flow-table"
      title={t("apiFlow.openTable")}
      className={
        "w-40 cursor-pointer rounded-md border bg-muted/40 px-2 py-1.5 shadow-sm " +
        (selected ? "border-primary ring-1 ring-primary" : "hover:border-ring")
      }
    >
      <div className="flex items-center gap-1.5">
        <Table2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
          {data.name}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span>{t("apiFlow.tableColumns", { count: data.columnCount })}</span>
        <span className="ml-auto shrink-0">
          {t("apiFlow.tableRoutes", { count: data.routeCount })}
        </span>
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { page: PageNodeView, route: RouteNodeView, table: TableNodeView };

function ApiFlowFooter({ graph }: { graph: ApiFlowGraph }) {
  const { routes, pages, tables, edges, byMethod } = graph.stats;
  return (
    <div className="shrink-0 space-y-1 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
      <p>{t("apiFlow.stats", { routes, pages, tables, edges })}</p>
      <ul className="flex flex-wrap items-center gap-1">
        <li className="font-medium text-foreground">{t("apiFlow.legend")}</li>
        <li className="rounded border px-1">{t("apiFlow.legendPage")}</li>
        <li className="rounded border px-1">{t("apiFlow.legendRoute")}</li>
        <li className="rounded border bg-muted/40 px-1">{t("apiFlow.legendTable")}</li>
        <li className="rounded border border-dashed px-1">{t("apiFlow.legendPageEdge")}</li>
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
