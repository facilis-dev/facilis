// The chrome the project-graph node cards share: the card frame, the hidden link handles React
// Flow resolves an edge from, the "open source" title and the unknown badge. It sits in its own
// module so the card files (page/table in ProjectGraphNodes.tsx, route in
// ProjectGraphRouteNode.tsx) can share it without importing each other.

import { Handle, Position } from "@xyflow/react";
import { t, type MessageKey } from "@/i18n";
import type { ColumnMarker, ProjectGraphNode } from "@/facilis/graph-model";

// select-none: dragging a card or box-selecting must not paint the card text as selected.
const NODE_BASE =
  "cursor-pointer select-none rounded-md border bg-card px-2 py-1.5 text-card-foreground ";

/**
 * The card frame classes. Three independent channels (issue #66): the USER focus dims every
 * card outside the selection's closure to 12%, edge-kind isolation (issue #63) recedes to 10%,
 * and a search miss to 40% — the strongest dim wins so they never stack into an unreadable
 * card. The AI focus (D-171) no longer dims: it OUTLINES the cards it names, in the brand role,
 * so it stays visible even on a dimmed card and composes with the user's dimming.
 */
export function nodeClass(
  selected: boolean,
  matched: boolean,
  dragging: boolean,
  focused: boolean,
  isolated: boolean,
  aiOutlined: boolean,
  impactDimmed = false,
): string {
  const border = selected
    ? "border-primary ring-1 ring-primary"
    : dragging
      ? "border-primary ring-1 ring-ring"
      : "hover:border-ring";
  const elevation = dragging ? "shadow-lg" : "shadow-sm";
  // The impact lens (issue #74) dims outsiders like the user focus; the strongest dim wins.
  const opacity = isolated
    ? " opacity-10"
    : !focused || impactDimmed
      ? " opacity-12"
      : !matched
        ? " opacity-40"
        : "";
  // outline (not ring): the selection already owns the ring, and the offset keeps the two
  // frames apart when a card is both selected and AI-named.
  const outline = aiOutlined ? " outline outline-2 outline-offset-2 outline-brand/70" : "";
  return NODE_BASE + elevation + " " + border + opacity + outline;
}

/**
 * The hidden anchors React Flow needs to resolve an edge at all. The custom edge overrides
 * their fixed sides with floating border intersections, so they only have to exist.
 */
export function LinkHandles() {
  return (
    <>
      <Handle
        id={LINK_SOURCE_HANDLE_ID}
        type="source"
        position={Position.Right}
        className="pointer-events-none opacity-0"
        style={LINK_HANDLE_STYLE}
      />
      <Handle
        id={LINK_TARGET_HANDLE_ID}
        type="target"
        position={Position.Left}
        className="pointer-events-none opacity-0"
        style={LINK_HANDLE_STYLE}
      />
    </>
  );
}

export const LINK_SOURCE_HANDLE_ID = "link-source";
export const LINK_TARGET_HANDLE_ID = "link-target";

const LINK_HANDLE_STYLE = { width: "1px", height: "1px" };

export function sourceTitle(node: ProjectGraphNode): string {
  return t("projectGraph.nodeTitle", { source: node.sourceFile ?? node.label });
}

export function UnknownBadge() {
  return (
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}

/** The column marker chips shared by the table card's rows (moved here to keep cards lean). */
export function ColumnMarkers({ markers }: { markers: readonly ColumnMarker[] }) {
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

/** The impact lens's target marker (issue #74): this card is being simulated as removed. */
export function ImpactTargetBadge() {
  return (
    <span
      title={t("projectGraph.impact.simulatingHint")}
      className="shrink-0 rounded border border-destructive/50 bg-destructive/10 px-1 text-[9px] text-destructive"
    >
      {t("projectGraph.impact.simulating")}
    </span>
  );
}

/** The impact lens's muted observation: no route reads this table, directly or via a view. */
export function NeverReadBadge() {
  return (
    <span
      title={t("projectGraph.impact.neverReadHint")}
      className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground"
    >
      {t("projectGraph.impact.neverRead")}
    </span>
  );
}
