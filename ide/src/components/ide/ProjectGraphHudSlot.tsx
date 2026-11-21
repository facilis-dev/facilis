// The HUD composition slot (issue #57), extracted from ProjectGraphPanel so the composition
// root stays under the 300-line source limit as modes land. Owns the zen gate and wires the
// floating clusters: the mode switcher (issue #67) rides the shared view state like every other
// HUD control, so canvas ↔ matrix is one URL-synced switch, never a parallel state; the
// navigation surface (issue #68) fills the minimap slot (docked, issue #150) and the top-left
// breadcrumb trail with the cluster group-by toggle, and opens the palette/shortcut sheet.

import type { Dispatch, RefObject, SetStateAction } from "react";
import { clearGraphFocus } from "@/facilis/graph-focus";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import {
  toggleEdgesFilter,
  toggleKindFilter,
  type GraphStatsFilter,
} from "@/facilis/graph-stats-filter";
import { ProjectGraphBreadcrumbs } from "./ProjectGraphBreadcrumbs";
import { ProjectGraphHud } from "./ProjectGraphHud";
import { ProjectGraphMinimap } from "./ProjectGraphMinimap";
import type { ProjectGraphHudSlots } from "./useProjectGraphHudSlots";
import type { ProjectGraphLayout } from "./useProjectGraphLayout";
import type { ProjectGraphNavigation } from "./useProjectGraphNavigation";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphHudSlotProps {
  zen: boolean;
  onToggleZen: () => void;
  viewState: ProjectGraphViewState;
  graph: ProjectGraphLayout;
  slots: ProjectGraphHudSlots;
  /** The navigation surface (issue #68): minimap, breadcrumbs, palette and shortcut sheet. */
  navigation: ProjectGraphNavigation;
  /** The canvas container the minimap reads for the visible-world rectangle. */
  containerRef: RefObject<HTMLDivElement | null>;
  stats: ProjectGraphStats | null;
  filter: GraphStatsFilter;
  onFilterChange: Dispatch<SetStateAction<GraphStatsFilter>>;
  errors: number;
  warnings: number;
  onRefresh: () => void;
  refreshing: boolean;
  focusActive: boolean;
  /** False while a non-canvas state view is up: the first note then lands at a fixed origin. */
  canvasActive: boolean;
}

export function ProjectGraphHudSlot(props: ProjectGraphHudSlotProps) {
  const { viewState, graph, slots, filter, onFilterChange, navigation } = props;
  if (props.zen) return null;
  return (
    <ProjectGraphHud
      stats={props.stats}
      query={viewState.state.query}
      onQueryChange={viewState.setQuery}
      saveState={graph.saveState}
      saveError={graph.saveError}
      onSave={graph.saveNow}
      onRefresh={props.onRefresh}
      refreshing={props.refreshing}
      zen={props.zen}
      onToggleZen={props.onToggleZen}
      focusActive={props.focusActive}
      onClearFocus={clearGraphFocus}
      errors={props.errors}
      warnings={props.warnings}
      onFit={navigation.fit}
      onZoomIn={() => navigation.flow?.zoomIn()}
      onZoomOut={() => navigation.flow?.zoomOut()}
      filter={filter}
      onToggleKind={(kind) => onFilterChange((current) => toggleKindFilter(current, kind))}
      onToggleEdges={() => onFilterChange((current) => toggleEdgesFilter(current))}
      lensChips={slots.lensChips}
      focusBar={slots.focusBar}
      runtimeControls={slots.runtimeControls}
      auditRibbon={slots.auditRibbon}
      dataRibbon={slots.dataRibbon}
      turnRibbon={slots.turnRibbon}
      breadcrumbs={
        <ProjectGraphBreadcrumbs
          trail={navigation.trail}
          onNavigate={navigation.navigateBreadcrumb}
        />
      }
      clusterControls={slots.clusterControls}
      // The minimap is a canvas affordance: matrix mode has no viewport to draw.
      minimap={
        viewState.state.mode === "matrix" ? null : (
          <ProjectGraphMinimap
            nodes={navigation.minimapNodes}
            viewport={navigation.liveViewport}
            containerRef={props.containerRef}
            onPan={navigation.panTo}
            onPanEnd={navigation.panEnd}
          />
        )
      }
      tableVisibility={graph.layout.tableVisibility}
      onTableVisibilityChange={graph.changeTableVisibility}
      mode={viewState.state.mode}
      onModeChange={viewState.setMode}
      onAddNote={
        props.canvasActive ? () => graph.createNote({ x: 120, y: 120 }) : graph.requestAddNote
      }
      onResetLayout={navigation.resetLayout}
      onOpenPalette={navigation.openPalette}
      onOpenSheet={navigation.openSheet}
    />
  );
}
