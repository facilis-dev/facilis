// The graph's navigation surface (issue #68, epic #56 rule 6): palette/sheet open state,
// zoom-to-node, the 1/2 presets, the 0 reset, fit, the minimap's live viewport and node bounds,
// and the project → cluster → node breadcrumb trail. Open state is TRANSIENT — like zen, never
// URL state; every change it makes (selection, mode, isolation, drill, viewport) goes through
// the shared addressable view state (#58) or the layout hook's viewport-only setter, so the URL
// encodes the whole view. Navigation NEVER writes a node position: zoom and pan drive the React
// Flow viewport only (rule 2), and zoom-to-node sets the exact selection a canvas click sets.

import { useCallback, useMemo, useState, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphViewport } from "@/facilis/graph-layout-file";
import { isolateEdgeKind } from "@/facilis/graph-lens-state";
import { minimapFrameRect, minimapNodeRect, type MinimapNode } from "@/facilis/graph-minimap";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  GRAPH_PALETTE_COMMANDS,
  buildPaletteIndex,
  type PaletteCommand,
  type PaletteCommandId,
  type PaletteIndex,
} from "@/facilis/graph-palette";
import {
  GRAPH_ZOOM_PRESET_COMPACT,
  GRAPH_ZOOM_PRESET_FULL,
  buildGraphBreadcrumbs,
  presetZoomViewport,
  zoomAnimationDuration,
  zoomToNodeViewport,
  type GraphBreadcrumbItem,
} from "@/facilis/graph-navigation";
import type { GraphViewMode } from "@/facilis/graph-view-state";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import type { ProjectCanvasEdge } from "./ProjectGraphDetailsLinkEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphClusters } from "./useProjectGraphClusters";

export interface ProjectGraphNavigationInput {
  /** The filtered view: palette targets, minimap rects and zoom bounds come from here. */
  readonly view: ProjectGraphView | null;
  readonly selection: string | null;
  readonly setSelection: (id: string | null) => void;
  readonly isolatedNode: string | null;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly setIsolatedEdgeKinds: (kinds: readonly GraphEdgeKind[]) => void;
  readonly mode: GraphViewMode;
  readonly setMode: (mode: GraphViewMode) => void;
  /** The cluster mode state (issue #62): the drill level joins the breadcrumb, never a layout. */
  readonly clusters: ProjectGraphClusters;
  readonly saveNow: () => void;
  readonly resetPositions: () => void;
  readonly changeViewport: (viewport: GraphViewport) => void;
  readonly remeasure: () => void;
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

export interface ProjectGraphNavigation {
  readonly flow: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge> | null;
  readonly onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge>) => void;
  readonly onViewportLive: (viewport: GraphViewport) => void;
  readonly fitNonce: number;
  readonly fit: () => void;
  readonly resetLayout: () => void;
  readonly paletteOpen: boolean;
  readonly sheetOpen: boolean;
  readonly openPalette: () => void;
  readonly closePalette: () => void;
  readonly openSheet: () => void;
  readonly closeSheet: () => void;
  readonly paletteIndex: PaletteIndex;
  readonly commands: readonly PaletteCommand[];
  readonly runCommand: (id: PaletteCommandId) => void;
  readonly zoomToNode: (id: string) => void;
  readonly applyZoomPreset: (preset: 1 | 2) => void;
  readonly resetZoom: () => void;
  readonly liveViewport: GraphViewport | null;
  readonly minimapNodes: readonly MinimapNode[];
  readonly trail: readonly GraphBreadcrumbItem[];
  readonly navigateBreadcrumb: (item: GraphBreadcrumbItem) => void;
  readonly panTo: (viewport: GraphViewport) => void;
  readonly panEnd: (viewport: GraphViewport) => void;
}

