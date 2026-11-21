// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// loadProjectAnalysis(controller) and drawn full-bleed in the editor area (issue #57).
//
// This file is the composition root: the stats-ribbon filter, zen mode and the AI focus. The
// analysis lifecycle lives in useProjectGraphAnalysis, the URL-synced view (search, selection,
// mode, lenses) in useProjectGraphViewState — which composes the saved-layout hook — and the
// chrome in ProjectGraphShell / ProjectGraphHud / StatsRibbon.
// Nothing here touches the analyzer worker or writes outside the project's .facilis directory.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { buildProjectGraphView, sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { clearGraphFocus } from "@/facilis/graph-focus";
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
import { ProjectGraphAuditRibbon } from "./ProjectGraphAuditRibbon";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphHud } from "./ProjectGraphHud";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphLensChips } from "./ProjectGraphLensChips";
import { ProjectGraphShell } from "./ProjectGraphShell";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { useHudFitPadding } from "./useHudFitPadding";
import { useIde } from "./useIde";
import { useProjectGraphAnalysis } from "./useProjectGraphAnalysis";
import { useProjectGraphAudit } from "./useProjectGraphAudit";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
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
  const setQuery = viewState.setQuery;
  const setSelectedNodeId = viewState.setSelection;
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Measure the floating HUD so fitView parks no node under a cluster; zen hides it (active=false).
  const { padding: fitPadding, remeasure } = useHudFitPadding(containerRef, !zen);

  // Esc leaves zen first (the bigger mode change); a second Esc then clears an AI focus. Typing
  // targets keep Escape for themselves (the note editor cancels the edit), so never steal it.
  useEffect(() => {
    if (!zen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatchZen({ type: "exit" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zen]);
  useEffect(() => {
    if (focus === null || zen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typing) return;
      clearGraphFocus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus, zen]);

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
  // The contract lens (issue #69): attached diagnostics, audit counters and the canvas inputs.
  const audit = useProjectGraphAudit(
    analysis,
    view,
    viewState.state,
    viewState.setAuditFilters,
    layout.viewport?.zoom ?? 1,
  );

  const fit = () => {
    remeasure();
    setFitNonce((value) => value + 1);
  };
  const resetLayout = () => {
    graph.resetPositions();
    fit();
  };
  const openNode = (node: ProjectGraphNode) => {
    const path = sourcePathFor(root, node.sourceFile);
    if (path !== null) void c.openFile(path);
  };
  const selectedNode = view?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  // Incident edges, both directions: the page inspector lists page links and the view inspector
  // reads the routes that use it (incoming route-view edges).
  const selectedEdges =
    view?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];
  // The inspector's detail facts live on the Analysis the panel already holds, not on the graph.
  const details = useMemo<ReadonlyMap<string, NodeDetails>>(
    () => (analysis === null ? new Map() : buildGraphDetails(analysis)),
    [analysis],
  );
  const nodeLabels = useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.id, node.label] as const)),
    [view],
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

  const stats = view?.stats ?? null;
  const body =
    state !== null ? (
      <ProjectGraphStateView state={state} onRefresh={refresh} />
    ) : view !== null ? (
      <ProjectGraphCanvas
        view={view}
        fitPadding={fitPadding}
        onInstance={setFlow}
        viewport={layout.viewport ?? null}
        fitNonce={fitNonce}
        edgeCurves={layout.edgeCurves}
        focus={focus}
        isolatedEdgeKinds={viewState.state.isolatedEdgeKinds}
        contract={audit.contract}
        notes={graph.notes}
        addNoteNonce={graph.addNoteNonce}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onMoveNode={graph.moveNode}
        onToggleCollapse={graph.toggleCollapsed}
        onOpenNode={openNode}
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
            auditRibbon={
              viewState.state.activeLenses.includes("contract") ? (
                <ProjectGraphAuditRibbon
                  counts={audit.counts}
                  filters={viewState.state.auditFilters}
                  onToggle={audit.onToggle}
                  disabled={stats === null}
                />
              ) : null
            }
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
            diagnostics={audit.nodeDiagnostics.get(selectedNode.id) ?? []}
            sources={sources}
            nodeLabel={nodeLabel}
            onClose={() => setSelectedNodeId(null)}
            onOpenFileAt={openFileAt}
            onOpenPreview={(path) => openPageInPreview(c, path)}
            onSelectNode={selectNode}
          />
        ) : null
      }
    >
      {body}
    </ProjectGraphShell>
  );
}
