// The chip and compact renderings of the project-graph cards (issue #60). Presentational only:
// no store hooks here, so the content is testable as static markup. Sizes that must stay
// readable at any zoom are counter-scaled through lodScreenPx (a CSS calc over the live zoom
// the canvas writes as a CSS variable), which keeps their SCREEN size constant without a React
// re-render per frame. Role tokens only (D-043/D-044); every badge is an analyzer fact.

import type { ReactNode } from "react";
import Eye from "~icons/lucide/eye";
import FileCode from "~icons/lucide/file-code";
import Route from "~icons/lucide/route";
import Table2 from "~icons/lucide/table-2";
import WorkflowIcon from "~icons/lucide/workflow";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import {
  GRAPH_LOD_CHIP_HEIGHT_PX,
  GRAPH_LOD_CHIP_HIT_PX,
  lodScreenPx,
  type GraphLodLevel,
} from "@/facilis/graph-lod";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { compactBadges } from "./ProjectGraphLodBadges";

const KIND_ICONS: Record<GraphNodeKind, typeof Eye> = {
  page: FileCode,
  route: Route,
  table: Table2,
  view: Eye,
  workflow: WorkflowIcon,
};

/** Kind colour from the same role vocabulary the edges and badges already use. */
const KIND_TONES: Record<GraphNodeKind, string> = {
  page: "border-brand/50",
  route: "border-success/50",
  table: "border-info/50",
  view: "border-info/50",
  workflow: "border-warning/50",
};

const ICON_STYLE = { width: lodScreenPx(14), height: lodScreenPx(14) };

/**
 * The chip: glyph + kind colour + kind word + short label + edge count. The kind word and the
 * count never truncate (criterion: a chip shows at least its kind and a count); the label takes
 * the remaining space. The box is 28 SCREEN px tall at every zoom; the hit area is the whole
 * node footprint, extended to >= 24 screen px by GraphLodOverlay.
 */
export function GraphLodChip({
  icon,
  kindLabel,
  label,
  count,
  countTitle,
  tone,
}: {
  icon: ReactNode;
  kindLabel: string;
  label: string;
  count: number;
  countTitle: string;
  tone: string;
}) {
  return (
    <div
      data-testid="project-graph-chip"
      className={
        "pointer-events-none flex max-h-full max-w-full items-center rounded-md border bg-card text-card-foreground " +
        tone
      }
      style={{
        height: lodScreenPx(GRAPH_LOD_CHIP_HEIGHT_PX),
        gap: lodScreenPx(4),
        paddingLeft: lodScreenPx(6),
        paddingRight: lodScreenPx(6),
      }}
    >
      {icon}
      <span
        className="shrink-0 uppercase tracking-wide text-muted-foreground"
        style={{ fontSize: lodScreenPx(9) }}
      >
        {kindLabel}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono"
        title={label}
        style={{ fontSize: lodScreenPx(11) }}
      >
        {label}
      </span>
      <span
        className="shrink-0 tabular-nums text-muted-foreground"
        title={countTitle}
        aria-label={countTitle}
        style={{ fontSize: lodScreenPx(10) }}
      >
        {count}
      </span>
    </div>
  );
}

/** The compact card: icon + name + ONE badge row, counter-scaled to constant screen sizes. */
export function GraphLodCompact({
  icon,
  name,
  badges,
}: {
  icon: ReactNode;
  name: string;
  badges: ReactNode;
}) {
  return (
    <div
      data-testid="project-graph-compact"
      className="pointer-events-none flex max-h-full w-full flex-col justify-center"
      style={{ gap: lodScreenPx(2), paddingLeft: lodScreenPx(4), paddingRight: lodScreenPx(4) }}
    >
      <div className="flex items-center" style={{ gap: lodScreenPx(4) }}>
        {icon}
        <span
          className="min-w-0 flex-1 truncate font-mono"
          title={name}
          style={{ fontSize: lodScreenPx(12) }}
        >
          {name}
        </span>
      </div>
      <div
        className="flex items-center overflow-hidden text-muted-foreground"
        style={{ gap: lodScreenPx(3), fontSize: lodScreenPx(10) }}
      >
        {badges}
      </div>
    </div>
  );
}

/**
 * Centres the chip/compact inside the UNCHANGED full-card footprint (spatial constancy, epic
 * rule 2). The invisible extender guarantees a >= 24 screen px hit area even when the footprint
 * itself shrinks below that at extreme zoom-out; clicks bubble to the React Flow node wrapper,
 * so selection, keyboard focus and double-click behave exactly as on the full card.
 */
export function GraphLodOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center motion-safe:transition-opacity motion-safe:duration-150">
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2"
        style={{
          minWidth: lodScreenPx(GRAPH_LOD_CHIP_HIT_PX),
          minHeight: lodScreenPx(GRAPH_LOD_CHIP_HIT_PX),
        }}
      />
      {children}
    </div>
  );
}

/**
 * The full content stays in the DOM at every level as the footprint sizer (spatial constancy):
 * invisible below full, it still occupies exactly the full card's box, so React Flow's measured
 * node size — and every edge anchor — is independent of the level. The opacity fade is CSS and
 * motion-safe only (prefers-reduced-motion disables it, criterion 6).
 */
export function lodSizerClass(level: GraphLodLevel): string {
  const fade = "motion-safe:transition-opacity motion-safe:duration-150";
  return level === "full" ? fade : "invisible opacity-0 " + fade;
}

/** The non-full content of an analysis card, chosen by the already-computed level. */
export function ProjectGraphLodContent({
  node,
  edgeCount,
  level,
}: {
  node: ProjectGraphNode;
  edgeCount: number;
  level: Exclude<GraphLodLevel, "full">;
}) {
  const Icon = KIND_ICONS[node.kind];
  const icon = <Icon className="shrink-0 text-muted-foreground" style={ICON_STYLE} />;
  if (level === "chip") {
    return (
      <GraphLodChip
        icon={icon}
        kindLabel={t(("projectGraph.node." + node.kind) as MessageKey)}
        label={node.label}
        count={edgeCount}
        countTitle={t("projectGraph.lod.edgeCount", { count: edgeCount })}
        tone={KIND_TONES[node.kind]}
      />
    );
  }
  return <GraphLodCompact icon={icon} name={node.label} badges={compactBadges(node)} />;
}
