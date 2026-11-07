/**
 * Analyzer parser adapter over rolldown's oxc parser (`rolldown/utils`).
 *
 * The Nitro Vite plugin also runs inside the Studio's WebContainer, where the analyzer's
 * Node subpath (its native oxc-parser adapter) is not proven (D-092). rolldown/utils is the
 * parser the previous AST pass used in that VM, so the analyzer's main entry gets it injected
 * here instead of importing a parser package itself.
 */
import { parseSync } from "rolldown/utils";

import type { ParseError, ParsedModule, Parser } from "@facilis/analyze";

/** Languages the parser adapter maps a file extension to; the rest are TypeScript. */
type ScriptLanguage = "ts" | "tsx" | "js" | "jsx";

/** The subset of rolldown's OxcError this adapter reads. */
interface RolldownParserError {
  readonly message: string;
  readonly labels?: readonly { readonly start?: number; readonly end?: number }[];
}

function languageOf(filename: string): ScriptLanguage {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".jsx")) return "jsx";
  if (filename.endsWith(".js") || filename.endsWith(".mjs") || filename.endsWith(".cjs"))
    return "js";
  return "ts";
}

/** 1-based line of an offset; `@facilis/analyze` keeps its own helper internal. */
function lineOf(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function toParseError(filename: string, source: string, error: RolldownParserError): ParseError {
  const label = error.labels?.[0];
  const start = label?.start ?? null;
  return {
    message: error.message,
    start,
    end: label?.end ?? null,
    source: { file: filename, line: start === null ? 1 : lineOf(source, start) },
  };
}

/** The analyzer's injected parser: rolldown's oxc build, the parser proven in the VM. */
export function createRolldownParser(): Parser {
  return {
    parse(filename, source): ParsedModule {
      // Parse TypeScript directly (no transform step): rolldown returns TS-ESTree, so
      // `as const` / type annotations survive for the analyzer's structural readers.
      const result = parseSync(filename, source, {
        lang: languageOf(filename),
        sourceType: "module",
        preserveParens: true,
      });
      return {
        program: toProgram(result.program),
        errors: result.errors.map((error) => toParseError(filename, source, error)),
      };
    },
  };
}

function toProgram(value: unknown): ParsedModule["program"] {
  if (typeof value !== "object" || value === null) {
    throw new Error("rolldown's oxc parser returned no program");
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") {
    throw new Error("rolldown's oxc parser returned an invalid program");
  }
  return value as ParsedModule["program"];
}
