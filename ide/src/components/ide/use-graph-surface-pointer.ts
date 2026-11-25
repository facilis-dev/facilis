// Pointer gestures for the graph surface (issues #184/#185): one-finger/mouse pan, two-finger
// pinch zoom, hover hit-testing, click detection under a movement slop, and — in the detail view
// only — node dragging with live edge follow and snap-to-column on release. Mouse and touch share
// the same unified pointer events. The camera is a ref, so gestures never trigger React renders or
// re-layout; they only mark the frame dirty. A second finger cancels a drag into a pinch.

import { useRef, type RefObject } from "react";
import { worldPoint, zoomCamera, type SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import { dragPosition, endNodeDrag, startNodeDrag, type NodeDrag } from "@/facilis/graph-surface/drag.ts";
import { hitTestSurface, type SurfaceScene } from "@/facilis/graph-surface/scene.ts";

const CLICK_SLOP_PX = 5;

export function canvasLocalPoint(
  canvas: HTMLCanvasElement | null,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  if (canvas === null) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

interface GestureState {
  startX: number;
  startY: number;
  tx: number;
  ty: number;
  moved: boolean;
  pinch: number;
  drag: NodeDrag | null;
}

export function useGraphSurfacePointer({
  canvasRef,
  cameraRef,
  sceneRef,
  dirtyRef,
  onClick,
  onHover,
  onNodeDragMove,
  onNodeDragEnd,
  onGestureEnd,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraRef: RefObject<SurfaceCamera>;
  sceneRef: RefObject<SurfaceScene | null>;
  dirtyRef: RefObject<boolean>;
  onClick: (screenX: number, screenY: number) => void;
  onHover: (id: string | null) => void;
  /** Live drag update (world top-left); the surface mutates the working rect so edges follow. */
  onNodeDragMove: (id: string, x: number, y: number) => void;
  /** Release: the snapped drop position the surface commits to the saved layout. */
  onNodeDragEnd: (id: string, x: number, y: number) => void;
  /** A pan/pinch/drag finished: the surface persists the viewport. */
  onGestureEnd: () => void;
}) {
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<GestureState>({
    startX: 0,
    startY: 0,
    tx: 0,
    ty: 0,
    moved: false,
    pinch: 0,
    drag: null,
  });

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasLocalPoint(canvas, event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      const current = sceneRef.current;
      const world = worldPoint(cameraRef.current, point.x, point.y);
      const drag =
        current !== null && current.mode === "detail"
          ? startNodeDrag(current, world.x, world.y)
          : null;
      gestureRef.current = {
        startX: point.x,
        startY: point.y,
        tx: cameraRef.current.tx,
        ty: cameraRef.current.ty,
        moved: false,
        pinch: 0,
        drag,
      };
      if (drag !== null) {
        onHover(drag.id);
        canvas.style.cursor = "grabbing";
      }
    } else if (pointersRef.current.size === 2) {
      const gesture = gestureRef.current;
      // A second finger turns the gesture into a pinch: put the dragged node back first.
      if (gesture.drag !== null) {
        onNodeDragMove(gesture.drag.id, gesture.drag.origin.x, gesture.drag.origin.y);
        gesture.drag = null;
      }
      // size === 2 guarantees both entries exist.
      const [a, b] = [...pointersRef.current.values()];
      gesture.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      gesture.moved = true;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const point = canvasLocalPoint(canvas, event);
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) {
      // Hover: hit-test for the cursor and the highlight, no camera change.
      const current = sceneRef.current;
      const world = worldPoint(cameraRef.current, point.x, point.y);
      const hit = current === null ? null : hitTestSurface(current, world.x, world.y);
      const id = hit === null ? null : hit.kind === "domain" ? hit.name : hit.id;
      onHover(id);
      const draggable = hit !== null && hit.kind === "node" && current?.mode === "detail";
      canvas.style.cursor = hit === null || draggable ? "grab" : "pointer";
      return;
    }
    pointers.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (pointers.size === 2) {
      // size === 2 guarantees both entries exist.
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (gesture.pinch > 0 && dist > 0) {
        const midX = (a!.x + b!.x) / 2;
        const midY = (a!.y + b!.y) / 2;
        cameraRef.current = zoomCamera(cameraRef.current, midX, midY, dist / gesture.pinch);
        dirtyRef.current = true;
      }
      gesture.pinch = dist;
      return;
    }
    const dx = point.x - gesture.startX;
    const dy = point.y - gesture.startY;
    if (Math.abs(dx) + Math.abs(dy) > CLICK_SLOP_PX) gesture.moved = true;
    if (gesture.drag !== null) {
      // Live node drag: edges follow the working rect; the camera stays put.
      if (gesture.moved) {
        const world = worldPoint(cameraRef.current, point.x, point.y);
        const position = dragPosition(gesture.drag, world.x, world.y);
        onNodeDragMove(gesture.drag.id, position.x, position.y);
      }
      canvas.style.cursor = "grabbing";
      dirtyRef.current = true;
      return;
    }
    if (gesture.moved) {
      cameraRef.current = { ...cameraRef.current, tx: gesture.tx + dx, ty: gesture.ty + dy };
      canvas.style.cursor = "grabbing";
      dirtyRef.current = true;
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const pointers = pointersRef.current;
    const wasSingle = pointers.size === 1;
    pointers.delete(event.pointerId);
    if (canvas !== null) canvas.style.cursor = "grab";
    const gesture = gestureRef.current;
    if (wasSingle) {
      const point = canvasLocalPoint(canvas, event);
      if (gesture.drag !== null) {
        if (gesture.moved) {
          const current = sceneRef.current;
          const world = worldPoint(cameraRef.current, point.x, point.y);
          const drop =
            current !== null && current.mode === "detail"
              ? endNodeDrag(gesture.drag, current, world.x, world.y)
              : dragPosition(gesture.drag, world.x, world.y);
          onNodeDragEnd(gesture.drag.id, drop.x, drop.y);
        } else {
          // Under the slop a grab is a click: select the node, it never moved.
          onClick(point.x, point.y);
        }
        gesture.drag = null;
      } else if (!gesture.moved) {
        onClick(point.x, point.y);
      }
      onGestureEnd();
    }
    if (pointers.size === 1) {
      // size === 1 guarantees the remaining entry exists.
      const [remaining] = [...pointers.values()];
      gestureRef.current = {
        startX: remaining!.x,
        startY: remaining!.y,
        tx: cameraRef.current.tx,
        ty: cameraRef.current.ty,
        moved: true,
        pinch: 0,
        drag: null,
      };
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}
