// The data lens's card marks (issue #70): the schema facts' badge row drawn under every table
// or view card while the lens is active, plus the elevated edge's lock label. The row joins the
// SAME overlay stack as the contract marks (#69) — outside the LOD sizer, so the card's measured
// footprint and every node position hold (epic rule 2) — and counter-scales through lodScreenPx
// so its text never drops below the 7px floor (epic rule 4). A secondary lens draws the row at
// 30% (epic rule 3). The marks only add a row or a label; positions never change.

import { t } from "@/i18n";
import { lodScreenPx } from "@/facilis/graph-lod";
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

const ROW_STYLE = { columnGap: lodScreenPx(4) };

/** A row of the shared marks stack: flex-wrap, never absolutely positioned itself. */
function marksClass(secondary: boolean): string {
  return "flex flex-wrap items-center" + (secondary ? " opacity-30" : "");
}

export function TableDataMarks({
  table,
  compact,
  secondary,
}: DataMarksProps & { table: TableGraphData }) {
  return (
    <div data-testid="data-marks-table" className={marksClass(secondary)} style={ROW_STYLE}>
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
    <div data-testid="data-marks-view" className={marksClass(secondary)} style={ROW_STYLE}>
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
 * the compact threshold like the card badges and, while it shows, counter-scales to the 9px
 * screen floor (epic rule 4). The dash pattern already distinguishes the edge — the label names
 * it, so the encoding is never colour-only.
 */
export function ElevatedEdgeLabel({
  x,
  y,
  compact,
  secondary,
}: DataMarksProps & { x: number; y: number }) {
  return (
    <g
      data-testid="data-edge-lock"
      transform={`translate(${x}, ${y})`}
      opacity={secondary ? 0.3 : 1}
      style={{ pointerEvents: "none" }}
    >
      <title>{t("projectGraph.data.elevatedEdge")}</title>
      {/* Lucide's lock, scaled to the label row: geometry survives every zoom level. */}
      <g
        transform={compact ? "translate(-5, -5) scale(0.42)" : "translate(-27, -5) scale(0.42)"}
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
        <text
          x={-11}
          y={3.5}
          fill="var(--warning)"
          style={{
            fontSize: lodScreenPx(9),
            paintOrder: "stroke",
            stroke: "var(--background)",
            strokeWidth: lodScreenPx(3),
          }}
        >
          {t("projectGraph.elevated")}
        </text>
      )}
    </g>
  );
}
