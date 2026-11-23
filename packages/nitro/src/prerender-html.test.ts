import { describe, expect, it } from "vitest";

import {
  assemblePrerenderDocument,
  canonicalTag,
  rewriteAnchorHrefs,
  rewriteDevAssets,
  routeOutputPath,
  sitemapXml,
} from "./prerender-html.ts";

const SHELL =
  '<!doctype html><html><head><meta charset="UTF-8"/><title>Shell</title></head>' +
  '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

const BASE = { shell: SHELL, head: "", body: "<h1>Hi</h1>", island: {}, route: "/about" };

describe("assemblePrerenderDocument", () => {
  it("fills the empty root and injects the island before </head>", () => {
    const html = assemblePrerenderDocument({ ...BASE, island: { "/api/x": 1 } });
    expect(html).toContain('<div id="root"><h1>Hi</h1></div>');
    expect(html).toContain('id="prerender-data"');
    expect(html.indexOf("prerender-data")).toBeLessThan(html.indexOf("</head>"));
  });

  it("throws when the shell has no empty root", () => {
    expect(() => assemblePrerenderDocument({ ...BASE, shell: "<div>no root</div>" })).toThrow(
      /root/,
    );
  });

  it("replaces the shell title with the hoisted one, never duplicates", () => {
    const html = assemblePrerenderDocument({ ...BASE, head: "<title>Route</title>" });
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Route</title>");
    expect(html).not.toContain("<title>Shell</title>");
  });

  it("keeps the shell title when the route hoists none", () => {
    expect(assemblePrerenderDocument(BASE)).toContain("<title>Shell</title>");
  });

  it("adds canonical only with an origin", () => {
    expect(assemblePrerenderDocument(BASE)).not.toContain("canonical");
    const html = assemblePrerenderDocument({ ...BASE, origin: "https://x.dev" });
    expect(html).toContain('<link rel="canonical" href="https://x.dev/about"/>');
  });
});

describe("output naming and sitemap", () => {
  it("maps routes to subfolder-index paths", () => {
    expect(routeOutputPath("/")).toBe("index.html");
    expect(routeOutputPath("/about")).toBe("about/index.html");
    expect(routeOutputPath("/a/b")).toBe("a/b/index.html");
  });

  it("lists exactly the allowlist, paths verbatim", () => {
    const xml = sitemapXml("https://x.dev", ["/", "/about"]);
    expect(xml).toContain("<loc>https://x.dev/</loc>");
    expect(xml).toContain("<loc>https://x.dev/about</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(canonicalTag("https://x.dev", "/")).toBe('<link rel="canonical" href="https://x.dev/"/>');
  });
});

describe("rewriteAnchorHrefs", () => {
  it("prefixes root-relative navigation hrefs only", () => {
    const html =
      '<a href="/about">A</a><a href="https://x.dev/b">B</a><a href="//cdn/x">C</a><a href="rel">D</a>';
    const out = rewriteAnchorHrefs(html, "/preview/5173");
    expect(out).toContain('<a href="/preview/5173/about">A</a>');
    expect(out).toContain('<a href="https://x.dev/b">B</a>');
    expect(out).toContain('<a href="//cdn/x">C</a>');
    expect(out).toContain('<a href="rel">D</a>');
  });
});

describe("rewriteDevAssets", () => {
  it("swaps built assets for the dev entry", () => {
    const built =
      '<head><script type="module" crossorigin src="/assets/index-abc.js"></script>' +
      '<link rel="modulepreload" href="/assets/chunk-xyz.js">' +
      '<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head>';
    const out = rewriteDevAssets(built);
    expect(out).not.toContain("/assets/");
    expect(out).toContain('src="/@vite/client"');
    expect(out).toContain('src="/src/main.tsx"');
  });
});