const IDLE_CONTAINER = { width: 1024, height: 768 };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useProjectGraphNavigation({
  view,
  selection,
  setSelection,
  isolatedNode,
  setIsolatedNode,
  isolatedEdgeKinds,
  setIsolatedEdgeKinds,
  mode,
  setMode,
  clusters,
  saveNow,
  resetPositions,
  changeViewport,
  remeasure,
  containerRef,
}: ProjectGraphNavigationInput): ProjectGraphNavigation {
  const [flow, setFlow] = useState<ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge> | null>(
    null,
  );
  const [fitNonce, setFitNonce] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [liveViewport, setLiveViewport] = useState<GraphViewport | null>(null);

  const containerSize = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect === undefined || rect.width === 0 ? IDLE_CONTAINER : rect;
  }, [containerRef]);

  const onInstance = useCallback(
    (instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge>) => {
      setFlow(instance);
      setLiveViewport(instance.getViewport());
    },
    [],
  );
  const onViewportLive = useCallback((viewport: GraphViewport) => {
    setLiveViewport(viewport);
  }, []);

  const fit = useCallback(() => {
    remeasure();
    setFitNonce((value) => value + 1);
  }, [remeasure]);
  const resetLayout = useCallback(() => {
    resetPositions();
    fit();
  }, [resetPositions, fit]);

  const zoomToNode = useCallback(
    (id: string) => {
      const node = view?.nodes.find((entry) => entry.id === id);
      if (node === undefined) return;
      // The card's real bounds: the view position plus React Flow's measured size when present.
      const entry = flow?.getNodes().find((item) => item.id === id);
      const target = zoomToNodeViewport(
        minimapNodeRect(node, entry?.measured ?? entry, GRAPH_NODE_SIZES[node.kind]),
        containerSize(),
      );
      if (mode === "matrix" || flow === null) {
        // The canvas is unmounted in matrix mode: commit the target viewport so the remount
        // lands centred on the node (defaultViewport reads the layout viewport).
        changeViewport(target);
      } else {
        void flow.setViewport(target, { duration: zoomAnimationDuration(prefersReducedMotion()) });
      }
      // The exact view-state selection a canvas click sets: the satellite/sheet opens on it.
      setSelection(id);
      // The target must be drawn: navigation leaves matrix mode and any temporary isolation.
      if (mode === "matrix") setMode("topology");
      if (isolatedNode !== null) setIsolatedNode(null);
    },
    [
      view,
      flow,
      containerSize,
      setSelection,
      mode,
      setMode,
      isolatedNode,
      setIsolatedNode,
      changeViewport,
    ],
  );

  const applyZoomPreset = useCallback(
    (preset: 1 | 2) => {
      if (flow === null) return;
      const zoom = preset === 1 ? GRAPH_ZOOM_PRESET_COMPACT : GRAPH_ZOOM_PRESET_FULL;
      const next = presetZoomViewport(flow.getViewport(), containerSize(), zoom);
      void flow.setViewport(next, { duration: zoomAnimationDuration(prefersReducedMotion()) });
    },
    [flow, containerSize],
  );
  const resetZoom = useCallback(() => {
    if (flow === null) return;
    const next = presetZoomViewport(flow.getViewport(), containerSize(), 1);
    void flow.setViewport(next, { duration: zoomAnimationDuration(prefersReducedMotion()) });
  }, [flow, containerSize]);

  // Minimap drag: live pans drive the instance only; the commit is viewport-only (rule 2).
  const panTo = useCallback(
    (viewport: GraphViewport) => {
      void flow?.setViewport(viewport, { duration: 0 });
    },
    [flow],
  );
  const panEnd = useCallback(
    (viewport: GraphViewport) => changeViewport(viewport),
    [changeViewport],
  );

  const runCommand = useCallback(
    (id: PaletteCommandId) => {
      if (id === "fit") fit();
      else if (id === "reset-layout") resetLayout();
      else if (id === "toggle-matrix") setMode(mode === "matrix" ? "topology" : "matrix");
      else if (id === "save-layout") saveNow();
      else {
        const kind = id.slice("isolate-edge:".length) as GraphEdgeKind;
        setIsolatedEdgeKinds(isolateEdgeKind(isolatedEdgeKinds, kind, false));
      }
    },
    [fit, resetLayout, setMode, mode, saveNow, setIsolatedEdgeKinds, isolatedEdgeKinds],
  );

  const paletteIndex = useMemo(() => buildPaletteIndex(view?.nodes ?? []), [view]);
  // liveViewport is a dependency so measured sizes are re-read after a viewport change:
  // React Flow reports measurements asynchronously, and a pan/zoom is the natural refresh.
  const minimapNodes = useMemo<MinimapNode[]>(() => {
    if (view === null) return [];
    const measured = new Map(flow?.getNodes().map((entry) => [entry.id, entry.measured ?? entry]));
    // Cluster frames first: a collapsed cluster's members are not drawn, so the frame is the
    // block that must appear (issue #62); cards paint over the frames behind them.
    return [
      ...view.clusters.map(minimapFrameRect),
      ...view.nodes.map((node) =>
        minimapNodeRect(node, measured.get(node.id), GRAPH_NODE_SIZES[node.kind]),
      ),
    ];
  }, [view, flow, liveViewport]);

  const trail = useMemo(() => {
    const node =
      selection === null ? undefined : view?.nodes.find((entry) => entry.id === selection);
    const drillCluster = clusters.drillCluster;
    return buildGraphBreadcrumbs(
      node === undefined ? null : { id: node.id, label: node.label },
      drillCluster === null ? null : { id: drillCluster.id, label: drillCluster.key },
    );
  }, [view, selection, clusters.drillCluster]);

  const navigateBreadcrumb = useCallback(
    (item: GraphBreadcrumbItem) => {
      if (item.kind === "node" && item.id !== null) {
        zoomToNode(item.id);
        return;
      }
      // The project root returns to the overview: clear the selection and leave the drill (the
      // #62 slot's "up one level"), then fit. The cluster level only drops the selection.
      setSelection(null);
      if (item.kind === "project") clusters.drillUp();
      fit();
    },
    [zoomToNode, setSelection, clusters, fit],
  );

  const openPalette = useCallback(() => {
    setSheetOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSheet = useCallback(() => {
    setPaletteOpen(false);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  return {
    flow,
    onInstance,
    onViewportLive,
    fitNonce,
    fit,
    resetLayout,
    paletteOpen,
    sheetOpen,
    openPalette,
    closePalette,
    openSheet,
    closeSheet,
    paletteIndex,
    commands: GRAPH_PALETTE_COMMANDS,
    runCommand,
    zoomToNode,
    applyZoomPreset,
    resetZoom,
    liveViewport,
    minimapNodes,
    trail,
    navigateBreadcrumb,
    panTo,
    panEnd,
  };
}
