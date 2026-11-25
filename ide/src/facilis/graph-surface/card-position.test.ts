// Placement and spatial-constancy tests for the rich card (issue #188): the card must be
// anchored to the node, clamped to the viewport, a sheet on narrow surfaces, and it must never
// mutate the world rect/camera it reads (opening a card may not move nodes or the camera).

import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  CARD_MARGIN,
  CARD_MAX_WIDTH,
  CARD_SHEET_BREAKPOINT,
  anchorScreenRect,
  cardWidth,
  placeCard,
} from "./card-position.ts";

const CAMERA = { tx: 100, ty: 50, scale: 2 };
const NODE = { x: 10, y: 20, w: 120, h: 60 };
const VIEWPORT = { width: 1000, height: 700 };

describe("anchorScreenRect", () => {
  it("projects the node through translate and scale", () => {
    expect(anchorScreenRect(NODE, CAMERA)).toEqual({
      x: 120,
      y: 90,
      width: 240,
      height: 120,
    });
  });
});

describe("placeCard", () => {
  it("anchors to the right of the node when there is room", () => {
    const anchor = anchorScreenRect({ x: 10, y: 20, w: 120, h: 60 }, { tx: 0, ty: 0, scale: 1 });
    const placement = placeCard({ anchor, viewport: VIEWPORT, card: { width: 360, height: 300 } });
    expect(placement.kind).toBe("anchored");
    if (placement.kind !== "anchored") throw new Error("expected anchored placement");
    expect(placement.left).toBe(anchor.x + anchor.width + CARD_GAP);
    expect(placement.width).toBe(Math.min(CARD_MAX_WIDTH, VIEWPORT.width - CARD_MARGIN * 2));
  });

  it("flips to the left when the right side would overflow", () => {
    const anchor = { x: 800, y: 100, width: 160, height: 60 };
    const placement = placeCard({ anchor, viewport: VIEWPORT, card: { width: 360, height: 300 } });
    if (placement.kind !== "anchored") throw new Error("expected anchored placement");
    expect(placement.left).toBe(anchor.x - CARD_MAX_WIDTH - CARD_GAP);
  });

  it("clamps the top against both viewport edges", () => {
    const high = placeCard({
      anchor: { x: 100, y: 0, width: 100, height: 40 },
      viewport: VIEWPORT,
      card: { width: 360, height: 300 },
    });
    const low = placeCard({
      anchor: { x: 100, y: 680, width: 100, height: 40 },
      viewport: VIEWPORT,
      card: { width: 360, height: 300 },
    });
    if (high.kind !== "anchored" || low.kind !== "anchored") throw new Error("expected anchored");
    expect(high.top).toBe(CARD_MARGIN);
    expect(low.top).toBe(VIEWPORT.height - CARD_MARGIN - 300);
  });

  it("is a full-width sheet below the narrow breakpoint", () => {
    const placement = placeCard({
      anchor: { x: 40, y: 40, width: 80, height: 40 },
      viewport: { width: CARD_SHEET_BREAKPOINT - 1, height: 600 },
      card: { width: 360, height: 300 },
    });
    expect(placement).toEqual({ kind: "sheet" });
  });

  it("never mutates the camera, node rect or anchor (spatial constancy)", () => {
    const camera = Object.freeze({ ...CAMERA });
    const node = Object.freeze({ ...NODE });
    const anchor = Object.freeze(anchorScreenRect(node, camera));
    const before = JSON.stringify({ camera, node, anchor });
    placeCard({ anchor, viewport: VIEWPORT, card: { width: 360, height: 300 } });
    expect(JSON.stringify({ camera, node, anchor })).toBe(before);
  });

  it("never shrinks a card below zero width on a tiny viewport", () => {
    const placement = placeCard({
      anchor: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: CARD_SHEET_BREAKPOINT, height: 10 },
      card: { width: 360, height: 300 },
    });
    expect(placement.kind).toBe("sheet");
    expect(cardWidth({ width: 8, height: 100 })).toBe(0);
  });
});
