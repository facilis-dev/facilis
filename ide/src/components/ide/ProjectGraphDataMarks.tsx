// The data lens's per-kind marks (issue #70): which badges a table or view card draws while
// the lens is active, plus the elevated edge's lock label. A secondary lens draws the marks at
// 30% (epic rule 3); the compact LOD is handled inside each badge and the edge label. The marks
// only add a row to the card or a label to the edge — positions never change (epic rule 2).

import { t } from "@/i18n";
import type { TableGraphData, ViewGraphData } from "@/facilis/graph-types";
import {
  PoliciesBadge,
  ScopeBadge,
  ViewAccessBadge,
  ViewPermissionBadge,
} from "./ProjectGraphDataBadges";

export interface DataMarksProps {
  readonly compact: boolean;
  /** True when the data lens is the secondary one: the marks recede to 30% (epic rule 3). */
  readonly secondary: boolean;
}

function marksClass(secondary: boolean): string {
  return "mt-1 flex flex-wrap items-center gap-1 border-t pt-1" + (secondary ? " opacity-30" : "");
}

export function TableDataMarks({
  table,
  compact,
  secondary,
}: DataMarksProps & { table: TableGraphData }) {
  return (
    <div data-testid="data-marks-table" className={marksClass(secondary)}>
      <ScopeBadge table={table} compact={compact} />
      <PoliciesBadge count={table.policies.length} unknown={table.unknown} compact={compact} />
    </div>
  );
}

export function ViewDataMarks({
  view,
  compact,
  secondary,
}: DataMarksProps & { view: ViewGraphData }) {
  return (
    <div data-testid="data-marks-view" className={marksClass(secondary)}>
      <ViewAccessBadge access={view.access} compact={compact} />
      {/* The permission is unreadable exactly when the access mode is (D-098): null access means
          the declared permission could not be read, so the badge hatches instead of guessing. */}
      <ViewPermissionBadge
        permission={view.permission}
        unknown={view.access === null}
        compact={compact}
      />
    </div>
  );
}

/**
 * The elevated edge's lock label, in flow coordinates at the edge midpoint. The lock glyph is
 * SVG geometry, not text, so it stays visible at EVERY zoom (criterion 1); the word drops below
 * the compact threshold like the card badges (epic rule 4). The dash pattern alone already
 * distinguishes the edge — the label names it, so the encoding is never colour-only.
 */
export function ElevatedEdgeLabel({
  x,
  y,
  compact,
  secondary,
}: DataMarksProps & { x: number; y: number }) {
  const width = compact ? 16 : 62;
  return (
    <g
      data-testid="data-edge-lock"
      transform={`translate(${x}, ${y})`}
      opacity={secondary ? 0.3 : 1}
      style={{ pointerEvents: "none" }}
    >
      <title>{t("projectGraph.data.elevatedEdge")}</title>
      <rect
        x={-width / 2}
        y={-8}
        width={width}
        height={16}
        rx={4}
        fill="var(--background)"
        stroke="var(--warning)"
        strokeWidth={1}
      />
      {/* Lucide's lock, scaled to the pill: geometry survives every zoom level. */}
      <g
        transform={`translate(${compact ? -5 : -27}, -5) scale(0.42)`}
        fill="none"
        stroke="var(--warning)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </g>
      {!compact && (
        <text x={-11} y={3.5} fontSize={9} fill="var(--warning)">
          {t("projectGraph.elevated")}
        </text>
      )}
    </g>
  );
}
