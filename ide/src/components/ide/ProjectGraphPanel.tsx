// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// loadProjectAnalysis(controller) and drawn full-bleed in the editor area (issue #57).
//
// This file is the composition root: the stats-ribbon filter, zen mode, the AI focus, the
// user's focus-and-context (issue #66) and the navigation surface (issue #68: palette, minimap,
// breadcrumbs, zoom presets, shortcut sheet). The analysis lifecycle lives in
// useProjectGraphAnalysis, the URL-synced view in useProjectGraphViewState (composing the
// saved-layout hook), the closure in useProjectGraphUserFocus, the keyboard in
// useProjectGraphPanelKeys, the navigation in useProjectGraphNavigation, the chrome in
// ProjectGraphShell / Hud / StatsRibbon / InspectorSlot. Nothing here touches the analyzer
// worker or writes outside the project's .facilis directory.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { closureSummary } from "@/facilis/graph-user-focus";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import {
  EMPTY_STATS_FILTER,
  effectiveHiddenEdgeKinds,
  toggleEdgesFilter,
  toggleKindFilter,
} from "@/facilis/graph-stats-filter";
import { countEdgeKinds } from "@/facilis/graph-lens-state";
import { INITIAL_ZEN, zenReducer } from "@/facilis/graph-zen";
import { ProjectGraphBreadcrumbs } from "./ProjectGraphBreadcrumbs";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphFocusBar } from "./ProjectGraphFocusBar";
import { ProjectGraphHud } from "./ProjectGraphHud";
import { ProjectGraphInspectorSlot } from "./ProjectGraphInspectorSlot";
import { ProjectGraphLensChips } from "./ProjectGraphLensChips";
import { ProjectGraphMatrixSurface } from "./ProjectGraphMatrixSurface";
import { ProjectGraphMinimap } from "./ProjectGraphMinimap";
import { ProjectGraphNavigationOverlays } from "./ProjectGraphNavigationOverlays";
import { ProjectGraphShell } from "./ProjectGraphShell";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { useHudFitPadding } from "./useHudFitPadding";
import { useIde } from "./useIde";
import { useProjectGraphAnalysis } from "./useProjectGraphAnalysis";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
import { useProjectGraphNavigation } from "./useProjectGraphNavigation";
import { useProjectGraphPanelKeys } from "./useProjectGraphPanelKeys";
import { useProjectGraphUserFocus } from "./useProjectGraphUserFocus";
import { useProjectGraphViewState } from "./useProjectGraphViewState";

