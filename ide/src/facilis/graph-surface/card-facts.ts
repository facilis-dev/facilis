// Pure fact extraction for the on-demand rich card (D-219, issue #188). The card shows the
// analyzer facts the graph already joined in graph-details.ts; these helpers make the per-kind
// content testable without a DOM and keep long lists bounded with an explicit overflow count.

import type { RouteInputFact } from "@facilis.dev/analyze";
import type { ColumnDetails, TableDetails } from "../graph-details.ts";
import type { ColumnMarker, TableGraphData } from "../graph-types.ts";

/** Compact column markers: the rich card uses the abbreviations the schema vocabulary uses. */
export type CardColumnMarker = "pk" | "nn" | "uq" | "def" | "fk" | "unknown";

export interface CardColumn {
  /** The Drizzle property when available; unique per table. */
  readonly key: string;
  readonly name: string;
  readonly property: string;
  readonly type: string;
  readonly markers: readonly CardColumnMarker[];
}

export type RouteInputKey = "body" | "form" | "query" | "params";

export const ROUTE_INPUT_ORDER: readonly RouteInputKey[] = ["body", "form", "query", "params"];

/** A list plus how many items were left out; the card shows "+N more" rather than growing. */
export interface CappedList<T> {
  readonly visible: readonly T[];
  readonly hidden: number;
}

export const CARD_LIST_LIMIT = 24;

const NODE_MARKER: Readonly<Record<ColumnMarker, CardColumnMarker>> = {
  primaryKey: "pk",
  notNull: "nn",
  unique: "uq",
  default: "def",
  unknown: "unknown",
};

/** The SQL columns a table's foreign keys point out of, as the schema names them. */
export function foreignKeyColumns(foreignKeys: TableDetails["foreignKeys"]): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const foreignKey of foreignKeys) {
    for (const column of foreignKey.columns) columns.add(column);
  }
  return columns;
}

/** Marker order is stable: keys, constraints, defaults, then references and unknowns. */
export function columnMarkers(
  column: ColumnDetails,
  foreignKeys: ReadonlySet<string>,
  unknown = false,
): readonly CardColumnMarker[] {
  const markers: CardColumnMarker[] = [];
  if (column.primaryKey) markers.push("pk");
  if (column.notNull) markers.push("nn");
  if (column.unique) markers.push("uq");
  if (column.default !== null) markers.push("def");
  if (foreignKeys.has(column.name)) markers.push("fk");
  if (unknown) markers.push("unknown");
  return markers;
}

/**
 * The FULL column list. Analysis details are authoritative; a missing detail falls back to
 * the graph node's own columns (never invented) and keeps its unknown marker.
 */
export function tableCardColumns(
  node: TableGraphData,
  details: TableDetails | null,
): readonly CardColumn[] {
  const unknown = new Set(
    node.columns
      .filter((column) => column.markers.includes("unknown"))
      .map((column) => column.property),
  );
  if (details !== null && details.columns.length > 0) {
    const foreignKeys = foreignKeyColumns(details.foreignKeys);
    return details.columns.map((column) => ({
      key: column.property,
      name: column.name,
      property: column.property,
      type: column.type,
      markers: columnMarkers(column, foreignKeys, unknown.has(column.property)),
    }));
  }
  return node.columns.map((column) => ({
    key: column.property,
    name: column.name,
    property: column.property,
    type: column.type,
    markers: column.markers.map((marker) => NODE_MARKER[marker]),
  }));
}

/** Present input schemas in their canonical order: body, form, query, params. */
export function routeInputKeys(input: RouteInputFact): readonly RouteInputKey[] {
  return ROUTE_INPUT_ORDER.filter((key) => input[key]);
}

/** Bounded lists keep the card readable; the hidden count is surfaced, never silently dropped. */
export function capList<T>(items: readonly T[], limit: number = CARD_LIST_LIMIT): CappedList<T> {
  if (limit < 0) return { visible: items, hidden: 0 };
  return { visible: items.slice(0, limit), hidden: Math.max(0, items.length - limit) };
}
