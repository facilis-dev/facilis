// The graph shell (issue #57): the tab is one full-bleed canvas with floating HUD clusters.
// The canvas is absolute inset-0 and the shell never scrolls; the HUD and the inspector are
// overlays, so selecting a node cannot resize the canvas or move a card (spatial constancy).
// The shell owns the view state (search, selection, zen, node-kind filters, fit/zoom events)
// and measures the HUD rectangles into fitView padding; the panel owns the analysis lifecycle.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Diagnostic, GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import { clearGraphFocus } from "@/facilis/graph-focus";
import { GRAPH_EDGE_KINDS, type ProjectGraphView } from "@/facilis/graph-types";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { ProjectGraphStateView, type ProjectGraphState } from "./ProjectGraphStates";
import { ProjectGraphHud, type GraphHudZoneRefs } from "./graph-hud";
import {
  EMPTY_FIT_PADDING,
  hudFitPadding,
  type FitPadding,
  type HudRect,
} from "./graph-hud-padding";
import { filterViewByNodeKinds, toggleAllEdgeKinds, toggleKind } from "./graph-ribbon-filters";
import { isTypingTarget, resolveGraphEscape } from "./graph-zen";
import type { GraphZoomRequest } from "./use-project-graph-fit";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";
import type { ProjectGraphLayout } from "./useProjectGraphLayout";

