// Fit padding for the full-bleed project graph (issue #57). The canvas fills the tab and the
// HUD clusters float over it, so a plain centred fitView would park nodes underneath a cluster.
// React Flow's fitView accepts an asymmetric per-side padding; this pure helper turns MEASURED
// HUD rectangles (relative to the canvas top-left) into the pixel inset each side needs so the
// fitted node bounds clear every cluster. No React, no DOM: the measuring hook feeds it rects.

/** A HUD cluster rectangle in canvas-local pixels (origin = canvas top-left). */
export interface HudRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Per-side fit inset in pixels, ready to hand to fitView as `{ top: "Npx", … }`. */
export interface HudFitPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Breathing room kept between a cluster and the fitted nodes even on an untouched side. */
const DEFAULT_GAP = 16;
/** A cluster may never claim more than this share of a side, so a fit cannot degenerate. */
const MAX_FRACTION = 0.4;

/**
 * Reserve, on each side, the deepest intrusion of any cluster anchored to that side. A cluster
 * is anchored to the half (top/bottom, left/right) its centre falls in; reserving its full extent
 * from that edge is conservative — the fitted bounds are centred inside the padded box, so they
 * clear the cluster on both axes. Sides no cluster touches keep just the gap.
 */
export function computeHudFitPadding(
  canvas: { readonly width: number; readonly height: number },
  zones: readonly HudRect[],
  gap: number = DEFAULT_GAP,
): HudFitPadding {
  const { width, height } = canvas;
  const idle = { top: gap, right: gap, bottom: gap, left: gap };
  if (width <= 0 || height <= 0) return idle;
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  for (const zone of zones) {
    if (zone.width <= 0 || zone.height <= 0) continue;
    const centreX = zone.x + zone.width / 2;
    const centreY = zone.y + zone.height / 2;
    if (centreY < height / 2) top = Math.max(top, zone.y + zone.height);
    else bottom = Math.max(bottom, height - zone.y);
    if (centreX < width / 2) left = Math.max(left, zone.x + zone.width);
    else right = Math.max(right, width - zone.x);
  }
  const inset = (value: number, dimension: number): number =>
    Math.min(Math.max(value, 0) + gap, Math.floor(dimension * MAX_FRACTION));
  return {
    top: inset(top, height),
    bottom: inset(bottom, height),
    left: inset(left, width),
    right: inset(right, width),
  };
}

/** A pixel padding value in the template-literal form React Flow's fitView accepts. */
type Px = `${number}px`;

/**
 * Format the measured insets as the asymmetric per-side padding object fitView expects. Kept
 * framework-free (a structural match for @xyflow's Padding) so the math module stays pure.
 */
export function toFlowPadding(padding: HudFitPadding): {
  top: Px;
  right: Px;
  bottom: Px;
  left: Px;
} {
  return {
    top: `${padding.top}px`,
    right: `${padding.right}px`,
    bottom: `${padding.bottom}px`,
    left: `${padding.left}px`,
  };
}
