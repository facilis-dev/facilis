import { describe, expect, it } from "vitest";

import { blocks } from "./index";

describe("blocks registry", () => {
  it("starts empty until the first block lands", () => {
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(0);
  });
});
