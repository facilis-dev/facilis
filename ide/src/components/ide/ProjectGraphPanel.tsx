// The project-graph tab (AST graph contract §7, D-126): the one project graph, drawn full-bleed.
// Composition root: filter, zen, focus, the meaning lenses, details, topology/matrix — .facilis.

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
import { ProjectGraphLensProviders } from "./ProjectGraphLensProviders";
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
import { useProjectGraphImpact } from "./useProjectGraphImpact";
import { useProjectGraphOpen } from "./use-project-graph-open";
import { useProjectGraphLenses } from "./useProjectGraphLenses";
import { useProjectGraphSelection } from "./use-project-graph-selection";
import { useProjectGraphUserFocus } from "./useProjectGraphUserFocus";
import { useProjectGraphViewState } from "./useProjectGraphViewState";
export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // openFolder() publishes the index asynchronously: at cold boot the analysis must wait, not read.
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
  // Cluster layout MODE (#62, F.4): auto above 40 nodes, explicit choice wins; collapse/drill in gv.
  const nodeCount = analysis?.graph.nodes.length ?? 0;
  // Matrix mode (#67) pivots routes × tables: clusters are topology-only, so it skips them.
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
  // The meaning lenses (#72, #69, #70, #73): seam lifecycle, card contexts, audit/data facts.
  const { runtime, audit, data, turn } = useProjectGraphLenses(c, analysis, view, viewState);
  // Focus-and-context (#66): dimming closure; the data lens tightens a table selection (#70).
  const { userFocus, focusSummary } = useProjectGraphUserFocus(
    view,
    isolatedNode,
    selectedNodeId,
    data.fkFocus,
  );
  const { selectedNode, selectedEdges, details, nodeLabels, nodeLabel, closeDetails } =
    useProjectGraphSelection(view, selectedNodeId, analysis, setSelectedNodeId);
  // The impact lens (issue #74): a derived overlay, so Esc/exit restores the exact prior view.
  const impact = useProjectGraphImpact(viewState, view, details);
  // Esc ladder + Enter/G/C/E/B (issues #66, #62, #64, #65): one listener owns every graph key.
  useProjectGraphEscape({
    zen,
    impactActive: impact.lensActive,
    isolatedNode,
    selection: selectedNodeId,
    drill: viewState.state.drill,
    aiFocusActive: focus !== null,
    onExitZen: () => dispatchZen({ type: "exit" }),
    onExitImpact: impact.exit,
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
    audit,
    data,
    turn,
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
          contract={audit.contract}
          data={data.data}
          turn={turn.overlay}
          impact={impact.overlay}
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
    <ProjectGraphLensProviders runtime={runtime.context} contract={audit.context} impact={impact}>
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
            errors={audit.errors}
            warnings={audit.warnings}
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
          // F.7 (#67): matrix has no canvas, so the sheet is the details overlay at ALL widths.
          (sheetMode || matrixMode) && selectedNode !== null ? (
            <ProjectGraphDetailsSheet
              node={selectedNode}
              edges={selectedEdges}
              details={details.get(selectedNode.id) ?? null}
              diagnostics={audit.nodeDiagnostics.get(selectedNode.id) ?? []}
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
    </ProjectGraphLensProviders>
  );
}