export function ProjectGraphShell({
  state,
  view,
  query,
  onQueryChange,
  edgeTotals,
  graph,
  focus,
  diagnostics,
  errors,
  warnings,
  sources,
  details,
  nodeLabel,
  onOpenNode,
  onOpenFileAt,
  onOpenPreview,
  onRefresh,
  refreshing,
}: {
  state: ProjectGraphState | null;
  view: ProjectGraphView | null;
  query: string;
  onQueryChange: (value: string) => void;
  edgeTotals: Record<GraphEdgeKind, number>;
  graph: ProjectGraphLayout;
  focus: ProjectGraphFocusState | null;
  diagnostics: readonly Diagnostic[];
  errors: number;
  warnings: number;
  sources: ReadonlyMap<string, string>;
  details: ReadonlyMap<string, NodeDetails>;
  nodeLabel: (id: string) => string | null;
  onOpenNode: (node: ProjectGraphNode) => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [zen, setZen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  // View-only filter: node-kind counters toggle it, nothing persists (layout v3 unchanged).
  const [hiddenNodeKinds, setHiddenNodeKinds] = useState<readonly GraphNodeKind[]>([]);
  const [zoomRequest, setZoomRequest] = useState<GraphZoomRequest | null>(null);
  const [padding, setPadding] = useState<FitPadding>(EMPTY_FIT_PADDING);

  const canvasView = useMemo(
    () => (view === null ? null : filterViewByNodeKinds(view, hiddenNodeKinds)),
    [view, hiddenNodeKinds],
  );
  const selectedNode = canvasView?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdges =
    canvasView?.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    ) ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const topLeftRef = useRef<HTMLDivElement>(null);
  const topRightRef = useRef<HTMLDivElement>(null);
  const bottomLeftRef = useRef<HTMLDivElement>(null);
  const bottomRightRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useMemo<GraphHudZoneRefs>(
    () => ({
      topLeft: topLeftRef,
      topRight: topRightRef,
      bottomLeft: bottomLeftRef,
      bottomRight: bottomRightRef,
    }),
    [],
  );

  // Measure every HUD box relative to the canvas container and turn the boxes into per-side
  // fitView insets. Re-measure on resize (ResizeObserver), on zen/selection/state changes,
  // and when React Flow mounts the minimap (MutationObserver); an unchanged result keeps the
  // same state object so panning the canvas does not re-render the shell.
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const base = container.getBoundingClientRect();
    const rects: HudRect[] = [];
    const push = (element: Element | null) => {
      if (element === null) return;
      const box = element.getBoundingClientRect();
      rects.push({
        left: box.left - base.left,
        top: box.top - base.top,
        width: box.width,
        height: box.height,
      });
    };
    push(topLeftRef.current);
    push(topRightRef.current);
    push(bottomLeftRef.current);
    push(bottomRightRef.current);
    push(inspectorRef.current);
    push(container.querySelector(".react-flow__minimap"));
    const next = hudFitPadding(rects, { width: base.width, height: base.height });
    setPadding((current) =>
      current.top === next.top &&
      current.right === next.right &&
      current.bottom === next.bottom &&
      current.left === next.left
        ? current
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    const sizes = new ResizeObserver(measure);
    const children = new MutationObserver(measure);
    if (container !== null) {
      sizes.observe(container);
      children.observe(container, { childList: true, subtree: true });
    }
    for (const ref of [topLeftRef, topRightRef, bottomLeftRef, bottomRightRef, inspectorRef]) {
      if (ref.current !== null) sizes.observe(ref.current);
    }
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, [measure, zen, selectedNodeId, state, view, zoneRefs]);

  // One Escape ladder (graph-zen.ts): zen first, then the inspector, then an AI focus.
  // Typing targets and consumed events keep the key, so the note editor and search are safe.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveGraphEscape({
        zen,
        inspectorOpen: selectedNode !== null,
        focusActive: focus !== null,
        typing: isTypingTarget(event.target),
        defaultPrevented: event.defaultPrevented,
      });
      if (action === "exit-zen") setZen(false);
      else if (action === "close-inspector") setSelectedNodeId(null);
      else if (action === "clear-focus") clearGraphFocus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zen, selectedNode, focus]);

  const layout = graph.layout;
  const toggleAllEdges = () => {
    const next = toggleAllEdgeKinds(layout.hiddenEdges);
    for (const kind of GRAPH_EDGE_KINDS) {
      const now = next.includes(kind);
      if (layout.hiddenEdges.includes(kind) !== now) graph.toggleEdgeKind(kind, now);
    }
  };
  const zoom = (direction: GraphZoomRequest["direction"]) => {
    setZoomRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, direction }));
  };

  return (
    <section
      data-testid="project-graph-panel"
      aria-label={t("projectGraph.title")}
      className="relative h-full min-h-0 overflow-hidden bg-editor"
    >
      <div ref={containerRef} className="absolute inset-0">
        {state !== null ? (
          <ProjectGraphStateView state={state} onRefresh={onRefresh} />
        ) : canvasView !== null ? (
          <ProjectGraphCanvas
            view={canvasView}
            viewport={layout.viewport ?? null}
            fitNonce={fitNonce}
            fitPadding={padding}
            zoomRequest={zoomRequest}
            hudVisible={!zen}
            inspectorOpen={selectedNode !== null}
            edgeCurves={layout.edgeCurves}
            focus={focus}
            notes={graph.notes}
            addNoteNonce={graph.addNoteNonce}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onMoveNode={graph.moveNode}
            onToggleCollapse={graph.toggleCollapsed}
            onOpenNode={onOpenNode}
            onViewportChange={graph.changeViewport}
            onEdgeCurveChange={graph.changeEdgeCurve}
            onCreateNote={graph.createNote}
            onMoveNote={graph.moveNote}
            onEditNote={graph.editNote}
            onDeleteNote={graph.deleteNote}
          />
        ) : null}
      </div>
      {!zen && (
        <ProjectGraphHud
          canvasReady={canvasView !== null}
          query={query}
          onQueryChange={onQueryChange}
          onToggleZen={() => setZen(true)}
          onFit={() => setFitNonce((value) => value + 1)}
          onZoomIn={() => zoom("in")}
          onZoomOut={() => zoom("out")}
          onResetLayout={() => {
            graph.resetPositions();
            setFitNonce((value) => value + 1);
          }}
          // With no canvas on screen (the "empty" state) the HUD must still place the first
          // note, so create it directly at a deterministic origin.
          onAddNote={
            state === null ? graph.requestAddNote : () => graph.createNote({ x: 120, y: 120 })
          }
          onSave={graph.saveNow}
          onRefresh={onRefresh}
          refreshing={refreshing}
          saveState={graph.saveState}
          saveError={graph.saveError}
          errors={errors}
          warnings={warnings}
          focusActive={focus !== null}
          onClearFocus={clearGraphFocus}
          tableVisibility={layout.tableVisibility}
          onTableVisibilityChange={graph.changeTableVisibility}
          ribbonProps={{
            stats: view?.stats ?? null,
            edgeTotals,
            hiddenEdgeKinds: layout.hiddenEdges,
            hiddenNodeKinds,
            onToggleEdgeKind: graph.toggleEdgeKind,
            onToggleNodeKind: (kind) => setHiddenNodeKinds((hidden) => toggleKind(hidden, kind)),
            onToggleAllEdges: toggleAllEdges,
            queryActive: query.trim().length > 0,
            layoutInvalid: graph.layoutInvalid,
            diagnostics,
          }}
          zoneRefs={zoneRefs}
        />
      )}
      {/* The inspector is an overlay until the satellite replaces it: fixed width, internal
          scroll, clear of the top-right HUD and the bottom-right zoom cluster. */}
      {!zen && selectedNode !== null && (
        <div ref={inspectorRef} className="absolute bottom-12 right-2 top-12 z-10">
          <ProjectGraphInspector
            node={selectedNode}
            edges={selectedEdges}
            details={details.get(selectedNode.id) ?? null}
            sources={sources}
            nodeLabel={nodeLabel}
            onClose={() => setSelectedNodeId(null)}
            onOpenFileAt={onOpenFileAt}
            onOpenPreview={onOpenPreview}
            // A detail list may name a relation the graph did not draw (hidden visibility,
            // unresolved names): only select ids that have a card, never close for no reason.
            onSelectNode={(id) => {
              if (canvasView?.nodes.some((node) => node.id === id)) setSelectedNodeId(id);
            }}
          />
        </div>
      )}
    </section>
  );
}
