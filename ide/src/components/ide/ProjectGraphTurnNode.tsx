// The turn-diff lens's own cards (issue #73): a tombstone for a node that existed at the turn
// base whose file is gone, and (phase 2) a ghost for a planned-but-not-yet-written path. Both
// are dashed and muted with a letter badge and a hover title — shape and label carry the kind,
// never colour alone (criterion 1). They are non-interactive except hover: no selection, no
// drag, no source to open. The canvas places a tombstone at the deleted node's last-known
// position (epic rule 2: a lens never re-layouts), and the hidden link handles stay so severed
// edges still resolve against the card.
//
// LOD (epic rule 4): the text counter-scales through lodScreenPx, so the letter badge and the
// name never drop below the 7 px screen floor; below the chip threshold the name yields to the
// glyph alone, the chip-level "glyph + count" rule. The card is a transient overlay, not a
// layout member: its position is the deleted node's last-known one at every zoom, and no layout
// write ever learns about it (spatial constancy, epic rule 2).

import type { Node, NodeProps } from "@xyflow/react";
import { t } from "@/i18n";
import { lodScreenPx } from "@/facilis/graph-lod";
import { LinkHandles } from "./ProjectGraphNodeChrome";
import { useGraphLod } from "./use-graph-lod";

export const TURN_NODE_TYPE = "turn-diff";

/** React Flow's data bound wants an object alias, not an interface. */
export type TurnDiffFlowData = {
  turnKind: "deleted" | "planned";
  label: string;
  sourceFile: string | null;
  /** False when an AI focus request (D-171) names other nodes: the card recedes with the rest. */
  focused: boolean;
  /** True when edge-kind isolation (issue #63) names no edge touching this card. */
  isolated: boolean;
  /** True when the agent lens is secondary: the whole card is lens chrome at ~30% (epic rule 3). */
  secondary: boolean;
};

export type ProjectTurnFlowNode = Node<TurnDiffFlowData, typeof TURN_NODE_TYPE>;

const BADGE_STYLE = { fontSize: lodScreenPx(9) };
const NAME_STYLE = { fontSize: lodScreenPx(11) };
const PATH_STYLE = { fontSize: lodScreenPx(9) };

export function TurnDiffNode({ data }: NodeProps<ProjectTurnFlowNode>) {
  const level = useGraphLod();
  const deleted = data.turnKind === "deleted";
  const title = deleted
    ? t("projectGraph.turnDiff.deletedHint", { source: data.sourceFile ?? data.label })
    : t("projectGraph.turnDiff.plannedHint", { path: data.label });
  // The strongest dim wins, the same rule the live cards use: isolation 10%, a secondary lens
  // 30%, an AI focus naming other nodes 40% — never stacked into an invisible card.
  const opacity = Math.min(
    data.isolated ? 0.1 : 1,
    data.focused ? 1 : 0.4,
    data.secondary ? 0.3 : 1,
  );
  return (
    <div
      data-testid="project-graph-turn-node"
      data-lod={level}
      title={title}
      style={{ opacity }}
      className="w-56 cursor-default select-none rounded-md border border-dashed border-border bg-card/50 px-2 py-1.5 text-muted-foreground shadow-sm"
    >
      <div className="flex items-center gap-1.5 overflow-hidden">
        <span
          className={
            "shrink-0 rounded border px-1 font-mono font-bold " +
            (deleted ? "border-destructive/50 text-destructive" : "border-info/50 text-info")
          }
          style={BADGE_STYLE}
        >
          {deleted ? "D" : "P"}
        </span>
        {level !== "chip" && (
          <span
            className={"min-w-0 flex-1 truncate font-mono" + (deleted ? " line-through" : "")}
            style={NAME_STYLE}
          >
            {data.label}
          </span>
        )}
      </div>
      {level === "full" && (
        <p className="mt-0.5 truncate" style={PATH_STYLE}>
          {deleted ? (data.sourceFile ?? data.label) : t("projectGraph.turnDiff.planned")}
        </p>
      )}
      <LinkHandles />
    </div>
  );
}
