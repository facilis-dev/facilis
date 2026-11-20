// The hub chip (issue #64): a view artefact concentrating a high route fan-out into one glyph
// plus a count (epic rule 4). Click (or Enter/Space) toggles the session-scoped expansion;
// hover isolates the concentrated edges and lists the route names in an on-canvas satellite
// anchored to the chip (epic rule 1 — no side panel). The chip is never draggable and never
// selectable: it must not reach the saved layout or the URL state. Role tokens only (D-044).

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import GitMerge from "~icons/lucide/git-merge";
import { t } from "@/i18n";
import type { GraphEdgeHub } from "@/facilis/graph-edge-hubs";
import { LinkHandles } from "./ProjectGraphNodeChrome";
import { PROJECT_GRAPH_NODE_TYPES } from "./ProjectGraphNodes";

export const HUB_NODE_TYPE = "hub";

export type ProjectHubData = {
  hub: GraphEdgeHub;
  targetLabel: string;
  /** Route labels in hub.sources order, for the hover satellite. */
  routeLabels: readonly string[];
  hovered: boolean;
  dimmed: boolean;
  onToggle: (hubId: string) => void;
  onHover: (hubId: string | null) => void;
};

export type ProjectHubFlowNode = Node<ProjectHubData, typeof HUB_NODE_TYPE>;

/** The presentational chip + satellite; the node wrapper adds the React Flow handles. */
export function HubChipView({ data }: { data: ProjectHubData }) {
  const { hub } = data;
  const frame = data.hovered
    ? "border-primary ring-1 ring-primary"
    : hub.expanded
      ? "border-primary/60"
      : "border-border hover:border-ring";
  return (
    <div
      data-testid="project-graph-hub"
      role="button"
      tabIndex={0}
      aria-pressed={hub.expanded}
      aria-label={t("projectGraph.hub.aria", { count: hub.count, target: data.targetLabel })}
      title={hub.expanded ? t("projectGraph.hub.hintExpanded") : t("projectGraph.hub.hint")}
      className={
        "relative flex h-7 w-14 cursor-pointer items-center justify-center gap-1 rounded-full border bg-card text-card-foreground shadow-sm select-none " +
        frame +
        (data.dimmed ? " opacity-40" : "")
      }
      onClick={(event) => {
        event.stopPropagation();
        data.onToggle(hub.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        data.onToggle(hub.id);
      }}
      onMouseEnter={() => data.onHover(hub.id)}
      onMouseLeave={() => data.onHover(null)}
    >
      <GitMerge className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-[11px] font-medium tabular-nums">{hub.count}</span>
      {data.hovered ? (
        <div
          data-testid="project-graph-hub-satellite"
          // The outer box bridges the visual gap: crossing it must not leave the chip's
          // hover region, or the list would vanish on the way to scrolling it.
          className="nodrag nopan absolute top-full left-1/2 z-50 w-52 -translate-x-1/2"
        >
          <div className="mt-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-sm">
            <p className="text-[10px] font-medium text-muted-foreground">
              {t("projectGraph.hub.routesTitle", { count: hub.count })}
            </p>
            <ul className="mt-0.5 max-h-64 space-y-0.5 overflow-y-auto">
              {data.routeLabels.map((label, index) => (
                <li key={hub.sources[index] ?? index} className="truncate font-mono text-[10px]">
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectGraphHubNode({ data }: NodeProps<ProjectHubFlowNode>) {
  return (
    <>
      <HubChipView data={data} />
      <LinkHandles />
    </>
  );
}

/** The canvas's registration: the analysis cards plus the hub chip. */
export const PROJECT_GRAPH_NODE_TYPES_WITH_HUBS: NodeTypes = {
  ...PROJECT_GRAPH_NODE_TYPES,
  [HUB_NODE_TYPE]: ProjectGraphHubNode,
};
