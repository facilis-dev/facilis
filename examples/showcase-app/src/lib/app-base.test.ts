import { describe, expect, it } from "vitest";
import { appBasePath } from "./app-base.ts";

describe("appBasePath", () => {
  it("is empty at the root of a standalone dev server", () => {
    expect(appBasePath("/")).toBe("");
    expect(appBasePath("/showcase")).toBe("");
  });

  it("returns the IDE preview prefix", () => {
    expect(appBasePath("/preview/3000/")).toBe("/preview/3000");
    expect(appBasePath("/preview/4173/showcase")).toBe("/preview/4173");
  });

  it("ignores paths that only look like a preview", () => {
    expect(appBasePath("/preview/abc")).toBe("");
    expect(appBasePath("/preview/")).toBe("");
  });
});
