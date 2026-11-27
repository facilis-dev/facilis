// Normalised state facts (D-224 §2): every live, workspace and declared lens speaks this
// shape, so the bar, the answer list and the callout render any of them through t(code, params)
// without inventing prose. Analyzer diagnostics deliberately keep their own type.

import type { I18nParams } from "@facilis.dev/core/i18n";
import type { MessageKey } from "@/i18n";
import type {
  GraphLensBadge,
  GraphLensCode,
  GraphLensDefinition,
  GraphLensLegendEntry,
  GraphLensSummary,
} from "./lenses.ts";

/** One observation about one node: the fact type of every state lens. */
export interface GraphStateFact {
  readonly nodeId: string;
  readonly code: GraphLensCode;
  readonly params: I18nParams;
}

/** The banner's total for a state lens, rendered as t(key, { count, ...params }). */
export interface GraphLensTotals {
  readonly key: MessageKey;
  readonly count: number;
  readonly params?: I18nParams;
}

/**
 * The declared-lens chooser (reach: the role): data plus the one callback the banner calls.
 * Keeping it on the state means the picker needs no extra prop through the bar or the panel.
 */
export interface GraphLensPicker {
  readonly labelKey: MessageKey;
  readonly value: string;
  readonly options: readonly string[];
  readonly onSelect: (value: string) => void;
}

export interface GraphLensState {
  readonly facts: readonly GraphStateFact[];
  readonly totals: GraphLensTotals | null;
  /** Interpolation shared by the banner lines (for runtime: the window in minutes). */
  readonly params: I18nParams;
  /** The banner's context line, e.g. the sampling window. */
  readonly contextKey: MessageKey | null;
  /** Why the lens has no facts, when it has none: never a blank panel. */
  readonly emptyKey: MessageKey | null;
  /** What to do about it; the lens owns the words, the banner only renders them. */
  readonly emptyHintKey: MessageKey | null;
  /** Draw-only per-node badges; the canvas never resizes a card for them. */
  readonly badges: ReadonlyMap<string, GraphLensBadge>;
  /**
   * Nodes the lens flags even without a badge (reach highlights every reachable page and table).
   * Omitted means "every badge key", the runtime/changes behaviour.
   */
  readonly highlight?: readonly string[];
  /** A declared lens's chooser, rendered by the banner; omitted when the lens has none. */
  readonly picker?: GraphLensPicker;
  /** Node id -> domain, when the lens's answers are grouped by domain. */
  readonly groups?: ReadonlyMap<string, string>;
}

/** What the lens bar renders: analyzer diagnostics or a state lens's normalised facts. */
export type GraphLensView =
  | { readonly kind: "diagnostics"; readonly summary: GraphLensSummary }
  | { readonly kind: "state"; readonly state: GraphLensState };

export function factsByNode(
  facts: readonly GraphStateFact[],
): ReadonlyMap<string, readonly GraphStateFact[]> {
  const byNode = new Map<string, GraphStateFact[]>();
  for (const fact of facts) {
    const list = byNode.get(fact.nodeId) ?? [];
    list.push(fact);
    byNode.set(fact.nodeId, list);
  }
  return byNode;
}

/** The registry's legend entry for a code: its message key and colour live in one place. */
export function legendEntryOf(
  definition: GraphLensDefinition,
  code: GraphLensCode,
): GraphLensLegendEntry | null {
  return definition.legend.find((entry) => entry.code === code) ?? null;
}
