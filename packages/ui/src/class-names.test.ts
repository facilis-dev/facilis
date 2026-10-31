import { describe, expect, it } from "vitest";
import { cx } from "./class-names.ts";

describe("cx", () => {
  it("joins truthy class names with one space and drops the rest", () => {
    expect(cx("fc-btn", "fc-btn--primary", undefined, false, null, "")).toBe(
      "fc-btn fc-btn--primary",
    );
  });
});
