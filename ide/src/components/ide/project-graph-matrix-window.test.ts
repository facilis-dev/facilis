// The row-window arithmetic (issue #67 criterion 4): the rendered span plus the two spacers
// must always conserve the full scroll height, the window must stay bounded by the viewport
// (not the project size), and scroll-into-view must move as little as possible.
import { describe, expect, it } from "vitest";
import { buildGraphMatrix } from "@/facilis/graph-matrix";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { TODOS, graphOf, routeNode } from "@/facilis/graph-model.test-fixtures";
import {
  MATRIX_HEADER_HEIGHT,
  MATRIX_OVERSCAN,
  MATRIX_ROW_HEIGHT,
  matrixItemIndexOfRow,
  matrixItems,
  matrixRowWindow,
  matrixScrollTopFor,
} from "./project-graph-matrix-window";

describe("matrixRowWindow", () => {
  it("renders only a viewport-bounded window of a large grid", () => {
    const window = matrixRowWindow(500, 0, 640);
    expect(window.start).toBe(0);
    expect(window.end).toBe(Math.ceil(640 / MATRIX_ROW_HEIGHT) + MATRIX_OVERSCAN);
    expect(window.end - window.start).toBeLessThanOrEqual(40);
    expect(window.topPad).toBe(0);
    expect(window.bottomPad).toBe((500 - window.end) * MATRIX_ROW_HEIGHT);
  });

  it("conserves the full scroll height at every scroll position", () => {
    for (const scrollTop of [0, 31, 3200, 15968, 999999]) {
      const window = matrixRowWindow(500, scrollTop, 640);
      const rendered = (window.end - window.start) * MATRIX_ROW_HEIGHT;
      expect(window.topPad + rendered + window.bottomPad).toBe(500 * MATRIX_ROW_HEIGHT);
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.end).toBeLessThanOrEqual(500);
    }
  });

  it("windows around the scrolled position with overscan on both sides", () => {
    const window = matrixRowWindow(500, 3200, 640);
    expect(window.start).toBe(100 - MATRIX_OVERSCAN);
    expect(window.end).toBe(120 + MATRIX_OVERSCAN);
    expect(window.topPad).toBe(window.start * MATRIX_ROW_HEIGHT);
  });

  it("degrades safely for an empty grid or a zero viewport", () => {
    expect(matrixRowWindow(0, 0, 640)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
    const collapsed = matrixRowWindow(10, 0, 0);
    expect(collapsed.end - collapsed.start).toBeLessThanOrEqual(MATRIX_OVERSCAN);
  });
});

describe("matrixItems and scroll-into-view", () => {
  const routes = Array.from({ length: 6 }, (_, index) =>
    routeNode(index % 2 === 0 ? "GET" : "POST", "/api/r" + index),
  );
  const view = buildProjectGraphView({
    graph: graphOf(
      [...routes, TODOS],
      routes.map((route, index) => ({
        id: "route-table:" + index,
        kind: "route-table" as const,
        source: route.id,
        target: TODOS.id,
        label: null,
      })),
    ),
  });
  const model = buildGraphMatrix(view);
  const items = matrixItems(model);

  it("flattens groups and rows with the model's flat row indices", () => {
    expect(items.map((item) => item.kind)).toEqual([
      "group",
      "row",
      "row",
      "row",
      "group",
      "row",
      "row",
      "row",
    ]);
    expect(items[0]).toMatchObject({ kind: "group", method: "GET", count: 3 });
    const rowIndexes = items.flatMap((item) => (item.kind === "row" ? [item.rowIndex] : []));
    expect(rowIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(matrixItemIndexOfRow(items, 4)).toBe(6);
    expect(matrixItemIndexOfRow(items, 99)).toBe(-1);
  });

  it("scrolls a row above the visible band down to just below the sticky header", () => {
    const target = matrixScrollTopFor(3200, 4, 640);
    expect(target).toBe(4 * MATRIX_ROW_HEIGHT - MATRIX_HEADER_HEIGHT);
    // A row under the header itself clamps to the top instead of a negative scroll.
    expect(matrixScrollTopFor(3200, 1, 640)).toBe(0);
  });

  it("scrolls a row below the visible band up just enough to show it", () => {
    const itemIndex = 40;
    const target = matrixScrollTopFor(0, itemIndex, 640);
    expect(target).toBe((itemIndex + 1) * MATRIX_ROW_HEIGHT - 640);
  });

  it("keeps the current scroll for an already-visible row (spatial constancy)", () => {
    const itemIndex = 15; // top 480, inside [0+68, 640]
    expect(matrixScrollTopFor(0, itemIndex, 640)).toBe(0);
    expect(matrixScrollTopFor(100, -1, 640)).toBe(100);
  });
});
