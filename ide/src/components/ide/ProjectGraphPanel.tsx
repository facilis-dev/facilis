// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// `loadProjectAnalysis(controller)` and drawn fullscreen-capable in the editor area.
//
// The panel is the view half: analysis, search jumps, the floating drawer and the empty/error
// states live here; the saved layout and its actions live in useProjectGraphLayout (which owns
// the debounced writes to `.facilis/graph`). Nothing here touches the analyzer worker, and
// nothing here writes outside the project's `.facilis` directory.

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { loadProjectSources } from "@/facilis/analyze-client";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import { sourcePathFor } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import { ProjectGraphSurface } from "./ProjectGraphSurface";
import { ProjectGraphDrawer } from "./ProjectGraphDrawer";
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
import { useProjectGraphRichCard } from "./use-project-graph-rich-card";
import { useProjectGraphSearchJump } from "./useProjectGraphSearchJump";
import { useProjectGraphViewModel } from "./useProjectGraphViewModel";

export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // openFolder() publishes the file index asynchronously, so at cold boot this is false while
  // the graph tab is already open; the analysis must wait, not read the empty snapshot.
  const indexReady = isProjectIndexReady(snap.files, root);
  const { result, loading, refresh } = useProjectGraphAnalysis(c, root, indexReady);
  const [fullscreen, setFullscreen] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The drawer is independent from selection: X/Esc close it while the focus stays, and the
  // next Esc clears the selection (issue #187 progressive Escape).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ProjectGraphMode>({ kind: "overview" });
  // The sources the analyzer already read for this snapshot, so code previews never re-read
  // files one node at a time (loadProjectSources is cached per controller snapshot).
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  const graph = useProjectGraphLayout(c, root);
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  // The prerender toggle writes the declaration, then re-analyzes without a reload (#84).
  const togglePrerender = usePrerenderToggle(c, root, refresh);

  const analysis = result !== null && result.ok ? result.analysis : null;
  const prerenderFacts = analysis?.prerender ?? [];
  // Incremental view model (#186): rebuilt only on dataset/saved-layout changes; the search
  // input is debounced into a match pass, and selection/focus stay canvas draw state.
  const { view, query, search, onQueryChange, flushSearch } = useProjectGraphViewModel(
    analysis?.graph ?? null,
    layout,
  );

  const stats = view === null ? null : { ...view.stats, matches: search.matched.size };
  useEffect(() => {
    // Drop the previous project's map first: the keys are project-relative, so a stale
    // `src/app.tsx` would otherwise render the other project's source while this one loads.
    setSources(new Map());
    if (analysis === null) return;
    let cancelled = false;
    void loadProjectSources(c)
      .then((loaded) => {
        if (!cancelled && loaded.ok) setSources(loaded.files);
      })
      .catch(() => {
        // A transient bridge failure leaves the snippets empty; the next analysis retries.
      });
    return () => {
      cancelled = true;
    };
  }, [c, analysis]);
  // A curve is keyed by edge id: drop the ones whose edge disappeared from the analysis. Prune
  // against every analyzed edge, not the filtered view, so hiding an edge kind keeps its curves.
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
  const selectedNode = view?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  // Incident edges, both directions: the page inspector lists page links and the view inspector
  // reads the routes that use it (incoming route-view edges).
  const selectedEdges =
    view?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];
  // The inspector's detail facts (security flags, db columns, policies, foreign keys, page
  // calls, source lines) live on the Analysis the panel already holds, not on the drawn graph.
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
  // A detail list may name a relation the graph did not draw (hidden table visibility, unresolved
  // names): selecting an id that has no node would close the inspector for no reason.
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
  // Search jump: drill to the node's domain, select it (the drawer opens) and ask the surface to
  // centre the camera. The jump nonce makes a second jump to the same node re-centre too.
  const onJump = useCallback((nodeId: string, domain: string) => {
    setSelectedNodeId(nodeId);
    setDrawerOpen(true);
    setMode({ kind: "detail", domain });
  }, []);
  const { searchResults, jump, jumpToNode, submitSearch } = useProjectGraphSearchJump({
    view,
    query,
    search,
    flushSearch,
    onJump,
  });

  useProjectGraphEscape({
    fullscreen,
    onExitFullscreen: () => setFullscreen(false),
    focusActive: focus !== null,
    onClearFocus: clearGraphFocus,
    richCardOpen: richCard.card !== null,
    onCloseRichCard: richCard.close,
    drawerOpen,
    onCloseDrawer: closeDrawer,
    selectedNodeId,
    onClearSelection: clearSelection,
    mode,
    onOverview: backToOverview,
  });

  // The panel owns the lifecycle; the four non-canvas states live in their own component.
  // Notes are content too: a graph with only annotations is not "empty" (D-126).
  let state: ProjectGraphState | null = null;
  if (root === null) state = { kind: "no-project" };
  // While the index is still landing there is no result for this project yet: loading outranks
  // a stale error/empty from the previous project or the empty-snapshot analysis.
  else if (!indexReady) state = { kind: "loading" };
  else if (result !== null && !result.ok) state = { kind: "error", error: result.error };
  else if (view === null || !layoutLoaded) state = { kind: "loading" };
  else if (view.nodes.length === 0 && graph.notes.length === 0) state = { kind: "empty" };

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
        savedPositions={layout.nodes}
        viewport={layout.viewport}
        onModeChange={changeMode}
        onSelectNode={handleSelectNode}
        onOpenRichCard={richCard.open}
        onMoveNode={graph.moveNode}
        onViewportChange={graph.changeViewport}
      />
    );
  }

  return (
    <section
      data-testid="project-graph-panel"
      aria-label={t("projectGraph.title")}
      className={
        "flex min-h-0 flex-col bg-editor " +
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
        onToggleFullscreen={() => setFullscreen((value) => !value)}
        onFit={() => setFitNonce((value) => value + 1)}
        onResetLayout={resetLayout}
        // With no canvas on screen (the "empty" state) the toolbar must still be able to place
        // the first note, so create it directly at a deterministic origin.
        onAddNote={
          state === null ? graph.requestAddNote : () => graph.createNote({ x: 120, y: 120 })
        }
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
        <div className="relative min-h-0 flex-1">{body}</div>
        {state === null && selectedNode !== null && drawerOpen && (
          <ProjectGraphDrawer onClose={closeDrawer}>
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
              nodes={view?.nodes ?? []}
              prerenderFacts={prerenderFacts}
              graphEdges={analysis?.graph.edges ?? []}
              onTogglePrerender={togglePrerender}
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
}
