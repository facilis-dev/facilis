// The HUD composition slot (issue #57), extracted from ProjectGraphPanel so the composition
// root stays under the 300-line source limit as modes land. Owns the zen gate and wires the
// floating clusters: the mode switcher (issue #67) rides the shared view state like every other
// HUD control, so canvas ↔ matrix is one URL-synced switch, never a parallel state.

import type { Dispatch, SetStateAction } from "react";
import { clearGraphFocus } from "@/facilis/graph-focus";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import {
  toggleEdgesFilter,
  toggleKindFilter,
  type GraphStatsFilter,
} from "@/facilis/graph-stats-filter";
import { ProjectGraphHud } from "./ProjectGraphHud";
import type { ProjectGraphHudSlots } from "./useProjectGraphHudSlots";
import type { ProjectGraphLayout } from "./useProjectGraphLayout";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphHudSlotProps {
  zen: boolean;
  onToggleZen: () => void;
  viewState: ProjectGraphViewState;
  graph: ProjectGraphLayout;
  slots: ProjectGraphHudSlots;
  stats: ProjectGraphStats | null;
  filter: GraphStatsFilter;
  onFilterChange: Dispatch<SetStateAction<GraphStatsFilter>>;
  errors: number;
  warnings: number;
  onRefresh: () => void;
  refreshing: boolean;
  focusActive: boolean;
  onFit: () => void;
  /** The React Flow instance, lifted only so the zoom buttons can drive it (issue #57). */
  flow: { zoomIn: () => void; zoomOut: () => void } | null;
  onResetLayout: () => void;
  /** False while a non-canvas state view is up: the first note then lands at a fixed origin. */
  canvasActive: boolean;
}

export function ProjectGraphHudSlot(props: ProjectGraphHudSlotProps) {
  const { viewState, graph, slots, filter, onFilterChange } = props;
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
      onFit={props.onFit}
      onZoomIn={() => props.flow?.zoomIn()}
      onZoomOut={() => props.flow?.zoomOut()}
      filter={filter}
      onToggleKind={(kind) => onFilterChange((current) => toggleKindFilter(current, kind))}
      onToggleEdges={() => onFilterChange((current) => toggleEdgesFilter(current))}
      lensChips={slots.lensChips}
      focusBar={slots.focusBar}
      runtimeControls={slots.runtimeControls}
      auditRibbon={slots.auditRibbon}
      dataRibbon={slots.dataRibbon}
      turnRibbon={slots.turnRibbon}
      clusterControls={slots.clusterControls}
      tableVisibility={graph.layout.tableVisibility}
      onTableVisibilityChange={graph.changeTableVisibility}
      mode={viewState.state.mode}
      onModeChange={viewState.setMode}
      onAddNote={
        props.canvasActive ? () => graph.createNote({ x: 120, y: 120 }) : graph.requestAddNote
      }
      onResetLayout={props.onResetLayout}
    />
  );
}
