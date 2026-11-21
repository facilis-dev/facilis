// One matrix cell (issue #67): a real gridcell with a glyph per edge kind — never colour alone
// (D-044): declared ●, elevated ▲, via-view ◆, absent ·. The kinds stack in canonical order,
// the tooltip and the aria-label name the route, the column and every marker, so a screen
// reader announces the same facts the glyphs show. Role tokens only; the dim levels mirror the
// topology chrome (search opacity-40, outside the selection closure opacity-12).

import { t } from "@/i18n";
import type { GraphMatrixCell, GraphMatrixCellKind } from "@/facilis/graph-matrix";

export const MATRIX_GLYPHS: Record<GraphMatrixCellKind | "absent", string> = {
  declared: "●",
  elevated: "▲",
  "via-view": "◆",
  absent: "·",
};

export const MATRIX_KIND_CLASSES: Record<GraphMatrixCellKind | "absent", string> = {
  declared: "text-foreground",
  elevated: "text-warning",
  "via-view": "text-info",
  absent: "text-muted-foreground/60",
};

const KIND_KEYS = {
  declared: "projectGraph.matrix.declared",
  elevated: "projectGraph.matrix.elevated",
  "via-view": "projectGraph.matrix.viaView",
} as const;

export function matrixKindLabel(kind: GraphMatrixCellKind): string {
  return t(KIND_KEYS[kind]);
}

/** The cell's kind stack as readable text; the absent case is a word, not an empty string. */
export function matrixCellKindsText(cell: GraphMatrixCell): string {
  return cell.kinds.length === 0
    ? t("projectGraph.matrix.absent")
    : cell.kinds.map((kind) => matrixKindLabel(kind)).join(", ");
}

export type MatrixDim = "none" | "search" | "focus";

export function matrixDimClass(dim: MatrixDim): string {
  return dim === "focus" ? " opacity-12" : dim === "search" ? " opacity-40" : "";
}

export function ProjectGraphMatrixCell({
  cell,
  rowLabel,
  columnLabel,
  rowIndex,
  colIndex,
  cursor,
  selected,
  dim,
  onSelect,
  onOpen,
}: {
  cell: GraphMatrixCell;
  rowLabel: string;
  columnLabel: string;
  rowIndex: number;
  colIndex: number;
  cursor: boolean;
  /** The cell's route is the current selection. */
  selected: boolean;
  dim: MatrixDim;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const id = "graph-matrix-cell-" + rowIndex + "-" + colIndex;
  const kindsText = matrixCellKindsText(cell);
  const label = t("projectGraph.matrix.cellLabel", {
    route: rowLabel,
    column: columnLabel,
    kinds: kindsText,
  });
  return (
    <td
      id={id}
      data-testid={id}
      data-kinds={cell.kinds.join(" ")}
      role="gridcell"
      aria-selected={cursor}
      aria-label={label}
      title={label + "\n" + t("projectGraph.matrix.cellHint")}
      onClick={onSelect}
      onDoubleClick={cell.kinds.length > 0 ? onOpen : undefined}
      className={
        "h-8 cursor-pointer border-r border-b border-border px-2 text-center align-middle" +
        (selected ? " bg-accent/50" : "") +
        (cursor ? " ring-1 ring-ring ring-inset" : "") +
        matrixDimClass(dim)
      }
    >
      <span className="inline-flex items-center gap-0.5 text-[11px] leading-none">
        {cell.kinds.length === 0 ? (
          <span aria-hidden="true" className={MATRIX_KIND_CLASSES.absent}>
            {MATRIX_GLYPHS.absent}
          </span>
        ) : (
          cell.kinds.map((kind) => (
            <span key={kind} aria-hidden="true" className={MATRIX_KIND_CLASSES[kind]}>
              {MATRIX_GLYPHS[kind]}
            </span>
          ))
        )}
      </span>
    </td>
  );
}
