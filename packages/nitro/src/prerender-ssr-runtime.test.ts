import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { renderPrerenderRoute, splitHoistedHead } from "./prerender-ssr-runtime.ts";

describe("splitHoistedHead", () => {
  it("splits the leading hoisted run from the body", () => {
    const { head, body } = splitHoistedHead(
      '<title>T</title><meta name="description" content="d"/><link rel="canonical" href="https://x.dev/"/><div><h1>Hi</h1></div>',
    );
    expect(head).toBe('<title>T</title><meta name="description" content="d"/><link rel="canonical" href="https://x.dev/"/>');
    expect(body).toBe("<div><h1>Hi</h1></div>");
  });

  it("handles attribute values containing >", () => {
    const { head, body } = splitHoistedHead('<meta content="a>b"/><p>body</p>');
    expect(head).toBe('<meta content="a>b"/>');
    expect(body).toBe("<p>body</p>");
  });

  it("returns an empty head when nothing is hoisted", () => {
    expect(splitHoistedHead("<div>x</div>")).toEqual({ head: "", body: "<div>x</div>" });
  });

  it("stops at the first non-hoistable tag", () => {
    const { head, body } = splitHoistedHead("<title>T</title><div>x</div><meta later/>");
    expect(head).toBe("<title>T</title>");
    expect(body).toBe("<div>x</div><meta later/>");
  });
});

describe("renderPrerenderRoute", () => {
  function Page() {
    return createElement(
      "main",
      null,
      createElement("title", null, "Route Title"),
      createElement("h1", null, "Rendered"),
    );
  }

  it("renders the route tree with hoisted metadata and no session", async () => {
    const { head, body } = await renderPrerenderRoute({ route: "/", data: {}, app: Page });
    expect(head).toContain("<title>Route Title</title>");
    expect(body).toContain("<h1>Rendered</h1>");
  });

  it("passes the island through the provider", async () => {
    function Provider({ data, children }: { data: Readonly<Record<string, unknown>>; children: React.ReactNode }) {
      return createElement("div", { "data-count": String((data["/api/x"] as { count?: number })?.count) }, children);
    }
    const { body } = await renderPrerenderRoute({
      route: "/",
      data: { "/api/x": { count: 7 } },
      app: Page,
      provider: Provider,
    });
    expect(body).toContain('data-count="7"');
  });
});
