// The chrome the project-graph node cards share: the card frame, the hidden link handles React
// Flow resolves an edge from, the "open source" title and the unknown badge. It sits in its own
// module so the card files (page/table in ProjectGraphNodes.tsx, route in
// ProjectGraphRouteNode.tsx) can share it without importing each other.

import { Handle, Position } from "@xyflow/react";
import { t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { TurnNodeChrome } from "@/facilis/graph-turn-diff";

// select-none: dragging a card or box-selecting must not paint the card text as selected.
// The surface (bg-card) is appended by nodeClass: an added node's ghost outline is translucent.
const NODE_BASE = "cursor-pointer select-none rounded-md border px-2 py-1.5 text-card-foreground ";

/**
 * The card frame classes. A card recedes when the search excludes it or when an AI focus (D-171)
 * names other nodes; edge-kind isolation (issue #63) recedes it further to 10%. A single opacity
 * class keeps the dims from stacking into an unreadable card.
 *
 * The turn-diff overlay (issue #73) composes on top: modified earns a warning halo (the AI focus
 * dims and the selection ring stays primary, so the three remain distinct), added earns a dashed
 * ghost outline. Shape carries the kind; a secondary lens fades the chrome to ~30% (epic rule 3).
 */
export function nodeClass(
  selected: boolean,
  matched: boolean,
  dragging: boolean,
  focused: boolean,
  isolated: boolean,
  turn: TurnNodeChrome | null = null,
): string {
  const added = turn?.kind === "added";
  const border = selected
    ? "border-primary ring-1 ring-primary"
    : dragging
      ? "border-primary ring-1 ring-ring"
      : added
        ? turn.secondary
          ? "border-success/25"
          : "border-success/70"
        : "hover:border-ring";
  const halo =
    turn?.kind === "modified" && !selected && !dragging
      ? turn.secondary
        ? " ring-2 ring-warning/20"
        : " ring-2 ring-warning/60"
      : "";
  const surface = added ? " border-dashed bg-card/60" : " bg-card";
  const elevation = dragging ? "shadow-lg" : "shadow-sm";
  const dimmed = !matched || !focused;
  const opacity = isolated ? " opacity-10" : dimmed ? " opacity-40" : "";
  return NODE_BASE + surface + " " + elevation + " " + border + halo + opacity;
}

/**
 * The turn-diff letter badge (issue #73): M/A are git status symbols, like the route method
 * badges — the translated title carries the meaning, so colour is never the only signal.
 */
export function TurnBadge({ turn }: { turn: TurnNodeChrome }) {
  const modified = turn.kind === "modified";
  return (
    <span
      data-testid={"project-graph-turn-" + turn.kind}
      title={t(modified ? "projectGraph.turnDiff.modified" : "projectGraph.turnDiff.addedNode")}
      className={
        "shrink-0 rounded border px-1 font-mono text-[9px] font-bold " +
        (modified ? "border-warning/50 text-warning" : "border-success/50 text-success") +
        (turn.secondary ? " opacity-30" : "")
      }
    >
      {modified ? "M" : "A"}
    </span>
  );
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

/** Hovering a changed card names the change kind beside the open-source hint (issue #73). */
export function turnSourceTitle(node: ProjectGraphNode, turn: TurnNodeChrome | null): string {
  const base = sourceTitle(node);
  if (turn === null) return base;
  const kind = t(
    turn.kind === "modified" ? "projectGraph.turnDiff.modified" : "projectGraph.turnDiff.addedNode",
  );
  return base + " — " + kind;
}

export function UnknownBadge() {
  return (
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}
