// The project-graph toolbar: title, search, the edge-kind filters, the layout actions
// (fit/reset/save), fullscreen and refresh, plus the diagnostics badge. Split from the panel
// to keep both files well under the 300-line source limit.

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
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS, type GraphSystemNodeKind } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import { GRAPH_EDGE_LABEL_KEYS, GRAPH_EDGE_STYLES } from "./project-graph-edges";

export type ProjectGraphSaveState = "idle" | "saving" | "saved" | "error";

export function ProjectGraphToolbar({
  stats,
  hiddenEdgeKinds,
  query,
  onQueryChange,
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
  hideSystemRoutes,
  hideSystemTables,
  onToggleSystemNodes,
}: {
  stats: ProjectGraphStats | null;
  hiddenEdgeKinds: readonly GraphEdgeKind[];
  query: string;
  onQueryChange: (value: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onFit: () => void;
  onResetLayout: () => void;
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
  hideSystemRoutes: boolean;
  hideSystemTables: boolean;
  onToggleSystemNodes: (kind: GraphSystemNodeKind, hidden: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Network className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("projectGraph.title")}</span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("projectGraph.search")}
          aria-label={t("projectGraph.search")}
          className="mx-1 h-6 min-w-32 flex-1 rounded border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        {/* Only the AI tools create a focus (D-171), and without this the dimmed canvas had no
            way back, so the escape hatch is visible next to the title while it is active. */}
        {focusActive && (
          <Button
            variant="ghost"
            size="sm"
            className="border border-brand/50 bg-brand/10 text-brand hover:bg-brand/20 hover:text-brand"
            aria-label={t("projectGraph.clearFocus")}
            title={t("projectGraph.clearFocusHint")}
            onClick={onClearFocus}
          >
            <ScanEye />
            <span>{t("projectGraph.clearFocus")}</span>
          </Button>
        )}
        {(errors > 0 || warnings > 0) && (
          <span
            title={t("projectGraph.diagnostics")}
            className="flex items-center gap-1 rounded border border-warning/50 px-1.5 py-0.5 text-[10px] text-warning"
          >
            <TriangleAlert className="size-3" />
            {t("projectGraph.diagnosticErrors", { count: errors })} /{" "}
            {t("projectGraph.diagnosticWarnings", { count: warnings })}
          </span>
        )}
        <span
          className={
            "text-[10px] " + (saveState === "error" ? "text-destructive" : "text-muted-foreground")
          }
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
        <Button
          variant="ghost"
          size="icon-sm"
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
          aria-label={fullscreen ? t("projectGraph.exitFullscreen") : t("projectGraph.fullscreen")}
          title={fullscreen ? t("projectGraph.exitFullscreen") : t("projectGraph.fullscreen")}
          aria-pressed={fullscreen}
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
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{t("projectGraph.filters")}</span>
        {GRAPH_EDGE_KINDS.map((kind) => {
          const hidden = hiddenEdgeKinds.includes(kind);
          return (
            <label
              key={kind}
              className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent"
            >
              <input
                type="checkbox"
                className="size-3 accent-primary"
                checked={!hidden}
                onChange={(event) => onToggleEdgeKind(kind, !event.target.checked)}
              />
              <span
                className="inline-block h-0.5 w-3 shrink-0 rounded"
                style={{ background: GRAPH_EDGE_STYLES[kind].stroke }}
              />
              <span>{t(GRAPH_EDGE_LABEL_KEYS[kind])}</span>
            </label>
          );
        })}
        <span>{t("projectGraph.systemFilters")}</span>
        <label
          title={t("projectGraph.systemHint")}
          className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent"
        >
          <input
            type="checkbox"
            className="size-3 accent-primary"
            checked={!hideSystemRoutes}
            onChange={(event) => onToggleSystemNodes("routes", !event.target.checked)}
          />
          <span>{t("projectGraph.systemRoutes")}</span>
        </label>
        <label
          title={t("projectGraph.systemHint")}
          className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent"
        >
          <input
            type="checkbox"
            className="size-3 accent-primary"
            checked={!hideSystemTables}
            onChange={(event) => onToggleSystemNodes("tables", !event.target.checked)}
          />
          <span>{t("projectGraph.systemTables")}</span>
        </label>
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
    </div>
  );
}
