// The route × table matrix surface (issue #67, epic #56): a real <table> promoted to role=grid
// over the SAME ProjectGraphView the topology draws (derived in graph-matrix.ts). Sticky row
// and column headers carry the degree counts; rows are windowed (project-graph-matrix-window)
// so a 200-route project renders a viewport's worth of DOM, not the whole grid. The grid owns
// the arrow-key cursor and Enter-selects like a click; preventDefault keeps the document-level
// graph shortcuts from doubling up. Switching modes preserves the selection and scrolls the
// selected row into view. Role tokens only (D-044); every string via t() (D-043).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/i18n";
import type {
  GraphMatrixCell,
  GraphMatrixModel,
  GraphMatrixRow,
  GraphMatrixSort,
} from "@/facilis/graph-matrix";
import type { GraphReachability } from "@/facilis/graph-reachability";
import {
  MATRIX_DEFAULT_VIEWPORT,
  MATRIX_ROW_HEADER_WIDTH,
  matrixItemIndexOfRow,
  matrixItems,
  matrixRowWindow,
  matrixScrollTopFor,
} from "./project-graph-matrix-window";
import { ProjectGraphMatrixCell, matrixDimClass, type MatrixDim } from "./ProjectGraphMatrixCell";
import { ProjectGraphMatrixHeader } from "./ProjectGraphMatrixHeader";
import { ProjectGraphMatrixStrip } from "./ProjectGraphMatrixStrip";

