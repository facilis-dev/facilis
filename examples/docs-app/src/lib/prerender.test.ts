import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRERENDER_ISLAND_ID,
  PrerenderDataProvider,
  hasIslandResponse,
  parsePrerenderIsland,
  readIslandResponse,
  readPrerenderIsland,
  shouldHydrate,
  usePrerenderData,
  type PrerenderIsland,
} from "./prerender.tsx";

/** Renders the provider once so its module-level island state matches `data`. */
function setIsland(data: PrerenderIsland | null): void {
  renderToStaticMarkup(createElement(PrerenderDataProvider, { data, children: null }));
}

afterEach(() => {
  // The island is module state: reset it so tests cannot leak responses into each other.
  setIsland(null);
});

describe("parsePrerenderIsland", () => {
  it("parses a JSON object into the island", () => {
    expect(parsePrerenderIsland('{"/api/todos":{"items":[]}}')).toEqual({
      "/api/todos": { items: [] },
    });
  });

  it("accepts the empty object of a static page", () => {
    expect(parsePrerenderIsland("{}")).toEqual({});
  });

  it("returns null for absent or empty text", () => {
    expect(parsePrerenderIsland(null)).toBeNull();
    expect(parsePrerenderIsland("")).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    expect(parsePrerenderIsland("{not json")).toBeNull();
  });

  it("rejects arrays, scalars and the null literal", () => {
    expect(parsePrerenderIsland("[1,2]")).toBeNull();
    expect(parsePrerenderIsland("42")).toBeNull();
    expect(parsePrerenderIsland('"text"')).toBeNull();
    expect(parsePrerenderIsland("true")).toBeNull();
    expect(parsePrerenderIsland("null")).toBeNull();
  });
});

describe("readPrerenderIsland", () => {
  it("uses the prerender-data island id", () => {
    expect(PRERENDER_ISLAND_ID).toBe("prerender-data");
  });

  it("is null without a document (server render or node test)", () => {
    expect(readPrerenderIsland()).toBeNull();
  });
});

describe("shouldHydrate", () => {
  // Only childElementCount is read, so a plain stub stands in for the real container.
  const filled = { childElementCount: 1 } as HTMLElement;
  const empty = { childElementCount: 0 } as HTMLElement;

  it("hydrates when markup and island are both present", () => {
    expect(shouldHydrate(filled, {})).toBe(true);
    expect(shouldHydrate(filled, { "/api/todos": { items: [] } })).toBe(true);
  });

  it("falls back to client render without an island", () => {
    expect(shouldHydrate(filled, null)).toBe(false);
  });

  it("falls back to client render without markup", () => {
    expect(shouldHydrate(empty, {})).toBe(false);
    expect(shouldHydrate(empty, null)).toBe(false);
  });
});

describe("island responses", () => {
  it("answers paths carried by the provider", () => {
    setIsland({ "/api/todos": { items: [1] } });
    expect(hasIslandResponse("/api/todos")).toBe(true);
    expect(readIslandResponse("/api/todos")).toEqual({ items: [1] });
  });

  it("misses paths outside the island", () => {
    setIsland({ "/api/todos": { items: [] } });
    expect(hasIslandResponse("/api/other")).toBe(false);
    expect(readIslandResponse("/api/other")).toBeUndefined();
  });

  it("misses everything when the provider carries no island", () => {
    setIsland(null);
    expect(hasIslandResponse("/api/todos")).toBe(false);
    expect(readIslandResponse("/api/todos")).toBeUndefined();
  });

  it("exposes the island through usePrerenderData", () => {
    let seen: PrerenderIsland | null = null;
    function Probe() {
      seen = usePrerenderData();
      return null;
    }
    const data = { "/api/todos": { items: [] } };
    renderToStaticMarkup(createElement(PrerenderDataProvider, { data, children: createElement(Probe) }));
    expect(seen).toEqual(data);
  });
});
