// The project-graph tab (AST graph contract §7): the one project graph, read from
// `loadProjectAnalysis(controller)` and drawn fullscreen-capable in the editor area.
//
// The analysis and the saved layout are independent reads: the graph can render with the
// automatic layout while `.facilis/graph.json` is missing or unreadable, and a drag or a
// filter change is debounced into that file through the kernel VFS. Nothing here touches the
// analyzer worker, and nothing here writes outside the project's `.facilis` directory.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Network from "~icons/lucide/network";
import RefreshCw from "~icons/lucide/refresh-cw";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { loadProjectAnalysis } from "@/facilis/analyze-client";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import {
  GRAPH_LAYOUT_SAVE_DELAY_MS,
  emptyGraphLayout,
  loadGraphLayout,
  resetGraphLayoutPositions,
  saveGraphLayout,
  withCollapsed,
  withHiddenEdgeKind,
  withNodePosition,
  withViewport,
  type GraphLayoutFile,
} from "@/facilis/graph-layout";
import { buildProjectGraphView, sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";
import { errText } from "@/vv/errors";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphFooter } from "./ProjectGraphFooter";
import { ProjectGraphToolbar, type ProjectGraphSaveState } from "./ProjectGraphToolbar";
import { useIde } from "./useIde";

const CENTER =
  "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center";

export function ProjectGraphPanel() {
  const { c } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  const [result, setResult] = useState<ProjectAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [layout, setLayout] = useState<GraphLayoutFile>(() => emptyGraphLayout());
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [layoutInvalid, setLayoutInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [saveState, setSaveState] = useState<ProjectGraphSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedLayout = useRef<GraphLayoutFile | null>(null);
  const latestLayout = useRef(layout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latestLayout.current = layout;
  }, [layout]);

  // Analysis: on mount, on refresh, and whenever the active project changes.
  useEffect(() => {
    if (root === null) {
      setResult(null);
      setLoading(false);
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
  }, [c, root, nonce]);
  // The saved layout: read once per project. A corrupt file is a warning, not an error.
  useEffect(() => {
    let cancelled = false;
    savedLayout.current = null;
    setLayoutLoaded(false);
    setLayoutInvalid(false);
    if (root === null) {
      setLayout(emptyGraphLayout());
      return;
    }
    void loadGraphLayout(c, root)
      .then((loaded) => {
        if (cancelled) return;
        setLayout(loaded.layout);
        setLayoutInvalid(loaded.source === "invalid");
        savedLayout.current = loaded.layout;
        setLayoutLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        const empty = emptyGraphLayout();
        setLayout(empty);
        setLayoutInvalid(true);
        savedLayout.current = empty;
        setLayoutLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [c, root]);

  const runSave = useCallback(
    (next: GraphLayoutFile) => {
      if (root === null) return;
      setSaveState("saving");
      setSaveError(null);
      void saveGraphLayout(c, root, next)
        .then(() => {
          savedLayout.current = next;
          setSaveState("saved");
        })
        .catch((error: unknown) => {
          setSaveState("error");
          setSaveError(errText(error));
        });
    },
    [c, root],
  );
  // Debounce: every drag/filter/collapse/viewport change rewrites the file once it settles.
  useEffect(() => {
    if (root === null || !layoutLoaded) return;
    if (savedLayout.current === layout) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      runSave(layout);
    }, GRAPH_LAYOUT_SAVE_DELAY_MS);
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [layout, layoutLoaded, root, runSave]);

  // Leaving the tab must not drop the last drag: flush whatever is pending (fire-and-forget).
  useEffect(
    () => () => {
      if (root === null || savedLayout.current === latestLayout.current) return;
      void saveGraphLayout(c, root, latestLayout.current).catch(() => {
        /* the tab is gone; the next open retries from the automatic layout */
      });
    },
    [c, root],
  );
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
            collapsed: layout.collapsed,
            query,
          }),
    [analysis, layout, query],
  );
  const diagnostics = analysis?.diagnostics ?? [];
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;

  const toggleEdgeKind = (kind: Parameters<typeof withHiddenEdgeKind>[1], hidden: boolean) => {
    setLayout((current) => withHiddenEdgeKind(current, kind, hidden));
  };
  const toggleCollapsed = (id: string) => {
    setLayout((current) => withCollapsed(current, id, current.collapsed[id] !== true));
  };
  const moveNode = (id: string, position: { x: number; y: number }) => {
    setLayout((current) => withNodePosition(current, id, position));
  };
  const changeViewport = (next: { x: number; y: number; zoom: number }) => {
    setLayout((current) => withViewport(current, next));
  };
  const resetLayout = () => {
    setLayout((current) => resetGraphLayoutPositions(current));
    setFitNonce((value) => value + 1);
  };
  const saveNow = () => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    runSave(layout);
  };
  const openNode = (node: ProjectGraphNode) => {
    const path = sourcePathFor(root, node.sourceFile);
    if (path !== null) void c.openFile(path);
  };

  let body: React.ReactNode;
  if (root === null) {
    body = <p className={CENTER}>{t("projectGraph.openProjectFirst")}</p>;
  } else if (loading && result === null) {
    body = (
      <p className={CENTER + " text-xs text-muted-foreground"}>
        <RefreshCw className="size-4 animate-spin" />
        {t("projectGraph.loading")}
      </p>
    );
  } else if (result !== null && !result.ok) {
    body = (
      <div className={CENTER}>
        <p className="text-xs font-medium text-destructive">
          {t("projectGraph.error", { error: result.error })}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setNonce((value) => value + 1)}>
          {t("projectGraph.refresh")}
        </Button>
      </div>
    );
  } else if (view === null || !layoutLoaded) {
    body = (
      <p className={CENTER + " text-xs text-muted-foreground"}>
        <RefreshCw className="size-4 animate-spin" />
        {t("projectGraph.loading")}
      </p>
    );
  } else if (view.nodes.length === 0) {
    body = (
      <div className={CENTER}>
        <Network className="size-5 text-muted-foreground" />
        <p className="text-xs font-medium">{t("projectGraph.empty")}</p>
        <p className="max-w-sm text-[11px] text-muted-foreground">{t("projectGraph.emptyHint")}</p>
      </div>
    );
  } else {
    body = (
      <ProjectGraphCanvas
        view={view}
        viewport={layout.viewport ?? null}
        fitNonce={fitNonce}
        onMoveNode={moveNode}
        onToggleCollapse={toggleCollapsed}
        onOpenNode={openNode}
        onViewportChange={changeViewport}
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
        onSave={saveNow}
        onRefresh={() => setNonce((value) => value + 1)}
        refreshing={loading}
        saveState={saveState}
        saveError={saveError}
        errors={errors}
        warnings={warnings}
        onToggleEdgeKind={toggleEdgeKind}
      />
      <div className="relative min-h-0 flex-1">{body}</div>
      <ProjectGraphFooter
        stats={view?.stats ?? null}
        diagnostics={diagnostics}
        layoutInvalid={layoutInvalid}
      />
    </section>
  );
}
