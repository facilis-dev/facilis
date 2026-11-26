// The node-drag pipeline for the detail view (D-219, issue #185): grab a node, follow the
// pointer live (edges track the working rect), and on release snap to the nearest swimlane
// column. Pure functions so the gesture math is regression-testable without a DOM; the pointer
// hook wires them to mouse AND touch through unified pointer events. The overview never drags.

import type { GraphPosition } from "../graph-layout-file.ts";
import type { SurfaceRect } from "./layout.ts";
import { hitTestSurface, type DetailScene } from "./scene.ts";
import { snapDropToColumn } from "./positions.ts";

export interface NodeDrag {
  readonly id: string;
  /** Pointer-to-rect-origin offset, so the card does not jump to the cursor on grab. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The rect at grab time: restored if a second finger turns the gesture into a pinch. */
  readonly origin: SurfaceRect;
}

/** Begin a drag only on a detail-view node hit; ports, domains and empty space pan instead. */
export function startNodeDrag(
  scene: DetailScene,
  worldX: number,
  worldY: number,
): NodeDrag | null {
  const hit = hitTestSurface(scene, worldX, worldY);
  if (hit === null || hit.kind !== "node") return null;
  const rect = scene.layout.positions.get(hit.id);
  if (rect === undefined) return null;
  return { id: hit.id, offsetX: worldX - rect.x, offsetY: worldY - rect.y, origin: rect };
}

/** The live top-left for the dragged node at a world pointer position. */
export function dragPosition(drag: NodeDrag, worldX: number, worldY: number): GraphPosition {
  return { x: worldX - drag.offsetX, y: worldY - drag.offsetY };
}

/** The committed drop: snapped to a lane column, y kept. This is what gets persisted. */
export function endNodeDrag(
  drag: NodeDrag,
  scene: DetailScene,
  worldX: number,
  worldY: number,
): GraphPosition {
  const drop = dragPosition(drag, worldX, worldY);
  return snapDropToColumn(scene.columns, drop.x, drop.y);
}
