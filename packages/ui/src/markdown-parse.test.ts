import { describe, expect, it } from "vitest";
import { isSafeLink, parseInline, parseMarkdown } from "./markdown-parse.ts";

describe("parseMarkdown", () => {
  it("parses heading levels", () => {
    const blocks = parseMarkdown("# one\n\n## two\n\n### three");
    expect(blocks).toEqual([
      { type: "heading", level: 1, content: "one" },
      { type: "heading", level: 2, content: "two" },
      { type: "heading", level: 3, content: "three" },
    ]);
  });

  it("merges consecutive lines into one paragraph and keeps blank lines as separators", () => {
    expect(parseMarkdown("first line\nsecond line\n\nnext")).toEqual([
      { type: "paragraph", content: "first line\nsecond line" },
      { type: "paragraph", content: "next" },
    ]);
  });

  it("parses bullet and numbered lists as runs", () => {
    expect(parseMarkdown("- one\n- two\n\n1. first\n2) second")).toEqual([
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "list", ordered: true, items: ["first", "second"] },
    ]);
  });

  it("parses quotes, fenced code and rules", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const blocks = parseMarkdown(
      "> quoted\n> second\n\n---\n\n" + fence + "ts\nconst x = 1;\n" + fence,
    );

    expect(blocks).toEqual([
      { type: "blockquote", content: "quoted\nsecond" },
      { type: "hr" },
      { type: "code", language: "ts", content: "const x = 1;" },
    ]);
  });

  it("treats raw HTML as paragraph text", () => {
    expect(parseMarkdown("<b>hi</b>")).toEqual([{ type: "paragraph", content: "<b>hi</b>" }]);
  });
});

describe("parseInline", () => {
  it("parses emphasis, strong and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { type: "text", value: "a " },
      { type: "strong", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " " },
      { type: "em", children: [{ type: "text", value: "c" }] },
      { type: "text", value: " " },
      { type: "code", value: "d" },
    ]);
  });

  it("parses links and nested emphasis inside them", () => {
    expect(parseInline("[**docs**](https://example.com)")).toEqual([
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "strong", children: [{ type: "text", value: "docs" }] }],
      },
    ]);
  });

  it("turns newlines into break nodes", () => {
    expect(parseInline("a\nb")).toEqual([
      { type: "text", value: "a" },
      { type: "break" },
      { type: "text", value: "b" },
    ]);
  });
});

describe("isSafeLink", () => {
  it("accepts http, mailto, fragments and relative paths", () => {
    expect(isSafeLink("https://example.com")).toBe(true);
    expect(isSafeLink("http://example.com")).toBe(true);
    expect(isSafeLink("mailto:hi@example.com")).toBe(true);
    expect(isSafeLink("#section")).toBe(true);
    expect(isSafeLink("/docs/page")).toBe(true);
    expect(isSafeLink("./page")).toBe(true);
  });

  it("rejects explicit non-web schemes", () => {
    expect(isSafeLink("javascript:void(0)")).toBe(false);
    expect(isSafeLink("data:text/html;base64,xx")).toBe(false);
    expect(isSafeLink("vbscript:msgbox")).toBe(false);
    expect(isSafeLink("")).toBe(false);
  });
});
