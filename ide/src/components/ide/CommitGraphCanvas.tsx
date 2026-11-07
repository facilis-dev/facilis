// The commit-graph canvas (D-088): one card per commit, one edge per child → parent, laid
// out by lane. The geometry lives in the model (commit-graph-model.ts), so this file only
// renders it and reports the clicked commit.
//
// React Flow's chrome is mapped to theme role tokens (D-044) and the lane colour comes from
// the role palette below — no raw palette values (D-043).

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
import GitBranch from "~icons/lucide/git-branch";
import GitCommitHorizontal from "~icons/lucide/git-commit-horizontal";
import { t } from "@/i18n";
import type { CommitGraph, CommitGraphNodeData } from "@/facilis/commit-graph-model";
import { XYFLOW_THEME_TOKENS } from "./xyflow-theme";

export type CommitFlowData = CommitGraphNodeData & Record<string, unknown>;
type CommitFlowNode = Node<CommitFlowData, "commit">;

// Five theme roles distinguish neighbouring lanes without inventing colours.
const LANE_COLORS = [
  "var(--brand)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--primary)",
] as const;

/** The lane's colour role (used for the card's left edge and the details dot). */
export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function CommitGraphCanvas({
  graph,
  selectedId,
  onSelect,
}: {
  graph: CommitGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const nodes: CommitFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "commit",
    position: node.position,
    data: node.data as CommitFlowData,
    selected: node.id === selectedId,
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }));
  const onNodeClick: NodeMouseHandler<CommitFlowNode> = (_event, node) => onSelect(node.id);

  return (
    <div data-testid="commit-graph-canvas" className={"h-full min-h-0 " + XYFLOW_THEME_TOKENS}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.04}
        // A reload replaces the graph: refit instead of keeping the previous viewport.
        key={graph.nodes.map((node) => node.id).join("|")}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function CommitNodeView({ data, selected }: NodeProps<CommitFlowNode>) {
  const date = data.timestamp > 0 ? new Date(data.timestamp * 1000).toLocaleDateString() : "";
  const shown = data.branches.slice(0, 2);
  const rest = data.branches.length - shown.length;
  return (
    <div
      data-testid="commit-graph-node"
      title={data.message + " · " + data.oid}
      className={
        "w-[260px] cursor-pointer rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm " +
        (selected ? "border-primary ring-1 ring-primary" : "hover:border-ring")
      }
      style={{ borderLeft: "3px solid " + laneColor(data.lane) }}
    >
      <div className="flex items-center gap-1.5">
        <GitCommitHorizontal className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{data.message}</span>
        {data.head && (
          <span className="shrink-0 rounded border border-brand/50 bg-brand/10 px-1 text-[9px] font-semibold text-brand">
            {t("commitGraph.head")}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="shrink-0 font-mono">{data.short}</span>
        <span className="min-w-0 truncate">{data.author}</span>
        <span className="ml-auto shrink-0">{date}</span>
      </div>
      {data.branches.length > 0 && (
        <div className="mt-0.5 flex items-center gap-1 overflow-hidden text-[9px]">
          {shown.map((branch) => (
            <span
              key={branch}
              className="flex shrink-0 items-center gap-0.5 rounded border px-1 text-foreground"
            >
              <GitBranch className="size-2.5" />
              {branch}
            </span>
          ))}
          {rest > 0 && <span className="shrink-0 text-muted-foreground">+{rest}</span>}
        </div>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { commit: CommitNodeView };
