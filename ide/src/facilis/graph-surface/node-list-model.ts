// The keyboard model of the project-graph node list (issue #213): the nodes are canvas paint,
// so the surface mirrors them as a real listbox rail beside the map. Pure: the flattening mirrors
// the a11y groups, and the intent function turns a key into what the list should do, so the
// roving-tabindex/arrow rules are unit-tested (the IDE ships no jsdom).

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { A11yNodeGroup } from "./a11y-nodes.ts";

/** A row of the rail: the node id plus the facts its visible label and accessible name need. */
export interface NodeListOption {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** The group the option is rendered under (domain in the overview, lane in detail). */
  readonly groupKey: string;
}

/** The parts of a key event the list reads. */
export interface NodeListKeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type NodeListIntent = { kind: "active"; id: string } | { kind: "select"; id: string };

export interface NodeListOptionAttributes {
  role: "option";
  "aria-selected": boolean;
  tabIndex: 0 | -1;
}

/**
 * The options in canvas group order (the groups are already sorted). The rail renders the groups;
 * this flat sequence is what the roving tabindex walks, so the two cannot disagree.
 */
export function buildNodeListOptions(groups: readonly A11yNodeGroup[]): readonly NodeListOption[] {
  return groups.flatMap((group) =>
    group.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      groupKey: group.key,
    })),
  );
}

/**
 * The option that owns the list's single roving tab stop. A missing id (the graph reloaded or
 * the selection left the visible set) recovers to the first option, so the list never loses it.
 */
export function activeNodeOption(
  options: readonly NodeListOption[],
  activeId: string | null,
): NodeListOption | null {
  if (options.length === 0) return null;
  return options.find((option) => option.id === activeId) ?? options[0];
}

/**
 * What a key pressed inside the listbox means, or null when it is not the list's. Arrows and
 * Home/End move the active option only; Enter/Space select it (which opens the inspector from the
 * overview exactly like a canvas click); every other key, including the Escape owned by the
 * graph's single ladder, is left alone. Modified chords belong to the window shortcuts.
 */
export function nodeListIntent(
  options: readonly NodeListOption[],
  activeId: string | null,
  event: NodeListKeyLike,
): NodeListIntent | null {
  if (options.length === 0) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const index = options.findIndex((option) => option.id === activeId);
  const at = index === -1 ? 0 : index;
  switch (event.key) {
    case "ArrowUp":
      return { kind: "active", id: options[Math.max(0, at - 1)].id };
    case "ArrowDown":
      return { kind: "active", id: options[Math.min(options.length - 1, at + 1)].id };
    case "Home":
      return { kind: "active", id: options[0].id };
    case "End":
      return { kind: "active", id: options[options.length - 1].id };
    case "Enter":
    case " ":
      return { kind: "select", id: options[at].id };
    default:
      return null;
  }
}

/** The ARIA/roving-tabindex attributes an option is rendered with. */
export function nodeListOptionAttributes(
  active: boolean,
  selected: boolean,
): NodeListOptionAttributes {
  return { role: "option", "aria-selected": selected, tabIndex: active ? 0 : -1 };
}

/**
 * The activation contract in one testable place: from the overview, open the node's domain first
 * so the canvas reveals it, then hand the id to the panel's existing selection handler (which
 * opens the same drawer a canvas click opens).
 */
export function selectListNode(
  nodeId: string,
  domain: string | null,
  detailDomain: string | null,
  onSelectNode: (id: string) => void,
  onOpenDomain: (domain: string) => void,
): void {
  if (detailDomain === null && domain !== null) onOpenDomain(domain);
  onSelectNode(nodeId);
}
