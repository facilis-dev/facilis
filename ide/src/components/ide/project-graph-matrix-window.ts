// Row windowing for the matrix (issue #67 criterion 4): 200+ routes must render fast, so only
// the items inside the scroll viewport (plus an overscan margin) become DOM rows; spacer rows
// carry the rest of the height so the scrollbar and the sticky headers stay honest. Pure
// arithmetic — no DOM, no timers — so the windowing contract is unit-testable without a browser
// and the render cost is bounded by the viewport, not the project size. Group headers share the
// row height so one pitch covers every item.

import type { HttpMethod } from "@facilis.dev/analyze";
import type { GraphMatrixModel, GraphMatrixRow } from "@/facilis/graph-matrix";

/** One pitch for data rows AND group headers: the window math stays a single multiplication. */
export const MATRIX_ROW_HEIGHT = 32;
/** Extra items rendered above/below the viewport so a fast scroll never shows a blank band. */
export const MATRIX_OVERSCAN = 6;
/** First-paint guess until the ResizeObserver measures the real scroll container. */
export const MATRIX_DEFAULT_VIEWPORT = 640;
/** Sticky header stack: the block row (24px) plus the column row (44px). */
export const MATRIX_HEADER_HEIGHT = 68;
/** Sticky row-header width, kept clear when scrolling a cursor cell into view horizontally. */
export const MATRIX_ROW_HEADER_WIDTH = 224;

export type GraphMatrixItem =
  | { readonly kind: "group"; readonly method: HttpMethod; readonly count: number }
  | { readonly kind: "row"; readonly rowIndex: number; readonly row: GraphMatrixRow };

/** The flat scroll list: a header item per method group, then its rows in model order. */
export function matrixItems(model: GraphMatrixModel): GraphMatrixItem[] {
  // Groups flatten in model order, so a running counter is the flat row index — no search.
  let rowIndex = 0;
  return model.groups.flatMap((group) => [
    { kind: "group" as const, method: group.method, count: group.rows.length },
    ...group.rows.map((row) => ({ kind: "row" as const, rowIndex: rowIndex++, row })),
  ]);
}

export interface MatrixWindow {
  /** Item index range [start, end) to render. */
  readonly start: number;
  readonly end: number;
  readonly topPad: number;
  readonly bottomPad: number;
}

export function matrixRowWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
): MatrixWindow {
  const first = Math.floor(Math.max(0, scrollTop) / MATRIX_ROW_HEIGHT);
  const last = Math.ceil(
    (Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / MATRIX_ROW_HEIGHT,
  );
  const start = Math.max(0, first - MATRIX_OVERSCAN);
  const end = Math.min(total, last + MATRIX_OVERSCAN);
  return {
    start,
    end,
    topPad: start * MATRIX_ROW_HEIGHT,
    bottomPad: Math.max(0, total - end) * MATRIX_ROW_HEIGHT,
  };
}

/** Where a row sits in the flat item list; -1 when the index is out of range. */
export function matrixItemIndexOfRow(items: readonly GraphMatrixItem[], rowIndex: number): number {
  return items.findIndex((item) => item.kind === "row" && item.rowIndex === rowIndex);
}

/**
 * The scrollTop that brings item i into the visible band below the sticky header, moving as
 * little as possible: an already-visible item keeps the current scroll (spatial constancy).
 */
export function matrixScrollTopFor(
  current: number,
  itemIndex: number,
  viewportHeight: number,
): number {
  if (itemIndex < 0) return current;
  const top = itemIndex * MATRIX_ROW_HEIGHT;
  const bottom = top + MATRIX_ROW_HEIGHT;
  if (top < current + MATRIX_HEADER_HEIGHT) return Math.max(0, top - MATRIX_HEADER_HEIGHT);
  if (bottom > current + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return current;
}
