// The chrome the project-graph node cards share: the card frame, the hidden link handles React
// Flow resolves an edge from, the "open source" title and the unknown badge. It sits in its own
// module so the card files (page/table in ProjectGraphNodes.tsx, route in
// ProjectGraphRouteNode.tsx) can share it without importing each other.

import { Handle, Position } from "@xyflow/react";
import { t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";

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
): string {
  const border = selected
    ? "border-primary ring-1 ring-primary"
    : dragging
      ? "border-primary ring-1 ring-ring"
      : "hover:border-ring";
  const elevation = dragging ? "shadow-lg" : "shadow-sm";
  const opacity = isolated
    ? " opacity-10"
    : !focused
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
  return t("projectGraph.openSource", { source: node.sourceFile ?? node.label });
}

export function UnknownBadge() {
  return (
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[10px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}
