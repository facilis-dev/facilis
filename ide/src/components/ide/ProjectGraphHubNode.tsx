// The hub chip (issue #64): a view artefact concentrating a high route fan-out into one glyph
// plus a count (epic rule 4). Click (or Enter/Space) toggles the session-scoped expansion;
// hover isolates the concentrated edges and lists the route names in an on-canvas satellite
// anchored to the chip (epic rule 1 — no side panel). The chip is never draggable and never
// selectable: it must not reach the saved layout or the URL state. The flow footprint stays
// HUB_SIZE so routing never moves; the chip itself counter-scales like the LOD chips
// (lodScreenPx), keeping glyph, count and route list above the 7 px floor at every zoom.
// Dimming composes the card channels (nodeClass): kind isolation 10%, user/drill/hover 12%,
// the AI focus outlines instead of dimming. Role tokens only (D-044).

import type { Node, NodeProps } from "@xyflow/react";
import GitMerge from "~icons/lucide/git-merge";
import { t } from "@/i18n";
import { HUB_SIZE, type GraphEdgeHub } from "@/facilis/graph-edge-hubs";
import { GRAPH_LOD_CHIP_HIT_PX, lodScreenPx } from "@/facilis/graph-lod";
import { LinkHandles } from "./ProjectGraphNodeChrome";

export const HUB_NODE_TYPE = "hub";

export type ProjectHubData = {
  hub: GraphEdgeHub;
  targetLabel: string;
  /** Route labels in hub.sources order, for the hover satellite. */
  routeLabels: readonly string[];
  hovered: boolean;
  /** False when the user focus, a drill or another hub's hover names other nodes: 12%. */
  focused: boolean;
  /** True when edge-kind isolation (issue #63) names other kinds: 10%. */
  isolated: boolean;
  /** True when the AI focus (D-171) names the hub's parts: the outline channel, never a dim. */
  aiOutlined: boolean;
  onToggle: (hubId: string) => void;
  onHover: (hubId: string | null) => void;
};

export type ProjectHubFlowNode = Node<ProjectHubData, typeof HUB_NODE_TYPE>;

const CHIP_ICON_STYLE = { width: lodScreenPx(12), height: lodScreenPx(12) };

/** The presentational chip + satellite; the node wrapper adds the React Flow handles. */
export function HubChipView({ data }: { data: ProjectHubData }) {
  const { hub } = data;
  const frame = data.hovered
    ? "border-primary ring-1 ring-primary"
    : hub.expanded
      ? "border-primary/60"
      : "border-border hover:border-ring";
  // The strongest dim wins, exactly like nodeClass: the channels never stack.
  const opacity = data.isolated ? " opacity-10" : !data.focused ? " opacity-12" : "";
  const outline = data.aiOutlined ? " outline outline-2 outline-offset-2 outline-brand/70" : "";
  return (
    // The unchanged flow footprint: routing and obstacle rects read HUB_SIZE, never the
    // counter-scaled visual box (spatial constancy, epic rule 2).
    <div className="relative flex h-7 w-14 items-center justify-center">
      <div
        data-testid="project-graph-hub"
        role="button"
        tabIndex={0}
        aria-pressed={hub.expanded}
        aria-label={t("projectGraph.hub.aria", { count: hub.count, target: data.targetLabel })}
        title={hub.expanded ? t("projectGraph.hub.hintExpanded") : t("projectGraph.hub.hint")}
        className={
          "nodrag nopan relative flex cursor-pointer items-center justify-center rounded-full border bg-card text-card-foreground shadow-sm select-none " +
          frame +
          opacity +
          outline
        }
        style={{
          width: lodScreenPx(HUB_SIZE.width),
          height: lodScreenPx(HUB_SIZE.height),
          minWidth: lodScreenPx(GRAPH_LOD_CHIP_HIT_PX),
          minHeight: lodScreenPx(GRAPH_LOD_CHIP_HIT_PX),
          gap: lodScreenPx(4),
        }}
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
        <GitMerge className="shrink-0 text-muted-foreground" style={CHIP_ICON_STYLE} />
        <span className="font-medium tabular-nums" style={{ fontSize: lodScreenPx(10) }}>
          {hub.count}
        </span>
        {data.hovered ? (
          <div
            data-testid="project-graph-hub-satellite"
            // The outer box bridges the visual gap: crossing it must not leave the chip's
            // hover region, or the list would vanish on the way to scrolling it.
            className="nodrag nopan absolute top-full left-1/2 z-50 -translate-x-1/2"
            style={{ width: lodScreenPx(208), paddingTop: lodScreenPx(4) }}
          >
            <div
              className="rounded-md border border-border bg-popover text-popover-foreground shadow-sm"
              style={{ padding: lodScreenPx(6) }}
            >
              <p className="font-medium text-muted-foreground" style={{ fontSize: lodScreenPx(10) }}>
                {t("projectGraph.hub.routesTitle", { count: hub.count })}
              </p>
              <ul className="overflow-y-auto" style={{ maxHeight: lodScreenPx(256), marginTop: lodScreenPx(2) }}>
                {data.routeLabels.map((label, index) => (
                  <li
                    key={hub.sources[index] ?? index}
                    className="truncate font-mono"
                    style={{ fontSize: lodScreenPx(10) }}
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
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
