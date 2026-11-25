// Deterministic HUD state on the graph surface root (#182): the smoke gate, assistive checks and
// humans all need a DOM-visible answer to "which mode, how many columns, where is the camera and
// the selected node" without reaching into React refs. Written from the draw loop and the scene
// sync, never read by layout: this is observation only.

import type { SurfaceCamera } from "./camera.ts";
import type { SurfaceScene } from "./scene.ts";

/** Columns the layout really produced: the overview grid or the detail swimlanes. */
export function surfaceColumns(scene: SurfaceScene): number {
  if (scene.mode === "overview") {
    return new Set(scene.layout.cards.map((card) => card.rect.x)).size;
  }
  return scene.columns.length;
}

/** World-space node centre projected through the camera to CSS pixels from the surface's top. */
export function selectedScreenY(
  scene: SurfaceScene,
  camera: SurfaceCamera,
  id: string | null,
): number | null {
  if (id === null || scene.mode !== "detail") return null;
  const rect = scene.layout.positions.get(id);
  if (rect === undefined) return null;
  return camera.ty + (rect.y + rect.h / 2) * camera.scale;
}

export interface SurfaceHudRoot {
  readonly dataset: Record<string, string | undefined>;
}

/**
 * Publish mode, column count, camera and the selected node's screen position on the surface root.
 * The mobile gate asserts that swimlanes never reflow into one column: a CSS layout cannot hide
 * that regression from these numbers.
 */
export function writeSurfaceHud(
  root: SurfaceHudRoot | null,
  scene: SurfaceScene,
  camera: SurfaceCamera,
  selectedId: string | null,
): void {
  if (root === null) return;
  const y = selectedScreenY(scene, camera, selectedId);
  root.dataset.graphMode = scene.mode;
  root.dataset.graphDomain = scene.mode === "detail" ? scene.domain : "";
  root.dataset.graphColumns = String(surfaceColumns(scene));
  root.dataset.graphCamera =
    camera.tx.toFixed(2) + "," + camera.ty.toFixed(2) + "," + camera.scale.toFixed(3);
  root.dataset.graphSelectedY = y === null ? "" : y.toFixed(2);
}
