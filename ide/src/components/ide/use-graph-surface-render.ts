// The graph surface's resize + dirty-only render loop (#184/#182), extracted from
// ProjectGraphSurface so the component stays under the line limit. Resize keeps the camera; the
// first real size restores the saved viewport (or fits a first-ever open), and wheel zoom persists
// on a short debounce. Every drawn frame republishes the HUD data attributes, including the
// fit/centre content box that reserves the top HUD and the drawer (#144/#182).

import { useEffect, useRef, type RefObject } from "react";
import { startDirtyFrameLoop } from "@/facilis/graph-surface/frame-loop.ts";
import { writeSurfaceHud } from "@/facilis/graph-surface/hud.ts";
import { resolveSurfacePalette } from "@/facilis/graph-surface/palette.ts";
import { zoomCamera, type SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { SurfaceInsets } from "@/facilis/graph-surface/safe-area.ts";
import {
  drawSurface,
  type SurfaceInteraction,
  type SurfaceScene,
} from "@/facilis/graph-surface/scene.ts";
import type { SurfaceSize } from "./use-graph-surface-camera";

export function useGraphSurfaceRender({
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
  getInsets,
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sizeRef: RefObject<SurfaceSize>;
  sceneRef: RefObject<SurfaceScene | null>;
  cameraRef: RefObject<SurfaceCamera>;
  dirtyRef: RefObject<boolean>;
  uiRef: RefObject<SurfaceInteraction>;
  restoreOrFit: () => void;
  scheduleViewportPersist: () => void;
  positionRichCard: () => void;
  /** Read live: the HUD/drawer insets change with the mode and the sheet, not per frame. */
  getInsets: () => SurfaceInsets;
}): void {
  // Latest-ref pattern: the draw closure reads the current insets without re-creating the loop
  // (re-subscribing would reset the one-shot fit and break the no-rezoom promise).
  const getInsetsRef = useRef(getInsets);
  getInsetsRef.current = getInsets;
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
        writeSurfaceHud(
          wrap,
          current,
          cameraRef.current,
          uiRef.current.selectedId,
          sizeRef.current,
          getInsetsRef.current(),
        );
        positionRichCard();
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
  }, [
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
  ]);
}
