import { describe, expect, it } from "vitest";
import { encodeViewport, readEncodedViewport } from "./graph-view-viewport";

describe("readEncodedViewport", () => {
  it("round-trips a readable viewport", () => {
    const viewport = { x: 12.345, y: -7.891, zoom: 0.5 };
    expect(readEncodedViewport(encodeViewport(viewport))).toEqual({
      x: 12.35,
      y: -7.89,
      zoom: 0.5,
    });
  });

  it("drops a collapsed auto-fit viewport below the readable floor", () => {
    // The pre-fix HUD padding collapsed the fit to ~0.06 and the URL sync persisted it; such
    // a viewport must not be restored on reload, or the graph stays unreadable.
    expect(readEncodedViewport([151, 103.72, 0.061])).toBeNull();
    expect(readEncodedViewport([151, 103.72, 0.119])).toBeNull();
    expect(readEncodedViewport([151, 103.72, 0.12])).toEqual({ x: 151, y: 103.72, zoom: 0.12 });
  });

  it("rejects hostile or malformed triples", () => {
    expect(readEncodedViewport(null)).toBeNull();
    expect(readEncodedViewport([1, 2])).toBeNull();
    expect(readEncodedViewport([1, 2, 0])).toBeNull();
    expect(readEncodedViewport(["1", 2, 0.5])).toBeNull();
  });
});
