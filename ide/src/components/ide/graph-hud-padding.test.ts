import { describe, expect, it } from "vitest";
import { EMPTY_FIT_PADDING, flowPadding, hudFitPadding, type HudRect } from "./graph-hud-padding";

const SIZE = { width: 1000, height: 800 };
const rect = (left: number, top: number, width: number, height: number): HudRect => ({
  left,
  top,
  width,
  height,
});

describe("hudFitPadding", () => {
  it("returns zero insets when no HUD is measured (zen mode)", () => {
    expect(hudFitPadding([], SIZE)).toEqual(EMPTY_FIT_PADDING);
  });

  it("ignores empty or unmounted clusters", () => {
    expect(hudFitPadding([rect(0, 0, 0, 40), rect(8, 8, 200, 0)], SIZE)).toEqual(EMPTY_FIT_PADDING);
  });

  it("reserves a top band for the top-left breadcrumb, not a left band", () => {
    const padding = hudFitPadding([rect(8, 8, 220, 32)], SIZE);
    expect(padding.top).toBe(48); // 8 + 32 + gap 8
    expect(padding.left).toBe(0);
    expect(padding.right).toBe(0);
    expect(padding.bottom).toBe(0);
  });

  it("reserves a top band for a wide top-right toolbar without squeezing horizontally", () => {
    const padding = hudFitPadding([rect(480, 8, 512, 40)], SIZE);
    expect(padding.top).toBe(56);
    expect(padding.right).toBe(0);
  });

  it("reserves a bottom band for the ribbon and the minimap stack", () => {
    const padding = hudFitPadding([rect(8, 720, 600, 72), rect(840, 660, 152, 96)], SIZE);
    // The minimap sits above the zoom cluster: its top edge sets the band, not its bottom.
    expect(padding.bottom).toBe(148); // 800 - 660 + 8
    expect(padding.top).toBe(0);
  });

  it("reserves a right band for the tall inspector overlay", () => {
    const padding = hudFitPadding([rect(660, 48, 332, 704)], SIZE);
    expect(padding.right).toBe(348); // 1000 - 660 + 8
    expect(padding.top).toBe(0);
    expect(padding.bottom).toBe(0);
  });

  it("reserves a left band for a tall overlay on the left half", () => {
    const padding = hudFitPadding([rect(8, 48, 300, 704)], SIZE);
    expect(padding.left).toBe(316);
    expect(padding.right).toBe(0);
  });

  it("takes the deepest cluster per band when several share a side", () => {
    const padding = hudFitPadding([rect(8, 8, 200, 32), rect(400, 8, 592, 56)], SIZE);
    expect(padding.top).toBe(72); // 8 + 56 + 8, the taller toolbar wins
  });

  it("clamps each inset so a tiny canvas keeps a fit area", () => {
    const padding = hudFitPadding([rect(0, 0, 900, 700), rect(0, 750, 900, 50)], SIZE);
    expect(padding.left).toBe(SIZE.width * 0.45); // 908 requested, capped at 450
    expect(padding.bottom).toBe(58); // a short cluster is not capped
    expect(padding.top).toBe(0);
  });

  it("honours a custom gap", () => {
    expect(hudFitPadding([rect(8, 8, 200, 32)], SIZE, 0).top).toBe(40);
  });
});

describe("flowPadding", () => {
  it("emits px strings (a bare number would be a ratio in React Flow)", () => {
    expect(flowPadding({ top: 48, right: 0, bottom: 148.2, left: 3 })).toEqual({
      top: "48px",
      right: "0px",
      bottom: "149px",
      left: "3px",
    });
  });
});
