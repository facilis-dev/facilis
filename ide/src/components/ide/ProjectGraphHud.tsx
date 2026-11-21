// The floating HUD (issue #57): four clusters absolutely positioned over the full-bleed canvas,
// never participating in layout. Top-left breadcrumb + mode-switcher SLOT; top-right search, save
// state, refresh and actions; bottom-left the stats ribbon + the lens chips (issue #63);
// bottom-right minimap SLOT, zoom and fit. The remaining slots are owned here but left empty —
// later issues fill them. Every control is a named, keyboard-reachable button; clusters are
// role="toolbar". Below 1280px (xl) button labels collapse to icons. Role tokens only (D-044);
// every string via t() (D-043).

import type { ReactNode } from "react";
import Maximize2 from "~icons/lucide/maximize-2";
import Minimize2 from "~icons/lucide/minimize-2";
import Network from "~icons/lucide/network";
import RefreshCw from "~icons/lucide/refresh-cw";
import Save from "~icons/lucide/save";
import Scan from "~icons/lucide/scan";
import ScanEye from "~icons/lucide/scan-eye";
import TriangleAlert from "~icons/lucide/triangle-alert";
import ZoomIn from "~icons/lucide/zoom-in";
import ZoomOut from "~icons/lucide/zoom-out";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import type { GraphStatsFilter } from "@/facilis/graph-stats-filter";
import { ProjectGraphHudActions } from "./ProjectGraphHudActions";
import { ProjectGraphStatsRibbon } from "./ProjectGraphStatsRibbon";

export type ProjectGraphSaveState = "idle" | "saving" | "saved" | "error";

export interface ProjectGraphHudProps {
  stats: ProjectGraphStats | null;
  query: string;
  onQueryChange: (value: string) => void;
  saveState: ProjectGraphSaveState;
  saveError: string | null;
  onSave: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  zen: boolean;
  onToggleZen: () => void;
  focusActive: boolean;
  onClearFocus: () => void;
  errors: number;
  warnings: number;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  filter: GraphStatsFilter;
  onToggleKind: (kind: GraphNodeKind) => void;
  onToggleEdges: () => void;
  /** The lens chips (issue #63), docked in the bottom-left slot beside the stats ribbon. */
  lensChips: ReactNode;
  /** The selection-context line / isolate breadcrumb (issue #66), in the top-left cluster. */
  focusBar: ReactNode;
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
  onAddNote: () => void;
  onResetLayout: () => void;
}

const CLUSTER =
  "pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm";

export function ProjectGraphHud(props: ProjectGraphHudProps) {
  const { stats, zen } = props;
  return (
    <div data-testid="graph-hud" className="pointer-events-none absolute inset-0 z-10">
      {/* Top-left: breadcrumb + mode-switcher SLOT (filled by a later issue). */}
      <div
        role="toolbar"
        aria-label={t("projectGraph.hud.overview")}
        data-testid="graph-hud-top-left"
        data-hud-zone
        className={CLUSTER + " top-2 left-2 max-w-[60%]"}
      >
        <Network className="size-3.5 shrink-0 text-brand" />
        <span className="truncate text-xs font-medium">{t("projectGraph.title")}</span>
        {props.focusBar}
        <div
          data-testid="graph-hud-mode-slot"
          aria-label={t("projectGraph.hud.modeSlot")}
          className="hidden"
        />
      </div>

      {/* Top-right: search, save state, refresh, zen, actions. */}
      <div
        role="toolbar"
        aria-label={t("projectGraph.hud.actions")}
        data-testid="graph-hud-top-right"
        data-hud-zone
        className={CLUSTER + " top-2 right-2 max-w-[calc(100%-1rem)] flex-wrap justify-end"}
      >
        <input
          type="search"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("projectGraph.search")}
          aria-label={t("projectGraph.search")}
          data-testid="graph-hud-search"
          className="h-6 w-28 rounded border border-border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring xl:w-44"
        />
        <span
          data-testid="graph-hud-save-state"
          title={props.saveError ?? undefined}
          className={
            "hidden text-[10px] xl:inline " +
            (props.saveState === "error" ? "text-destructive" : "text-muted-foreground")
          }
        >
          {props.saveState === "saving"
            ? t("projectGraph.saving")
            : props.saveState === "saved"
              ? t("projectGraph.saved")
              : props.saveState === "error"
                ? t("projectGraph.saveFailed", { error: props.saveError ?? "" })
                : ""}
        </span>
        {(props.errors > 0 || props.warnings > 0) && (
          <span
            title={t("projectGraph.diagnostics")}
            className="flex items-center gap-1 rounded border border-warning/50 px-1.5 py-0.5 text-[10px] text-warning"
          >
            <TriangleAlert className="size-3" />
            <span className="hidden xl:inline">
              {t("projectGraph.diagnosticErrors", { count: props.errors })} /{" "}
              {t("projectGraph.diagnosticWarnings", { count: props.warnings })}
            </span>
          </span>
        )}
        {props.focusActive && (
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="graph-hud-clear-focus"
            className="border border-brand/50 bg-brand/10 text-brand hover:bg-brand/20 hover:text-brand"
            aria-label={t("projectGraph.clearFocus")}
            title={t("projectGraph.clearFocusHint")}
            onClick={props.onClearFocus}
          >
            <ScanEye />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-save"
          aria-label={t("projectGraph.save")}
          title={t("projectGraph.save")}
          disabled={stats === null || props.saveState === "saving"}
          onClick={props.onSave}
        >
          <Save />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-refresh"
          aria-label={t("projectGraph.refresh")}
          title={t("projectGraph.refresh")}
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          <RefreshCw className={props.refreshing ? "animate-spin" : undefined} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-zen"
          aria-pressed={zen}
          aria-label={zen ? t("projectGraph.exitZen") : t("projectGraph.zen")}
          title={t("projectGraph.zenHint")}
          onClick={props.onToggleZen}
        >
          {zen ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <ProjectGraphHudActions
          stats={stats}
          tableVisibility={props.tableVisibility}
          onTableVisibilityChange={props.onTableVisibilityChange}
          onAddNote={props.onAddNote}
          onResetLayout={props.onResetLayout}
        />
      </div>

      {/* Bottom-left: stats ribbon (filter counters) + lens chips (issue #63). */}
      <ProjectGraphStatsRibbon
        stats={stats}
        filter={props.filter}
        onToggleKind={props.onToggleKind}
        onToggleEdges={props.onToggleEdges}
        lensChips={props.lensChips}
      />

      {/* Bottom-right: minimap SLOT (later issue), zoom, fit. */}
      <div
        role="toolbar"
        aria-label={t("projectGraph.hud.view")}
        data-testid="graph-hud-bottom-right"
        data-hud-zone
        className={CLUSTER + " right-2 bottom-2"}
      >
        <div
          data-testid="graph-hud-minimap-slot"
          aria-label={t("projectGraph.hud.minimapSlot")}
          className="hidden"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-zoom-out"
          aria-label={t("projectGraph.zoomOut")}
          title={t("projectGraph.zoomOut")}
          disabled={stats === null}
          onClick={props.onZoomOut}
        >
          <ZoomOut />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-zoom-in"
          aria-label={t("projectGraph.zoomIn")}
          title={t("projectGraph.zoomIn")}
          disabled={stats === null}
          onClick={props.onZoomIn}
        >
          <ZoomIn />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="graph-hud-fit"
          aria-label={t("projectGraph.fit")}
          title={t("projectGraph.fit")}
          disabled={stats === null}
          onClick={props.onFit}
        >
          <Scan />
        </Button>
      </div>
    </div>
  );
}
