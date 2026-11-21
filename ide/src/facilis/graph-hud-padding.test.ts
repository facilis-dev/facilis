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

  it("reserves a top cluster's height from the top but not a horizontal side", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(8, 8, 200, 40)], 16);
    expect(padding.top).toBe(8 + 40 + 16);
    expect(padding.left).toBe(16);
    expect(padding.bottom).toBe(16);
    expect(padding.right).toBe(16);
  });

  it("reserves a bottom-right cluster from the bottom but not the right", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(760, 700, 232, 92)], 16);
    expect(padding.bottom).toBe(800 - 700 + 16);
    expect(padding.right).toBe(16);
    expect(padding.top).toBe(16);
    expect(padding.left).toBe(16);
  });

  it("takes the deepest vertical intrusion across the corner clusters", () => {
    const zones = [
      rect(8, 8, 240, 44), // top-left
      rect(700, 8, 292, 60), // top-right (deeper top)
      rect(8, 740, 320, 52), // bottom-left ribbon
      rect(820, 720, 172, 72), // bottom-right
    ];
    const padding = computeHudFitPadding(CANVAS, zones, 16);
    expect(padding.top).toBe(8 + 60 + 16); // deepest top cluster
    expect(padding.bottom).toBe(800 - 720 + 16);
    expect(padding.left).toBe(16); // no side rail: the ribbon must not eat the width
    expect(padding.right).toBe(16);
  });

  it("lets a wide bottom-left ribbon keep the horizontal fit box (regression: 0.06 zoom)", () => {
    // A 419px-wide ribbon on a 1024px canvas used to reserve 409px on the left, leaving a
    // 206px sliver and collapsing the fit to ~0.06; only its height may be reserved.
    const canvas = { width: 1024, height: 900 };
    const padding = computeHudFitPadding(canvas, [rect(8, 780, 419, 100)], 16);
    expect(padding.bottom).toBe(900 - 780 + 16);
    expect(padding.left).toBe(16);
    expect(padding.right).toBe(16);
  });

  it("reserves a full-height side rail from the horizontal edge", () => {
    const padding = computeHudFitPadding(CANVAS, [rect(0, 0, 120, 700)], 16);
    expect(padding.left).toBe(120 + 16);
    // The rail also touches the top, so the vertical side is capped at 40%.
    expect(padding.top).toBe(Math.floor(800 * 0.4));
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
