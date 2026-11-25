// Double-tap detection tests (issue #188): the second tap opens the rich card, a different
// node or a stale tap does not.

import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, isDoubleTap } from "./card-trigger.ts";

describe("isDoubleTap", () => {
  it("accepts the same node inside the window", () => {
    expect(isDoubleTap({ id: "table:todos", at: 1000 }, "table:todos", 1000 + DOUBLE_TAP_MS)).toBe(
      true,
    );
  });

  it("rejects a different node, a stale tap and a tap before the previous one", () => {
    expect(isDoubleTap({ id: "table:todos", at: 1000 }, "route:GET /", 1100)).toBe(false);
    expect(
      isDoubleTap({ id: "table:todos", at: 1000 }, "table:todos", 1000 + DOUBLE_TAP_MS + 1),
    ).toBe(false);
    expect(isDoubleTap({ id: "table:todos", at: 1000 }, "table:todos", 999)).toBe(false);
  });

  it("has no previous tap on the first click", () => {
    expect(isDoubleTap(null, "table:todos", 1000)).toBe(false);
  });
});
