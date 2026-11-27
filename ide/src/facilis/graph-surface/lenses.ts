// The graph lens code contract (D-220, D-224, #189/#198). Analyzer facts and IDE state facts
// both carry a stable code plus params; this module is the ONE place that maps a diagnostic code
// to its lens, i18n keys and semantic colour token, so no component ever hardcodes prose or a
// palette value (D-043/D-044). The descriptor registry itself lives in lenses-registry.ts.

import type { GraphDiagnostic, GraphDiagnosticCode } from "@facilis.dev/analyze";
import type { I18nParams } from "@facilis.dev/core/i18n";
import type { MessageKey } from "@/i18n";

export const GRAPH_LENS_IDS = [
  "security",
  "elevated",
  "shared",
  "unknown",
  "runtime",
  "changes",
  "reach",
  "prerender",
] as const;
export type GraphLensId = (typeof GRAPH_LENS_IDS)[number];

/**
 * Where a lens's facts come from (D-224 §1). The taxonomy is closed: adding a source is a
 * contract change, not another adapter.
 */
export const GRAPH_LENS_SOURCES = ["static", "live", "workspace", "declared"] as const;
export type GraphLensSource = (typeof GRAPH_LENS_SOURCES)[number];

/** The IDE's own state vocabulary (D-224 §2): live/workspace/declared facts, never analyzer. */
export type GraphStateCode = `state.${string}`;
export type GraphLensCode = GraphDiagnosticCode | GraphStateCode;

export function isStateCode(code: GraphLensCode): code is GraphStateCode {
  return code.startsWith("state.");
}

/** Which lens surfaces a diagnostic code (a code belongs to exactly one lens). */
export const LENS_BY_CODE: Readonly<Record<GraphDiagnosticCode, GraphLensId>> = {
  publicWrite: "security",
  publicAdmin: "security",
  tableNoRls: "security",
  elevated: "elevated",
  shared: "shared",
  unknown: "unknown",
};

/** The full diagnosis text, resolved with t(key, params). */
export const DIAGNOSTIC_MESSAGE_KEYS: Readonly<Record<GraphDiagnosticCode, MessageKey>> = {
  publicWrite: "projectGraph.surface.diag.publicWrite",
  publicAdmin: "projectGraph.surface.diag.publicAdmin",
  tableNoRls: "projectGraph.surface.diag.tableNoRls",
  elevated: "projectGraph.surface.diag.elevated",
  shared: "projectGraph.surface.diag.shared",
  unknown: "projectGraph.surface.diag.unknown",
};

/** The short legend/answer label for a code. */
export const DIAGNOSTIC_LABEL_KEYS: Readonly<Record<GraphDiagnosticCode, MessageKey>> = {
  publicWrite: "projectGraph.surface.diag.publicWrite.label",
  publicAdmin: "projectGraph.surface.diag.publicAdmin.label",
  tableNoRls: "projectGraph.surface.diag.tableNoRls.label",
  elevated: "projectGraph.surface.diag.elevated.label",
  shared: "projectGraph.surface.diag.shared.label",
  unknown: "projectGraph.surface.diag.unknown.label",
};

/** The semantic theme token for a code: no hardcoded colours anywhere in the lens UI. */
export const DIAGNOSTIC_COLOR_TOKENS: Readonly<Record<GraphDiagnosticCode, string>> = {
  publicWrite: "--destructive",
  publicAdmin: "--destructive",
  tableNoRls: "--warning",
  elevated: "--warning",
  shared: "--info",
  unknown: "--muted-foreground",
};

export interface GraphLensLegendEntry {
  readonly code: GraphLensCode;
  /** The full explanation, resolved with t(messageKey, params). */
  readonly messageKey: MessageKey;
  readonly labelKey: MessageKey;
  readonly colorToken: string;
}

export interface GraphLensDefinition {
  readonly id: GraphLensId;
  readonly source: GraphLensSource;
  readonly titleKey: MessageKey;
  /** The label a narrow bar can still fit. */
  readonly shortKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** The lens accent; per-code colours live in `legend`. */
  readonly colorToken: string;
  readonly codes: readonly GraphLensCode[];
  readonly legend: readonly GraphLensLegendEntry[];
}

/** Translate a diagnostic's structured params into interpolation values. */
export function diagnosticParams(entry: GraphDiagnostic): I18nParams {
  switch (entry.code) {
    case "publicWrite":
      return { method: entry.params.method };
    case "tableNoRls":
      return { table: entry.params.table };
    case "shared":
      return { count: entry.params.count, domains: entry.params.domains.join(", ") };
    default:
      return {};
  }
}

export interface GraphLensSummary {
  readonly lens: GraphLensId;
  /** Every diagnostic of this lens, in analyzer order. */
  readonly matches: readonly GraphDiagnostic[];
  /** The flagged node ids (the lens counts nodes, not diagnostics). */
  readonly flagged: ReadonlySet<string>;
  /** Diagnostics grouped by node for the answer list and the diagnosis callout. */
  readonly byNode: ReadonlyMap<string, readonly GraphDiagnostic[]>;
  /** The banner's total: how many nodes the lens flags. */
  readonly count: number;
}

export function summarizeLens(
  lens: GraphLensId,
  diagnostics: readonly GraphDiagnostic[],
): GraphLensSummary {
  const matches = diagnostics.filter((entry) => LENS_BY_CODE[entry.code] === lens);
  const byNode = new Map<string, GraphDiagnostic[]>();
  for (const entry of matches) {
    const list = byNode.get(entry.nodeId) ?? [];
    list.push(entry);
    byNode.set(entry.nodeId, list);
  }
  return {
    lens,
    matches,
    flagged: new Set(byNode.keys()),
    byNode,
    count: byNode.size,
  };
}

/** Draw-only per-node badge: a short text and the semantic token it is inked with. */
export interface GraphLensBadge {
  readonly text: string;
  readonly colorToken: string;
}

/** What the canvas needs for a lens: flagged ids, their colour code, and optional badges. */
export interface GraphLensHighlight {
  readonly flagged: ReadonlySet<string>;
  readonly codeOf: ReadonlyMap<string, GraphDiagnosticCode>;
  /** State lenses paint numbers here; static lenses have none. */
  readonly badges: ReadonlyMap<string, GraphLensBadge>;
}

export function lensHighlight(summary: GraphLensSummary): GraphLensHighlight {
  const codeOf = new Map<string, GraphDiagnosticCode>();
  for (const [nodeId, entries] of summary.byNode) {
    const first = entries[0];
    if (first !== undefined) codeOf.set(nodeId, first.code);
  }
  return { flagged: summary.flagged, codeOf, badges: new Map() };
}

/** Group diagnostics by node across every lens (the selected node's diagnosis callout). */
export function diagnosticsByNode(
  diagnostics: readonly GraphDiagnostic[],
): ReadonlyMap<string, readonly GraphDiagnostic[]> {
  const byNode = new Map<string, GraphDiagnostic[]>();
  for (const entry of diagnostics) {
    const list = byNode.get(entry.nodeId) ?? [];
    list.push(entry);
    byNode.set(entry.nodeId, list);
  }
  return byNode;
}

/** Per-domain flag counts for the overview badges; the scene's own domain map is read-only. */
export function domainFlagCounts(
  domainOf: ReadonlyMap<string, string>,
  flagged: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const id of flagged) {
    const domain = domainOf.get(id);
    if (domain === undefined) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return counts;
}
