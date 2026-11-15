import { describe, expect, it } from "vitest";

import { lineOf, sourceLines } from "./source.ts";

/** The scan the index replaces: count newlines before the offset, 1-based result. */
function referenceLine(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

describe("sourceLines", () => {
  it("numbers lines exactly like the reference scan, for every offset", () => {
    const sources = [
      "",
      "a",
      "a\n",
      "a\nb",
      "\n\n\n",
      "line one\n  line two\r\n\tline three",
      "no trailing newline\nlast",
      "windows\r\nline\r\nend\r\n",
    ];
    for (const source of sources) {
      const lines = sourceLines(source);
      for (let offset = -2; offset <= source.length + 2; offset += 1) {
        expect(lines.lineAt(offset), source + " @" + offset).toBe(referenceLine(source, offset));
      }
    }
  });

  it("clamps negative and past-the-end offsets", () => {
    const lines = sourceLines("a\nb");
    expect(lines.lineAt(-10)).toBe(1);
    expect(lines.lineAt(1_000_000)).toBe(2);
  });

  it("lineOf keeps the one-off helper consistent with the index", () => {
    const source = "first\nsecond\nthird";
    expect(lineOf(source, 0)).toBe(1);
    expect(lineOf(source, 6)).toBe(2);
    expect(lineOf(source, 13)).toBe(3);
  });

  it("looks up a position without rescanning the text for every node", () => {
    // Regression guard for issue #36: the analyzer records a source position per
    // import/export/usage node, and the pre-index helper rescanned the whole text for
    // each of them (27 s of the in-VM 38.5 s Vite boot). This file has ~20k positions;
    // a quadratic lookup needs seconds, the index a few milliseconds — the bound is
    // deliberately generous so a slow CI machine cannot make it flaky.
    const lines = Array.from({ length: 20_000 }, (_, index) => "const value" + index + " = " + index + ";")
      .join("\n");
    const index = sourceLines(lines);
    const started = performance.now();
    let total = 0;
    for (let offset = 0; offset < lines.length; offset += 13) total += index.lineAt(offset);
    expect(total).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
