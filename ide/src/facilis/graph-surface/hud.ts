// Deterministic HUD state on the graph surface root (#182/#144): the smoke gate, assistive
// checks and humans all need a DOM-visible answer to "which mode, how many columns, where is the
// camera, where is the content box and the selected node". Written from the draw loop, never read
// by layout: this is observation only, except that the content box comes from the same
// safe-area.ts insets the camera fits with, so a HUD overlap is measurable.

import type { SurfaceCamera } from "./camera.ts";
import { contentBox, type SurfaceInsets } from "./safe-area.ts";
import type { SurfaceScene } from "./scene.ts";
import type { SurfaceRect } from "./layout.ts";

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

/** The scene bounds projected to screen space: every drawn card lies inside it. */
export function boundsScreenRect(scene: SurfaceScene, camera: SurfaceCamera): SurfaceRect {
  const bounds = scene.layout.bounds;
  return {
    x: bounds.x * camera.scale + camera.tx,
    y: bounds.y * camera.scale + camera.ty,
    w: bounds.w * camera.scale,
    h: bounds.h * camera.scale,
  };
}

/** The selected node's visible (screen-space) rect; null when nothing is selected. */
export function selectedScreenRect(
  scene: SurfaceScene,
  camera: SurfaceCamera,
  id: string | null,
): SurfaceRect | null {
  if (id === null || scene.mode !== "detail") return null;
  const rect = scene.layout.positions.get(id);
  if (rect === undefined) return null;
  return {
    x: rect.x * camera.scale + camera.tx,
    y: rect.y * camera.scale + camera.ty,
    w: rect.w * camera.scale,
    h: rect.h * camera.scale,
  };
}

export interface SurfaceHudRoot {
  readonly dataset: Record<string, string | undefined>;
}

export interface SurfaceHudView {
  readonly width: number;
  readonly height: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const rectValue = (rect: SurfaceRect | null): string =>
  rect === null ? "" : [rect.x, rect.y, rect.w, rect.h].map(round).join(",");

/**
 * Publish mode, column count, camera, the free content box, the top HUD inset and the selected
 * node's screen rect on the surface root. The smoke asserts the content box starts below the DOM
 * HUD rect and the selected rect never intersects it (#144/#182).
 */
export function writeSurfaceHud(
  root: SurfaceHudRoot | null,
  scene: SurfaceScene,
  camera: SurfaceCamera,
  selectedId: string | null,
  view: SurfaceHudView,
  insets: SurfaceInsets,
): void {
  if (root === null) return;
  const y = selectedScreenY(scene, camera, selectedId);
  root.dataset.graphMode = scene.mode;
  root.dataset.graphDomain = scene.mode === "detail" ? scene.domain : "";
  root.dataset.graphColumns = String(surfaceColumns(scene));
  root.dataset.graphCamera =
    camera.tx.toFixed(2) + "," + camera.ty.toFixed(2) + "," + camera.scale.toFixed(3);
  root.dataset.graphSelectedY = y === null ? "" : y.toFixed(2);
  root.dataset.graphSelectedRect = rectValue(selectedScreenRect(scene, camera, selectedId));
  root.dataset.graphBounds = rectValue(boundsScreenRect(scene, camera));
  root.dataset.graphContent = rectValue(contentBox(view.width, view.height, insets));
  root.dataset.graphHudTop = String(insets.top);
}
