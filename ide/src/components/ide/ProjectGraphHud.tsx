// The floating HUD (issue #57): clusters float over the full-bleed canvas, never resizing it.
// Top-left the breadcrumb trail (issue #68, project → cluster → node) + the mode switcher (#67);
// top-right search/save/refresh/palette/actions (ProjectGraphHudTopRight); the bottom-left
// ribbon, lens chips (#63) and lens ribbons and the bottom-right minimap SLOT + zoom/fit share
// one dock row (#150) so they cannot overlap. Every control is a named, keyboard-reachable
// button (role="toolbar", labels collapse below 1280px); role tokens only; t() strings.

import type { ReactNode } from "react";
import Network from "~icons/lucide/network";
import Scan from "~icons/lucide/scan";
import Table2 from "~icons/lucide/table-2";
import ZoomIn from "~icons/lucide/zoom-in";
import ZoomOut from "~icons/lucide/zoom-out";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import type { GraphViewMode } from "@/facilis/graph-view-state";
import type { GraphStatsFilter } from "@/facilis/graph-stats-filter";
import { ProjectGraphHudTopRight, type ProjectGraphSaveState } from "./ProjectGraphHudTopRight";
import { ProjectGraphStatsRibbon } from "./ProjectGraphStatsRibbon";

export type { ProjectGraphSaveState };

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
  /** The runtime lens's control strip (issue #72), or null when the lens is inactive. */
  runtimeControls: ReactNode;
  /** The contract lens's audit ribbon (issue #69), or null when the lens is inactive. */
  auditRibbon: ReactNode;
  /** The data lens's summary ribbon (issue #70), or null when the lens is inactive. */
  dataRibbon: ReactNode;
  /** The agent lens's turn-diff segment (issue #73), or null when the lens is inactive. */
  turnRibbon: ReactNode;
  /** The selection-context line / isolate exit (issue #66), in the top-left cluster. */
  focusBar: ReactNode;
  /** The project → cluster → node trail (issue #68), replacing the static title top-left. */
  breadcrumbs: ReactNode;
  /** The cluster group-by toggle (issue #62), beside the trail it groups around. */
  clusterControls: ReactNode;
  /** The minimap (issue #68), docked in the bottom-right cluster beside zoom and fit. */
  minimap: ReactNode;
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
  /** The drawn mode (issue #67); timeline stays a carried mode until #76 renders it. */
  mode: GraphViewMode;
  onModeChange: (mode: GraphViewMode) => void;
  onAddNote: () => void;
  onResetLayout: () => void;
  /** Palette / shortcut-sheet triggers (issue #68); the keys work in zen too, the HUD hides. */
  onOpenPalette: () => void;
  onOpenSheet: () => void;
}

// The cluster box without positioning: the top clusters anchor absolutely, while the two bottom
// clusters are flex children of the dock row below (issue #150), so they must not be absolute.
const CLUSTER_BOX =
  "pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm";
const CLUSTER = CLUSTER_BOX + " absolute";

export function ProjectGraphHud(props: ProjectGraphHudProps) {
  const { stats } = props;
  return (
    <div data-testid="graph-hud" className="pointer-events-none absolute inset-0 z-10">
      {/* Top-left: the project → cluster → node trail (issues #62/#68) + mode switcher (#67). */}
      <div
        role="toolbar"
        aria-label={t("projectGraph.hud.overview")}
        data-testid="graph-hud-top-left"
        data-hud-zone
        className={CLUSTER + " top-2 left-2 max-w-[60%]"}
      >
        <Network className="size-3.5 shrink-0 text-brand" />
        {props.breadcrumbs}
        {props.clusterControls}
        {props.focusBar}
        <span
          role="group"
          data-testid="graph-hud-mode-slot"
          aria-label={t("projectGraph.hud.modeSlot")}
          className="flex items-center gap-0.5"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="graph-hud-mode-topology"
            aria-pressed={props.mode !== "matrix"}
            aria-label={t("projectGraph.hud.modeTopology")}
            title={t("projectGraph.hud.modeHint")}
            onClick={() => props.onModeChange("topology")}
          >
            <Network />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="graph-hud-mode-matrix"
            aria-pressed={props.mode === "matrix"}
            aria-label={t("projectGraph.hud.modeMatrix")}
            title={t("projectGraph.hud.modeHint")}
            onClick={() => props.onModeChange("matrix")}
          >
            <Table2 />
          </Button>
        </span>
      </div>

      <ProjectGraphHudTopRight
        className={CLUSTER + " top-2 right-2 max-w-[calc(100%-1rem)] flex-wrap justify-end"}
        stats={stats}
        query={props.query}
        onQueryChange={props.onQueryChange}
        saveState={props.saveState}
        saveError={props.saveError}
        onSave={props.onSave}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
        zen={props.zen}
        onToggleZen={props.onToggleZen}
        focusActive={props.focusActive}
        onClearFocus={props.onClearFocus}
        errors={props.errors}
        warnings={props.warnings}
        onOpenPalette={props.onOpenPalette}
        onOpenSheet={props.onOpenSheet}
        tableVisibility={props.tableVisibility}
        onTableVisibilityChange={props.onTableVisibilityChange}
        onAddNote={props.onAddNote}
        onResetLayout={props.onResetLayout}
      />

      {/* Bottom dock (issue #150): the stats ribbon + lens chips (left) and the minimap + zoom/fit
          (right) share one floating row. The left cluster wraps within the space the right leaves
          (min-w-0) and the right never shrinks, so the two can never overlap however narrow the
          canvas gets. The row is a query container (@container): on a narrow canvas the lens chips
          collapse to their popover button (@md) so the ribbon stays compact instead of wrapping
          into a tall column. */}
      <div
        data-hud-dock
        className="@container pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2"
      >
        <ProjectGraphStatsRibbon
          stats={stats}
          filter={props.filter}
          onToggleKind={props.onToggleKind}
          onToggleEdges={props.onToggleEdges}
          lensChips={props.lensChips}
          runtimeControls={props.runtimeControls}
          auditRibbon={props.auditRibbon}
          dataRibbon={props.dataRibbon}
          turnRibbon={props.turnRibbon}
        />

        {/* Bottom-right: the minimap SLOT (issue #68), zoom, fit. */}
        <div
          role="toolbar"
          aria-label={t("projectGraph.hud.view")}
          data-testid="graph-hud-bottom-right"
          data-hud-zone
          className={CLUSTER_BOX + " shrink-0"}
        >
          <div
            data-testid="graph-hud-minimap-slot"
            aria-label={t("projectGraph.hud.minimapSlot")}
            className="flex items-center"
          >
            {props.minimap}
          </div>
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
    </div>
  );
}
