// The feature-cluster node (issue #62): expanded, a labelled frame whose children React Flow
// places inside it (parentId + extent: "parent"); collapsed, a super-node chip carrying the
// kind counts and the number of edges crossing its boundary. Role tokens only (D-044), every
// string via t() (D-043), no text under 9 px (epic #56 rule 4). The frame is not draggable: a
// cluster origin is derived, never a saved position, so moving it could not persist.

import type { Node, NodeProps } from "@xyflow/react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import Eye from "~icons/lucide/eye";
import FileCode from "~icons/lucide/file-code";
import Route from "~icons/lucide/route";
import Table2 from "~icons/lucide/table-2";
import WorkflowIcon from "~icons/lucide/workflow";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { GraphCluster } from "@/facilis/graph-types";
import { OTHER_CLUSTER_KEY } from "@/facilis/graph-clusters";
import { LinkHandles } from "./ProjectGraphNodeChrome";

export const CLUSTER_NODE_TYPE = "cluster";

export type ProjectClusterFlowData = {
  cluster: GraphCluster;
  /** False when a drill or AI focus names other nodes: the frame is drawn dimmed. */
  focused: boolean;
  onToggleCollapse: (id: string) => void;
  onDrill: (id: string) => void;
};

export type ProjectClusterFlowNode = Node<ProjectClusterFlowData, typeof CLUSTER_NODE_TYPE>;

const KIND_ICONS: Record<GraphNodeKind, typeof FileCode> = {
  page: FileCode,
  route: Route,
  table: Table2,
  view: Eye,
  workflow: WorkflowIcon,
};

const KIND_ORDER: readonly GraphNodeKind[] = ["page", "route", "table", "view", "workflow"];

function clusterTitle(cluster: GraphCluster): string {
  return cluster.key === OTHER_CLUSTER_KEY ? t("projectGraph.cluster.other") : cluster.label;
}

function CollapseButton({
  cluster,
  onToggleCollapse,
}: {
  cluster: GraphCluster;
  onToggleCollapse: (id: string) => void;
}) {
  if (!cluster.collapsible) return null;
  const label = cluster.collapsed ? t("projectGraph.cluster.expand") : t("projectGraph.cluster.collapse");
  return (
    <button
      type="button"
      className="nodrag flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
      aria-label={label}
      title={t("projectGraph.cluster.collapseHint")}
      onClick={(event) => {
        event.stopPropagation();
        onToggleCollapse(cluster.id);
      }}
    >
      {cluster.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
    </button>
  );
}

/** Glyph + count chips: the kind breakdown readable even when the frame is fitted small. */
function KindChips({ cluster }: { cluster: GraphCluster }) {
  return (
    <span className="flex items-center gap-1.5">
      {KIND_ORDER.filter((kind) => cluster.counts[kind] > 0).map((kind) => {
        const Icon = KIND_ICONS[kind];
        return (
          <span
            key={kind}
            className="flex items-center gap-0.5 text-[9px] text-muted-foreground"
            title={t(("projectGraph.ribbon." + kind + "s") as MessageKey)}
          >
            <Icon className="size-2.5" />
            {cluster.counts[kind]}
          </span>
        );
      })}
    </span>
  );
}

export function ClusterGraphNode({ data, selected }: NodeProps<ProjectClusterFlowNode>) {
  const { cluster, focused } = data;
  const title = clusterTitle(cluster);
  const dimmed = !cluster.matched || !focused;
  const border = selected ? "border-primary ring-1 ring-primary" : "border-border";
  if (cluster.collapsed) {
    return (
      <div
        data-testid="project-graph-cluster-collapsed"
        title={t("projectGraph.cluster.drillHint")}
        className={
          "flex h-full w-full cursor-pointer select-none flex-col justify-center gap-1 rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm hover:border-ring " +
          border +
          (dimmed ? " opacity-40" : "")
        }
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">{title}</span>
          <CollapseButton cluster={cluster} onToggleCollapse={data.onToggleCollapse} />
        </div>
        <KindChips cluster={cluster} />
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span>{t("projectGraph.cluster.nodes", { count: cluster.nodeIds.length })}</span>
          <span className="truncate">{t("projectGraph.cluster.crossing", { count: cluster.crossingEdges })}</span>
        </div>
        <LinkHandles />
      </div>
    );
  }
  return (
    <div
      data-testid="project-graph-cluster"
      title={t("projectGraph.cluster.drillHint")}
      className={
        "h-full w-full cursor-pointer select-none rounded-lg border bg-card/40 " +
        border +
        (dimmed ? " opacity-40" : "")
      }
    >
      <div className="flex h-10 items-center gap-1.5 border-b border-border/60 px-2">
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-medium"
          title={cluster.key === OTHER_CLUSTER_KEY ? t("projectGraph.cluster.otherHint") : title}
        >
          {title}
        </span>
        <KindChips cluster={cluster} />
        <span className="shrink-0 text-[9px] text-muted-foreground">
          {t("projectGraph.cluster.crossing", { count: cluster.crossingEdges })}
        </span>
        <CollapseButton cluster={cluster} onToggleCollapse={data.onToggleCollapse} />
      </div>
      <LinkHandles />
    </div>
  );
}
