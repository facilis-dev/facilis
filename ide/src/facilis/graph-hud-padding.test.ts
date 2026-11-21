import { describe, expect, it } from "vitest";
import { computeHudFitPadding, type HudRect } from "./graph-hud-padding";

const CANVAS = { width: 1000, height: 800 };
const rect = (x: number, y: number, width: number, height: number): HudRect => ({
  x,
  y,
  width,
  height,
});

describe("computeHudFitPadding", () => {
  it("keeps only the gap on every side when no HUD is measured", () => {
    expect(computeHudFitPadding(CANVAS, [], 16)).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
  });

  it("reserves a top-left cluster's full extent from the top and left edges", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(8, 8, 200, 40)], 16);
    expect(padding.top).toBe(8 + 40 + 16);
    expect(padding.left).toBe(8 + 200 + 16);
    expect(padding.bottom).toBe(16);
    expect(padding.right).toBe(16);
  });

  it("reserves a bottom-right cluster from the bottom and right edges", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(760, 700, 232, 92)], 16);
    expect(padding.bottom).toBe(800 - 700 + 16);
    expect(padding.right).toBe(1000 - 760 + 16);
    expect(padding.top).toBe(16);
    expect(padding.left).toBe(16);
  });

  it("takes the deepest intrusion per side across the four corner clusters", () => {
    const zones = [
      rect(8, 8, 240, 44), // top-left
      rect(700, 8, 292, 60), // top-right (deeper top)
      rect(8, 740, 320, 52), // bottom-left (wider left)
      rect(820, 720, 172, 72), // bottom-right
    ];
    const padding = computeHudFitPadding(CANVAS, zones, 16);
    expect(padding.top).toBe(8 + 60 + 16); // deepest top cluster
    expect(padding.left).toBe(8 + 320 + 16); // widest left cluster
    expect(padding.bottom).toBe(800 - 720 + 16);
    expect(padding.right).toBe(1000 - 700 + 16);
  });

  it("caps a side at 40% of its dimension so a huge cluster cannot degenerate the fit", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(0, 0, 900, 700)], 16);
    expect(padding.left).toBe(Math.floor(1000 * 0.4));
    expect(padding.top).toBe(Math.floor(800 * 0.4));
  });

  it("ignores zero-area clusters", () => {
    expect(computeHudFitPadding(CANVAS, [rect(8, 8, 0, 40)], 16)).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
  });

  it("falls back to the gap for a non-positive canvas", () => {
    expect(computeHudFitPadding({ width: 0, height: 800 }, [rect(0, 0, 10, 10)], 12)).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
  });

  it("never returns a negative inset for a cluster partly off-canvas", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(-50, -50, 80, 80)], 16);
    expect(padding.top).toBeGreaterThanOrEqual(16);
    expect(padding.left).toBeGreaterThanOrEqual(16);
  });
});
