// HUD rectangles → React Flow fitView padding (issue #57). Pure geometry so the rule is
// unit-tested: a fitView must never leave a node under a floating HUD cluster.
//
// React Flow resolves per-side padding in pixels and offsets the fitted viewport so every
// side keeps at least its inset (getViewportForBounds). Corner clusters therefore reserve a
// full horizontal band (top/bottom); only a tall overlay such as the inspector also reserves
// a vertical side band — a wide-but-short toolbar must not squeeze the graph horizontally.

/** A HUD cluster's box in CSS pixels, relative to the canvas container's top-left. */
export interface HudRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Per-side fitView insets in CSS pixels. */
export interface FitPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const EMPTY_FIT_PADDING: FitPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** Breathing room between a fitted node and the HUD edge that reserves its band. */
export const HUD_FIT_GAP = 8;

/** An overlay at least this tall (relative to the canvas) is a side panel, not a corner chip. */
const SIDE_PANEL_HEIGHT_RATIO = 0.25;

/** Keep the fit area sane when clusters cover most of a small canvas. */
const MAX_SIDE_RATIO = 0.45;

export function hudFitPadding(
  rects: readonly HudRect[],
  size: { readonly width: number; readonly height: number },
  gap: number = HUD_FIT_GAP,
): FitPadding {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const centerY = rect.top + rect.height / 2;
    const centerX = rect.left + rect.width / 2;
    if (rect.height >= size.height * SIDE_PANEL_HEIGHT_RATIO) {
      // A tall side overlay (the inspector): reserve its whole vertical band on the near side.
      if (centerX < size.width / 2) left = Math.max(left, rect.left + rect.width + gap);
      else right = Math.max(right, size.width - rect.left + gap);
      continue;
    }
    // A corner cluster: reserve the horizontal band on the side its centre sits in. The band
    // spans the full width/height, so the cluster's corner position cannot hide a node.
    if (centerY < size.height / 2) top = Math.max(top, rect.top + rect.height + gap);
    else bottom = Math.max(bottom, size.height - rect.top + gap);
  }
  const maxV = size.height * MAX_SIDE_RATIO;
  const maxH = size.width * MAX_SIDE_RATIO;
  return {
    top: Math.min(top, maxV),
    bottom: Math.min(bottom, maxV),
    left: Math.min(left, maxH),
    right: Math.min(right, maxH),
  };
}

/** React Flow's PaddingWithUnit is a template-literal type, not a plain string. */
type Px = `${number}px`;

const px = (value: number): Px => `${Math.ceil(value)}px`;

/** React Flow wants px strings for absolute per-side padding (a bare number is a ratio). */
export function flowPadding(padding: FitPadding): {
  top: Px;
  right: Px;
  bottom: Px;
  left: Px;
} {
  return {
    top: px(padding.top),
    right: px(padding.right),
    bottom: px(padding.bottom),
    left: px(padding.left),
  };
}
