// The turn-diff lens's own cards (issue #73): a tombstone for a node that existed at the turn
// base whose file is gone, and (phase 2) a ghost for a planned-but-not-yet-written path. Both
// are dashed and muted with a letter badge and a hover title — shape and label carry the kind,
// never colour alone (criterion 1). They are non-interactive except hover: no selection, no
// drag, no source to open. The canvas places a tombstone at the deleted node's last-known
// position (epic rule 2: a lens never re-layouts), and the hidden link handles stay so severed
// edges still resolve against the card.

import type { Node, NodeProps } from "@xyflow/react";
import { t } from "@/i18n";
import { LinkHandles } from "./ProjectGraphNodeChrome";

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

export function TurnDiffNode({ data }: NodeProps<ProjectTurnFlowNode>) {
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
      title={title}
      style={{ opacity }}
      className="w-56 cursor-default select-none rounded-md border border-dashed border-border bg-card/50 px-2 py-1.5 text-muted-foreground shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={
            "shrink-0 rounded border px-1 font-mono text-[9px] font-bold " +
            (deleted ? "border-destructive/50 text-destructive" : "border-info/50 text-info")
          }
        >
          {deleted ? "D" : "P"}
        </span>
        <span
          className={
            "min-w-0 flex-1 truncate font-mono text-[11px]" + (deleted ? " line-through" : "")
          }
        >
          {data.label}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[9px]">
        {deleted ? (data.sourceFile ?? data.label) : t("projectGraph.turnDiff.planned")}
      </p>
      <LinkHandles />
    </div>
  );
}
