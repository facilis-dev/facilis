// Canvas interactions for the map-and-lens surface (issues #184/#185/#187): click to enter a
// domain or select a node, hover hit-testing, live node drag and double-click to open source.
// Kept out of ProjectGraphSurface so the component stays under the line limit; all callbacks
// update refs and mark the frame dirty, never React state during a gesture.

import { useCallback } from "react";
import type { RefObject } from "react";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { worldPoint, type SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import { setNodeRect } from "@/facilis/graph-surface/positions.ts";
import { hitTestSurface, type SurfaceScene } from "@/facilis/graph-surface/scene.ts";
import type { ProjectGraphMode } from "./project-graph-surface-mode";
import { canvasLocalPoint, useGraphSurfacePointer } from "./use-graph-surface-pointer";

export function useGraphSurfaceInteractions({
  canvasRef,
  cameraRef,
  sceneRef,
  dirtyRef,
  hoverRef,
  onSelectNode,
  onOpenNode,
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
  onOpenNode: (node: ProjectGraphNode) => void;
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

  const handleClick = useCallback(
    (screenX: number, screenY: number) => {
      const current = sceneRef.current;
      if (current === null) return;
      const point = worldPoint(cameraRef.current, screenX, screenY);
      const hit = hitTestSurface(current, point.x, point.y);
      if (hit === null) {
        onSelectNode(null);
        return;
      }
      if (hit.kind === "domain") {
        onSelectNode(null);
        onModeChange({ kind: "detail", domain: hit.name });
        return;
      }
      if (hit.kind === "port") {
        onSelectNode(null);
        onModeChange({ kind: "detail", domain: hit.domain });
        return;
      }
      onSelectNode(hit.id);
    },
    [sceneRef, cameraRef, onSelectNode, onModeChange],
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

  return { pointer, onDoubleClick };
}
