import { describe, expect, it } from "vitest";

import { describeValue } from "./describe-value.ts";

describe("describeValue", () => {
  it("names values typeof alone cannot distinguish", () => {
    expect(describeValue(null)).toBe("null");
    expect(describeValue([1, 2])).toBe("an array");
    expect(describeValue("2026-03-29")).toBe("string");
    expect(describeValue(42)).toBe("number");
    expect(describeValue(undefined)).toBe("undefined");
  });
});
