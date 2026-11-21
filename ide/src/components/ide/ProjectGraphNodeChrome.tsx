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
 * The card frame classes. A card recedes when the search excludes it or when an AI focus (D-171)
 * names other nodes; a single opacity class keeps the two dims from stacking into an unreadable
 * card.
 */
export function nodeClass(
  selected: boolean,
  matched: boolean,
  dragging: boolean,
  focused: boolean,
): string {
  const border = selected
    ? "border-primary ring-1 ring-primary"
    : dragging
      ? "border-primary ring-1 ring-ring"
      : "hover:border-ring";
  const elevation = dragging ? "shadow-lg" : "shadow-sm";
  const dimmed = !matched || !focused;
  return NODE_BASE + elevation + " " + border + (dimmed ? " opacity-40" : "");
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
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}
