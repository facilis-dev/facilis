// Card and spotlight placement for the tour overlay. Pure maths: the caller
// measures the anchor and the card, so the tricky edge cases are unit-testable.
import type { TourPlacement } from "./tour-types";

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface CardPlacement {
  readonly top: number;
  readonly left: number;
  readonly side: TourPlacement;
  readonly arrow: number;
}

export const SPOTLIGHT_PADDING = 6;
export const CARD_GAP = 14;
export const VIEWPORT_MARGIN = 12;

const OPPOSITE: Record<TourPlacement, TourPlacement> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function spotlightRect(target: Rect): Rect {
  return {
    top: target.top - SPOTLIGHT_PADDING,
    left: target.left - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  };
}

function fits(side: TourPlacement, anchor: Rect, card: Size, viewport: Size): boolean {
  switch (side) {
    case "top":
      return anchor.top - CARD_GAP - card.height >= VIEWPORT_MARGIN;
    case "bottom":
      return (
        anchor.top + anchor.height + CARD_GAP + card.height <= viewport.height - VIEWPORT_MARGIN
      );
    case "left":
      return anchor.left - CARD_GAP - card.width >= VIEWPORT_MARGIN;
    case "right":
      return anchor.left + anchor.width + CARD_GAP + card.width <= viewport.width - VIEWPORT_MARGIN;
  }
}

function atSide(
  side: TourPlacement,
  anchor: Rect,
  card: Size,
  viewport: Size,
): { readonly top: number; readonly left: number } {
  const centreX = anchor.left + anchor.width / 2;
  const centreY = anchor.top + anchor.height / 2;
  let top: number;
  let left: number;
  switch (side) {
    case "top":
      top = anchor.top - CARD_GAP - card.height;
      left = centreX - card.width / 2;
      break;
    case "bottom":
      top = anchor.top + anchor.height + CARD_GAP;
      left = centreX - card.width / 2;
      break;
    case "left":
      top = centreY - card.height / 2;
      left = anchor.left - CARD_GAP - card.width;
      break;
    case "right":
      top = centreY - card.height / 2;
      left = anchor.left + anchor.width + CARD_GAP;
      break;
  }
  // Clamp both axes: a card with no fitting side still must not render off-screen.
  return {
    top: clamp(
      top,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - card.height),
    ),
    left: clamp(
      left,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - card.width),
    ),
  };
}

export function placeCard(
  anchor: Rect,
  card: Size,
  viewport: Size,
  preferred: TourPlacement,
): CardPlacement {
  const side = fits(preferred, anchor, card, viewport) ? preferred : OPPOSITE[preferred];
  const { top, left } = atSide(side, anchor, card, viewport);
  const arrow =
    side === "top" || side === "bottom"
      ? clamp(anchor.left + anchor.width / 2 - left, 0, card.width)
      : clamp(anchor.top + anchor.height / 2 - top, 0, card.height);
  return { top, left, side, arrow };
}

export function centerCard(
  card: Size,
  viewport: Size,
): { readonly top: number; readonly left: number } {
  return {
    top: (viewport.height - card.height) / 2,
    left: (viewport.width - card.width) / 2,
  };
}
