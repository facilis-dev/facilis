// The matrix header strip (issue #67): pages are not matrix rows/columns — they call routes,
// not tables — so they are summarised here as per-page route counts. The strip also carries
// the glyph legend (the kinds are never colour-only) and the row-sort control, whose value is
// URL state through the view hook (epic rule 6). Role tokens only (D-044); every string via
// t() (D-043). The strip wraps instead of overflowing so a 1024px canvas never scrolls the page.

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  GRAPH_MATRIX_CELL_KINDS,
  type GraphMatrixModel,
  type GraphMatrixSort,
} from "@/facilis/graph-matrix";
import { MATRIX_GLYPHS, MATRIX_KIND_CLASSES, matrixKindLabel } from "./ProjectGraphMatrixCell";

export function ProjectGraphMatrixStrip({
  model,
  sort,
  onSortChange,
}: {
  model: GraphMatrixModel;
  sort: GraphMatrixSort;
  onSortChange: (sort: GraphMatrixSort) => void;
}) {
  return (
    <div
      data-testid="graph-matrix-strip"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-panel px-2 py-1 text-[11px]"
    >
      <span
        role="group"
        aria-label={t("projectGraph.matrix.pagesLabel")}
        data-testid="graph-matrix-pages"
        className="flex min-w-0 flex-wrap items-center gap-1"
      >
        <span className="text-muted-foreground">
          {t("projectGraph.matrix.pages", { count: model.pages.length })}
        </span>
        {model.pages.map((page) => (
          <span
            key={page.pageId}
            data-testid={"graph-matrix-page-" + page.pageId}
            title={page.label}
            className={
              "max-w-44 truncate rounded border border-border bg-card px-1.5 py-0.5" +
              (page.matched ? "" : " opacity-40")
            }
          >
            {page.label} · {t("projectGraph.matrix.pageRoutes", { count: page.routeCount })}
          </span>
        ))}
      </span>
      <span className="flex-1" />
      <span
        role="group"
        aria-label={t("projectGraph.matrix.legend")}
        data-testid="graph-matrix-legend"
        className="flex items-center gap-2 text-muted-foreground"
      >
        {GRAPH_MATRIX_CELL_KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-1">
            <span aria-hidden="true" className={MATRIX_KIND_CLASSES[kind]}>
              {MATRIX_GLYPHS[kind]}
            </span>
            {matrixKindLabel(kind)}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className={MATRIX_KIND_CLASSES.absent}>
            {MATRIX_GLYPHS.absent}
          </span>
          {t("projectGraph.matrix.absent")}
        </span>
      </span>
      <span
        role="group"
        aria-label={t("projectGraph.matrix.sortLabel")}
        className="flex items-center gap-0.5"
      >
        <Button
          variant="ghost"
          size="xs"
          data-testid="graph-matrix-sort-path"
          aria-pressed={sort === "path"}
          title={t("projectGraph.matrix.sortPathHint")}
          onClick={() => onSortChange("path")}
        >
          {t("projectGraph.matrix.sortPath")}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          data-testid="graph-matrix-sort-degree"
          aria-pressed={sort === "degree"}
          title={t("projectGraph.matrix.sortDegreeHint")}
          onClick={() => onSortChange("degree")}
        >
          {t("projectGraph.matrix.sortDegree")}
        </Button>
      </span>
    </div>
  );
}
