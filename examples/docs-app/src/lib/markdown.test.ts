import { describe, expect, it } from "vitest";
import { extractHeadings, renderMarkdown, slugHeading } from "./markdown.ts";

describe("slugHeading", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugHeading("Getting started")).toBe("getting-started");
    expect(slugHeading("  Why MDX?  ")).toBe("why-mdx");
  });

  it("keeps Unicode letters and numbers", () => {
    expect(slugHeading("Perché MDX?")).toBe("perché-mdx");
    expect(slugHeading("Versión 2")).toBe("versión-2");
  });

  it("falls back to a stable id for empty text", () => {
    expect(slugHeading("!!!")).toBe("section");
  });
});

describe("extractHeadings", () => {
  it("collects depth-2 and depth-3 ATX headings in order", () => {
    const body = "# Title\n\n## First\n\ntext\n\n### Nested\n\n## Second\n";
    expect(extractHeadings(body)).toEqual([
      { id: "first", text: "First", depth: 2 },
      { id: "nested", text: "Nested", depth: 3 },
      { id: "second", text: "Second", depth: 2 },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const body = "## Real\n\n```md\n## Fake\n```\n\n~~~\n### Also fake\n~~~\n";
    expect(extractHeadings(body)).toEqual([{ id: "real", text: "Real", depth: 2 }]);
  });

  it("ignores depth-1 and depth-4 headings and closing hashes", () => {
    expect(extractHeadings("# One\n#### Four\n## Two ##")).toEqual([
      { id: "two", text: "Two", depth: 2 },
    ]);
  });
});

describe("renderMarkdown", () => {
  it("renders headings with the same ids the TOC extracts", () => {
    const body = "## Getting started\n\n### Why MDX?\n";
    const html = renderMarkdown(body);
    const ids = extractHeadings(body).map((entry) => entry.id);
    expect(html).toContain('<h2 id="' + ids[0] + '">Getting started</h2>');
    expect(html).toContain('<h3 id="' + ids[1] + '">Why MDX?</h3>');
  });

  it("renders paragraphs, lists, links and code", () => {
    const html = renderMarkdown(
      "A [link](/docs/guides).\n\n- one\n- two\n\n```bash\nnpm run dev\n```\n",
    );
    expect(html).toContain('<a href="/docs/guides">link</a>');
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<pre>");
    expect(html).toContain("npm run dev");
  });

  it("escapes raw HTML in code spans (content is trusted, code stays code)", () => {
    expect(renderMarkdown("`<script>`")).toContain("&lt;script&gt;");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });
});
