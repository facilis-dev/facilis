// The floating HUD (issue #57): four clusters over the full-bleed canvas, never in layout.
// Top-left breadcrumb + mode-switcher slot, top-right search/save/refresh/actions, bottom-left
// stats ribbon + lens-chips slot, bottom-right zoom/fit. The slots are empty placeholders
// owned by later issues — no mode or lens logic here. Below 1280px (Tailwind xl) the action
// buttons collapse to icons; accessible names stay through aria-label/title (D-043).
// Clusters read as popover surfaces with border + shadow, role tokens only (D-044).

import type { ReactNode, RefObject } from "react";
import Maximize2 from "~icons/lucide/maximize-2";
import Minus from "~icons/lucide/minus";
import Network from "~icons/lucide/network";
import Plus from "~icons/lucide/plus";
import RefreshCw from "~icons/lucide/refresh-cw";
import RotateCcw from "~icons/lucide/rotate-ccw";
import Save from "~icons/lucide/save";
import Scan from "~icons/lucide/scan";
import ScanEye from "~icons/lucide/scan-eye";
import StickyNote from "~icons/lucide/sticky-note";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t, type MessageKey } from "@/i18n";
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import { ProjectGraphStatsRibbon, type ProjectGraphStatsRibbonProps } from "./graph-stats-ribbon";

export type ProjectGraphSaveState = "idle" | "saving" | "saved" | "error";

/** The shell measures these four zone boxes to pad fitView clear of the HUD. */
export interface GraphHudZoneRefs {
  readonly topLeft: RefObject<HTMLDivElement | null>;
  readonly topRight: RefObject<HTMLDivElement | null>;
  readonly bottomLeft: RefObject<HTMLDivElement | null>;
  readonly bottomRight: RefObject<HTMLDivElement | null>;
}

/** The owner's order: narrowest first, "all" last (D-179). */
const TABLE_VISIBILITY_OPTIONS: readonly GraphTableVisibility[] = ["project", "used", "all"];

const TABLE_VISIBILITY_LABEL_KEYS: Record<GraphTableVisibility, MessageKey> = {
  project: "projectGraph.tableVisibility.project",
  used: "projectGraph.tableVisibility.used",
  all: "projectGraph.tableVisibility.all",
};

const ZONE_SURFACE = "rounded-md border border-border bg-popover/95 shadow-md";

/** An action button: icon always, label from 1280px up; the name never collapses. */
function HudButton({
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="h-6 gap-1 px-1.5 text-[11px]"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}

export function ProjectGraphHud({
  canvasReady,
  query,
  onQueryChange,
  onToggleZen,
  onFit,
  onZoomIn,
  onZoomOut,
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
  tableVisibility,
  onTableVisibilityChange,
  ribbonProps,
  zoneRefs,
}: {
  canvasReady: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onToggleZen: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
  ribbonProps: ProjectGraphStatsRibbonProps;
  zoneRefs: GraphHudZoneRefs;
}) {
  return (
    <>
      <div
        ref={zoneRefs.topLeft}
        data-testid="project-graph-hud-top-left"
        className={
          ZONE_SURFACE +
          " absolute left-2 top-2 z-10 flex max-w-[40%] items-center gap-1.5 px-2 py-1"
        }
      >
        <Network className="size-3.5 shrink-0 text-brand" />
        <span className="truncate text-xs font-medium">{t("projectGraph.title")}</span>
        {/* Mode-switcher slot: a later epic issue fills it; no behavior here. */}
        <div data-testid="project-graph-mode-slot" />
      </div>
      <div
        ref={zoneRefs.topRight}
        data-testid="project-graph-hud-top-right"
        role="toolbar"
        aria-label={t("projectGraph.actions")}
        className={
          ZONE_SURFACE +
          " absolute right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-1 px-1.5 py-1"
        }
      >
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("projectGraph.search")}
          aria-label={t("projectGraph.search")}
          className="h-6 w-28 rounded border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring xl:w-44"
        />
        {/* Only the AI tools create a focus (D-171); the escape hatch stays visible while active. */}
        {focusActive && (
          <Button
            variant="ghost"
            size="xs"
            className="h-6 gap-1 border border-brand/50 bg-brand/10 px-1.5 text-[11px] text-brand hover:bg-brand/20 hover:text-brand"
            aria-label={t("projectGraph.clearFocus")}
            title={t("projectGraph.clearFocusHint")}
            onClick={onClearFocus}
          >
            <ScanEye />
            <span className="hidden xl:inline">{t("projectGraph.clearFocus")}</span>
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
        <span className="flex items-center gap-0.5">
          <span className="text-[10px] text-muted-foreground">
            {t("projectGraph.tableVisibility")}
          </span>
          <Select<GraphTableVisibility>
            items={TABLE_VISIBILITY_OPTIONS.map((value) => ({
              value,
              label: t(TABLE_VISIBILITY_LABEL_KEYS[value]),
            }))}
            value={tableVisibility}
            onValueChange={(value) => {
              if (value !== null) onTableVisibilityChange(value);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("projectGraph.tableVisibility")}
              title={t("projectGraph.tableVisibility.hint")}
              className="h-5 gap-0.5 rounded border px-1.5 py-0 text-[10px] text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TABLE_VISIBILITY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value} className="text-[11px]">
                  {t(TABLE_VISIBILITY_LABEL_KEYS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
        <HudButton label={t("projectGraph.addNote")} disabled={!canvasReady} onClick={onAddNote}>
          <StickyNote />
        </HudButton>
        <HudButton
          label={t("projectGraph.resetLayout")}
          disabled={!canvasReady}
          onClick={onResetLayout}
        >
          <RotateCcw />
        </HudButton>
        <HudButton
          label={t("projectGraph.save")}
          disabled={!canvasReady || saveState === "saving"}
          onClick={onSave}
        >
          <Save />
        </HudButton>
        <HudButton
          label={t("projectGraph.zen")}
          title={t("projectGraph.zenHint")}
          onClick={onToggleZen}
        >
          <Maximize2 />
        </HudButton>
        <HudButton label={t("projectGraph.refresh")} disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={refreshing ? "size-3 animate-spin" : undefined} />
        </HudButton>
      </div>
      <div
        ref={zoneRefs.bottomLeft}
        data-testid="project-graph-hud-bottom-left"
        className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-16rem)] flex-col items-start gap-1"
      >
        <ProjectGraphStatsRibbon {...ribbonProps} />
        {/* Lens-chips slot: a later epic issue fills it; no behavior here. */}
        <div data-testid="project-graph-lens-slot" />
      </div>
      <div
        ref={zoneRefs.bottomRight}
        data-testid="project-graph-hud-bottom-right"
        role="toolbar"
        aria-label={t("projectGraph.viewControls")}
        className={
          ZONE_SURFACE + " absolute bottom-2 right-2 z-10 flex items-center gap-0.5 px-1 py-0.5"
        }
      >
        <HudButton label={t("projectGraph.zoomOut")} disabled={!canvasReady} onClick={onZoomOut}>
          <Minus />
        </HudButton>
        <HudButton label={t("projectGraph.zoomIn")} disabled={!canvasReady} onClick={onZoomIn}>
          <Plus />
        </HudButton>
        <HudButton label={t("projectGraph.fit")} disabled={!canvasReady} onClick={onFit}>
          <Scan />
        </HudButton>
      </div>
    </>
  );
}
