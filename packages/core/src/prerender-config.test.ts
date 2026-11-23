import { describe, expect, it } from "vitest";

import { defineConfig, facilisConfigSchema } from "./config.ts";
import { DEFAULT_PRERENDER_CONFIG } from "./prerender-config.ts";

const AUTH = { defaultRole: "user", roles: { user: [] } } as const;

function parsePrerender(prerender: unknown) {
  return facilisConfigSchema.safeParse({ auth: AUTH, prerender });
}

function issuePaths(prerender: unknown): string[] {
  const result = parsePrerender(prerender);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("prerender config section", () => {
  it("defaults to off: no route is prerendered unless declared", () => {
    const config = defineConfig({ auth: AUTH });
    expect(config.prerender).toEqual({ routes: [] });
    expect(DEFAULT_PRERENDER_CONFIG.routes).toEqual([]);
  });

  it("accepts absolute param-free routes and an http(s) origin", () => {
    const result = parsePrerender({
      routes: ["/", "/about", "/docs/intro"],
      origin: "https://example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prerender.routes).toEqual(["/", "/about", "/docs/intro"]);
      expect(result.data.prerender.origin).toBe("https://example.com");
    }
  });

  it("accepts an origin with a port and no trailing slash", () => {
    expect(parsePrerender({ routes: ["/"], origin: "http://localhost:5173" }).success).toBe(true);
  });

  it("rejects unknown prerender keys (strictObject)", () => {
    const result = parsePrerender({ routes: [], crawl: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("crawl");
    }
  });

  it.each([
    ["about", "relative path"],
    ["/users/:id", "react-router param"],
    ["/users/{id}", "openapi param"],
    ["/files/*", "catch-all"],
    ["/a?b=1", "query"],
    ["/a#frag", "fragment"],
    ["/a b", "whitespace"],
    ["/a\\b", "backslash"],
    ["/a//b", "double slash"],
    ["/about/", "trailing slash"],
    ["", "empty route"],
  ])("rejects the invalid route %j (%s)", (route) => {
    const paths = issuePaths({ routes: [route] });
    expect(paths).toContain("prerender.routes.0");
  });

  it("keeps the root slash as the one legal trailing slash", () => {
    expect(parsePrerender({ routes: ["/"] }).success).toBe(true);
  });

  it("reports duplicates at the second occurrence", () => {
    const result = parsePrerender({ routes: ["/about", "/about"] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const duplicate = result.error.issues.find((issue) => issue.message.includes("duplicate"));
      expect(duplicate?.path).toEqual(["prerender", "routes", 1]);
    }
  });

  it.each([
    ["not a url", "absolute URL"],
    ["ftp://example.com", "protocol"],
    ["https://example.com/path", "origin only"],
    ["https://example.com/?q=1", "origin only"],
    ["https://example.com/#frag", "origin only"],
    ["https://user:pass@example.com", "credentials"],
    ["", "absolute URL"],
  ])("rejects the invalid origin %j (%s)", (origin) => {
    expect(issuePaths({ routes: [], origin })).toContain("prerender.origin");
  });

  it("reports each invalid route at its own index", () => {
    const paths = issuePaths({ routes: ["/ok", "bad", "/users/:id"] });
    expect(paths).toContain("prerender.routes.1");
    expect(paths).toContain("prerender.routes.2");
    expect(paths).not.toContain("prerender.routes.0");
  });
});
