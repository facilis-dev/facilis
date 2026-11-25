// The Canvas2D map-and-lens graph surface (D-211, issue #184): domain overview grid and
// drill-down swimlane detail, ported from the validated static preview. Layout is computed once
// per dataset/domain (useMemo) and cached; pan/zoom only moves the camera ref and marks the
// frame dirty, so interaction never re-runs layout and idle frames cost nothing. The same
// spatial layout serves desktop and mobile — touch pans and pinches instead of reflowing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import { deriveDomains, domainIndex } from "@/facilis/graph-surface/domains.ts";
import {
  fitCamera,
  worldPoint,
  zoomCamera,
  type SurfaceCamera,
} from "@/facilis/graph-surface/camera.ts";
import { resolveSurfacePalette } from "@/facilis/graph-surface/palette.ts";
import {
  buildDetailScene,
  buildOverviewScene,
  drawSurface,
  hitTestSurface,
  type SurfaceScene,
} from "@/facilis/graph-surface/scene.ts";
import { ProjectGraphSurfaceChrome } from "./ProjectGraphSurfaceChrome";
import { canvasLocalPoint, useGraphSurfacePointer } from "./use-graph-surface-pointer";

/** The inspector is a w-80 (320px) side panel: fit reserves its width so cards never hide under it. */
const INSPECTOR_WIDTH = 320;

type SurfaceMode =
  { readonly kind: "overview" } | { readonly kind: "detail"; readonly domain: string };

export function ProjectGraphSurface({
  view,
  query,
  fitNonce,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
}: {
  view: ProjectGraphView;
  query: string;
  fitNonce: number;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onOpenNode: (node: ProjectGraphNode) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<SurfaceCamera>({ tx: 0, ty: 0, scale: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const sceneRef = useRef<SurfaceScene | null>(null);
  const dirtyRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const [mode, setMode] = useState<SurfaceMode>({ kind: "overview" });

  // Layout caching: these memos depend on the data and the mode only — never on the camera.
  const domains = useMemo(() => deriveDomains(view.nodes, view.edges), [view]);
  const domainOf = useMemo(() => domainIndex(domains), [domains]);
  const overviewScene = useMemo(
    () => buildOverviewScene(domains, view.nodes, view.edges),
    [domains, view],
  );
  const detailScene = useMemo(
    () =>
      mode.kind === "detail"
        ? buildDetailScene(mode.domain, view.nodes, domainOf, view.edges)
        : null,
    [mode, view, domainOf],
  );
  const scene: SurfaceScene =
    mode.kind === "overview" ? overviewScene : (detailScene ?? overviewScene);
  const matched = useMemo(
    () => new Set(view.nodes.filter((node) => node.matched).map((node) => node.id)),
    [view],
  );
  const uiRef = useRef({
    hoverId: null as string | null,
    selectedId: null as string | null,
    query: "",
    matched: new Set<string>(),
  });
  useEffect(() => {
    uiRef.current = {
      hoverId: hoverRef.current,
      selectedId: selectedNodeId,
      query: query.trim().toLowerCase(),
      matched,
    };
    dirtyRef.current = true;
  }, [selectedNodeId, query, matched]);

  const fitNow = useCallback(() => {
    const current = sceneRef.current;
    const size = sizeRef.current;
    if (current === null || size.width === 0 || size.height === 0) return;
    const insetRight = current.mode === "detail" ? INSPECTOR_WIDTH : 0;
    cameraRef.current = fitCamera(current.layout.bounds, size.width, size.height, {
      insetRight,
      maxScale: 1.1,
    });
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    sceneRef.current = scene;
    dirtyRef.current = true;
  }, [scene]);
  // Fit on mode/fit requests only: a data refresh or a keystroke must not snap the camera back.
  const modeKey = mode.kind === "overview" ? "overview" : "detail:" + mode.domain;
  useEffect(() => {
    fitNow();
  }, [modeKey, fitNonce, fitNow]);

  // Resize + the dirty-only render loop. Resize keeps the camera; the first real size fits.
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
        fitNow();
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dirtyRef.current) return;
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
    };
    raf = requestAnimationFrame(frame);
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
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [fitNow]);

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

  const pointer = useGraphSurfacePointer({
    canvasRef,
    cameraRef,
    sceneRef,
    dirtyRef,
    onClick: handleClick,
    onHover: setHover,
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
