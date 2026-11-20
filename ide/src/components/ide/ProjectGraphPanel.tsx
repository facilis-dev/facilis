// The project-graph tab (AST graph contract §7, D-126): the one project graph, read from
// loadProjectAnalysis(controller) and drawn as a full-bleed canvas with a floating HUD
// (issue #57). This panel is the lifecycle half: analysis, search, sources, detail facts and
// the empty/error states. graph-shell.tsx owns the view state (selection, zen, filters) and
// renders canvas + HUD + inspector; useProjectGraphLayout owns the debounced writes to
// .facilis/graph. Nothing here touches the analyzer worker or writes outside .facilis.

import { useEffect, useMemo, useState } from "react";
import { loadProjectAnalysis, loadProjectSources } from "@/facilis/analyze-client";
import { isProjectIndexReady } from "@/facilis/project-graph-readiness";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import { buildProjectGraphView, sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";
import { buildGraphDetails, type NodeDetails } from "@/facilis/graph-details";
import { openPageInPreview } from "@/facilis/graph-open-preview";
import { errText } from "@/vv/errors";
import { ProjectGraphShell } from "./graph-shell";
import { edgeKindTotals } from "./graph-ribbon-filters";
import type { ProjectGraphState } from "./ProjectGraphStates";
import { useIde } from "./useIde";
import { useProjectGraphFocus } from "./useProjectGraphFocus";
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
  // The sources the analyzer already read for this snapshot, so code previews never re-read
  // files one node at a time (loadProjectSources is cached per controller snapshot).
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  const graph = useProjectGraphLayout(c, root);
  const layout = graph.layout;
  // The AI graph tools announce which nodes/edges to focus here (D-171); it is view state only.
  const focus = useProjectGraphFocus();

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

  const analysis = result !== null && result.ok ? result.analysis : null;
  const view = useMemo(
    () =>
      analysis === null
        ? null
        : buildProjectGraphView({
            graph: analysis.graph,
            positions: layout.nodes,
            hiddenEdgeKinds: layout.hiddenEdges,
            tableVisibility: layout.tableVisibility,
            collapsed: layout.collapsed,
            query,
          }),
    [analysis, layout, query],
  );
  // Per-kind totals over the analyzed edges: a hidden ribbon chip still shows what it holds.
  const edgeTotals = useMemo(() => edgeKindTotals(analysis?.graph.edges ?? []), [analysis]);
  useEffect(() => {
    // Drop the previous project's map first: the keys are project-relative, so a stale
    // src/app.tsx would otherwise render the other project's source while this one loads.
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

  const openSource = (sourceFile: string | null) => {
    const path = sourcePathFor(root, sourceFile);
    if (path !== null) void c.openFile(path);
  };
  const openNode = (node: ProjectGraphNode) => openSource(node.sourceFile);
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

  return (
    <ProjectGraphShell
      state={state}
      view={view}
      query={query}
      onQueryChange={setQuery}
      edgeTotals={edgeTotals}
      graph={graph}
      focus={focus}
      diagnostics={diagnostics}
      errors={errors}
      warnings={warnings}
      sources={sources}
      details={details}
      nodeLabel={nodeLabel}
      onOpenNode={openNode}
      onOpenFileAt={openFileAt}
      onOpenPreview={(path) => openPageInPreview(c, path)}
      onRefresh={() => setNonce((value) => value + 1)}
      refreshing={loading}
    />
  );
}
