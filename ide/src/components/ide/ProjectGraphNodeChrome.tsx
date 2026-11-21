// The chrome the project-graph node cards share: the card frame, the hidden link handles React
// Flow resolves an edge from, the "open source" title and the unknown badge. It sits in its own
// module so the card files (page/table in ProjectGraphNodes.tsx, route in
// ProjectGraphRouteNode.tsx) can share it without importing each other.

import { Handle, Position } from "@xyflow/react";
import { t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { TurnNodeChrome } from "@/facilis/graph-turn-diff";

// select-none: dragging a card or box-selecting must not paint the card text as selected.
// The surface is appended by nodeClass: an added node's ghost outline is translucent.
const NODE_BASE = "cursor-pointer select-none rounded-md border px-2 py-1.5 text-card-foreground ";

/**
 * The card frame classes. Four independent dim channels: the USER focus dims every card outside
 * the selection's closure to 12% (issue #66), edge-kind isolation (issue #63) recedes to 10%,
 * and a search miss or an audit-ribbon filter miss (issue #69) to 40% — the strongest dim wins
 * so they never stack into an unreadable card. The AI focus (D-171) no longer dims: it OUTLINES
 * the cards it names, in the brand role, so it stays visible even on a dimmed card and composes
 * with the user's dimming. The contract lens's diagnostics ring (issue #69) shares that single
 * outline channel: the AI outline wins when both apply, and the lens's glyph+count badge keeps
 * the severity visible on the card (epic rule 6 — never colour alone).
 *
 * The turn-diff overlay (issue #73) composes on top as shape, never as a dim: a modified card
 * earns a warning RING (the selection keeps its own ring-1 when both apply, and the AI focus
 * keeps its distinct brand OUTLINE), an added card a dashed translucent surface. A secondary
 * agent lens fades its own chrome to ~30% (epic rule 3) without touching the other channels.
 */
export function nodeClass(
  selected: boolean,
  matched: boolean,
  dragging: boolean,
  focused: boolean,
  isolated: boolean,
  aiOutlined: boolean,
  auditDimmed: boolean,
  diagnosticsRing: string,
  turn: TurnNodeChrome | null = null,
): string {
  const added = turn?.kind === "added";
  const border = selected
    ? "border-primary ring-1 ring-primary"
    : dragging
      ? "border-primary ring-1 ring-ring"
      : added
        ? turn?.secondary === true
          ? "border-success/25"
          : "border-success/70"
        : "hover:border-ring";
  // The halo is a ring, not an outline: the AI focus and the diagnostics ring own the single
  // outline channel, so the two frames stay distinguishable when a card carries both.
  const halo =
    turn?.kind === "modified" && !selected && !dragging
      ? turn.secondary
        ? " ring-2 ring-warning/20"
        : " ring-2 ring-warning/60"
      : "";
  const surface = added ? " border-dashed bg-card/60" : " bg-card";
  const elevation = dragging ? "shadow-lg" : "shadow-sm";
  const opacity = isolated
    ? " opacity-10"
    : !focused
      ? " opacity-12"
      : !matched || auditDimmed
        ? " opacity-40"
        : "";
  // outline (not ring): the selection already owns the ring, and the offset keeps the two
  // frames apart when a card is both selected and AI-named.
  const outline = aiOutlined
    ? " outline outline-2 outline-offset-2 outline-brand/70"
    : diagnosticsRing;
  return NODE_BASE + surface + " " + elevation + " " + border + halo + opacity + outline;
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
export function turnSourceTitle(
  node: ProjectGraphNode,
  turn: TurnNodeChrome | null | undefined,
): string {
  const base = sourceTitle(node);
  if (turn === null || turn === undefined) return base;
  const kind = t(
    turn.kind === "modified" ? "projectGraph.turnDiff.modified" : "projectGraph.turnDiff.addedNode",
  );
  return base + " — " + kind;
}

export function UnknownBadge() {
  return (
    <span className="shrink-0 rounded border border-warning/50 px-1 text-[10px] text-warning">
      {t("projectGraph.unknown")}
    </span>
  );
}
