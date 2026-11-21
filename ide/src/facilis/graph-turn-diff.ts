// The agent turn-diff lens (issue #73, epic #56): the working tree overlaid on the turn's
// git checkpoint. Pure — no React, no IO, no git writes — so the overlay is unit-testable and
// the canvas only draws what this module derives from facts.
//
// Base ref: D-181 gates every AI turn on a clean HEAD, and the IDE exposes no other turn base
// (git-checkpoint.ts resolves HEAD only), so HEAD is the honest label. The lens reads the SCM
// store's staged+unstaged changes; it never writes git or .facilis (D-126).
//
// Spatial constancy (epic rule 2): the output marks existing nodes and adds tombstones at the
// deleted node's last-known position; it never moves a node. Tombstones come ONLY from the
// base snapshot captured while the tree was clean — without one, a deletion shows no tombstone
// rather than guessing (criterion 3).

import type { GitChange } from "@/vv/scm-session";
import { sourcePathFor } from "./graph-model";
import type { ProjectGraphEdge, ProjectGraphNode } from "./graph-types";

/** The kinds a live node can carry; deletions are tombstones, not a kind on a live card. */
export type TurnChangeKind = "modified" | "added";

/** What a card needs to draw the overlay: the kind plus the lens role (epic rule 3). */
export interface TurnNodeChrome {
  readonly kind: TurnChangeKind;
  /** True when the agent lens is secondary: the chrome renders at ~30% opacity. */
  readonly secondary: boolean;
}

export interface TurnDiffCounts {
  readonly changed: number;
  readonly added: number;
  readonly deleted: number;
}

/** Phase 2: a planned-but-not-yet-written path. Phase 1 wires no plan source, so none appear. */
export interface TurnGhost {
  readonly path: string;
}

/** The analyzed model remembered while the tree was clean (D-181 guarantees it at turn start). */
export interface TurnDiffBase {
  readonly nodes: readonly ProjectGraphNode[];
  readonly edges: readonly ProjectGraphEdge[];
}

export interface TurnDiffInput {
  readonly root: string | null;
  /** Merged staged+unstaged changes, one entry per path (mergeTurnChanges). */
  readonly changes: readonly GitChange[];
  readonly nodes: readonly ProjectGraphNode[];
  readonly edges: readonly ProjectGraphEdge[];
  readonly base?: TurnDiffBase | null;
  readonly planPaths?: readonly string[];
}

export interface GraphTurnDiff {
  /** False when the tree is clean: the lens draws nothing and the graph renders as without it. */
  readonly active: boolean;
  readonly baseRef: string;
  readonly nodeKinds: ReadonlyMap<string, TurnChangeKind>;
  /** Deleted base nodes at their last-known position; the ids may still be in the live model. */
  readonly tombstones: readonly ProjectGraphNode[];
  readonly tombstoneIds: ReadonlySet<string>;
  readonly changedEdgeIds: ReadonlySet<string>;
  readonly brokenEdgeIds: ReadonlySet<string>;
  /** Base edges touching a tombstone whose endpoints still resolve: drawn broken, not removed. */
  readonly severedEdges: readonly ProjectGraphEdge[];
  readonly counts: TurnDiffCounts;
  /** Changed files with no node in the current view — listed in the ribbon, never dropped. */
  readonly unmapped: readonly string[];
  readonly ghosts: readonly TurnGhost[];
}

/** What the canvas draws for the agent lens: the derived diff plus the lens role's fade. */
export interface TurnOverlay {
  readonly diff: GraphTurnDiff;
  readonly secondary: boolean;
}

/** D-181's checkpoint is HEAD; no turn-base ref is exposed anywhere in the IDE. */
export const TURN_DIFF_BASE_REF = "HEAD";

const EMPTY_COUNTS: TurnDiffCounts = { changed: 0, added: 0, deleted: 0 };

/** One shared inactive value: a clean tree (or an inactive lens) adds nothing to the canvas. */
export const INACTIVE_TURN_DIFF: GraphTurnDiff = {
  active: false,
  baseRef: TURN_DIFF_BASE_REF,
  nodeKinds: new Map(),
  tombstones: [],
  tombstoneIds: new Set(),
  changedEdgeIds: new Set(),
  brokenEdgeIds: new Set(),
  severedEdges: [],
  counts: EMPTY_COUNTS,
  unmapped: [],
  ghosts: [],
};

/**
 * Staged and unstaged are one list (the D-192 precedent): a path appears once, the staged
 * letter wins, and the order is stable so the ribbon never reshuffles between SCM walks.
 */
export function mergeTurnChanges(
  staged: readonly GitChange[],
  changes: readonly GitChange[],
): GitChange[] {
  const byPath = new Map<string, GitChange>();
  for (const change of [...staged, ...changes]) {
    if (!byPath.has(change.path)) byPath.set(change.path, change);
  }
  return [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path));
}

