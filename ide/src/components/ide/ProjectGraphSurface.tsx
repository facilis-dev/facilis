// The Canvas2D map-and-lens graph surface (D-211, issues #184/#185/#187/#191): domain overview grid
// and drill-down swimlane detail. Layout is computed once per dataset/domain and cached on a
// fingerprint that excludes search/selection/focus, so pan/zoom/search/focus never re-run layout
// or move nodes — only the camera ref changes and the frame is marked dirty. Search arrives as
// the panel's debounced match set (#186); selection focus is a cached-adjacency 2-hop BFS (#187).
// Detail nodes drag with mouse AND touch, edges follow live, and the dropped position snaps to its
// lane column and sticks. The saved viewport is restored on open, never silently re-fit (D-127).

import { useCallback, useEffect, useMemo, useRef } from "react";
import { t } from "@/i18n";
import type { GraphPosition, GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphSearchResult } from "@/facilis/graph-view-model";
import { deriveDomains, domainIndex } from "@/facilis/graph-surface/domains.ts";
import type { GraphLensHighlight } from "@/facilis/graph-surface/lenses.ts";
import { focusHops, focusNeighborhood } from "@/facilis/graph-surface/focus.ts";
import { surfaceLayoutKey } from "@/facilis/graph-surface/positions.ts";
import { DRAWER_INSET, drawerInsets } from "@/facilis/graph-surface/safe-area.ts";
import {
  buildDetailScene,
  buildOverviewScene,
  type SurfaceScene,
} from "@/facilis/graph-surface/scene.ts";
import { ProjectGraphNodeList } from "./ProjectGraphNodeList";
import { ProjectGraphSurfaceChrome } from "./ProjectGraphSurfaceChrome";
import type { RichCardRequest } from "./ProjectGraphRichCard";
import { useGraphSurfaceCamera, type SurfaceSize } from "./use-graph-surface-camera";
import { useGraphSurfaceRender } from "./use-graph-surface-render";
import { useGraphSurfaceCard } from "./use-graph-surface-card";
import { useGraphSurfaceInteractions } from "./use-graph-surface-interactions";
import { useNarrowViewport } from "./use-narrow-viewport";
import type { ProjectGraphMode } from "./project-graph-surface-mode";

export interface GraphJumpRequest {
  readonly nodeId: string;
  /** Bumped for every jump, even to the same node, so the camera re-centres. */
  readonly nonce: number;
}

