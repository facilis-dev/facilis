// The agent turn-diff lens's data source (issue #73): the SCM store's working-tree changes
// against the turn checkpoint, composed with the analyzed view and the lens activation state.
// Store-driven like the D-192 chat footer — a commit, discard or AI write elsewhere updates the
// overlay here too. Read-only: nothing in this hook writes git or .facilis.
//
// Tombstone base: the analyzer result the panel holds is remembered whenever the tree is clean
// (D-181 guarantees a clean HEAD at turn start). When a deletion later empties the live model,
// the tombstone comes from that snapshot at its last-known position. If the lens first activates
// after a deletion with no clean snapshot yet, no tombstone is shown rather than guessing
// (criterion 3). The snapshot is the drawn view, so a node hidden by a user filter while the
// tree was clean is honestly "not on the graph" rather than a fabricated tombstone.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { lensRole } from "@/facilis/graph-lens-state";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  INACTIVE_TURN_DIFF,
  computeTurnDiff,
  mergeTurnChanges,
  type GraphTurnDiff,
  type TurnDiffBase,
  type TurnOverlay,
} from "@/facilis/graph-turn-diff";
import type { GraphLensId } from "@/facilis/graph-view-state";
import type { IdeController } from "@/vv/controller";

export interface GraphTurnDiffState {
  readonly diff: GraphTurnDiff;
  /** The agent lens's role (epic rule 3); null when the lens is not active. */
  readonly role: "dominant" | "secondary" | null;
  /** False without a git repo or an analysis: the ribbon says so instead of guessing "clean". */
  readonly ready: boolean;
  /** What the canvas draws: the diff plus its role fade, or null when the lens is off. */
  readonly overlay: TurnOverlay | null;
}

export function useGraphTurnDiff(
  c: IdeController,
  root: string | null,
  view: ProjectGraphView | null,
  activeLenses: readonly GraphLensId[],
): GraphTurnDiffState {
  const scm = useSyncExternalStore(c.scm.subscribe, c.scm.getSnapshot);
  const repo = root === null ? undefined : scm.repos.find((entry) => entry.root === root);
  const changes = useMemo(
    () => (repo !== undefined && repo.isRepo ? mergeTurnChanges(repo.staged, repo.changes) : []),
    [repo],
  );

  const base = useRef<TurnDiffBase | null>(null);
  // Remember the last model seen with an empty diff; a dirty tree keeps the previous snapshot.
  useEffect(() => {
    if (view !== null && changes.length === 0) {
      base.current = { nodes: view.nodes, edges: view.edges };
    }
  }, [view, changes]);
  // Another project's nodes must never become this project's tombstones.
  useEffect(() => {
    base.current = null;
  }, [root]);

  const role = lensRole(activeLenses, "agent");
  const diff = useMemo(() => {
    if (role === null || view === null) return INACTIVE_TURN_DIFF;
    return computeTurnDiff({
      root,
      changes,
      nodes: view.nodes,
      edges: view.edges,
      base: base.current,
      // Phase 1 wires no plan source; phase 2 passes the agent plan's target paths here.
    });
  }, [role, root, changes, view]);
  const overlay = useMemo<TurnOverlay | null>(
    () => (role === null ? null : { diff, secondary: role === "secondary" }),
    [role, diff],
  );
  const ready = repo !== undefined && repo.isRepo && view !== null;
  return { diff, role, ready, overlay };
}
