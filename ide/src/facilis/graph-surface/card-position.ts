// Rich-card placement for the map-and-lens surface (D-211, issue #188): the card is anchored
// to its node in screen space and clamped to the viewport. Placement is a pure function of the
// node's world rect and the camera, so opening a card never touches the scene, the layout or the
// camera — spatial constancy is a property of this module, not a rendering convention.
//
// Narrow viewports do not try to anchor a card beside a node: below the sheet breakpoint the
// card becomes a full-width bottom sheet that fits inside the viewport without horizontal scroll.

import type { SurfaceCamera } from "./camera.ts";
import type { SurfaceRect } from "./layout.ts";

export interface CardViewport {
  readonly width: number;
  readonly height: number;
}

export interface CardSize {
  readonly width: number;
  readonly height: number;
}

/** A world rect projected to screen space; screen units are CSS pixels. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnchoredCardPlacement {
  readonly kind: "anchored";
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface SheetCardPlacement {
  readonly kind: "sheet";
}

export type CardPlacement = AnchoredCardPlacement | SheetCardPlacement;

/** Space kept between the card and the viewport edge, in CSS pixels. */
export const CARD_MARGIN = 8;
/** Space kept between the node card and the rich card. */
export const CARD_GAP = 12;
/** The anchored card never grows wider than this; the sheet fills the viewport instead. */
export const CARD_MAX_WIDTH = 380;
/** Below this viewport width the card becomes a bottom sheet. */
export const CARD_SHEET_BREAKPOINT = 640;

/** Project a world rect through the camera: screen = world * scale + translate. */
export function anchorScreenRect(rect: SurfaceRect, camera: SurfaceCamera): ScreenRect {
  return {
    x: rect.x * camera.scale + camera.tx,
    y: rect.y * camera.scale + camera.ty,
    width: rect.w * camera.scale,
    height: rect.h * camera.scale,
  };
}

/** The width an anchored card may use: the maximum, bounded by the viewport and its margins. */
export function cardWidth(viewport: CardViewport): number {
  return Math.max(0, Math.min(CARD_MAX_WIDTH, viewport.width - CARD_MARGIN * 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Place the card beside its node, preferring the right side and flipping left when the right
 * side would overflow. When neither side fits (a zoomed-in node in the middle of a small
 * viewport) the card centres over the node and the same clamp keeps it on screen. Vertical
 * position is centred on the node and clamped top/bottom; `height` is the measured card height,
 * zero before the first layout pass.
 */
export function placeCard({
  anchor,
  viewport,
  card,
}: {
  anchor: ScreenRect;
  viewport: CardViewport;
  card: CardSize;
}): CardPlacement {
  if (viewport.width < CARD_SHEET_BREAKPOINT) return { kind: "sheet" };
  const width = cardWidth(viewport);
  if (width <= 0 || viewport.height <= CARD_MARGIN * 2) return { kind: "sheet" };
  const maxLeft = viewport.width - CARD_MARGIN - width;
  let left = anchor.x + anchor.width + CARD_GAP;
  if (left > maxLeft) left = anchor.x - width - CARD_GAP;
  if (left < CARD_MARGIN) left = anchor.x + anchor.width / 2 - width / 2;
  left = clamp(left, CARD_MARGIN, maxLeft);
  const height = Math.min(card.height, viewport.height - CARD_MARGIN * 2);
  const maxTop = viewport.height - CARD_MARGIN - Math.max(0, height);
  const top = clamp(anchor.y + anchor.height / 2 - height / 2, CARD_MARGIN, maxTop);
  return { kind: "anchored", left, top, width };
}
