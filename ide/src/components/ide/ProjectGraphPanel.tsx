// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// loadProjectAnalysis(controller) and drawn full-bleed in the editor area (issue #57).
//
// This file is the composition root: the stats-ribbon filter, zen mode, the AI focus and the
// user's focus-and-context highlighting (issue #66). The analysis lifecycle lives in
// useProjectGraphAnalysis, the URL-synced view (search, selection, mode, lenses, isolation) in
// useProjectGraphViewState — which composes the saved-layout hook — the derived closure in
// useProjectGraphUserFocus, the keyboard in useProjectGraphKeys, and the chrome in
// ProjectGraphShell / ProjectGraphHud / StatsRibbon.
// Nothing here touches the analyzer worker or writes outside the project's .facilis directory.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { buildProjectGraphView, sourcePathFor } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { closureSummary, graphEscapeAction } from "@/facilis/graph-user-focus";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import {
  EMPTY_STATS_FILTER,
  effectiveHiddenEdgeKinds,
  toggleEdgesFilter,
  toggleKindFilter,
} from "@/facilis/graph-stats-filter";
import { countEdgeKinds } from "@/facilis/graph-lens-state";
import { INITIAL_ZEN, zenReducer } from "@/facilis/graph-zen";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphFocusBar } from "./ProjectGraphFocusBar";
import { ProjectGraphHud } from "./ProjectGraphHud";
import { ProjectGraphImpactBar } from "./ProjectGraphImpactBar";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphLensChips } from "./ProjectGraphLensChips";
import { ProjectGraphShell } from "./ProjectGraphShell";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { useHudFitPadding } from "./useHudFitPadding";
import { useIde } from "./useIde";
import { useProjectGraphAnalysis } from "./useProjectGraphAnalysis";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
import { useProjectGraphImpact } from "./useProjectGraphImpact";
import { useProjectGraphKeys } from "./useProjectGraphKeys";
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

  const fit = () => {
    remeasure();
    setFitNonce((value) => value + 1);
  };
  const resetLayout = () => {
    graph.resetPositions();
    fit();
  };
  const selectedNode = displayView?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  // Incident edges, both directions: the page inspector lists page links and the view inspector
  // reads the routes that use it (incoming route-view edges).
  const selectedEdges =
    displayView?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];
  // The inspector's detail facts live on the Analysis the panel already holds, not on the graph.
  const details = useMemo<ReadonlyMap<string, NodeDetails>>(
    () => (analysis === null ? new Map() : buildGraphDetails(analysis)),
    [analysis],
  );
  // The impact lens (issue #74): a derived overlay, so Esc/exit restores the exact prior view.
  const impact = useProjectGraphImpact(viewState, displayView, details);
  // Esc clears one layer at a time (zen → impact → isolate → selection → AI focus); Enter
  // isolates the selection. Typing targets keep their keys — the hook guards them.
  useProjectGraphKeys({
    onEscape: () => {
      const action = graphEscapeAction({
        zen,
        impactActive: impact.lensActive,
        isolatedNode,
        selection: selectedNodeId,
        aiFocusActive: focus !== null,
      });
      if (action === "exit-zen") dispatchZen({ type: "exit" });
      else if (action === "exit-impact") impact.exit();
      else if (action === "exit-isolate") setIsolatedNode(null);
      else if (action === "clear-selection") setSelectedNodeId(null);
      else if (action === "clear-ai-focus") clearGraphFocus();
    },
    onEnter: () => {
      if (selectedNodeId !== null) setIsolatedNode(selectedNodeId);
    },
  });
  const nodeLabels = useMemo(
    () => new Map((displayView?.nodes ?? []).map((node) => [node.id, node.label] as const)),
    [displayView],
  );
  const nodeLabel = (id: string): string | null => nodeLabels.get(id) ?? null;
  const openFileAt = (file: string, line: number) => {
    const path = sourcePathFor(root, file);
    if (path !== null) void c.openFileAt(path, line);
  };
  // A detail list may name a relation the graph did not draw: selecting an id that has no node
  // would close the inspector for no reason.
  const selectNode = (id: string) => {
    if (nodeLabels.has(id)) setSelectedNodeId(id);
  };
  const toggleKind = (kind: GraphNodeKind) =>
    setFilter((current) => toggleKindFilter(current, kind));

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
  const body =
    state !== null ? (
      <ProjectGraphStateView state={state} onRefresh={refresh} />
    ) : displayView !== null ? (
      <ProjectGraphCanvas
        view={displayView}
        fitPadding={fitPadding}
        onInstance={setFlow}
        viewport={layout.viewport ?? null}
        fitNonce={fitNonce}
        edgeCurves={layout.edgeCurves}
        focus={focus}
        userFocus={userFocus}
        isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
        impact={impact.overlay}
        notes={isolatedNode === null ? graph.notes : []}
        addNoteNonce={graph.addNoteNonce}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onMoveNode={graph.moveNode}
        onToggleCollapse={graph.toggleCollapsed}
        onIsolateNode={setIsolatedNode}
        onViewportChange={graph.changeViewport}
        onEdgeCurveChange={graph.changeEdgeCurve}
        onCreateNote={graph.createNote}
        onMoveNote={graph.moveNote}
        onEditNote={graph.editNote}
        onDeleteNote={graph.deleteNote}
      />
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
            onFit={fit}
            onZoomIn={() => flow?.zoomIn()}
            onZoomOut={() => flow?.zoomOut()}
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
            impactBar={<ProjectGraphImpactBar hud={impact.hud} onExit={impact.exit} />}
            focusBar={
              <ProjectGraphFocusBar
                summary={
                  displayView === null || userFocus === null
                    ? null
                    : closureSummary(displayView, userFocus)
                }
                isolatedLabel={isolatedNode === null ? null : nodeLabel(isolatedNode)}
                onIsolate={() => {
                  if (selectedNodeId !== null) setIsolatedNode(selectedNodeId);
                }}
                onExitIsolate={() => setIsolatedNode(null)}
              />
            }
            // With no canvas on screen the HUD must still place the first note at a fixed origin.
            onAddNote={
              state === null ? graph.requestAddNote : () => graph.createNote({ x: 120, y: 120 })
            }
            onResetLayout={resetLayout}
          />
        )
      }
      inspector={
        selectedNode !== null ? (
          <ProjectGraphInspector
            node={selectedNode}
            edges={selectedEdges}
            details={details.get(selectedNode.id) ?? null}
            sources={sources}
            nodeLabel={nodeLabel}
            onClose={() => setSelectedNodeId(null)}
            onOpenFileAt={openFileAt}
            onOpenPreview={(path) => openPageInPreview(c, path)}
            onSelectNode={selectNode}
            impact={impact.satellite}
          />
        ) : null
      }
    >
      {body}
    </ProjectGraphShell>
  );
}
