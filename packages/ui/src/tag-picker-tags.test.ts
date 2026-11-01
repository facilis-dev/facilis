import { describe, expect, it } from "vitest";
import { filterTagSuggestions, isDuplicateTag, normalizeTag } from "./tag-picker-tags.ts";

describe("tag normalisation", () => {
  it("trims tags", () => {
    expect(normalizeTag("  react  ")).toBe("react");
    expect(normalizeTag("   ")).toBe("");
  });

  it("detects duplicates case-insensitively", () => {
    const tags = ["React", "TypeScript"];
    expect(isDuplicateTag(tags, "react")).toBe(true);
    expect(isDuplicateTag(tags, " REACT ")).toBe(true);
    expect(isDuplicateTag(tags, "Vue")).toBe(false);
    expect(isDuplicateTag([], "")).toBe(false);
  });
});

describe("filterTagSuggestions", () => {
  const options = ["React", "react", "Vue", "Svelte", "Solid", "Astro"];

  it("hides selected tags and duplicate options", () => {
    expect(filterTagSuggestions(options, ["react"], "")).toEqual([
      "Vue",
      "Svelte",
      "Solid",
      "Astro",
    ]);
  });

  it("matches the query case-insensitively and caps the result", () => {
    expect(filterTagSuggestions(options, [], "SO")).toEqual(["Solid"]);
    expect(filterTagSuggestions(options, [], "", 2)).toEqual(["React", "Vue"]);
  });

  it("returns nothing when everything is selected", () => {
    expect(filterTagSuggestions(["One", "Two"], ["one", "two"], "")).toEqual([]);
  });
});
