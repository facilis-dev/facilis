import { describe, expect, it } from "vitest";
import {
  INITIAL_PINNED_DETAILS,
  SATELLITE_GAP,
  SATELLITE_WIDTH,
  SHEET_MIN_HEIGHT,
  clampSheetHeight,
  detailsLinkEdgeId,
  pinnedDetailsReducer,
  satelliteNodeId,
  satellitePosition,
  satelliteSide,
  sheetPanOffset,
} from "./graph-satellite";

const VIEWPORT = { x: 0, zoom: 1 };

describe("satelliteSide", () => {
  it("keeps the satellite on the right while it fits", () => {
    expect(satelliteSide({ x: 100, y: 0, width: 240 }, VIEWPORT, 1920)).toBe("right");
  });

  it("flips left when the right side would leave the viewport", () => {
    // Card right edge at 1700: 1700 + 24 + 320 + margin > 1920 - margin.
    expect(satelliteSide({ x: 1460, y: 0, width: 240 }, VIEWPORT, 1920)).toBe("left");
  });

  it("flips with the zoom: a far card fits at low zoom", () => {
    const anchor = { x: 3000, y: 0, width: 240 };
    expect(satelliteSide(anchor, VIEWPORT, 1920)).toBe("left");
    expect(satelliteSide(anchor, { x: 0, zoom: 0.3 }, 1920)).toBe("right");
  });

  it("accounts for a panned viewport", () => {
    const anchor = { x: 100, y: 0, width: 240 };
    expect(satelliteSide(anchor, { x: -1500, zoom: 1 }, 1920)).toBe("right");
    expect(satelliteSide(anchor, { x: 1500, zoom: 1 }, 1920)).toBe("left");
  });

  it("keeps the roomier side when neither fits", () => {
    // A 500px canvas: the card spans 100..340, more room on the right (160) than left (100).
    expect(satelliteSide({ x: 100, y: 0, width: 240 }, VIEWPORT, 500)).toBe("right");
    expect(satelliteSide({ x: 260, y: 0, width: 240 }, VIEWPORT, 500)).toBe("left");
  });

  it("treats a non-positive zoom as 1 instead of dividing by zero", () => {
    expect(satelliteSide({ x: 100, y: 0, width: 240 }, { x: 0, zoom: 0 }, 1920)).toBe("right");
  });
});

describe("satellitePosition", () => {
  const anchor = { x: 100, y: 40, width: 240 };

  it("sits one gap to the right of the card, top-aligned", () => {
    expect(satellitePosition(anchor, "right", 1)).toEqual({
      x: 100 + 240 + SATELLITE_GAP,
      y: 40,
    });
  });

  it("sits one gap plus its width to the left when flipped", () => {
    expect(satellitePosition(anchor, "left", 1)).toEqual({
      x: 100 - SATELLITE_GAP - SATELLITE_WIDTH,
      y: 40,
    });
  });

  it("keeps the gap and width screen-constant under zoom", () => {
    const position = satellitePosition(anchor, "right", 0.5);
    // In screen space the gap is still 24px and the satellite still 320px wide.
    expect((position.x - (anchor.x + anchor.width)) * 0.5).toBe(SATELLITE_GAP);
    expect((SATELLITE_WIDTH / 0.5) * 0.5).toBe(SATELLITE_WIDTH);
  });

  it("never overlaps the anchor card on either side", () => {
    for (const zoom of [0.05, 0.5, 1, 2]) {
      const right = satellitePosition(anchor, "right", zoom);
      const left = satellitePosition(anchor, "left", zoom);
      expect(right.x).toBeGreaterThan(anchor.x + anchor.width);
      expect(left.x + SATELLITE_WIDTH / zoom).toBeLessThan(anchor.x);
    }
  });
});

describe("ids", () => {
  it("derives stable node and edge ids from the anchor", () => {
    expect(satelliteNodeId("table:public.todo")).toBe("details:table:public.todo");
    expect(detailsLinkEdgeId("table:public.todo")).toBe("details-link:table:public.todo");
  });
});

describe("pinnedDetailsReducer", () => {
  const pin = { type: "pin", nodeId: "a", position: { x: 10, y: 20 } } as const;

  it("pins a card under the satellite id", () => {
    const state = pinnedDetailsReducer(INITIAL_PINNED_DETAILS, pin);
    expect(state).toEqual([{ id: satelliteNodeId("a"), nodeId: "a", position: { x: 10, y: 20 } }]);
  });

  it("never pins the same node twice", () => {
    const state = pinnedDetailsReducer(INITIAL_PINNED_DETAILS, pin);
    expect(pinnedDetailsReducer(state, { ...pin, position: { x: 0, y: 0 } })).toBe(state);
  });

  it("unpin removes only the named card", () => {
    const state = pinnedDetailsReducer(
      pinnedDetailsReducer(INITIAL_PINNED_DETAILS, pin),
      { type: "pin", nodeId: "b", position: { x: 0, y: 0 } },
    );
    const next = pinnedDetailsReducer(state, { type: "unpin", id: satelliteNodeId("a") });
    expect(next.map((card) => card.nodeId)).toEqual(["b"]);
    expect(pinnedDetailsReducer(next, { type: "unpin", id: "missing" })).toBe(next);
  });

  it("move repositions only the named card", () => {
    const state = pinnedDetailsReducer(INITIAL_PINNED_DETAILS, pin);
    const next = pinnedDetailsReducer(state, {
      type: "move",
      id: satelliteNodeId("a"),
      position: { x: 5, y: 6 },
    });
    expect(next[0].position).toEqual({ x: 5, y: 6 });
    expect(pinnedDetailsReducer(state, { type: "move", id: "missing", position: { x: 0, y: 0 } })).toBe(state);
  });

  it("prune drops cards whose node left the analysis", () => {
    const state = pinnedDetailsReducer(
      pinnedDetailsReducer(INITIAL_PINNED_DETAILS, pin),
      { type: "pin", nodeId: "b", position: { x: 0, y: 0 } },
    );
    const next = pinnedDetailsReducer(state, { type: "prune", knownNodeIds: new Set(["b"]) });
    expect(next.map((card) => card.nodeId)).toEqual(["b"]);
    expect(pinnedDetailsReducer(next, { type: "prune", knownNodeIds: new Set(["b"]) })).toBe(next);
  });
});

describe("sheet", () => {
  it("clamps the height between the minimum and 60% of the canvas", () => {
    expect(clampSheetHeight(10, 800)).toBe(SHEET_MIN_HEIGHT);
    expect(clampSheetHeight(300, 800)).toBe(300);
    expect(clampSheetHeight(700, 800)).toBe(480);
    // A tiny canvas still allows the minimum height.
    expect(clampSheetHeight(700, 100)).toBe(SHEET_MIN_HEIGHT);
  });

  it("pans up only when the node would sit under the sheet", () => {
    expect(sheetPanOffset(500, 600)).toBe(0);
    expect(sheetPanOffset(620, 600)).toBe(-(620 + 16 - 600));
  });
});
