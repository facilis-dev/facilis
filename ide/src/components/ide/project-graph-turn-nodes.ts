// The agent lens's own React Flow cards (issue #73), mapped outside the analysis-card builder so
// that file stays under the 300-line source limit. Tombstones come only from the clean-tree
// snapshot the lens hook remembered (criterion 3), and phase-2 ghosts exist only when a plan
// source supplies paths — phase 1 wires none, so the ghost loop is inert. Every card is
// transient: non-draggable, non-selectable and never written to the saved layout (epic rule 2).

import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { TurnOverlay } from "@/facilis/graph-turn-diff";
import { TURN_NODE_TYPE, type ProjectTurnFlowNode } from "./ProjectGraphTurnNode";

/** The dim channels a tombstone composes, read from the same mapping as the live cards. */
export interface TurnNodeChannels {
  readonly focused: (id: string) => boolean;
  readonly isolated: (id: string) => boolean;
  readonly secondary: boolean;
}

/** Deleted base nodes keyed by id, or null when the lens is off/inactive (nothing to draw). */
export function tombstoneIndex(
  turn: TurnOverlay | null,
): ReadonlyMap<string, ProjectGraphNode> | null {
  if (turn === null || !turn.diff.active) return null;
  return new Map(turn.diff.tombstones.map((node) => [node.id, node]));
}

export function buildTurnNode(
  id: string,
  turnKind: "deleted" | "planned",
  label: string,
  sourceFile: string | null,
  position: { x: number; y: number },
  channels: TurnNodeChannels,
): ProjectTurnFlowNode {
  return {
    id,
    type: TURN_NODE_TYPE,
    position,
    data: {
      turnKind,
      label,
      sourceFile,
      focused: channels.focused(id),
      isolated: channels.isolated(id),
      secondary: channels.secondary,
    },
    // Tombstones and ghosts are hover-only: no drag, no selection, no keyboard stop, so they can
    // never commit a position or a layout write the lens must not make (read-only, D-181).
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
  };
}

/**
 * Tombstones the live model no longer draws, at their last-known position, plus the phase-2
 * ghosts parked below the graph. A stale analysis that still draws the node keeps it in place
 * through buildTurnNode in the analysis mapping, not here — one card per id, always.
 */
export function buildTurnExtras(
  turn: TurnOverlay | null,
  view: ProjectGraphView,
  channels: TurnNodeChannels,
): ProjectTurnFlowNode[] {
  if (turn === null || !turn.diff.active) return [];
  const liveIds = new Set(view.nodes.map((node) => node.id));
  const out: ProjectTurnFlowNode[] = [];
  for (const node of turn.diff.tombstones) {
    if (liveIds.has(node.id)) continue;
    out.push(
      buildTurnNode(node.id, "deleted", node.label, node.sourceFile, node.position, channels),
    );
  }
  // Phase-2 ghosts: plan paths park below the lowest card, in the pages column. Phase 1 passes
  // no plan paths, so this loop never runs and the graph bounds never grow.
  const lowest = Math.max(0, ...view.nodes.map((node) => node.position.y));
  turn.diff.ghosts.forEach((ghost, index) => {
    out.push(
      buildTurnNode(
        "turn-ghost:" + ghost.path,
        "planned",
        ghost.path,
        null,
        {
          x: 0,
          y: lowest + 200 + index * 120,
        },
        channels,
      ),
    );
  });
  return out;
}