/** U (untracked) is absent from HEAD exactly like A, so both read as added. */
function kindOf(letter: GitChange["letter"]): TurnChangeKind | "deleted" {
  if (letter === "D") return "deleted";
  if (letter === "M") return "modified";
  return "added";
}

/** A plan path or an absolute sourceFile compared against repo-relative change paths. */
function relativePath(root: string | null, file: string): string {
  if (root !== null && file.startsWith(root + "/")) return file.slice(root.length + 1);
  return file.replace(/^\/+/, "");
}

export function computeTurnDiff(input: TurnDiffInput): GraphTurnDiff {
  const { root, changes, nodes, edges } = input;
  const base = input.base ?? null;
  if (changes.length === 0) return INACTIVE_TURN_DIFF;

  const modified = new Set<string>();
  const added = new Set<string>();
  const deleted = new Set<string>();
  let changed = 0;
  let addedCount = 0;
  let deletedCount = 0;
  for (const change of changes) {
    const kind = kindOf(change.letter);
    if (kind === "modified") {
      modified.add(change.abs);
      changed += 1;
    } else if (kind === "added") {
      added.add(change.abs);
      addedCount += 1;
    } else {
      deleted.add(change.abs);
      deletedCount += 1;
    }
  }

  // Node mapping goes through sourcePathFor, the same resolution the open-source click uses.
  const nodeKinds = new Map<string, TurnChangeKind>();
  const currentById = new Map(nodes.map((node) => [node.id, node]));
  const mappedAbs = new Set<string>();
  for (const node of nodes) {
    const abs = sourcePathFor(root, node.sourceFile);
    if (abs === null) continue;
    mappedAbs.add(abs);
    if (modified.has(abs)) nodeKinds.set(node.id, "modified");
    else if (added.has(abs)) nodeKinds.set(node.id, "added");
  }

  // Tombstones only for base nodes whose file is gone (criterion 3). A stale analysis may still
  // draw the deleted node: it is tombstoned in place, at its live position. A deleted file with
  // no base node (added then deleted within the turn, or no snapshot yet) gets no tombstone.
  const tombstones: ProjectGraphNode[] = [];
  const tombstoneIds = new Set<string>();
  const tombstonedAbs = new Set<string>();
  if (base !== null) {
    for (const baseNode of base.nodes) {
      const abs = sourcePathFor(root, baseNode.sourceFile);
      if (abs === null || !deleted.has(abs)) continue;
      tombstones.push(currentById.get(baseNode.id) ?? baseNode);
      tombstoneIds.add(baseNode.id);
      tombstonedAbs.add(abs);
      nodeKinds.delete(baseNode.id);
    }
  }

  const changedEdgeIds = new Set<string>();
  const brokenEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (tombstoneIds.has(edge.source) || tombstoneIds.has(edge.target)) brokenEdgeIds.add(edge.id);
    else if (nodeKinds.has(edge.source) || nodeKinds.has(edge.target)) changedEdgeIds.add(edge.id);
  }
  // A deleted table breaks its edges visibly: the base edges touching a tombstone stay drawn
  // (broken) while both endpoints still resolve. Edges to nodes that vanished entirely drop.
  const severedEdges: ProjectGraphEdge[] = [];
  if (base !== null && tombstoneIds.size > 0) {
    const liveEdgeIds = new Set(edges.map((edge) => edge.id));
    const resolvable = new Set([...currentById.keys(), ...tombstoneIds]);
    for (const edge of base.edges) {
      if (liveEdgeIds.has(edge.id)) continue;
      if (!tombstoneIds.has(edge.source) && !tombstoneIds.has(edge.target)) continue;
      if (!resolvable.has(edge.source) || !resolvable.has(edge.target)) continue;
      severedEdges.push(edge);
    }
  }

  const unmapped: string[] = [];
  for (const change of changes) {
    if (mappedAbs.has(change.abs) || tombstonedAbs.has(change.abs)) continue;
    unmapped.push(change.path);
  }

  // Phase 2 ghosts: plan paths that are neither live nodes nor already-written changes. Absent
  // planPaths (all of phase 1) leave this empty — the lens never depends on a plan existing.
  const ghosts: TurnGhost[] = [];
  const planPaths = input.planPaths ?? [];
  if (planPaths.length > 0) {
    const taken = new Set([
      ...nodes.map((node) => relativePath(root, node.sourceFile ?? "")),
      ...changes.map((change) => change.path),
    ]);
    const seen = new Set<string>();
    for (const path of planPaths) {
      const rel = relativePath(root, path);
      if (rel === "" || taken.has(rel) || seen.has(rel)) continue;
      seen.add(rel);
      ghosts.push({ path: rel });
    }
  }

  return {
    active: true,
    baseRef: TURN_DIFF_BASE_REF,
    nodeKinds,
    tombstones,
    tombstoneIds,
    changedEdgeIds,
    brokenEdgeIds,
    severedEdges,
    counts: { changed, added: addedCount, deleted: deletedCount },
    unmapped,
    ghosts,
  };
}
