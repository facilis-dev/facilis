// Browser parser adapter for @facilis.dev/analyze (docs/findings/ast-dsl-contract.md §4).
//
// The analyzer worker is the only runtime importer of this module: `oxc-parser`'s browser
// condition resolves to
// the wasm32-wasip1 binding, which loads its 1.5 MB `parser.wasm32-wasip1.wasm` with a
// top-level await. Keeping it here (and this module out of the editor's import graph) keeps
// both the parser and the wasm asset out of the initial bundle.
//
// Mirrors `createOxcParser()` from the package's Node adapter: same parser options, same
// `ParseError` mapping, because both adapters satisfy the same `Parser` contract.

import type { ParseError, ParsedModule, Parser } from "@facilis.dev/analyze";
import { parseSync } from "oxc-parser";

/** 1-based line number of a source offset (the fact model's SourceRef is 1-based). */
function lineOf(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/** The analyzer's parser over oxc-parser's wasm browser entry. */
export function createBrowserOxcParser(): Parser {
  return {
    parse(filename: string, source: string): ParsedModule {
      const result = parseSync(filename, source, {
        astType: "ts",
        sourceType: "module",
        preserveParens: true,
      });
      // The parser returns an ESTree/TS-ESTree Program, which is the structural shape
      // packages/analyze/src/ast/node.ts already narrows; only the static type differs.
      const program = result.program as unknown as ParsedModule["program"];
      if (typeof program !== "object" || program === null) {
        throw new Error("oxc-parser returned no program");
      }
      const errors: ParseError[] = result.errors.map((error) => {
        const label = error.labels[0];
        const start = label === undefined ? null : label.start;
        return {
          message: error.message,
          start,
          end: label === undefined ? null : label.end,
          source: { file: filename, line: start === null ? 1 : lineOf(source, start) },
        };
      });
      return { program, errors };
    },
  };
}
