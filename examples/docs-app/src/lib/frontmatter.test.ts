import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.ts";

describe("parseFrontmatter", () => {
  it("reads the fixed schema: title, description, order", () => {
    const source = "---\ntitle: My page\ndescription: About it\norder: 3\n---\n\nBody here.";
    expect(parseFrontmatter(source)).toEqual({
      data: { title: "My page", description: "About it", order: 3 },
      body: "\nBody here.",
    });
  });

  it("unquotes single- and double-quoted values", () => {
    const source = "---\ntitle: \"Release notes: v1.0\"\ndescription: 'Why.'\n---\nbody";
    const { data } = parseFrontmatter(source);
    expect(data.title).toBe("Release notes: v1.0");
    expect(data.description).toBe("Why.");
  });

  it("unescapes the quote character and backslash inside quoted values", () => {
    const source = '---\ntitle: "Say \\"hi\\" \\\\"\n---\n';
    expect(parseFrontmatter(source).data.title).toBe('Say "hi" \\');
  });

  it("accepts negative integers for order and ignores non-integers", () => {
    expect(parseFrontmatter("---\norder: -2\n---\n").data.order).toBe(-2);
    expect(parseFrontmatter("---\norder: 1.5\n---\n").data.order).toBeUndefined();
    expect(parseFrontmatter("---\norder: first\n---\n").data.order).toBeUndefined();
  });

  it("ignores unknown keys and empty values", () => {
    const { data } = parseFrontmatter("---\ntitle: T\ndraft: true\norder:\n---\n");
    expect(data).toEqual({ title: "T" });
  });

  it("returns no data without an opening delimiter", () => {
    const source = "# Just markdown\n";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  it("treats an unterminated block as body text (fail-soft)", () => {
    const source = "---\ntitle: T\nno closing delimiter";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  it("handles CRLF line endings", () => {
    const source = "---\r\ntitle: T\r\norder: 1\r\n---\r\nBody";
    expect(parseFrontmatter(source)).toEqual({ data: { title: "T", order: 1 }, body: "Body" });
  });
});
