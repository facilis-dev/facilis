// The graph's navigation surface (issue #68, epic #56 rule 6): palette/sheet open state,
// zoom-to-node, the 1/2 zoom presets, the 0 reset, fit, the minimap's live viewport and node
// bounds, and the breadcrumb trail. Open state is TRANSIENT — like zen, never URL state; every
// change it makes (selection, mode, isolation, viewport) goes through the shared addressable
// view state (#58) or the layout hook's viewport-only setter, so the URL encodes the whole view.
// Sibling branches integrate through the SAME contracts, not duplicated state: zoom-to-node
// sets the exact selection a node click sets (#59's satellite reacts once PR #118 merges), and
// the presets are plain viewport zooms banded for #60's semantic LOD (graph-navigation.ts).
// Drill/collapsedClusters/groupBy belong to #62 and are NOT touched. Extracted from the panel.

import { useCallback, useMemo, useState, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { GraphViewport } from "@/facilis/graph-layout-file";
import { isolateEdgeKind } from "@/facilis/graph-lens-state";
import { minimapNodeRect, type MinimapNode } from "@/facilis/graph-minimap";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphNode } from "@/facilis/graph-types";
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
import type { ProjectFlowEdge } from "./ProjectGraphEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { GRAPH_NODE_FALLBACK_SIZE } from "./project-graph-kind-tokens";

export interface ProjectGraphNavigationInput {
  /** The filtered full view: palette targets and zoom bounds come from here, not the isolation. */
  readonly view: ProjectGraphView | null;
  /** What is actually drawn (isolation applied): the minimap reflects this. */
  readonly displayView: ProjectGraphView | null;
  readonly selection: string | null;
  readonly setSelection: (id: string | null) => void;
  readonly isolatedNode: string | null;
  readonly setIsolatedNode: (id: string | null) => void;
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly setIsolatedEdgeKinds: (kinds: readonly GraphEdgeKind[]) => void;
  readonly mode: GraphViewMode;
  readonly setMode: (mode: GraphViewMode) => void;
  readonly saveNow: () => void;
  readonly resetPositions: () => void;
  readonly changeViewport: (viewport: GraphViewport) => void;
  readonly remeasure: () => void;
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

export interface ProjectGraphNavigation {
  readonly flow: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge> | null;
  readonly onInstance: (instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge>) => void;
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
  displayView,
  selection,
  setSelection,
  isolatedNode,
  setIsolatedNode,
  isolatedEdgeKinds,
  setIsolatedEdgeKinds,
  mode,
  setMode,
  saveNow,
  resetPositions,
  changeViewport,
  remeasure,
  containerRef,
}: ProjectGraphNavigationInput): ProjectGraphNavigation {
  const [flow, setFlow] = useState<ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge> | null>(
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
    (instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge>) => {
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

  /** The card's real bounds: view position + React Flow's measured size (minimapNodeRect). */
  const nodeBounds = useCallback(
    (node: ProjectGraphNode) => {
      const entry = flow?.getNodes().find((item) => item.id === node.id);
      return minimapNodeRect(node, entry?.measured ?? entry, GRAPH_NODE_FALLBACK_SIZE[node.kind]);
    },
    [flow],
  );

  const zoomToNode = useCallback(
    (id: string) => {
      const node = view?.nodes.find((entry) => entry.id === id);
      if (node === undefined) return;
      const target = zoomToNodeViewport(nodeBounds(node), containerSize());
      if (mode === "matrix" || flow === null) {
        // The canvas is unmounted in matrix mode: commit the target viewport so the remount
        // lands centred on the node (defaultViewport reads the layout viewport).
        changeViewport(target);
      } else {
        void flow.setViewport(target, { duration: zoomAnimationDuration(prefersReducedMotion()) });
      }
      // SIBLING WIRING (#59, PR #118): this sets the EXACT view-state selection a topology
      // node click sets — the floating ProjectGraphInspector opens on it in this base, and
      // the on-canvas details satellite replaces the inspector and reacts to the same
      // selection once it merges. No satellite state is duplicated here.
      setSelection(id);
      // The target must be drawn: navigation leaves matrix mode and any temporary isolation.
      if (mode === "matrix") setMode("topology");
      if (isolatedNode !== null) setIsolatedNode(null);
    },
    [
      view,
      flow,
      nodeBounds,
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

  // Minimap drag: live pans drive the instance only; the commit is viewport-only, so node
  // positions are never recomputed (criterion 3). The canvas's onMoveEnd also commits.
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
    if (displayView === null) return [];
    const measured = new Map(flow?.getNodes().map((entry) => [entry.id, entry.measured ?? entry]));
    return displayView.nodes.map((node) =>
      minimapNodeRect(node, measured.get(node.id), GRAPH_NODE_FALLBACK_SIZE[node.kind]),
    );
  }, [displayView, flow, liveViewport]);

  const trail = useMemo(() => {
    const node =
      selection === null ? undefined : view?.nodes.find((entry) => entry.id === selection);
    return buildGraphBreadcrumbs(node === undefined ? null : { id: node.id, label: node.label });
  }, [view, selection]);

  const navigateBreadcrumb = useCallback(
    (item: GraphBreadcrumbItem) => {
      // The cluster level dispatch arrives with #62's drill contract; the item kind already
      // carries it. In this base: node zooms+selects, the project root returns to overview.
      if (item.kind === "node" && item.id !== null) zoomToNode(item.id);
      else {
        setSelection(null);
        fit();
      }
    },
    [zoomToNode, setSelection, fit],
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
