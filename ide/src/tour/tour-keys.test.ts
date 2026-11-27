// The tour's key ownership (issue #218): Escape and the arrows drive the tour, but never
// while an editable field has focus and never after another handler consumed the event.

import { describe, expect, it } from "vitest";
import { tourKeyAction, type TourKeyInput } from "./tour-keys";

const press = (key: string, init: Partial<TourKeyInput> = {}) =>
  tourKeyAction({ key, defaultPrevented: false, typing: false, ...init });

describe("tourKeyAction", () => {
  it("owns Escape and the arrows", () => {
    expect(press("Escape")).toBe("dismiss");
    expect(press("ArrowRight")).toBe("next");
    expect(press("ArrowLeft")).toBe("previous");
  });

  it("leaves every other key to the surface that has focus", () => {
    expect(press("Tab")).toBeNull();
    expect(press("Enter")).toBeNull();
    expect(press("ArrowUp")).toBeNull();
    expect(press("a")).toBeNull();
    expect(press("Escape", { defaultPrevented: true })).toBeNull();
    expect(press("ArrowRight", { defaultPrevented: true })).toBeNull();
  });

  it("yields its keys to a field being typed in", () => {
    for (const key of ["Escape", "ArrowRight", "ArrowLeft"]) {
      expect(press(key, { typing: true }), key).toBeNull();
    }
  });
});
