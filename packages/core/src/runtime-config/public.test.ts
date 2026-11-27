import { describe, expect, it } from "vitest";

import { publicConfig } from "./public.ts";

describe("publicConfig (D-224)", () => {
  it("answers an empty frozen object when the build baked nothing", () => {
    const baked = publicConfig();
    expect(baked).toEqual({});
    expect(Object.isFrozen(baked)).toBe(true);
  });

  it("never throws before a build: a standalone import still reads a config", () => {
    expect(() => publicConfig()).not.toThrow();
  });
});
