// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// `loadProjectAnalysis(controller)` and drawn fullscreen-capable in the editor area.
//
// The panel is the view half: analysis, search, fullscreen and the empty/error states live
// here; the saved layout and its actions live in useProjectGraphLayout (which owns the
// debounced writes to `.facilis/graph`). Nothing here touches the analyzer worker, and nothing
// here writes outside the project's `.facilis` directory.

import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { loadProjectAnalysis } from "@/facilis/analyze-client";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import { buildProjectGraphView, sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";
import { errText } from "@/vv/errors";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphFooter } from "./ProjectGraphFooter";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { ProjectGraphToolbar } from "./ProjectGraphToolbar";
import { useIde } from "./useIde";
import { useProjectGraphLayout } from "./useProjectGraphLayout";

export function ProjectGraphPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // openFolder() publishes the file index asynchronously, so at cold boot this is false while
  // the graph tab is already open; the analysis must wait, not read the empty snapshot.
  const indexReady = isProjectIndexReady(snap.files, root);
  const [result, setResult] = useState<ProjectAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graph = useProjectGraphLayout(c, root);
  const layout = graph.layout;

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

  const analysis = result !== null && result.ok ? result.analysis : null;
  const view = useMemo(
    () =>
      analysis === null
        ? null
        : buildProjectGraphView({
            graph: analysis.graph,
            positions: layout.nodes,
            hiddenEdgeKinds: layout.hiddenEdges,
            hideSystemRoutes: layout.hideSystemRoutes,
            hideSystemTables: layout.hideSystemTables,
            collapsed: layout.collapsed,
            query,
          }),
    [analysis, layout, query],
  );
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
    body = <ProjectGraphStateView state={state} onRefresh={() => setNonce((value) => value + 1)} />;
  } else if (view !== null) {
    body = (
      <ProjectGraphCanvas
        view={view}
        viewport={layout.viewport ?? null}
        fitNonce={fitNonce}
        edgeCurves={layout.edgeCurves}
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
        stats={view?.stats ?? null}
        hiddenEdgeKinds={layout.hiddenEdges}
        query={query}
        onQueryChange={setQuery}
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
        onRefresh={() => setNonce((value) => value + 1)}
        refreshing={loading}
        saveState={graph.saveState}
        saveError={graph.saveError}
        errors={errors}
        warnings={warnings}
        onToggleEdgeKind={graph.toggleEdgeKind}
        hideSystemRoutes={layout.hideSystemRoutes}
        hideSystemTables={layout.hideSystemTables}
        onToggleSystemNodes={graph.toggleSystemNodes}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">{body}</div>
        {selectedNode !== null && (
          <ProjectGraphInspector
            node={selectedNode}
            edges={selectedEdges}
            onClose={() => setSelectedNodeId(null)}
            onOpenFile={(file) => openSource(file)}
          />
        )}
      </div>
      <ProjectGraphFooter
        stats={view?.stats ?? null}
        diagnostics={diagnostics}
        layoutInvalid={graph.layoutInvalid}
      />
    </section>
  );
}
