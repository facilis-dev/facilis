// The project-graph toolbar: search, one compact row of primary actions (fit/reset/save,
// fullscreen, refresh) and the edge-kind/table-visibility filters collapsed into a "Filters"
// menu with a badge (#182). The chip rows used to wrap into five lines inside a normal side
// panel and left the canvas ~150px tall; the canvas now owns the remaining height.

import Maximize2 from "~icons/lucide/maximize-2";
import Minimize2 from "~icons/lucide/minimize-2";
import Network from "~icons/lucide/network";
import RefreshCw from "~icons/lucide/refresh-cw";
import RotateCcw from "~icons/lucide/rotate-ccw";
import Save from "~icons/lucide/save";
import Scan from "~icons/lucide/scan";
import ScanEye from "~icons/lucide/scan-eye";
import StickyNote from "~icons/lucide/sticky-note";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphStats } from "@/facilis/graph-model";
import { ProjectGraphFiltersMenu } from "./ProjectGraphFiltersMenu";
import { ProjectGraphSearchResults } from "./ProjectGraphSearchResults";

export type ProjectGraphSaveState = "idle" | "saving" | "saved" | "error";

export function ProjectGraphToolbar({
  stats,
  hiddenEdgeKinds,
  query,
  onQueryChange,
  results,
  onJumpToNode,
  onSubmitSearch,
  fullscreen,
  onToggleFullscreen,
  onFit,
  onResetLayout,
  onAddNote,
  onSave,
  onRefresh,
  refreshing,
  saveState,
  saveError,
  errors,
  warnings,
  focusActive,
  onClearFocus,
  onToggleEdgeKind,
  tableVisibility,
  onTableVisibilityChange,
}: {
  stats: ProjectGraphStats | null;
  hiddenEdgeKinds: readonly GraphEdgeKind[];
  query: string;
  onQueryChange: (value: string) => void;
  /** The debounced matches, capped for the result list. */
  results: readonly ProjectGraphNode[];
  onJumpToNode: (id: string) => void;
  /** Enter: flush the debounce and jump to the first match. */
  onSubmitSearch: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onFit: () => void;
  onResetLayout: () => void;
  /** Ask the surface to create a note at the centre of its visible content box. */
  onAddNote: () => void;
  onSave: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  saveState: ProjectGraphSaveState;
  saveError: string | null;
  errors: number;
  warnings: number;
  focusActive: boolean;
  onClearFocus: () => void;
  onToggleEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  // Only the non-default state earns chrome: a quiet panel is a usable canvas (#182).
  const showStatus =
    errors > 0 ||
    warnings > 0 ||
    saveState !== "idle" ||
    (stats !== null && (stats.hiddenEdges > 0 || stats.hiddenNodes > 0 || stats.matches > 0));
  return (
    <div className="@container flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium">
          <Network className="size-3.5 shrink-0 text-brand" />
          <span className="hidden truncate @sm:inline">{t("projectGraph.title")}</span>
        </div>
        <div className="relative min-w-24 flex-1">
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitSearch();
              } else if (event.key === "Escape" && query.length > 0) {
                // The search owns Escape while it has text: clearing it is the first step.
                event.preventDefault();
                event.stopPropagation();
                onQueryChange("");
              }
            }}
            placeholder={t("projectGraph.search")}
            aria-label={t("projectGraph.search")}
            className="h-6 w-full rounded border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          {searchFocused && (
            <ProjectGraphSearchResults query={query} results={results} onJump={onJumpToNode} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ProjectGraphFiltersMenu
            hiddenEdgeKinds={hiddenEdgeKinds}
            tableVisibility={tableVisibility}
            onToggleEdgeKind={onToggleEdgeKind}
            onTableVisibilityChange={onTableVisibilityChange}
          />
          {focusActive && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="border border-brand/50 bg-brand/10 text-brand hover:bg-brand/20 hover:text-brand"
              aria-label={t("projectGraph.clearFocus")}
              title={t("projectGraph.clearFocusHint")}
              onClick={onClearFocus}
            >
              <ScanEye />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="project-graph-add-note"
            aria-label={t("projectGraph.addNote")}
            title={t("projectGraph.addNote")}
            disabled={stats === null}
            onClick={onAddNote}
          >
            <StickyNote />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projectGraph.fit")}
            title={t("projectGraph.fit")}
            disabled={stats === null}
            onClick={onFit}
          >
            <Scan />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projectGraph.resetLayout")}
            title={t("projectGraph.resetLayout")}
            disabled={stats === null}
            onClick={onResetLayout}
          >
            <RotateCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projectGraph.save")}
            title={t("projectGraph.save")}
            disabled={stats === null || saveState === "saving"}
            onClick={onSave}
          >
            <Save />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              fullscreen ? t("projectGraph.exitFullscreen") : t("projectGraph.fullscreen")
            }
            title={fullscreen ? t("projectGraph.exitFullscreen") : t("projectGraph.fullscreen")}
            aria-pressed={fullscreen}
            data-graph-fullscreen-toggle=""
            onClick={onToggleFullscreen}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projectGraph.refresh")}
            title={t("projectGraph.refresh")}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
      {showStatus && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {(errors > 0 || warnings > 0) && (
            <span
              title={t("projectGraph.diagnostics")}
              className="flex items-center gap-1 rounded border border-warning/50 px-1.5 py-0.5 text-warning"
            >
              <TriangleAlert className="size-3" />
              {t("projectGraph.diagnosticErrors", { count: errors })} /{" "}
              {t("projectGraph.diagnosticWarnings", { count: warnings })}
            </span>
          )}
          <span
            className={saveState === "error" ? "text-destructive" : "text-muted-foreground"}
            title={saveError ?? undefined}
          >
            {saveState === "saving"
              ? t("projectGraph.saving")
              : saveState === "saved"
                ? t("projectGraph.saved")
                : saveState === "error"
                  ? t("projectGraph.saveFailed", { error: saveError ?? "" })
                  : ""}
          </span>
          {stats !== null && stats.hiddenEdges > 0 && (
            <span>{t("projectGraph.hiddenEdges", { count: stats.hiddenEdges })}</span>
          )}
          {stats !== null && stats.hiddenNodes > 0 && (
            <span>{t("projectGraph.hiddenNodes", { count: stats.hiddenNodes })}</span>
          )}
          {stats !== null && query.trim().length > 0 && (
            <span>{t("projectGraph.matches", { count: stats.matches })}</span>
          )}
        </div>
      )}
    </div>
  );
}
