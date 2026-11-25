// Canvas interactions for the map-and-lens surface (issues #184/#185/#187/#188): click to enter
// a domain or select a node, hover hit-testing, live node drag, and a second click on the same
// node (mouse double-click or touch double-tap) to open its on-demand rich card. Kept out of
// ProjectGraphSurface so the component stays under the line limit; all callbacks update refs and
// mark the frame dirty, never React state during a gesture.

import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { worldPoint, type SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import { isDoubleTap, type TapMark } from "@/facilis/graph-surface/card-trigger.ts";
import { setNodeRect } from "@/facilis/graph-surface/positions.ts";
import { hitTestSurface, type SurfaceScene } from "@/facilis/graph-surface/scene.ts";
import type { ProjectGraphMode } from "./project-graph-surface-mode";
import { useGraphSurfacePointer } from "./use-graph-surface-pointer";

export function useGraphSurfaceInteractions({
  canvasRef,
  cameraRef,
  sceneRef,
  dirtyRef,
  hoverRef,
  onSelectNode,
  onOpenRichCard,
  onMoveNode,
  onModeChange,
  onGestureEnd,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraRef: RefObject<SurfaceCamera>;
  sceneRef: RefObject<SurfaceScene | null>;
  dirtyRef: RefObject<boolean>;
  hoverRef: RefObject<string | null>;
  onSelectNode: (id: string | null) => void;
  onOpenRichCard: (id: string) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onModeChange: (mode: ProjectGraphMode) => void;
  onGestureEnd: () => void;
}) {
  const setHover = useCallback(
    (id: string | null) => {
      if (id === hoverRef.current) return;
      hoverRef.current = id;
      dirtyRef.current = true;
    },
    [hoverRef, dirtyRef],
  );

  const lastTapRef = useRef<TapMark | null>(null);

  const handleClick = useCallback(
    (screenX: number, screenY: number) => {
      const current = sceneRef.current;
      if (current === null) return;
      const point = worldPoint(cameraRef.current, screenX, screenY);
      const hit = hitTestSurface(current, point.x, point.y);
      if (hit === null) {
        lastTapRef.current = null;
        onSelectNode(null);
        return;
      }
      if (hit.kind === "domain") {
        lastTapRef.current = null;
        onSelectNode(null);
        onModeChange({ kind: "detail", domain: hit.name });
        return;
      }
      if (hit.kind === "port") {
        lastTapRef.current = null;
        onSelectNode(null);
        onModeChange({ kind: "detail", domain: hit.domain });
        return;
      }
      const now = Date.now();
      const doubleTap = isDoubleTap(lastTapRef.current, hit.id, now);
      lastTapRef.current = doubleTap ? null : { id: hit.id, at: now };
      onSelectNode(hit.id);
      if (doubleTap) onOpenRichCard(hit.id);
    },
    [sceneRef, cameraRef, onSelectNode, onModeChange, onOpenRichCard],
  );

  // Live drag: mutate the working rect so edges follow this frame; no layout, no React render.
  const handleNodeDragMove = useCallback(
    (id: string, x: number, y: number) => {
      const current = sceneRef.current;
      if (current === null || current.mode !== "detail") return;
      setNodeRect(current.layout.positions, id, x, y);
      dirtyRef.current = true;
    },
    [sceneRef, dirtyRef],
  );

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
    [sceneRef, dirtyRef, onMoveNode],
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
    onGestureEnd,
  });

  return { pointer };
}
