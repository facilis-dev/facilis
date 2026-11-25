// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// `loadProjectAnalysis(controller)` and drawn fullscreen-capable in the editor area.
//
// The panel is the view half: analysis, search, fullscreen and the empty/error states live
// here; the saved layout and its actions live in useProjectGraphLayout (which owns the
// debounced writes to `.facilis/graph`). Nothing here touches the analyzer worker, and nothing
// here writes outside the project's `.facilis` directory.

import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { loadProjectAnalysis, loadProjectSources } from "@/facilis/analyze-client";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import { sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import { errText } from "@/vv/errors";
import { ProjectGraphSurface } from "./ProjectGraphSurface";
import { ProjectGraphFooter } from "./ProjectGraphFooter";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { ProjectGraphToolbar } from "./ProjectGraphToolbar";
import { useIde } from "./useIde";
import { usePrerenderToggle } from "./usePrerenderToggle";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
import { useProjectGraphLayout } from "./useProjectGraphLayout";
import { useProjectGraphViewModel } from "./useProjectGraphViewModel";

export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // openFolder() publishes the file index asynchronously, so at cold boot this is false while
  // the graph tab is already open; the analysis must wait, not read the empty snapshot.
  const indexReady = isProjectIndexReady(snap.files, root);
  const [result, setResult] = useState<ProjectAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The sources the analyzer already read for this snapshot, so code previews never re-read
  // files one node at a time (loadProjectSources is cached per controller snapshot).
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  const graph = useProjectGraphLayout(c, root);
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();
  const refresh = () => setNonce((value) => value + 1);
  // The prerender toggle writes the declaration, then re-analyzes without a reload (#84).
  const togglePrerender = usePrerenderToggle(c, root, refresh);

  // Analysis: on mount, on refresh, and whenever the active project changes. The index gate
  // is one-shot: after it opens, a later edit/import does not re-run the analysis per keystroke.
  useEffect(() => {
    if (root === null) {
      setResult(null);
      setLoading(false);
      return;
    }
    if (!indexReady) {
      // Still indexing: analyzing now would report an empty project (missing-config error).
      setResult(null);
      setLoading(true);
      return;
    }
    let cancelled = false;
    setResult(null);
    setLoading(true);
    void loadProjectAnalysis(c)
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({ ok: false, error: errText(error) });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [c, root, nonce, indexReady]);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  // Escape also leaves an AI focus (D-171), but only once the fullscreen listener above had its
  // turn: exiting fullscreen is the bigger mode change, so one key press does one thing. Typing
  // targets keep Escape for themselves (the note editor cancels the edit), so never steal it.
  useEffect(() => {
    if (focus === null || fullscreen) return;
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
  }, [focus, fullscreen]);

  const analysis = result !== null && result.ok ? result.analysis : null;
  const prerenderFacts = analysis?.prerender ?? [];
  // Incremental view model (#186): rebuilt only on dataset/saved-layout changes; the search
  // input is debounced into a match pass, and selection/focus stay canvas draw state.
  const { view, query, search, onQueryChange } = useProjectGraphViewModel(
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
  const openSource = (sourceFile: string | null) => {
    const path = sourcePathFor(root, sourceFile);
    if (path !== null) void c.openFile(path);
  };
  const openNode = (node: ProjectGraphNode) => openSource(node.sourceFile);
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
    if (nodeLabels.has(id)) setSelectedNodeId(id);
  };

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
        selectedNodeId={selectedNodeId}
        savedPositions={layout.nodes}
        viewport={layout.viewport}
        onSelectNode={setSelectedNodeId}
        onOpenNode={openNode}
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
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">{body}</div>
        {selectedNode !== null && (
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
            nodes={view?.nodes ?? []}
            prerenderFacts={prerenderFacts}
            graphEdges={analysis?.graph.edges ?? []}
            onTogglePrerender={togglePrerender}
          />
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
