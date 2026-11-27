// The keyboard model of the commit list (issue #226): React Flow's node wrappers are
// focusable but their Enter/Space selection is dropped by the controlled graph (no
// onNodesChange), so the visible list beside the canvas is the keyboard path. Pure: the
// builder mirrors the model's newest-first nodes and the intent function turns a key into
// what the list should do, so the rules are unit-tested (the IDE ships no jsdom).

import type { CommitGraph } from "./commit-graph-model.ts";

/** A row of the list: the fields the row shows plus the ones its accessible name needs. */
export interface CommitListRow {
  readonly id: string;
  readonly oid: string;
  readonly summary: string;
  readonly short: string;
  readonly author: string;
  readonly branches: readonly string[];
  readonly head: boolean;
}

/** The parts of a key event the list reads. */
export interface CommitListKeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type CommitListIntent =
  { kind: "active"; id: string } | { kind: "select"; id: string } | { kind: "clear" };

export interface CommitListOptionAttributes {
  role: "option";
  "aria-selected": boolean;
  tabIndex: 0 | -1;
}

/**
 * The rows in the model's order (newest first), with the summary already reduced to the
 * subject line by the model. The list never reorders: it mirrors the canvas.
 */
export function buildCommitListRows(graph: CommitGraph): readonly CommitListRow[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    oid: node.data.oid,
    summary: node.data.message,
    short: node.data.short,
    author: node.data.author,
    branches: node.data.branches,
    head: node.data.head,
  }));
}

/**
 * The row that holds the list's single roving tab stop. A missing id (the graph reloaded
 * or the row was never focused) recovers to the first row, so the list never loses it.
 */
export function activeCommitRow(
  rows: readonly CommitListRow[],
  activeId: string | null,
): CommitListRow | null {
  if (rows.length === 0) return null;
  return rows.find((row) => row.id === activeId) ?? rows[0];
}

/**
 * What a key pressed inside the listbox means, or null when it is not the list's. Arrows and
 * Home/End move the active row only; Enter/Space select it (which opens the inspector) and
 * Escape clears the selection. Modified chords belong to the window shortcuts, never here.
 */
export function commitListIntent(
  rows: readonly CommitListRow[],
  activeId: string | null,
  e: CommitListKeyLike,
): CommitListIntent | null {
  if (rows.length === 0) return null;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const index = rows.findIndex((row) => row.id === activeId);
  const at = index === -1 ? 0 : index;
  switch (e.key) {
    case "ArrowUp":
      return { kind: "active", id: rows[Math.max(0, at - 1)].id };
    case "ArrowDown":
      return { kind: "active", id: rows[Math.min(rows.length - 1, at + 1)].id };
    case "Home":
      return { kind: "active", id: rows[0].id };
    case "End":
      return { kind: "active", id: rows[rows.length - 1].id };
    case "Enter":
    case " ":
      return { kind: "select", id: rows[at].id };
    case "Escape":
      return { kind: "clear" };
    default:
      return null;
  }
}

/** The ARIA/roving-tabindex attributes an option is rendered with. */
export function commitListOptionAttributes(
  active: boolean,
  selected: boolean,
): CommitListOptionAttributes {
  return { role: "option", "aria-selected": selected, tabIndex: active ? 0 : -1 };
}
