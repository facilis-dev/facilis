// The command palette's index and fuzzy ranker (issue #68, epic #56 rule 6). Pure so the
// ranking contract is unit-testable without a browser: exact label matches first, then label
// prefixes, then exact/prefix matches on the other facts (id, route paths, file path), then a
// fuzzy subsequence. Results group by kind — commands first, then the node kinds in column
// order — and every entry carries the node's kind so the dialog can draw the same badge the
// stats ribbon uses. The index is built once per view (useMemo in the navigation hook); the
// ranker runs per keystroke and must stay well under the 100 ms open budget at 500 nodes.

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS, type ProjectGraphNode } from "./graph-types";

/** The node kinds in layout-column order; the palette groups follow it. */
export const PALETTE_NODE_KINDS: readonly GraphNodeKind[] = [
  "page",
  "route",
  "table",
  "view",
  "workflow",
];

export type PaletteCommandId =
  "fit" | "reset-layout" | "toggle-matrix" | "save-layout" | `isolate-edge:${GraphEdgeKind}`;

export interface PaletteCommand {
  readonly id: PaletteCommandId;
  /** An i18n key; the dialog resolves it through t() (D-043). */
  readonly labelKey: string;
  /** Set on the per-kind isolate commands: the dialog interpolates the edge's label key. */
  readonly edgeKind?: GraphEdgeKind;
  /** The keyboard shortcut that also reaches the action, shown as a hint when one exists. */
  readonly shortcut?: string;
}

/** Every palette command (issue #68): one per action, one per edge kind for isolation. */
export const GRAPH_PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { id: "fit", labelKey: "projectGraph.fit", shortcut: "F" },
  { id: "reset-layout", labelKey: "projectGraph.resetLayout" },
  { id: "toggle-matrix", labelKey: "projectGraph.palette.toggleMatrix", shortcut: "M" },
  { id: "save-layout", labelKey: "projectGraph.save" },
  ...GRAPH_EDGE_KINDS.map((kind): PaletteCommand => ({
    id: `isolate-edge:${kind}`,
    labelKey: "projectGraph.palette.isolateEdge",
    edgeKind: kind,
  })),
];

export interface PaletteNodeEntry {
  readonly type: "node";
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** The secondary line: the route path, page path or source file the query can hit. */
  readonly detail: string;
}

export interface PaletteCommandEntry {
  readonly type: "command";
  readonly command: PaletteCommand;
}

export type PaletteEntry = PaletteNodeEntry | PaletteCommandEntry;

export interface PaletteGroup {
  readonly kind: GraphNodeKind | "command";
  readonly entries: readonly PaletteEntry[];
}

interface IndexedNode {
  readonly entry: PaletteNodeEntry;
  /** Lowercased search fields: label first, then id, route/page paths, source file. */
  readonly fields: readonly string[];
}

export interface PaletteIndex {
  readonly nodes: readonly IndexedNode[];
  readonly commands: readonly PaletteCommand[];
}

/** The route/page paths a node exposes to search, derived from its analyzer facts. */
function routeFields(node: ProjectGraphNode): string[] {
  if (node.data.kind === "route") return [node.data.path];
  if (node.data.kind === "page") return [node.data.pagePath, ...node.data.routePaths];
  return [];
}

/** Build the search index once per view; every field is lowercased up front. */
export function buildPaletteIndex(
  nodes: readonly ProjectGraphNode[],
  commands: readonly PaletteCommand[] = GRAPH_PALETTE_COMMANDS,
): PaletteIndex {
  return {
    nodes: nodes.map((node) => {
      const paths = routeFields(node);
      const detail = paths[0] ?? node.sourceFile ?? node.id;
      return {
        entry: { type: "node", id: node.id, kind: node.kind, label: node.label, detail },
        fields: [node.label, node.id, ...paths, node.sourceFile ?? ""].map((field) =>
          field.toLowerCase(),
        ),
      };
    }),
    commands,
  };
}

