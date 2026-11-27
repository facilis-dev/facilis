// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// `loadProjectAnalysis(controller)` and drawn fullscreen-capable in the editor area.
// The panel is the view half; the saved layout and its writes live in useProjectGraphLayout,
// and nothing here touches the analyzer worker or writes outside `.facilis`.
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { sourcePathFor } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { selectGraphSelection } from "@/facilis/graph-selection";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import { ProjectGraphSurface } from "./ProjectGraphSurface";
import { ProjectGraphDiagnosisCallout } from "./ProjectGraphDiagnosisCallout";
import { ProjectGraphDrawer } from "./ProjectGraphDrawer";
import { ProjectGraphLensBar } from "./ProjectGraphLensBar";
import { ProjectGraphFooter } from "./ProjectGraphFooter";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { ProjectGraphToolbar } from "./ProjectGraphToolbar";
import type { ProjectGraphMode } from "./project-graph-surface-mode";
import { useIde } from "./useIde";
import { usePrerenderToggle } from "./usePrerenderToggle";
import { useProjectGraphAnalysis } from "./useProjectGraphAnalysis";
import { useProjectGraphEscape } from "./useProjectGraphEscape";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
import { useProjectGraphLayout } from "./useProjectGraphLayout";
import { useProjectGraphNotes } from "./use-project-graph-notes";
import { useProjectGraphRichCard } from "./use-project-graph-rich-card";
import { useProjectGraphSearchJump } from "./useProjectGraphSearchJump";
import { useProjectGraphLens } from "./use-project-graph-lens";
import { useProjectGraphSources } from "./use-project-graph-sources";
import { useProjectGraphViewModel } from "./useProjectGraphViewModel";
import { portalWhenFullscreen, useProjectGraphFullscreen } from "./use-project-graph-fullscreen";
export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // The index lands asynchronously after openFolder(): a cold-boot graph must wait for it.
  const indexReady = isProjectIndexReady(snap.files, root);
  const { result, loading, refresh } = useProjectGraphAnalysis(c, root, indexReady);
  const { fullscreen, layerProps, toggleFullscreen, exitFullscreen } = useProjectGraphFullscreen();
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The drawer is independent from selection: X/Esc close it, the next Esc clears the selection.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ProjectGraphMode>({ kind: "overview" });
  const graph = useProjectGraphLayout(c, root);
  const noteState = useProjectGraphNotes(graph);
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  // The prerender toggle writes the declaration, then re-analyzes without a reload (#84).
  const togglePrerender = usePrerenderToggle(c, root, refresh);
  const analysis = result !== null && result.ok ? result.analysis : null;
  const sources = useProjectGraphSources(c, analysis);
  const prerenderFacts = analysis?.prerender ?? [];
  // Incremental view model (#186): rebuilt on dataset/saved-layout changes only; search debounce.
  const { view, query, search, onQueryChange, flushSearch } = useProjectGraphViewModel(
    analysis?.graph ?? null,
    layout,
  );
  const stats = view === null ? null : { ...view.stats, matches: search.matched.size };
  // A curve is keyed by edge id: prune against every analyzed edge, not the filtered view.
  const pruneCurves = graph.pruneCurves;
  const layoutLoaded = graph.layoutLoaded;
  useEffect(() => {
    if (analysis === null || !layoutLoaded) return;
    pruneCurves(new Set(analysis.graph.edges.map((edge) => edge.id)));
  }, [analysis, layoutLoaded, pruneCurves]);
  const diagnostics = analysis?.diagnostics ?? [];
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;
  const resetLayout = () => {
    graph.resetPositions();
    setFitNonce((value) => value + 1);
  };
  // Incident edges: the page inspector lists page links, the view inspector its routes.
  const { node: selectedNode, edges: selectedEdges } = selectGraphSelection(view, selectedNodeId);
  // The inspector's detail facts (flags, columns, policies, FKs, pages) live on the Analysis.
  const details = useMemo<ReadonlyMap<string, NodeDetails>>(
    () => (analysis === null ? new Map() : buildGraphDetails(analysis)),
    [analysis],
  );
  const nodeLabels = useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.id, node.label] as const)),
    [view],
  );
  const nodeLabel = (id: string): string | null => nodeLabels.get(id) ?? null;
  // Analyzer diagnostics are codes + params; the lens summary is pure draw state (#189).
  const {
    lens,
    view: lensView,
    highlight: lensHighlightValue,
    byNode: diagnosticsByNodeMap,
    availabilityOf,
    selectLens,
    closeLens,
  } = useProjectGraphLens(analysis, view, root, c);
  const selectedDiagnostics =
    selectedNodeId === null ? [] : (diagnosticsByNodeMap.get(selectedNodeId) ?? []);
  const openFileAt = (file: string, line: number) => {
    const path = sourcePathFor(root, file);
    if (path !== null) void c.openFileAt(path, line);
  };
  // A detail row may name a relation the graph did not draw: selecting it must not close the drawer.
  const selectNode = (id: string) => {
    if (!nodeLabels.has(id)) return;
    setSelectedNodeId(id);
    setDrawerOpen(true);
  };
  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setDrawerOpen(id !== null);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // The rich card is view state only; it closes when the selection leaves its node.
  const richCard = useProjectGraphRichCard({
    selectedNodeId,
    view,
    details,
    nodeLabel,
    onSelectNode: selectNode,
  });
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setDrawerOpen(false);
  }, []);
  const changeMode = useCallback((next: ProjectGraphMode) => {
    setMode(next);
    if (next.kind === "overview") {
      setSelectedNodeId(null);
      setDrawerOpen(false);
    }
  }, []);
  const backToOverview = useCallback(() => {
    setSelectedNodeId(null);
    setDrawerOpen(false);
    setMode({ kind: "overview" });
  }, []);
  // Search jump: drill to the node's domain, select it and ask the surface to centre it.
  const onJump = useCallback((nodeId: string, domain: string) => {
    setSelectedNodeId(nodeId);
    setDrawerOpen(true);
    setMode({ kind: "detail", domain });
  }, []);
  const { searchResults, jump, jumpToNode, submitSearch } = useProjectGraphSearchJump({
    view,
    groups: layout.groups,
    query,
    search,
    flushSearch,
    onJump,
  });
  useProjectGraphEscape({
    noteEditing: noteState.noteEditing,
    onCancelNoteEdit: noteState.cancelNoteEdit,
    fullscreen,
    onExitFullscreen: exitFullscreen,
    focusActive: focus !== null,
    onClearFocus: clearGraphFocus,
    richCardOpen: richCard.card !== null,
    onCloseRichCard: richCard.close,
    drawerOpen,
    onCloseDrawer: closeDrawer,
    selectedNodeId,
    onClearSelection: clearSelection,
    lensActive: lens !== null,
    onClearLens: closeLens,
    mode,
    onOverview: backToOverview,
  });
  let state: ProjectGraphState | null = null;
  if (root === null) state = { kind: "no-project" };
  // While the index lands there is no result yet: loading outranks a stale error or empty result.
  else if (!indexReady) state = { kind: "loading" };
  else if (result !== null && !result.ok) state = { kind: "error", error: result.error };
  else if (view === null || !layoutLoaded) state = { kind: "loading" };
  else if (view.nodes.length === 0 && noteState.notes.length === 0) state = { kind: "empty" };

  let body: React.ReactNode = null;
  if (state !== null) {
    body = <ProjectGraphStateView state={state} onRefresh={refresh} />;
  } else if (view !== null) {
    body = (
      <ProjectGraphSurface
        view={view}
        search={search}
        fitNonce={fitNonce}
        mode={mode}
        selectedNodeId={selectedNodeId}
        drawerOpen={drawerOpen}
        richCard={richCard.card}
        jump={jump}
        lens={lensHighlightValue}
        savedPositions={layout.nodes}
        viewport={layout.viewport}
        groups={layout.groups}
        noteState={noteState}
        onModeChange={changeMode}
        onSelectNode={handleSelectNode}
        onOpenRichCard={richCard.open}
        onMoveNode={graph.moveNode}
        onViewportChange={graph.changeViewport}
      />
    );
  }
  const section = (
    <section
      {...layerProps}
      data-testid="project-graph-panel"
      aria-label={t("projectGraph.title")}
      className={
        "flex min-h-0 flex-col overflow-hidden bg-editor " +
        (fullscreen ? "fixed inset-0 z-50 h-screen w-screen" : "h-full")
      }
    >
      <ProjectGraphToolbar
        stats={stats}
        hiddenEdgeKinds={layout.hiddenEdges}
        query={query}
        onQueryChange={onQueryChange}
        results={searchResults}
        onJumpToNode={jumpToNode}
        onSubmitSearch={submitSearch}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onFit={() => setFitNonce((value) => value + 1)}
        onResetLayout={resetLayout}
        onAddNote={state === null ? noteState.requestAddNote : noteState.createNoteHere}
        onSave={graph.saveNow}
        onRefresh={refresh}
        refreshing={loading}
        saveState={graph.saveState}
        saveError={graph.saveError}
        errors={errors}
        warnings={warnings}
        focusActive={focus !== null}
        onClearFocus={clearGraphFocus}
        onToggleEdgeKind={graph.toggleEdgeKind}
        tableVisibility={layout.tableVisibility}
        onTableVisibilityChange={graph.changeTableVisibility}
      />
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">
          {body}
          {state === null && view !== null && (
            <ProjectGraphLensBar
              lens={lens}
              view={lensView}
              nodeLabel={nodeLabel}
              onSelectLens={selectLens}
              onClose={closeLens}
              onActivate={jumpToNode}
              drawerOpen={drawerOpen}
              availabilityOf={availabilityOf}
            />
          )}
        </div>
        {state === null && selectedNode !== null && drawerOpen && view !== null && (
          <ProjectGraphDrawer onClose={closeDrawer}>
            <ProjectGraphDiagnosisCallout
              diagnostics={selectedDiagnostics}
              lens={lens}
              view={lensView}
              selectedNodeId={selectedNodeId}
            />
            <ProjectGraphInspector
              node={selectedNode}
              edges={selectedEdges}
              details={details.get(selectedNode.id) ?? null}
              sources={sources}
              nodeLabel={nodeLabel}
              onClose={closeDrawer}
              onExpand={() => richCard.open(selectedNode.id)}
              onOpenFileAt={openFileAt}
              onOpenPreview={(path) => openPageInPreview(c, path)}
              onSelectNode={selectNode}
              view={view}
              diagnostics={analysis?.graphDiagnostics ?? []}
              detailsMap={details}
              onNavigateNode={jumpToNode}
              nodes={view.nodes}
              prerenderFacts={prerenderFacts}
              graphEdges={analysis?.graph.edges ?? []}
              onTogglePrerender={togglePrerender}
              groups={layout.groups}
              onSetGroup={graph.setNodeGroup}
            />
          </ProjectGraphDrawer>
        )}
      </div>
      <ProjectGraphFooter
        stats={stats}
        diagnostics={diagnostics}
        layoutInvalid={graph.layoutInvalid}
      />
    </section>
  );
  return portalWhenFullscreen(fullscreen, section);
}
