// Pointer gestures for the graph surface (issue #184): one-finger/mouse pan, two-finger pinch
// zoom, hover hit-testing, and click detection under a movement slop. The camera is a ref, so
// gestures never trigger React renders or re-layout — they only mark the frame dirty.

import { useRef, type RefObject } from "react";
import { worldPoint, zoomCamera, type SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
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

export function useGraphSurfacePointer({
  canvasRef,
  cameraRef,
  sceneRef,
  dirtyRef,
  onClick,
  onHover,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraRef: RefObject<SurfaceCamera>;
  sceneRef: RefObject<SurfaceScene | null>;
  dirtyRef: RefObject<boolean>;
  onClick: (screenX: number, screenY: number) => void;
  onHover: (id: string | null) => void;
}) {
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef({ startX: 0, startY: 0, tx: 0, ty: 0, moved: false, pinch: 0 });

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasLocalPoint(canvas, event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      gestureRef.current = {
        startX: point.x,
        startY: point.y,
        tx: cameraRef.current.tx,
        ty: cameraRef.current.ty,
        moved: false,
        pinch: 0,
      };
    } else if (pointersRef.current.size === 2) {
      // size === 2 guarantees both entries exist.
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      gestureRef.current.moved = true;
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
      canvas.style.cursor = hit === null ? "grab" : "pointer";
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
    if (wasSingle && !gestureRef.current.moved) {
      const point = canvasLocalPoint(canvas, event);
      onClick(point.x, point.y);
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
      };
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}
