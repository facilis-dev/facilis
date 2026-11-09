import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  SPOTLIGHT_PADDING,
  VIEWPORT_MARGIN,
  centerCard,
  placeCard,
  spotlightRect,
  type Rect,
  type Size,
} from "./tour-geometry";

const VIEWPORT: Size = { width: 1200, height: 800 };
const CARD: Size = { width: 300, height: 150 };

describe("spotlightRect", () => {
  it("expands the target by the spotlight padding on every side", () => {
    const target: Rect = { top: 100, left: 200, width: 300, height: 400 };
    expect(spotlightRect(target)).toEqual({
      top: 100 - SPOTLIGHT_PADDING,
      left: 200 - SPOTLIGHT_PADDING,
      width: 300 + SPOTLIGHT_PADDING * 2,
      height: 400 + SPOTLIGHT_PADDING * 2,
    });
  });
});

describe("placeCard", () => {
  it("keeps the preferred side and centres the card on the anchor", () => {
    const anchor: Rect = { top: 100, left: 450, width: 300, height: 120 };
    expect(placeCard(anchor, CARD, VIEWPORT, "bottom")).toEqual({
      top: anchor.top + anchor.height + CARD_GAP,
      left: 450,
      side: "bottom",
      arrow: 150,
    });
  });

  it("places the card beside a horizontal anchor", () => {
    const anchor: Rect = { top: 300, left: 100, width: 200, height: 200 };
    expect(placeCard(anchor, { width: 200, height: 100 }, VIEWPORT, "right")).toEqual({
      top: 350,
      left: 100 + 200 + CARD_GAP,
      side: "right",
      arrow: 50,
    });
  });

  it("flips above the anchor when there is no room below", () => {
    const anchor: Rect = { top: 600, left: 450, width: 300, height: 120 };
    expect(placeCard(anchor, CARD, VIEWPORT, "bottom")).toEqual({
      top: anchor.top - CARD_GAP - CARD.height,
      left: 450,
      side: "top",
      arrow: 150,
    });
  });

  it("flips to the left when there is no room on the right", () => {
    const anchor: Rect = { top: 300, left: 1000, width: 150, height: 100 };
    expect(placeCard(anchor, CARD, VIEWPORT, "right")).toEqual({
      top: 275,
      left: anchor.left - CARD_GAP - CARD.width,
      side: "left",
      arrow: 75,
    });
  });

  it("clamps the card inside the viewport margin at the right edge", () => {
    const anchor: Rect = { top: 100, left: 1100, width: 80, height: 40 };
    const placement = placeCard(anchor, CARD, VIEWPORT, "bottom");
    expect(placement.side).toBe("bottom");
    expect(placement.left).toBe(VIEWPORT.width - VIEWPORT_MARGIN - CARD.width);
    expect(placement.arrow).toBe(252);
  });

  it("keeps the card and its arrow inside the margins when neither side fits", () => {
    const anchor: Rect = { top: 100, left: 100, width: 200, height: 40 };
    const placement = placeCard(
      anchor,
      { width: 250, height: 100 },
      { width: 400, height: 800 },
      "right",
    );
    expect(placement.side).toBe("left");
    expect(placement.top).toBe(70);
    expect(placement.left).toBe(VIEWPORT_MARGIN);
    expect(placement.arrow).toBe(50);
  });

  it("clamps vertically when neither top nor bottom fits", () => {
    const anchor: Rect = { top: 100, left: 175, width: 50, height: 40 };
    const placement = placeCard(
      anchor,
      { width: 200, height: 200 },
      { width: 400, height: 300 },
      "bottom",
    );
    expect(placement.side).toBe("top");
    expect(placement.top).toBe(VIEWPORT_MARGIN);
    expect(placement.arrow).toBe(100);
  });

  it("clamps the arrow onto the card when the anchor centre is off the card", () => {
    const anchor: Rect = { top: 10, left: 0, width: 20, height: 40 };
    const placement = placeCard(anchor, CARD, { width: 320, height: 300 }, "bottom");
    expect(placement.left).toBe(VIEWPORT_MARGIN);
    expect(placement.arrow).toBe(0);
    expect(placement.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });
});

describe("centerCard", () => {
  it("centres the card in the viewport", () => {
    expect(centerCard(CARD, VIEWPORT)).toEqual({ top: 325, left: 450 });
  });

  it("does not round odd space in half", () => {
    expect(centerCard(CARD, { width: 1001, height: 801 })).toEqual({ top: 325.5, left: 350.5 });
  });
});