export function ProjectGraphMatrix({
  model,
  sort,
  onSortChange,
  selectedNodeId,
  onSelectNode,
  onOpenEdge,
  userFocus,
}: {
  model: GraphMatrixModel;
  sort: GraphMatrixSort;
  onSortChange: (sort: GraphMatrixSort) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Double-click a marked cell: the surface switches to topology and focuses the edge. */
  onOpenEdge: (row: GraphMatrixRow, cell: GraphMatrixCell) => void;
  /** The selection's closure (issue #66): outside it, rows and columns recede like the cards. */
  userFocus: GraphReachability | null;
}) {
  const items = useMemo(() => matrixItems(model), [model]);
  const rowOfSelection = model.rows.findIndex((row) => row.routeId === selectedNodeId);
  const [cursor, setCursor] = useState({ row: Math.max(0, rowOfSelection), col: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(MATRIX_DEFAULT_VIEWPORT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const window = matrixRowWindow(items.length, scrollTop, viewportHeight);
  const cellId = "graph-matrix-cell-" + cursor.row + "-" + cursor.col;

  // Keyboard-first: the grid takes focus on mount so arrows work right after the mode switch.
  useEffect(() => {
    tableRef.current?.focus({ preventScroll: true });
  }, []);

  // A filter/sort change can shrink the grid under the cursor; clamp so aria-activedescendant
  // and Enter never point at a row that no longer exists.
  useEffect(() => {
    setCursor((current) => ({
      row: Math.min(current.row, Math.max(0, model.rows.length - 1)),
      col: Math.min(current.col, Math.max(0, model.columns.length - 1)),
    }));
  }, [model]);

  // A selection made elsewhere (inspector, topology, deep link) moves the cursor to its row.
  useEffect(() => {
    const index = model.rows.findIndex((row) => row.routeId === selectedNodeId);
    if (index >= 0) setCursor((current) => ({ ...current, row: index }));
  }, [selectedNodeId, model]);

  // Vertical: keep the cursor row inside the band below the sticky header. This also runs on
  // mount, which is how "switch mode → selected row scrolled into view" is satisfied.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const itemIndex = matrixItemIndexOfRow(items, cursor.row);
    container.scrollTop = matrixScrollTopFor(container.scrollTop, itemIndex, viewportHeight);
  }, [cursor.row, items, viewportHeight]);

  // Horizontal: keep the cursor cell clear of the sticky row header. Runs after the window
  // re-renders so the cell element exists even when the cursor jumped across the viewport.
  useEffect(() => {
    const container = containerRef.current;
    const cell = document.getElementById(cellId);
    if (container === null || cell === null) return;
    const box = container.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    if (rect.left < box.left + MATRIX_ROW_HEADER_WIDTH) {
      container.scrollLeft -= box.left + MATRIX_ROW_HEADER_WIDTH - rect.left;
    } else if (rect.right > box.right) {
      container.scrollLeft += rect.right - box.right;
    }
  }, [cursor, cellId, window.start, window.end]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const moveCursor = (dRow: number, dCol: number) => {
    setCursor((current) => ({
      row: Math.min(Math.max(0, current.row + dRow), Math.max(0, model.rows.length - 1)),
      col: Math.min(Math.max(0, current.col + dCol), Math.max(0, model.columns.length - 1)),
    }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const lastRow = Math.max(0, model.rows.length - 1);
    const lastCol = Math.max(0, model.columns.length - 1);
    switch (event.key) {
      case "ArrowDown":
        moveCursor(1, 0);
        break;
      case "ArrowUp":
        moveCursor(-1, 0);
        break;
      case "ArrowRight":
        moveCursor(0, 1);
        break;
      case "ArrowLeft":
        moveCursor(0, -1);
        break;
      case "Home":
        setCursor((current) => ({ row: event.ctrlKey ? 0 : current.row, col: 0 }));
        break;
      case "End":
        setCursor((current) => ({ row: event.ctrlKey ? lastRow : current.row, col: lastCol }));
        break;
      case "Enter": {
        const row = model.rows[cursor.row];
        if (row) onSelectNode(row.routeId);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const focusSet = userFocus === null ? null : new Set(userFocus.nodeIds);
  const rowDim = (row: GraphMatrixRow): MatrixDim =>
    focusSet !== null && !focusSet.has(row.routeId) ? "focus" : row.matched ? "none" : "search";
  const worse = (a: MatrixDim, b: MatrixDim): MatrixDim =>
    a === "focus" || b === "focus" ? "focus" : a === "search" || b === "search" ? "search" : "none";
  const colSpan = model.columns.length + 1;

  return (
    <div data-testid="graph-matrix" className="flex h-full min-h-0 flex-col bg-editor">
      <ProjectGraphMatrixStrip model={model} sort={sort} onSortChange={onSortChange} />
      {model.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("projectGraph.matrix.empty")}
        </div>
      ) : (
        <div
          ref={containerRef}
          data-testid="graph-matrix-scroll"
          className="min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table
            ref={tableRef}
            role="grid"
            tabIndex={0}
            aria-label={t("projectGraph.matrix.label")}
            aria-rowcount={items.length + 2}
            aria-colcount={colSpan}
            aria-activedescendant={cellId}
            onKeyDown={onKeyDown}
            className="w-full border-separate border-spacing-0 text-xs outline-none"
          >
            <ProjectGraphMatrixHeader
              columns={model.columns}
              userFocus={userFocus}
              onSelectNode={onSelectNode}
            />
            <tbody>
              {window.topPad > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: window.topPad, padding: 0, border: 0 }} />
                </tr>
              )}
              {items.slice(window.start, window.end).map((item) =>
                item.kind === "group" ? (
                  <tr
                    key={"group-" + item.method}
                    data-testid={"graph-matrix-group-" + item.method}
                  >
                    <td colSpan={colSpan} className="h-8 border-b border-border bg-panel px-0">
                      <span className="sticky left-2 inline-block px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {item.method} ·{" "}
                        {t("projectGraph.matrix.groupRoutes", { count: item.count })}
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={item.row.routeId}
                    role="row"
                    aria-selected={item.row.routeId === selectedNodeId}
                    data-testid={"graph-matrix-row-" + item.row.routeId}
                    className={item.row.routeId === selectedNodeId ? "bg-accent/40" : undefined}
                  >
                    <th
                      scope="row"
                      title={item.row.label}
                      onClick={() => onSelectNode(item.row.routeId)}
                      className={
                        "sticky left-0 z-10 h-8 max-w-56 cursor-pointer border-r border-b border-border px-2 text-left font-normal" +
                        (item.row.routeId === selectedNodeId ? " bg-accent" : " bg-card") +
                        matrixDimClass(rowDim(item.row))
                      }
                    >
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate">{item.row.path}</span>
                        <span
                          className="shrink-0 text-[10px] text-muted-foreground"
                          title={t("projectGraph.matrix.rowDegree", { count: item.row.degree })}
                        >
                          {item.row.degree}
                        </span>
                      </span>
                    </th>
                    {model.columns.map((column, colIndex) => {
                      const cell = item.row.cells[colIndex];
                      if (!cell) return null;
                      const dim = worse(
                        rowDim(item.row),
                        focusSet !== null && !focusSet.has(column.nodeId)
                          ? "focus"
                          : column.matched
                            ? "none"
                            : "search",
                      );
                      return (
                        <ProjectGraphMatrixCell
                          key={column.nodeId}
                          cell={cell}
                          rowLabel={item.row.label}
                          columnLabel={column.label}
                          rowIndex={item.rowIndex}
                          colIndex={colIndex}
                          cursor={cursor.row === item.rowIndex && cursor.col === colIndex}
                          selected={item.row.routeId === selectedNodeId}
                          dim={dim}
                          onSelect={() => {
                            setCursor({ row: item.rowIndex, col: colIndex });
                            onSelectNode(item.row.routeId);
                          }}
                          onOpen={() => onOpenEdge(item.row, cell)}
                        />
                      );
                    })}
                  </tr>
                ),
              )}
              {window.bottomPad > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={colSpan}
                    style={{ height: window.bottomPad, padding: 0, border: 0 }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
