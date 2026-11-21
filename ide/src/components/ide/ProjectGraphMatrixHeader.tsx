// The matrix's sticky column headers (issue #67), split from ProjectGraphMatrix.tsx so both
// stay under the source limit: a block row (Tables, then the separate Views block) above the
// per-column row with label + degree count. Both rows stick to the top of the scroll container;
// the corner cell spans them and sticks left too. Clicking a column selects its node — the same
// view-state selection a topology card click sets. Role tokens only (D-044), strings via t().

import { t } from "@/i18n";
import type { GraphMatrixColumn } from "@/facilis/graph-matrix";
import type { GraphReachability } from "@/facilis/graph-reachability";
import { matrixDimClass } from "./ProjectGraphMatrixCell";

/** The block row's height; the column row sticks exactly below it. */
const BLOCK_TOP = 24;

export function ProjectGraphMatrixHeader({
  columns,
  userFocus,
  onSelectNode,
}: {
  columns: readonly GraphMatrixColumn[];
  userFocus: GraphReachability | null;
  onSelectNode: (id: string | null) => void;
}) {
  const tableCount = columns.filter((column) => column.block === "tables").length;
  const viewCount = columns.length - tableCount;
  const focusSet = userFocus === null ? null : new Set(userFocus.nodeIds);
  return (
    <thead>
      <tr>
        <th
          rowSpan={2}
          scope="col"
          className="sticky top-0 left-0 z-30 h-[68px] min-w-56 border-r border-b border-border bg-card px-2 text-left align-bottom text-muted-foreground"
        >
          {t("projectGraph.matrix.routeHeader")}
        </th>
        {tableCount > 0 && (
          <th
            colSpan={tableCount}
            scope="col"
            className="sticky top-0 z-20 h-6 border-b border-border bg-card px-2 text-left text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t("projectGraph.matrix.tablesBlock")}
          </th>
        )}
        {viewCount > 0 && (
          <th
            colSpan={viewCount}
            scope="col"
            className="sticky top-0 z-20 h-6 border-b border-border bg-card px-2 text-left text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t("projectGraph.matrix.viewsBlock")}
          </th>
        )}
      </tr>
      <tr>
        {columns.map((column) => (
          <th
            key={column.nodeId}
            scope="col"
            data-testid={"graph-matrix-col-" + column.nodeId}
            title={
              column.label + " — " + t("projectGraph.matrix.colDegree", { count: column.degree })
            }
            onClick={() => onSelectNode(column.nodeId)}
            style={{ top: BLOCK_TOP }}
            className={
              "sticky z-20 border-r border-b border-border bg-card px-1 text-center align-middle" +
              " h-11 min-w-24 cursor-pointer font-medium" +
              matrixDimClass(
                focusSet !== null && !focusSet.has(column.nodeId)
                  ? "focus"
                  : column.matched
                    ? "none"
                    : "search",
              )
            }
          >
            <span className="block max-w-28 truncate">{column.label}</span>
            <span className="text-[10px] text-muted-foreground">{column.degree}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}