export function ProjectGraphSurface({
  view,
  search,
  fitNonce,
  mode,
  selectedNodeId,
  drawerOpen,
  richCard,
  jump,
  lens,
  savedPositions,
  viewport,
  onModeChange,
  onSelectNode,
  onOpenRichCard,
  onMoveNode,
  onViewportChange,
}: {
  view: ProjectGraphView;
  search: GraphSearchResult;
  fitNonce: number;
  mode: ProjectGraphMode;
  selectedNodeId: string | null;
  drawerOpen: boolean;
  richCard: RichCardRequest | null;
  jump: GraphJumpRequest | null;
  /** The active lens highlight (draw state only; never a layout input). */
  lens: GraphLensHighlight | null;
  savedPositions: Readonly<Record<string, GraphPosition>>;
  viewport: GraphViewport | undefined;
  onModeChange: (mode: ProjectGraphMode) => void;
  onSelectNode: (id: string | null) => void;
  onOpenRichCard: (id: string) => void;
  onMoveNode: (id: string, position: GraphPosition) => void;
  onViewportChange: (viewport: GraphViewport) => void;
}) {
  const sheet = useNarrowViewport();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<SurfaceSize>({ width: 0, height: 0, dpr: 1 });
  const sceneRef = useRef<SurfaceScene | null>(null);
  const dirtyRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const pendingJumpRef = useRef<string | null>(null);
  // Layout caching: the fingerprint covers the dataset (nodes, edges, saved positions) but NOT the
  // query, selection or focus, so those interactions reuse the cached scene instead of re-layouting.
  const layoutKey = useMemo(() => surfaceLayoutKey(view), [view]);
  const domains = useMemo(() => deriveDomains(view.nodes, view.edges), [layoutKey]);
  const domainOf = useMemo(() => domainIndex(domains), [domains]);
  const overviewScene = useMemo(
    () => buildOverviewScene(domains, view.nodes, view.edges),
    [domains, layoutKey],
  );
  const detailScene = useMemo(
    () =>
      mode.kind === "detail"
        ? buildDetailScene(mode.domain, view.nodes, domainOf, view.edges, savedPositions)
        : null,
    [mode, layoutKey, domainOf, savedPositions],
  );
  const scene: SurfaceScene =
    mode.kind === "overview" ? overviewScene : (detailScene ?? overviewScene);
  // Latest-ref pattern: gesture handlers and the camera hook read the current scene synchronously.
  sceneRef.current = scene;
  const uiRef = useRef({
    hoverId: null as string | null,
    selectedId: null as string | null,
    query: "",
    matched: new Set<string>() as ReadonlySet<string>,
    focus: null as ReadonlySet<string> | null,
    lens: null as GraphLensHighlight | null,
  });
  // Selection focus and the debounced match set are draw state: sync the frame's UI snapshot and
  // mark the surface dirty — no scene, layout or node object is rebuilt here (issues #186/#187).
  useEffect(() => {
    const detail = sceneRef.current?.mode === "detail" ? sceneRef.current : null;
    const selected = selectedNodeId === null ? undefined : detail?.nodeById.get(selectedNodeId);
    uiRef.current = {
      hoverId: hoverRef.current,
      selectedId: selectedNodeId,
      query: search.query,
      matched: search.matched,
      focus:
        selected === undefined || detail === null
          ? null
          : focusNeighborhood(detail.neighbors, selected.id, focusHops(selected.kind)),
      lens,
    };
    dirtyRef.current = true;
  }, [selectedNodeId, search, scene, lens]);
  useEffect(() => {
    dirtyRef.current = true;
  }, [scene, richCard]);

  const modeKey = mode.kind === "overview" ? "overview" : "detail:" + mode.domain;
  const { cameraRef, restoreOrFit, centerOn, noteGestureEnd, scheduleViewportPersist } =
    useGraphSurfaceCamera({
      sceneRef,
      sizeRef,
      dirtyRef,
      modeKey,
      fitNonce,
      viewport,
      drawerOpen,
      sheet,
      selectedNodeId,
      onViewportChange,
    });
  // The rich card is placed from the draw loop (pan/zoom) and re-measured on open/resize.
  const {
    cardRef,
    layout: richCardLayout,
    position: positionRichCard,
  } = useGraphSurfaceCard({
    sceneRef,
    cameraRef,
    sizeRef,
    nodeId: richCard?.nodeId ?? null,
  });

  // A search jump asks for a node; the panel already switched mode. Centre it once the detail
  // scene exists, at a readable scale, with the drawer's column reserved.
  useEffect(() => {
    if (jump !== null) pendingJumpRef.current = jump.nodeId;
  }, [jump]);
  useEffect(() => {
    const id = pendingJumpRef.current;
    if (id === null || scene.mode !== "detail") return;
    const rect = scene.layout.positions.get(id);
    if (rect === undefined) return;
    pendingJumpRef.current = null;
    centerOn(rect);
  }, [jump, scene, centerOn]);

  // Resize + the dirty-only render loop. The free content box reserves the top HUD rows and the
  // drawer, so fit/centre never place a card under a control (#144/#182).
  useGraphSurfaceRender({
    wrapRef,
    canvasRef,
    sizeRef,
    sceneRef,
    cameraRef,
    dirtyRef,
    uiRef,
    restoreOrFit,
    scheduleViewportPersist,
    positionRichCard,
    getInsets: () => drawerInsets(sheet, sizeRef.current.height, drawerOpen),
  });

  const goOverview = useCallback(() => {
    onSelectNode(null);
    onModeChange({ kind: "overview" });
  }, [onSelectNode, onModeChange]);

  const { pointer } = useGraphSurfaceInteractions({
    canvasRef,
    cameraRef,
    sceneRef,
    dirtyRef,
    hoverRef,
    onSelectNode,
    onOpenRichCard,
    onMoveNode,
    onModeChange,
    onGestureEnd: noteGestureEnd,
  });

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-40 w-full overflow-hidden bg-editor"
      data-testid="project-graph-canvas"
    >
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={t("projectGraph.surface.canvasLabel")}
        className="block cursor-grab touch-none select-none"
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.onPointerCancel}
      />
      {richCard !== null && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {richCard.render(richCardLayout, cardRef)}
        </div>
      )}
      <ProjectGraphNodeList
        nodes={view.nodes}
        domains={domains}
        detailDomain={mode.kind === "detail" ? mode.domain : null}
        onSelectNode={onSelectNode}
        onOpenDomain={(domain) => onModeChange({ kind: "detail", domain })}
      />
      <ProjectGraphSurfaceChrome
        domain={mode.kind === "detail" ? mode.domain : null}
        reservedRight={drawerOpen && !sheet ? DRAWER_INSET : 0}
        sheet={sheet && drawerOpen}
        onBack={goOverview}
      />
    </div>
  );
}
