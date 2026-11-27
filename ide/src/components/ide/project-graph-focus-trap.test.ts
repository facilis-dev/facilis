// Trap-math tests for the project-graph dialogs (issue #216). The focus move itself needs a
// browser (pnpm ide:smoke); what a Vitest case can prove is that Tab never leaves the dialog.

import { describe, expect, it } from "vitest";
import { trappedTabTarget } from "./project-graph-focus-trap.ts";

describe("trappedTabTarget", () => {
  it("wraps forward from the last tabbable to the first", () => {
    expect(trappedTabTarget(2, 3, false)).toBe(0);
    expect(trappedTabTarget(1, 3, false)).toBeNull();
  });

  it("wraps backwards from the first tabbable to the last", () => {
    expect(trappedTabTarget(0, 3, true)).toBe(2);
    expect(trappedTabTarget(1, 3, true)).toBeNull();
  });

  it("wraps from the dialog container because it sits before the first control", () => {
    expect(trappedTabTarget(-1, 3, true)).toBe(2);
    expect(trappedTabTarget(-1, 3, false)).toBeNull();
  });

  it("keeps focus on the only tabbable control", () => {
    expect(trappedTabTarget(0, 1, false)).toBe(0);
    expect(trappedTabTarget(0, 1, true)).toBe(0);
  });

  it("leaves an empty dialog to the browser", () => {
    expect(trappedTabTarget(-1, 0, false)).toBeNull();
    expect(trappedTabTarget(-1, 0, true)).toBeNull();
  });
});
