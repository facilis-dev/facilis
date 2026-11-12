import { describe, expect, it } from "vitest";
import { declarationLineOf, snippetAround } from "./graph-source-snippet";

describe("snippetAround", () => {
  it("returns null for empty text", () => {
    expect(snippetAround("", 1, 2)).toBeNull();
  });

  it("windows around a mid-file line", () => {
    const text = "one\ntwo\nthree\nfour\nfive";
    expect(snippetAround(text, 3, 1)).toMatchObject({
      from: 2,
      to: 4,
      lines: ["two", "three", "four"],
    });
  });

  it("returns the requested line alone with zero context", () => {
    expect(snippetAround("a\nb\nc", 2, 0)).toMatchObject({ from: 2, to: 2, lines: ["b"] });
  });

  it("clamps the window at the start of the file", () => {
    expect(snippetAround("a\nb\nc\nd", 1, 2)).toMatchObject({
      from: 1,
      to: 3,
      lines: ["a", "b", "c"],
    });
  });

  it("clamps the window at the end of the file", () => {
    expect(snippetAround("a\nb\nc\nd", 4, 2)).toMatchObject({
      from: 2,
      to: 4,
      lines: ["b", "c", "d"],
    });
  });

  it("clamps an out-of-range line to the last real line", () => {
    expect(snippetAround("a\nb\nc", 99, 1)).toMatchObject({ from: 2, to: 3, lines: ["b", "c"] });
  });

  it("clamps a non-positive line to the first line", () => {
    expect(snippetAround("a\nb\nc", 0, 1)).toMatchObject({ from: 1, to: 2, lines: ["a", "b"] });
    expect(snippetAround("a\nb\nc", -4, 0)).toMatchObject({ from: 1, to: 1, lines: ["a"] });
  });

  it("treats a trailing newline as a terminator, not an extra line", () => {
    expect(snippetAround("a\nb\n", 2, 1)).toMatchObject({ from: 1, to: 2, lines: ["a", "b"] });
  });

  it("strips CRLF line endings", () => {
    expect(snippetAround("a\r\nb\r\nc", 2, 1)).toMatchObject({
      from: 1,
      to: 3,
      lines: ["a", "b", "c"],
    });
  });

  it("reports the clamped anchor so the UI highlights a real line", () => {
    expect(snippetAround("a\nb\nc", 99, 1)?.anchor).toBe(3);
    expect(snippetAround("a\nb\nc", 0, 1)?.anchor).toBe(1);
    expect(snippetAround("a\nb\nc", 2, 0)?.anchor).toBe(2);
  });
});

describe("declarationLineOf", () => {
  it("finds a function declaration", () => {
    const text = "import x from 'y';\n\nexport function TodoList() {\n  return null;\n}";
    expect(declarationLineOf(text, "TodoList")).toBe(3);
  });

  it("finds a const arrow declaration and ignores a same-named usage", () => {
    const text = "const Row = () => null;\n<Row />\n";
    expect(declarationLineOf(text, "Row")).toBe(1);
  });

  it("falls back to line 1 for an unknown declaration or missing source", () => {
    expect(declarationLineOf("const Other = 1;", "Missing")).toBe(1);
    expect(declarationLineOf(undefined, "Missing")).toBe(1);
    expect(declarationLineOf("", "Missing")).toBe(1);
  });

  it("escapes regex metacharacters in the component name", () => {
    expect(declarationLineOf("const A = 1;\nconst B$ = 2;", "B$")).toBe(2);
  });
});
