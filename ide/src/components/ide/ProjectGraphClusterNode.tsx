// The feature-cluster node (issue #62): expanded, a labelled frame whose children React Flow
// places inside it (parentId + extent: "parent"); collapsed, a super-node card carrying the
// kind counts and the number of edges crossing its boundary. Both follow the LOD chip pattern
// (epic #56 rule 4): the full content stays in the DOM as the constant footprint sizer, and
// below full zoom a counter-scaled chip/compact renders in its place — no text under 7 px on
// screen. Role tokens only (D-044), every string via t() (D-043). The frame is not draggable:
// a cluster origin is derived, never a saved position, so moving it could not persist.

import type { ReactNode } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import Boxes from "~icons/lucide/boxes";
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
import { lodScreenPx } from "@/facilis/graph-lod";
import { LinkHandles, nodeClass } from "./ProjectGraphNodeChrome";
import { GraphLodChip, GraphLodCompact, GraphLodOverlay, lodSizerClass } from "./ProjectGraphLod";
import { useGraphLod } from "./use-graph-lod";

export const CLUSTER_NODE_TYPE = "cluster";

export type ProjectClusterFlowData = {
  cluster: GraphCluster;
  /** False when a drill or the user focus names other nodes: the frame is drawn dimmed. */
  focused: boolean;
  onToggleCollapse: (id: string) => void;
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

const CHIP_ICON_STYLE = { width: lodScreenPx(14), height: lodScreenPx(14) };
const BADGE_ICON_STYLE = { width: lodScreenPx(12), height: lodScreenPx(12) };
const SCREEN_BUTTON_STYLE = { width: lodScreenPx(16), height: lodScreenPx(16) };

function clusterTitle(cluster: GraphCluster): string {
  return cluster.key === OTHER_CLUSTER_KEY ? t("projectGraph.cluster.other") : cluster.label;
}

/** The collapse control; counter-scaled below full so its hit area stays >= 16 screen px. */
function CollapseButton({
  cluster,
  onToggleCollapse,
  screen = false,
}: {
  cluster: GraphCluster;
  onToggleCollapse: (id: string) => void;
  screen?: boolean;
}) {
  if (!cluster.collapsible) return null;
  const label = cluster.collapsed
    ? t("projectGraph.cluster.expand")
    : t("projectGraph.cluster.collapse");
  const Chevron = cluster.collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      className={
        "nodrag flex shrink-0 items-center justify-center rounded hover:bg-accent " +
        (screen ? "" : "size-4")
      }
      style={screen ? SCREEN_BUTTON_STYLE : undefined}
      aria-label={label}
      title={t("projectGraph.cluster.collapseHint")}
      onClick={(event) => {
        event.stopPropagation();
        onToggleCollapse(cluster.id);
      }}
    >
      <Chevron
        className={screen ? undefined : "size-3"}
        style={screen ? BADGE_ICON_STYLE : undefined}
      />
    </button>
  );
}

/** Glyph + count chips at full zoom: the kind breakdown inside the header/super-node sizer. */
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

/** The compact level's one badge row; font size inherits the counter-scaled container. */
function clusterBadges(cluster: GraphCluster): ReactNode {
  return (
    <>
      {KIND_ORDER.filter((kind) => cluster.counts[kind] > 0).map((kind) => {
        const Icon = KIND_ICONS[kind];
        return (
          <span
            key={kind}
            className="flex shrink-0 items-center gap-0.5"
            title={t(("projectGraph.ribbon." + kind + "s") as MessageKey)}
          >
            <Icon style={BADGE_ICON_STYLE} />
            {cluster.counts[kind]}
          </span>
        );
      })}
      <span className="truncate">
        {t("projectGraph.cluster.crossing", { count: cluster.crossingEdges })}
      </span>
    </>
  );
}

/** The chip/compact stand-in shared by the frame corner and the collapsed super-node. */
function ClusterLodContent({
  cluster,
  level,
}: {
  cluster: GraphCluster;
  level: "chip" | "compact";
}) {
  const title = clusterTitle(cluster);
  const icon = <Boxes className="shrink-0 text-muted-foreground" style={CHIP_ICON_STYLE} />;
  const countTitle = t("projectGraph.cluster.nodes", { count: cluster.nodeIds.length });
  if (level === "chip") {
    return (
      <GraphLodChip
        icon={icon}
        kindLabel={t("projectGraph.cluster.frameKind")}
        label={title}
        count={cluster.nodeIds.length}
        countTitle={countTitle}
        tone="border-border"
      />
    );
  }
  return <GraphLodCompact icon={icon} name={title} badges={clusterBadges(cluster)} />;
}

export function ClusterGraphNode({ data, selected }: NodeProps<ProjectClusterFlowNode>) {
  const level = useGraphLod();
  const { cluster, focused } = data;
  const title = clusterTitle(cluster);
  if (cluster.collapsed) {
    // The super-node is a card: the shared chrome owns the single-winner opacity ladder
    // (user focus 12%, search miss 40%), exactly like every analysis card.
    return (
      <div
        data-testid="project-graph-cluster-collapsed"
        data-lod={level}
        title={t("projectGraph.cluster.drillHint")}
        className={
          nodeClass(selected, cluster.matched, false, focused, false, false, false, "") +
          " relative h-full w-full"
        }
      >
        <div className={lodSizerClass(level)} aria-hidden={level !== "full"}>
          <div className="flex h-full w-full flex-col justify-center gap-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
                {title}
              </span>
              <CollapseButton cluster={cluster} onToggleCollapse={data.onToggleCollapse} />
            </div>
            <KindChips cluster={cluster} />
            <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
              <span>{t("projectGraph.cluster.nodes", { count: cluster.nodeIds.length })}</span>
              <span className="truncate">
                {t("projectGraph.cluster.crossing", { count: cluster.crossingEdges })}
              </span>
            </div>
          </div>
        </div>
        {level !== "full" && (
          <GraphLodOverlay>
            <ClusterLodContent cluster={cluster} level={level} />
          </GraphLodOverlay>
        )}
        {level !== "full" && (
          <span className="absolute right-1 top-1">
            <CollapseButton cluster={cluster} onToggleCollapse={data.onToggleCollapse} screen />
          </span>
        )}
        <LinkHandles />
      </div>
    );
  }
  // The expanded frame is a container, not a card: the same opacity ladder as nodeClass, but
  // the translucent bg-card/40 and the padding-free box the children lay out inside.
  const border = selected ? "border-primary ring-1 ring-primary" : "border-border";
  const opacity = !focused ? " opacity-12" : !cluster.matched ? " opacity-40" : "";
  return (
    <div
      data-testid="project-graph-cluster"
      data-lod={level}
      title={t("projectGraph.cluster.drillHint")}
      aria-label={t("projectGraph.cluster.frameLabel", { label: title })}
      className={
        "relative h-full w-full cursor-pointer select-none rounded-lg border bg-card/40 " +
        border +
        opacity
      }
    >
      <div className={lodSizerClass(level)} aria-hidden={level !== "full"}>
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
      </div>
      {level !== "full" && (
        // Below full the header text would drop under the 7 px floor: a counter-scaled chip
        // names the frame at its top-left corner instead (the children keep their own LOD).
        <span className="absolute left-1 top-1 flex items-center" style={{ gap: lodScreenPx(4) }}>
          <ClusterLodContent cluster={cluster} level={level} />
          <CollapseButton cluster={cluster} onToggleCollapse={data.onToggleCollapse} screen />
        </span>
      )}
      <LinkHandles />
    </div>
  );
}
