import { describe, expect, it } from "vitest";
import {
  DOCS,
  buildDocTree,
  docByRoute,
  docPager,
  docTree,
  routeOf,
  titleFromPath,
} from "./docs.ts";

describe("routeOf", () => {
  it("maps files to /docs routes and index files to their directory", () => {
    expect(routeOf("index.md")).toBe("/docs");
    expect(routeOf("getting-started.md")).toBe("/docs/getting-started");
    expect(routeOf("guides/index.md")).toBe("/docs/guides");
    expect(routeOf("guides/navigation.mdx")).toBe("/docs/guides/navigation");
    expect(routeOf("a/b/c.md")).toBe("/docs/a/b/c");
  });
});

describe("titleFromPath", () => {
  it("title-cases the last non-index segment", () => {
    expect(titleFromPath("content-pipeline.md")).toBe("Content Pipeline");
    expect(titleFromPath("guides/index.md")).toBe("Guides");
    expect(titleFromPath("index.md")).toBe("Docs");
  });
});

describe("buildDocTree", () => {
  const files = {
    "index.md": "---\ntitle: Introduction\norder: 1\n---\nintro",
    "zeta.md": "---\ntitle: Zeta\n---\nz",
    "alpha.md": "---\ntitle: Alpha\norder: 2\n---\na",
    "guides/index.md": "---\ntitle: Guides\norder: 1\n---\ng",
    "guides/second.md": "---\ntitle: Second\norder: 2\n---\ns",
    "guides/first.md": "---\ntitle: First\norder: 1\n---\nf",
    "guides/deep/index.md": "---\ntitle: Deep\n---\nd",
  };
  const registry = buildDocTree(files);

  it("derives routes, titles and formats from the files", () => {
    const entry = registry.byRoute.get("/docs/guides/first");
    expect(entry?.title).toBe("First");
    expect(entry?.format).toBe("md");
    expect(registry.byRoute.get("/docs")?.title).toBe("Introduction");
  });

  it("falls back to a slug-derived title without frontmatter", () => {
    const bare = buildDocTree({ "my-page.md": "body" });
    expect(bare.byRoute.get("/docs/my-page")?.title).toBe("My Page");
  });

  it("sorts pages by order, then title; absent order comes last", () => {
    const root = registry.tree;
    expect(root.pages.map((page) => page.title)).toEqual(["Alpha", "Zeta"]);
    const guides = root.sections.find((section) => section.key === "guides");
    expect(guides?.pages.map((page) => page.title)).toEqual(["First", "Second"]);
  });

  it("labels sections from their index page and nests directories", () => {
    const guides = registry.tree.sections.find((section) => section.key === "guides");
    expect(guides?.label).toBe("Guides");
    expect(guides?.index?.route).toBe("/docs/guides");
    expect(guides?.sections[0]?.key).toBe("guides/deep");
    expect(guides?.sections[0]?.label).toBe("Deep");
  });

  it("flattens in reading order: index, pages, then subsections", () => {
    expect(registry.flat.map((entry) => entry.route)).toEqual([
      "/docs",
      "/docs/alpha",
      "/docs/zeta",
      "/docs/guides",
      "/docs/guides/first",
      "/docs/guides/second",
      "/docs/guides/deep",
    ]);
  });

  it("keeps the first file on a duplicate route instead of throwing", () => {
    const duplicated = buildDocTree({
      "index.md": "---\ntitle: From MD\n---\n",
      "index.mdx": "---\ntitle: From MDX\n---\n",
    });
    expect(duplicated.byRoute.get("/docs")?.title).toBe("From MD");
    expect(duplicated.flat).toHaveLength(1);
  });
});

// The shipped content is the template's own documentation: these assertions pin the
// example-local convention the IDE contract test and the smoke rely on.
describe("the shipped content registry", () => {
  it("registers every shipped page at its file-derived route", () => {
    expect([...DOCS.byRoute.keys()].toSorted()).toEqual([
      "/docs",
      "/docs/getting-started",
      "/docs/guides",
      "/docs/guides/content-pipeline",
      "/docs/guides/navigation",
      "/docs/reference/frontmatter",
    ]);
  });

  it("renders the navigation guide as MDX and the rest as Markdown", () => {
    expect(docByRoute("/docs/guides/navigation")?.format).toBe("mdx");
    expect(docByRoute("/docs/getting-started")?.format).toBe("md");
  });

  it("orders the root pages by frontmatter and nests the guides section", () => {
    const tree = docTree();
    expect(tree.index?.route).toBe("/docs");
    expect(tree.pages.map((page) => page.route)).toEqual(["/docs/getting-started"]);
    expect(tree.sections.map((section) => section.key)).toEqual(["guides", "reference"]);
  });

  it("walks prev/next across sections in reading order", () => {
    expect(docPager("/docs").next?.route).toBe("/docs/getting-started");
    expect(docPager("/docs/getting-started").next?.route).toBe("/docs/guides");
    expect(docPager("/docs/guides/navigation").next?.route).toBe("/docs/reference/frontmatter");
    expect(docPager("/docs/reference/frontmatter").next).toBeNull();
    expect(docPager("/docs").prev).toBeNull();
    expect(docPager("/docs/nowhere")).toEqual({ prev: null, next: null });
  });
});
