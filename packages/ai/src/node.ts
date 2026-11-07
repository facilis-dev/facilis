/**
 * Node-only helpers, exported as `@facilis/ai/node` (D-084, D-092).
 *
 * The main entry must stay browser-safe, so this subpath is the only place that imports
 * runtime code from a parser: rule 1's rolldown `parseSync` (oxc) and, for tests/tooling,
 * @facilis/analyze's oxc adapter so a project file map can be analyzed without a browser.
 * The IDE never imports this module: it injects Monaco's TypeScript worker and its own
 * analyzer adapter instead.
 */

import { analyzeProject, type Analysis, type PathAlias } from "@facilis/analyze";
import { createOxcParser as createAnalyzerParser } from "@facilis/analyze/node";
import { parseSync } from "rolldown/utils";

import type { SyntaxChecker, SyntaxIssue } from "./types.ts";

export type ScriptLanguage = "ts" | "tsx" | "js" | "jsx";

interface ParserError {
  severity: string;
  message: string;
  labels?: readonly { start: number; end: number }[];
}

function languageOf(path: string): ScriptLanguage {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return "js";
  return "ts";
}

function positionOf(content: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, content.length));
  const lines = content.slice(0, bounded).split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function toIssue(content: string, error: ParserError): SyntaxIssue {
  const label = error.labels?.[0];
  const position = positionOf(content, label?.start ?? 0);
  return { line: position.line, column: position.column, message: error.message };
}

/** A {@link SyntaxChecker} backed by rolldown's oxc parser (Node only). */
export function createTypeScriptSyntaxChecker(): SyntaxChecker {
  return {
    async check(path, content) {
      const language = languageOf(path);
      try {
        const result = parseSync(path, content, { lang: language });
        return (result.errors as readonly ParserError[])
          .filter((error) => error.severity === "Error")
          .map((error) => toIssue(content, error));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ line: 1, column: 1, message }];
      }
    },
  };
}

/**
 * Analyze a project file map with the Node oxc parser. Tests/tooling only: the browser
 * passes its own parser adapter to `analyzeProject`, and the main entry never imports
 * this module (it would pull a parser into the IDE bundle).
 */
export function analyzeProjectSources(
  files: ReadonlyMap<string, string>,
  aliases?: readonly PathAlias[],
): Analysis {
  return analyzeProject({
    files,
    parser: createAnalyzerParser(),
    ...(aliases === undefined ? {} : { aliases }),
  });
}