/**
 * Subsequence score, or null when the query is not a subsequence of the text. Lower is better:
 * the span the match covers plus the start position, so compact leading matches win. Both
 * inputs must already be lowercased.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  let cursor = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < query.length; i += 1) {
    const found = text.indexOf(query[i], cursor);
    if (found < 0) return null;
    if (start < 0) start = found;
    end = found;
    cursor = found + 1;
  }
  return end - start + start * 0.1;
}

/** Rank tiers: exact label, label prefix, exact other field, other-field prefix, fuzzy. */
function nodeTier(
  query: string,
  fields: readonly string[],
): { tier: number; score: number } | null {
  const label = fields[0];
  if (label === query) return { tier: 0, score: 0 };
  if (label.startsWith(query)) return { tier: 1, score: label.length - query.length };
  for (let i = 1; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === "") continue;
    if (field === query) return { tier: 2, score: i };
    if (field.startsWith(query)) return { tier: 3, score: i * 100 + field.length };
  }
  let best: number | null = null;
  for (const field of fields) {
    if (field === "") continue;
    const score = fuzzyScore(query, field);
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best === null ? null : { tier: 4, score: best };
}

/** The render cap: the dialog never draws more than this many options across all groups. */
export const PALETTE_MAX_RESULTS = 60;

/**
 * Rank the index for a query. An empty query lists every command then the nodes in view order
 * (the palette opens onto the whole graph, capped). Entries rank GLOBALLY — an exact label
 * match leads the whole list even when its kind group would sort later — and the cap applies
 * in that global order. Groups keep only non-empty kinds, commands first, then ordered by
 * their best entry's rank; within a group entries keep the global order.
 */
export function rankPalette(index: PaletteIndex, rawQuery: string): PaletteGroup[] {
  const query = rawQuery.trim().toLowerCase();
  const groups: PaletteGroup[] = [];
  const commandEntries: PaletteEntry[] = index.commands
    .filter((command) => {
      if (query.length === 0) return true;
      // Commands match on their id words ("isolate edge route table") — the label itself is
      // translated at render time, so the stable id is the searchable fact.
      const haystack = command.id.replace(/[-:]/g, " ").toLowerCase();
      return haystack.includes(query) || fuzzyScore(query, haystack) !== null;
    })
    .map((command) => ({ type: "command", command }) as PaletteEntry);
  if (commandEntries.length > 0) groups.push({ kind: "command", entries: commandEntries });

  const scored: { entry: PaletteNodeEntry; tier: number; score: number }[] = [];
  for (const node of index.nodes) {
    if (query.length === 0) {
      scored.push({ entry: node.entry, tier: 5, score: 0 });
      continue;
    }
    const rank = nodeTier(query, node.fields);
    if (rank !== null) scored.push({ entry: node.entry, tier: rank.tier, score: rank.score });
  }
  scored.sort(
    (a, b) => a.tier - b.tier || a.score - b.score || a.entry.label.localeCompare(b.entry.label),
  );
  const capped = scored.slice(0, Math.max(0, PALETTE_MAX_RESULTS - commandEntries.length));
  const bestRank = new Map<GraphNodeKind, number>();
  capped.forEach((item, position) => {
    if (!bestRank.has(item.entry.kind)) bestRank.set(item.entry.kind, position);
  });
  // An empty query opens in layout-column order; a real query orders groups by relevance.
  const kinds =
    query.length === 0
      ? PALETTE_NODE_KINDS.filter((kind) => bestRank.has(kind))
      : PALETTE_NODE_KINDS.filter((kind) => bestRank.has(kind)).sort(
          (a, b) => (bestRank.get(a) ?? 0) - (bestRank.get(b) ?? 0),
        );
  for (const kind of kinds) {
    groups.push({
      kind,
      entries: capped.filter((item) => item.entry.kind === kind).map((item) => item.entry),
    });
  }
  return groups;
}

/** The flat option order the dialog's ArrowUp/Down walks: group order, entry order. */
export function flattenPaletteGroups(groups: readonly PaletteGroup[]): PaletteEntry[] {
  return groups.flatMap((group) => [...group.entries]);
}
