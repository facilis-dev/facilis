import { describe, expect, it } from "vitest";

import { islandScriptTag, parseIsland, serializeIsland } from "./prerender-island.ts";

// Runtime-only import: the fixture seam is browser code (.tsx, DOM) outside this package's
// rootDir, so tsc must not pull it into the node-only program; vitest resolves it at runtime.
const seamUrl = new URL("../test-fixtures/prerender-static/src/lib/prerender.tsx", import.meta.url).href;
const seam = (await import(seamUrl)) as {
  parsePrerenderIsland: (text: string | null) => Record<string, unknown> | null;
};
const parsePrerenderIsland = seam.parsePrerenderIsland;

describe("serializeIsland", () => {
  it("escapes the five HTML/JS breakout characters", () => {
    const serialized = serializeIsland({
      x: "</script><script>alert(1)</script>",
      y: "a&b",
      z: "line\u2028sep\u2029",
    });
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u003c");
    expect(serialized).toContain("\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(JSON.parse(serialized)).toEqual({
      x: "</script><script>alert(1)</script>",
      y: "a&b",
      z: "line\u2028sep\u2029",
    });
  });

  it("round-trips an empty island (static page)", () => {
    expect(serializeIsland({})).toBe("{}");
    expect(parseIsland("{}")).toEqual({});
  });
});

describe("parseIsland", () => {
  const CASES: readonly (string | null)[] = [
    null,
    "",
    "{corrupt",
    "[1,2]",
    "\"scalar\"",
    "42",
    "null",
    "{}",
    '{"/api/stats":{"count":1}}',
  ];

  it.each(CASES)("parses %j", (text) => {
    const parsed = parseIsland(text);
    if (text === "{}") expect(parsed).toEqual({});
    else if (text === '{"/api/stats":{"count":1}}') expect(parsed).toEqual({ "/api/stats": { count: 1 } });
    else expect(parsed).toBeNull();
  });

  // The generated-project seam is project-local code (D-168); the two parses must agree.
  it.each(CASES)("matches the template seam for %j", (text) => {
    expect(parsePrerenderIsland(text)).toEqual(parseIsland(text));
  });
});

describe("islandScriptTag", () => {
  it("emits the contract id and type", () => {
    const tag = islandScriptTag({ "/api/x": 1 });
    expect(tag).toContain('type="application/json"');
    expect(tag).toContain('id="prerender-data"');
    expect(tag).toContain('{"/api/x":1}');
  });
});
