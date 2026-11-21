// The HUD's top-right cluster (issues #57/#68): search, save state, diagnostics, the AI-focus
// exit, save/refresh, the palette and shortcut-sheet triggers and the actions menu. Extracted
// from ProjectGraphHud so the file stays under the 300-line source limit while issue #68 fills
// the navigation controls; the markup and the absolute anchoring stay identical (the cluster
// owns data-hud-zone, so fit padding still measures it). Every control is a named, keyboard-
// reachable button; role tokens only (D-044), every string via t() (D-043).

import Command from "~icons/lucide/command";
import Keyboard from "~icons/lucide/keyboard";
import Maximize2 from "~icons/lucide/maximize-2";
import Minimize2 from "~icons/lucide/minimize-2";
import RefreshCw from "~icons/lucide/refresh-cw";
import Save from "~icons/lucide/save";
import ScanEye from "~icons/lucide/scan-eye";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import { ProjectGraphHudActions } from "./ProjectGraphHudActions";

export type ProjectGraphSaveState = "idle" | "saving" | "saved" | "error";

export interface ProjectGraphHudTopRightProps {
  /** The HUD's shared cluster box + its absolute anchor, owned by ProjectGraphHud. */
  className: string;
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
  /** Palette / shortcut-sheet triggers (issue #68); the keys work in zen too, the HUD hides. */
  onOpenPalette: () => void;
  onOpenSheet: () => void;
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
  onAddNote: () => void;
  onResetLayout: () => void;
}

export function ProjectGraphHudTopRight(props: ProjectGraphHudTopRightProps) {
  const { stats } = props;
  return (
    <div
      role="toolbar"
      aria-label={t("projectGraph.hud.actions")}
      data-testid="graph-hud-top-right"
      data-hud-zone
      className={props.className}
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
        data-testid="graph-hud-palette"
        aria-label={t("projectGraph.palette.triggerHint")}
        title={t("projectGraph.palette.triggerHint")}
        onClick={props.onOpenPalette}
      >
        <Command />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="graph-hud-shortcuts"
        aria-label={t("projectGraph.shortcuts.triggerHint")}
        title={t("projectGraph.shortcuts.triggerHint")}
        onClick={props.onOpenSheet}
      >
        <Keyboard />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="graph-hud-zen"
        aria-pressed={props.zen}
        aria-label={props.zen ? t("projectGraph.exitZen") : t("projectGraph.zen")}
        title={t("projectGraph.zenHint")}
        onClick={props.onToggleZen}
      >
        {props.zen ? <Minimize2 /> : <Maximize2 />}
      </Button>
      <ProjectGraphHudActions
        stats={stats}
        tableVisibility={props.tableVisibility}
        onTableVisibilityChange={props.onTableVisibilityChange}
        onAddNote={props.onAddNote}
        onResetLayout={props.onResetLayout}
      />
    </div>
  );
}
