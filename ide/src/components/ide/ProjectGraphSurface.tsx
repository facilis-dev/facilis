// The Canvas2D map-and-lens graph surface (D-211, issues #184/#185): domain overview grid and
// drill-down swimlane detail. Layout is computed once per dataset/domain and cached on a fingerprint
// that excludes the search query, so pan/zoom/search never re-run layout or move nodes — only the
// camera ref changes and the frame is marked dirty. Search arrives as the panel's debounced match
// set (#186): selection, hover and matches are draw state here, never model rebuilds. Detail nodes
// drag with mouse AND touch, edges follow live, and the dropped position snaps to its lane column
// and sticks (persisted by the panel through the saved layout). The saved viewport is restored on
// open, never silently re-fit (D-127).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import type { GraphPosition, GraphViewport } from "@/facilis/graph-layout";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphSearchResult } from "@/facilis/graph-view-model";
import { deriveDomains, domainIndex } from "@/facilis/graph-surface/domains.ts";
import { startDirtyFrameLoop } from "@/facilis/graph-surface/frame-loop.ts";
import { worldPoint, zoomCamera } from "@/facilis/graph-surface/camera.ts";
import { resolveSurfacePalette } from "@/facilis/graph-surface/palette.ts";
import { surfaceLayoutKey, setNodeRect } from "@/facilis/graph-surface/positions.ts";
import {
  buildDetailScene,
  buildOverviewScene,
  drawSurface,
  hitTestSurface,
  type SurfaceScene,
} from "@/facilis/graph-surface/scene.ts";
import { ProjectGraphSurfaceChrome } from "./ProjectGraphSurfaceChrome";
import { useGraphSurfaceCamera, type SurfaceSize } from "./use-graph-surface-camera";
import { canvasLocalPoint, useGraphSurfacePointer } from "./use-graph-surface-pointer";

type SurfaceMode =
  { readonly kind: "overview" } | { readonly kind: "detail"; readonly domain: string };

export function ProjectGraphSurface({
  view,
  search,
  fitNonce,
  selectedNodeId,
  savedPositions,
  viewport,
  onSelectNode,
  onOpenNode,
  onMoveNode,
  onViewportChange,
}: {
  view: ProjectGraphView;
  search: GraphSearchResult;
  fitNonce: number;
  selectedNodeId: string | null;
  savedPositions: Readonly<Record<string, GraphPosition>>;
  viewport: GraphViewport | undefined;
  onSelectNode: (id: string | null) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
  onMoveNode: (id: string, position: GraphPosition) => void;
  onViewportChange: (viewport: GraphViewport) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<SurfaceSize>({ width: 0, height: 0, dpr: 1 });
  const sceneRef = useRef<SurfaceScene | null>(null);
  const dirtyRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const [mode, setMode] = useState<SurfaceMode>({ kind: "overview" });

  // Layout caching: the fingerprint covers the dataset (nodes, edges, saved positions) but NOT the
  // query or matched flags, so a search keystroke reuses the cached scene instead of re-layouting.
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
  });
  // Selection and the debounced match set are draw state: sync the frame's UI snapshot and mark
  // the surface dirty — no scene, layout or node object is rebuilt here (issue #186).
  useEffect(() => {
    uiRef.current = {
      hoverId: hoverRef.current,
      selectedId: selectedNodeId,
      query: search.query,
      matched: search.matched,
    };
    dirtyRef.current = true;
  }, [selectedNodeId, search]);
  useEffect(() => {
    dirtyRef.current = true;
  }, [scene]);

  const modeKey = mode.kind === "overview" ? "overview" : "detail:" + mode.domain;
  const { cameraRef, restoreOrFit, noteGestureEnd, scheduleViewportPersist } = useGraphSurfaceCamera({
    sceneRef,
    sizeRef,
    dirtyRef,
    modeKey,
    fitNonce,
    viewport,
    onViewportChange,
  });

  // Resize + the dirty-only render loop. Resize keeps the camera; the first real size restores the
  // saved viewport (or fits a first-ever open). Wheel zoom persists on a short debounce.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    let fitted = false;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      dirtyRef.current = true;
      if (!fitted && rect.width > 0) {
        fitted = true;
        restoreOrFit();
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const loop = startDirtyFrameLoop({
      isDirty: () => dirtyRef.current,
      draw: () => {
        dirtyRef.current = false;
        const current = sceneRef.current;
        const ctx = canvas.getContext("2d");
        if (current === null || ctx === null) return;
        drawSurface(
          ctx,
          current,
          cameraRef.current,
          sizeRef.current,
          resolveSurfacePalette(canvas),
          uiRef.current,
        );
      },
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      cameraRef.current = zoomCamera(
        cameraRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        factor,
      );
      dirtyRef.current = true;
      scheduleViewportPersist();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      loop.stop();
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [cameraRef, restoreOrFit, scheduleViewportPersist]);

  const enterDomain = useCallback(
    (domain: string) => {
      onSelectNode(null);
      setMode({ kind: "detail", domain });
    },
    [onSelectNode],
  );

  const handleClick = (screenX: number, screenY: number) => {
    const current = sceneRef.current;
    if (current === null) return;
    const point = worldPoint(cameraRef.current, screenX, screenY);
    const hit = hitTestSurface(current, point.x, point.y);
    if (hit === null) {
      onSelectNode(null);
      return;
    }
    if (hit.kind === "domain") enterDomain(hit.name);
    else if (hit.kind === "port") enterDomain(hit.domain);
    else onSelectNode(hit.id);
  };

  const setHover = useCallback((id: string | null) => {
    if (id === hoverRef.current) return;
    hoverRef.current = id;
    uiRef.current.hoverId = id;
    dirtyRef.current = true;
  }, []);

  // Live drag: mutate the working rect so edges follow this frame; no layout, no React render.
  const handleNodeDragMove = useCallback((id: string, x: number, y: number) => {
    const current = sceneRef.current;
    if (current === null || current.mode !== "detail") return;
    setNodeRect(current.layout.positions, id, x, y);
    dirtyRef.current = true;
  }, []);

  // Release: the hook already snapped the drop to a lane column. Show it at once and commit it to
  // the saved layout (debounced write); the rebuilt scene applies it as an override, so it sticks.
  const handleNodeDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const current = sceneRef.current;
      if (current === null || current.mode !== "detail") return;
      setNodeRect(current.layout.positions, id, x, y);
      dirtyRef.current = true;
      onMoveNode(id, { x, y });
    },
    [onMoveNode],
  );

  const pointer = useGraphSurfacePointer({
    canvasRef,
    cameraRef,
    sceneRef,
    dirtyRef,
    onClick: handleClick,
    onHover: setHover,
    onNodeDragMove: handleNodeDragMove,
    onNodeDragEnd: handleNodeDragEnd,
    onGestureEnd: noteGestureEnd,
  });

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const current = sceneRef.current;
    if (current === null || current.mode !== "detail") return;
    const point = canvasLocalPoint(canvasRef.current, event);
    const world = worldPoint(cameraRef.current, point.x, point.y);
    const hit = hitTestSurface(current, world.x, world.y);
    if (hit === null || hit.kind !== "node") return;
    const node = current.nodeById.get(hit.id);
    if (node !== undefined) onOpenNode(node);
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-editor"
      data-testid="project-graph-surface"
    >
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={t("projectGraph.surface.canvasLabel")}
        className="block cursor-grab touch-none select-none"
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      <ProjectGraphSurfaceChrome
        domain={mode.kind === "detail" ? mode.domain : null}
        onBack={() => {
          onSelectNode(null);
          setMode({ kind: "overview" });
        }}
      />
    </div>
  );
}
