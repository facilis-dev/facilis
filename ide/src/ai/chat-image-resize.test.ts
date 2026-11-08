import { describe, expect, it } from "vitest";
import { MAX_IMAGE_EDGE, scaleFor } from "./chat-image-resize";

describe("pasted image downscale (D-113)", () => {
  it("keeps an image that already fits", () => {
    expect(scaleFor(800, 600)).toBe(1);
    expect(scaleFor(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE)).toBe(1);
  });

  it("fits the longest edge", () => {
    expect(scaleFor(3072, 2048)).toBeCloseTo(0.5);
    expect(scaleFor(100, 3072) * 3072).toBeCloseTo(MAX_IMAGE_EDGE);
    expect(scaleFor(2000, 500, 1000)).toBe(0.5);
  });

  it("scales both sides proportionally", () => {
    const scale = scaleFor(4000, 1000);
    expect(Math.round(4000 * scale)).toBe(MAX_IMAGE_EDGE);
    expect(Math.round(1000 * scale)).toBe(384);
  });
});