export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // openFolder() publishes the file index asynchronously, so at cold boot this is false while
  // the graph tab is already open; the analysis must wait, not read the empty snapshot.
  const indexReady = isProjectIndexReady(snap.files, root);
  const { analysis, loading, error, sources, refresh } = useProjectGraphAnalysis(
    c,
    root,
    indexReady,
  );
  const [zenState, dispatchZen] = useReducer(zenReducer, INITIAL_ZEN);
  const zen = zenState.zen;
  const [filter, setFilter] = useState(EMPTY_STATS_FILTER);
  // The addressable view (issue #58): query/selection live in the URL-synced state, which also
  // composes the layout hook. knownNodeIds lets a deep link drop ids this project does not have.
  const knownNodeIds = useMemo(
    () => (analysis === null ? null : new Set(analysis.graph.nodes.map((node) => node.id))),
    [analysis],
  );
  const viewState = useProjectGraphViewState(c, root, knownNodeIds);
  const graph = viewState.graph;
  const { query, selection: selectedNodeId } = viewState.state;
  const isolatedNode = viewState.state.isolatedNode;
  const setIsolatedNode = viewState.setIsolatedNode;
  const setQuery = viewState.setQuery;
  const setSelectedNodeId = viewState.setSelection;
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Measure the floating HUD so fitView parks no node under a cluster; zen hides it (active=false).
  const { padding: fitPadding, remeasure } = useHudFitPadding(containerRef, !zen);

  const view = useMemo(
    () =>
      analysis === null
        ? null
        : buildProjectGraphView({
            graph: analysis.graph,
            positions: layout.nodes,
            hiddenEdgeKinds: effectiveHiddenEdgeKinds(filter, layout.hiddenEdges),
            tableVisibility: layout.tableVisibility,
            collapsed: layout.collapsed,
            query,
            kinds: filter.kinds,
          }),
    [analysis, layout, query, filter],
  );
  // The user's focus-and-context (issue #66): isolation filters the view to one closure, the
  // selection dims everything outside its own. Both are derived, so the URL alone restores them.
  const { displayView, userFocus } = useProjectGraphUserFocus(view, isolatedNode, selectedNodeId);
  // Navigation (issue #68): owns the React Flow instance and the fit nonce the canvas consumes.
  const nav = useProjectGraphNavigation({
    view,
    displayView,
    selection: selectedNodeId,
    setSelection: setSelectedNodeId,
    isolatedNode,
    setIsolatedNode,
    isolatedEdgeKinds: viewState.state.isolatedEdgeKinds,
    setIsolatedEdgeKinds: viewState.setIsolatedEdgeKinds,
    mode: viewState.state.mode,
    setMode: viewState.setMode,
    saveNow: graph.saveNow,
    resetPositions: graph.resetPositions,
    changeViewport: graph.changeViewport,
    remeasure,
    containerRef,
  });

  // Esc/Enter/"m" + the navigation keys (issues #66/#67/#68); typing targets keep their keys.
  useProjectGraphPanelKeys({
    zen,
    exitZen: () => dispatchZen({ type: "exit" }),
    isolatedNode,
    setIsolatedNode,
    selection: selectedNodeId,
    setSelection: setSelectedNodeId,
    aiFocusActive: focus !== null,
    mode: viewState.state.mode,
    setMode: viewState.setMode,
    navigation: nav,
  });

  // A curve is keyed by edge id: drop the ones whose edge disappeared from the analysis. Prune
  // against every analyzed edge, not the filtered view, so hiding an edge kind keeps its curves.
  const pruneCurves = graph.pruneCurves;
  const layoutLoaded = graph.layoutLoaded;
  useEffect(() => {
    if (analysis === null || !layoutLoaded) return;
    pruneCurves(new Set(analysis.graph.edges.map((edge) => edge.id)));
  }, [analysis, layoutLoaded, pruneCurves]);
  // Chip counts come from the analysis, not the filtered view: a hidden kind keeps its count.
  const edgeCounts = useMemo(() => countEdgeKinds(analysis?.graph.edges ?? []), [analysis]);
  const diagnostics = analysis?.diagnostics ?? [];
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;
  const toggleKind = (kind: GraphNodeKind) => setFilter((cur) => toggleKindFilter(cur, kind));

  // The four non-canvas states live in their own component. Notes are content too: a graph with
  // only annotations is not "empty" (D-126).
  let state: ProjectGraphState | null = null;
  if (root === null) state = { kind: "no-project" };
  else if (!indexReady) state = { kind: "loading" };
  else if (error !== null) state = { kind: "error", error };
  // ready gates the canvas until a deep link has restored, so it mounts on the restored viewport.
  else if (view === null || !layoutLoaded || !viewState.ready) state = { kind: "loading" };
  else if (view.nodes.length === 0 && graph.notes.length === 0) state = { kind: "empty" };

  const stats = displayView?.stats ?? null;
  const isolatedNodeLabel =
    isolatedNode === null ? null : (view?.nodes.find((n) => n.id === isolatedNode)?.label ?? null);
  const body =
    state !== null ? (
      <ProjectGraphStateView state={state} onRefresh={refresh} />
    ) : displayView !== null ? (
      viewState.state.mode === "matrix" ? (
        <ProjectGraphMatrixSurface
          view={displayView}
          sort={viewState.state.matrixSort}
          onSortChange={viewState.setMatrixSort}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onExitMatrix={() => viewState.setMode("topology")}
          userFocus={userFocus}
        />
      ) : (
        <ProjectGraphCanvas
          view={displayView}
          fitPadding={fitPadding}
          onInstance={nav.onInstance}
          viewport={layout.viewport ?? null}
          fitNonce={nav.fitNonce}
          edgeCurves={layout.edgeCurves}
          focus={focus}
          userFocus={userFocus}
          isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
          notes={isolatedNode === null ? graph.notes : []}
          addNoteNonce={graph.addNoteNonce}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onMoveNode={graph.moveNode}
          onToggleCollapse={graph.toggleCollapsed}
          onIsolateNode={setIsolatedNode}
          onViewportChange={graph.changeViewport}
          onViewportLive={nav.onViewportLive}
          onEdgeCurveChange={graph.changeEdgeCurve}
          onCreateNote={graph.createNote}
          onMoveNote={graph.moveNote}
          onEditNote={graph.editNote}
          onDeleteNote={graph.deleteNote}
        />
      )
    ) : null;

  return (
    <ProjectGraphShell
      containerRef={containerRef}
      hud={
        zen ? null : (
          <ProjectGraphHud
            stats={stats}
            query={query}
            onQueryChange={setQuery}
            saveState={graph.saveState}
            saveError={graph.saveError}
            onSave={graph.saveNow}
            onRefresh={refresh}
            refreshing={loading}
            zen={zen}
            onToggleZen={() => dispatchZen({ type: "toggle" })}
            focusActive={focus !== null}
            onClearFocus={clearGraphFocus}
            errors={errors}
            warnings={warnings}
            onFit={nav.fit}
            onZoomIn={() => nav.flow?.zoomIn()}
            onZoomOut={() => nav.flow?.zoomOut()}
            filter={filter}
            onToggleKind={toggleKind}
            onToggleEdges={() => setFilter((current) => toggleEdgesFilter(current))}
            lensChips={
              <ProjectGraphLensChips
                disabled={stats === null}
                edgeCounts={edgeCounts}
                hiddenEdgeKinds={layout.hiddenEdges}
                isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
                onIsolatedEdgeKindsChange={viewState.setIsolatedEdgeKinds}
                onHideEdgeKind={graph.toggleEdgeKind}
                activeLenses={viewState.state.activeLenses}
                onActiveLensesChange={viewState.setActiveLenses}
              />
            }
            tableVisibility={layout.tableVisibility}
            onTableVisibilityChange={graph.changeTableVisibility}
            mode={viewState.state.mode}
            onModeChange={viewState.setMode}
            focusBar={
              <ProjectGraphFocusBar
                summary={
                  displayView === null || userFocus === null
                    ? null
                    : closureSummary(displayView, userFocus)
                }
                isolatedLabel={isolatedNodeLabel}
                onIsolate={() => {
                  if (selectedNodeId !== null) setIsolatedNode(selectedNodeId);
                }}
                onExitIsolate={() => setIsolatedNode(null)}
              />
            }
            breadcrumbs={
              <ProjectGraphBreadcrumbs trail={nav.trail} onNavigate={nav.navigateBreadcrumb} />
            }
            minimap={
              viewState.state.mode === "matrix" ? null : (
                <ProjectGraphMinimap
                  nodes={nav.minimapNodes}
                  viewport={nav.liveViewport}
                  containerRef={containerRef}
                  onPan={nav.panTo}
                  onPanEnd={nav.panEnd}
                />
              )
            }
            onOpenPalette={nav.openPalette}
            onOpenSheet={nav.openSheet}
            // With no canvas on screen the HUD must still place the first note at a fixed origin.
            onAddNote={
              state === null ? graph.requestAddNote : () => graph.createNote({ x: 120, y: 120 })
            }
            onResetLayout={nav.resetLayout}
          />
        )
      }
      inspector={
        <ProjectGraphInspectorSlot
          analysis={analysis}
          view={displayView}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          root={root}
          controller={c}
          sources={sources}
        />
      }
    >
      {body}
      <ProjectGraphNavigationOverlays navigation={nav} />
    </ProjectGraphShell>
  );
}
