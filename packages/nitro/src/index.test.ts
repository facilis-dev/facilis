import { describe, expect, it } from "vitest";

import { facilis } from "./index";

describe("facilis", () => {
  it("returns a Vite plugin named facilis", () => {
    expect(facilis()).toEqual({ name: "facilis" });
  });
});
