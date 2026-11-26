// Positions the rich card anchored to its node (D-219, issue #188). The surface calls
// position() from the dirty-only draw loop, so pan/zoom keeps the card glued to the node without
// a React render per frame; opening/closing and resizes re-measure. Placement itself is pure
// (card-position.ts) and never touches the scene, the layout or the camera.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { anchorScreenRect, cardWidth, placeCard } from "@/facilis/graph-surface/card-position.ts";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { SurfaceScene } from "@/facilis/graph-surface/scene.ts";
import type { RichCardLayout } from "./ProjectGraphRichCard";
import type { SurfaceSize } from "./use-graph-surface-camera";

export function useGraphSurfaceCard({
  sceneRef,
  cameraRef,
  sizeRef,
  nodeId,
}: {
  sceneRef: RefObject<SurfaceScene | null>;
  cameraRef: RefObject<SurfaceCamera>;
  sizeRef: RefObject<SurfaceSize>;
  nodeId: string | null;
}): {
  cardRef: RefObject<HTMLDivElement | null>;
  layout: RichCardLayout;
  position: () => void;
} {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef(0);
  const [layout, setLayout] = useState<RichCardLayout>("anchored");

  const position = useCallback(() => {
    const element = cardRef.current;
    const scene = sceneRef.current;
    if (element === null || scene === null || nodeId === null || scene.mode !== "detail") return;
    const rect = scene.layout.positions.get(nodeId);
    if (rect === undefined) return;
    const viewport = { width: sizeRef.current.width, height: sizeRef.current.height };
    if (viewport.width <= 0 || viewport.height <= 0) return;
    const anchor = anchorScreenRect(rect, cameraRef.current);
    const width = cardWidth(viewport);
    if (width > 0) element.style.width = width + "px";
    const placement = placeCard({
      anchor,
      viewport,
      card: { width, height: heightRef.current },
    });
    if (placement.kind === "sheet") {
      element.style.left = "";
      element.style.top = "";
      element.style.width = "";
      setLayout("sheet");
      return;
    }
    element.style.left = placement.left + "px";
    element.style.top = placement.top + "px";
    element.style.width = placement.width + "px";
    setLayout("anchored");
  }, [sceneRef, cameraRef, sizeRef, nodeId]);

  // Measure after mount (the card's height decides its vertical clamp) and keep measuring when
  // its content changes, without reading layout from the animation frame.
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (element === null) {
      heightRef.current = 0;
      return;
    }
    position();
    heightRef.current = element.offsetHeight;
    position();
    const observer = new ResizeObserver(() => {
      heightRef.current = element.offsetHeight;
      position();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [position]);

  return { cardRef, layout, position };
}
