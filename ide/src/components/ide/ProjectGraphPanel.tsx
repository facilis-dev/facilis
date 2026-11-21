// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// loadProjectAnalysis(controller) and drawn full-bleed in the editor area (issues #57, #59).
// Composition root: stats filter, zen, AI focus, user focus-and-context (issue #66), the
// runtime lens (issue #72), pinned details, and the topology/matrix mode switch (issue #67).
// Analysis: useProjectGraphAnalysis; URL view: useProjectGraphViewState; closure:
// useProjectGraphUserFocus; keys: useProjectGraphEscape.
// Nothing here touches the analyzer worker or writes outside the project's .facilis directory.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { clusterInputFor } from "@/facilis/graph-clusters";
import {
  INITIAL_PINNED_DETAILS,
  SHEET_BREAKPOINT,
  SHEET_DEFAULT_HEIGHT,
  clampSheetHeight,
  pinnedDetailsReducer,
} from "@/facilis/graph-satellite";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import { EMPTY_STATS_FILTER, effectiveHiddenEdgeKinds } from "@/facilis/graph-stats-filter";
import { countEdgeKinds } from "@/facilis/graph-lens-state";
import { cycleEdgeConcentration } from "@/facilis/graph-view-state";
import { INITIAL_ZEN, zenReducer } from "@/facilis/graph-zen";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphDetailsSheet } from "./ProjectGraphDetailsSheet";
import { ProjectGraphHudSlot } from "./ProjectGraphHudSlot";
import { ProjectGraphMatrixSurface } from "./ProjectGraphMatrixSurface";
import { RuntimeLensContext } from "./ProjectGraphRuntimeMarks";
import { ProjectGraphShell } from "./ProjectGraphShell";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { useContainerSize } from "./use-container-size";
import { useProjectGraphEscape } from "./use-project-graph-escape";
import { useHudFitPadding } from "./useHudFitPadding";
import { useIde } from "./useIde";
import { useProjectGraphAnalysis } from "./useProjectGraphAnalysis";
import { useProjectGraphClusters } from "./useProjectGraphClusters";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
import { useProjectGraphHudSlots } from "./useProjectGraphHudSlots";
import { useProjectGraphOpen } from "./use-project-graph-open";
import { useProjectGraphRuntimeLens } from "./useProjectGraphRuntimeLens";
import { useProjectGraphSelection } from "./use-project-graph-selection";
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
  const [fitNonce, setFitNonce] = useState(0);
  // The React Flow instance, lifted only so the HUD zoom buttons can drive it (issue #57).
  const [flow, setFlow] = useState<{ zoomIn: () => void; zoomOut: () => void } | null>(null);
  // The addressable view (issue #58): URL-synced query/selection; knownNodeIds drops stale ids.
  const knownNodeIds = useMemo(
    () => (analysis === null ? null : new Set(analysis.graph.nodes.map((node) => node.id))),
    [analysis],
  );
  const viewState = useProjectGraphViewState(c, root, knownNodeIds);
  const graph = viewState.graph;
  const { query, selection: selectedNodeId, isolatedNode } = viewState.state;
  const { openNode, openFileAt } = useProjectGraphOpen(c, root);
  const setSelectedNodeId = viewState.setSelection;
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Measure the floating HUD so fitView parks no node under a cluster; zen hides it (active=false).
  const { padding: fitPadding, remeasure } = useHudFitPadding(containerRef, !zen);
  // Details surface by container width (issue #59): sheet below the breakpoint, satellite above.
  const containerSize = useContainerSize(containerRef);
  const sheetMode = containerSize.width > 0 && containerSize.width < SHEET_BREAKPOINT;
  const [sheetHeight, setSheetHeight] = useState(SHEET_DEFAULT_HEIGHT);
  // Pinned comparison cards are session state; the canvas hook places and drags them.
  const [pinned, dispatchPinned] = useReducer(pinnedDetailsReducer, INITIAL_PINNED_DETAILS);
  const [pinRequest, setPinRequest] = useState<{ nonce: number; nodeId: string } | null>(null);
  useEffect(() => {
    if (knownNodeIds !== null) dispatchPinned({ type: "prune", knownNodeIds });
  }, [knownNodeIds]);

  // The cluster layout MODE (issue #62, F.4): auto follows the analysis node count (on above
  // 40), the user's explicit choice wins; collapse/drill ride the URL, never .facilis/graph/.
  const nodeCount = analysis?.graph.nodes.length ?? 0;
  // Matrix mode (issue #67) pivots routes × tables: clusters are a topology concern, so the
  // matrix view skips them and every route/table stays an addressable row/column. The carried
  // collapse/drill ids survive the visit (useProjectGraphClusters skips its prune in matrix).
  const matrixMode = viewState.state.mode === "matrix";
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
            clusters: matrixMode ? undefined : clusterInputFor(viewState.state, nodeCount),
          }),
    [analysis, layout, query, filter, viewState.state, nodeCount, matrixMode],
  );
  const clusters = useProjectGraphClusters(viewState, view, nodeCount);
  // Focus-and-context (issue #66): derived dimming closure; isolate persists it in the URL (F.5).
  const { userFocus, focusSummary } = useProjectGraphUserFocus(view, isolatedNode, selectedNodeId);
  const { selectedNode, selectedEdges, details, nodeLabels, nodeLabel, closeDetails } =
    useProjectGraphSelection(view, selectedNodeId, analysis, setSelectedNodeId);
  // Esc ladder + Enter/G/C/E/B (issues #66, #62, #64, #65): one listener owns every graph key.
  useProjectGraphEscape({
    zen,
    isolatedNode,
    selection: selectedNodeId,
    drill: viewState.state.drill,
    aiFocusActive: focus !== null,
    onExitZen: () => dispatchZen({ type: "exit" }),
    onClearSelection: closeDetails,
    setIsolatedNode: viewState.setIsolatedNode,
    onDrillUp: clusters.drillUp,
    onToggleGroupBy: clusters.toggleGroupBy,
    onCollapseCluster: clusters.collapseActive,
    onCycleConcentration: () =>
      viewState.setEdgeConcentration(cycleEdgeConcentration(viewState.state.edgeConcentration)),
    onToggleBridges: () => viewState.setBridges(!viewState.state.bridges),
    onToggleMode: () => viewState.setMode(matrixMode ? "topology" : "matrix"),
  });
  // Curves are keyed by edge id: prune against every analyzed edge, not the filtered view.
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

  const fit = () => {
    remeasure();
    setFitNonce((value) => value + 1);
  };
  const resetLayout = () => {
    graph.resetPositions();
    fit();
  };
  // Non-canvas states live in their own component; a notes-only graph is not "empty" (D-126).
  let state: ProjectGraphState | null = null;
  if (root === null) state = { kind: "no-project" };
  else if (!indexReady) state = { kind: "loading" };
  else if (error !== null) state = { kind: "error", error };
  // ready gates the canvas until a deep link has restored, so it mounts on the restored viewport.
  else if (view === null || !layoutLoaded || !viewState.ready) state = { kind: "loading" };
  else if (view.nodes.length === 0 && graph.notes.length === 0) state = { kind: "empty" };

  const stats = view?.stats ?? null;
  // The runtime lens (issue #72): seam lifecycle, card context and the composed HUD slots.
  const runtime = useProjectGraphRuntimeLens(c, view, viewState, layout.viewport?.zoom ?? 1);
  const hudSlots = useProjectGraphHudSlots({
    stats,
    edgeCounts,
    hiddenEdgeKinds: layout.hiddenEdges,
    viewState,
    onHideEdgeKind: graph.toggleEdgeKind,
    focusSummary,
    isolatedNode,
    selectedNodeId,
    runtime,
    clusters,
  });
  const body =
    state !== null ? (
      <ProjectGraphStateView state={state} onRefresh={refresh} />
    ) : view !== null ? (
      matrixMode ? (
        <ProjectGraphMatrixSurface
          view={view}
          sort={viewState.state.matrixSort}
          onSortChange={viewState.setMatrixSort}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onExitMatrix={() => viewState.setMode("topology")}
          userFocus={userFocus}
        />
      ) : (
        <ProjectGraphCanvas
          view={view}
          concentration={viewState.state.edgeConcentration}
          fitPadding={fitPadding}
          onInstance={setFlow}
          viewport={layout.viewport ?? null}
          fitNonce={fitNonce}
          edgeCurves={layout.edgeCurves}
          bridges={viewState.state.bridges}
          focus={focus}
          userFocus={userFocus}
          isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
          drill={clusters.drill}
          notes={graph.notes}
          addNoteNonce={graph.addNoteNonce}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onMoveNode={graph.moveNode}
          onToggleCollapse={graph.toggleCollapsed}
          onToggleClusterCollapse={clusters.toggleCollapse}
          onDrillCluster={clusters.drillInto}
          onOpenNode={openNode}
          onViewportChange={graph.changeViewport}
          onEdgeCurveChange={graph.changeEdgeCurve}
          onCreateNote={graph.createNote}
          onMoveNote={graph.moveNote}
          onEditNote={graph.editNote}
          onDeleteNote={graph.deleteNote}
          details={details}
          sources={sources}
          nodeLabel={nodeLabel}
          sheetMode={sheetMode}
          sheetHeight={clampSheetHeight(sheetHeight, containerSize.height)}
          containerWidth={containerSize.width}
          pinned={pinned}
          dispatchPinned={dispatchPinned}
          pinRequest={pinRequest}
          onOpenFileAt={openFileAt}
          onOpenPreview={(path) => openPageInPreview(c, path)}
        />
      )
    ) : null;

  return (
    <RuntimeLensContext.Provider value={runtime.context}>
      <ProjectGraphShell
        containerRef={containerRef}
        hud={
          <ProjectGraphHudSlot
            zen={zen}
            onToggleZen={() => dispatchZen({ type: "toggle" })}
            viewState={viewState}
            graph={graph}
            slots={hudSlots}
            stats={stats}
            filter={filter}
            onFilterChange={setFilter}
            errors={errors}
            warnings={warnings}
            onRefresh={refresh}
            refreshing={loading}
            focusActive={focus !== null}
            onFit={fit}
            flow={flow}
            onResetLayout={resetLayout}
            canvasActive={state === null}
          />
        }
        sheet={
          // F.7 (issue #67): in matrix mode the sheet is the details overlay at ALL widths —
          // there is no canvas, so there is no satellite; the selection contract is unchanged.
          (sheetMode || matrixMode) && selectedNode !== null ? (
            <ProjectGraphDetailsSheet
              node={selectedNode}
              edges={selectedEdges}
              details={details.get(selectedNode.id) ?? null}
              sources={sources}
              nodeLabel={nodeLabel}
              height={clampSheetHeight(sheetHeight, containerSize.height)}
              pinned={pinned.some((card) => card.nodeId === selectedNode.id)}
              canPin={!matrixMode}
              onHeightChange={setSheetHeight}
              onClose={closeDetails}
              onTogglePin={() =>
                setPinRequest((current) => ({
                  nonce: (current?.nonce ?? 0) + 1,
                  nodeId: selectedNode.id,
                }))
              }
              onOpenFileAt={openFileAt}
              onOpenPreview={(path) => openPageInPreview(c, path)}
              onSelectNode={(id) => {
                // A detail list may name a relation the graph did not draw: ignore unknown ids.
                if (nodeLabels.has(id)) setSelectedNodeId(id);
              }}
            />
          ) : null
        }
      >
        {body}
      </ProjectGraphShell>
    </RuntimeLensContext.Provider>
  );
}
