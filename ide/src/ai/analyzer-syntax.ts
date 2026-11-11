// Rule 1's parser in the IDE: the framework's own analyzer (oxc), not Monaco.
//
// Monaco is a file viewer: its TypeScript worker is a language service for IntelliSense, it
// times out on cold projects and adds no value the analyzer does not already give the
// validator. The analyzer worker is warm (it produces the facts the other rules read anyway)
// and parses each patched file here with oxc; only its parse-error diagnostics count. A
// failure to analyze fails closed, exactly like the injected-checker contract requires.
//
// The analyze function is injected so the mapping is unit-tested in Node without a worker.

import type { SyntaxChecker, SyntaxIssue } from "@facilis.dev/ai";
import { analyzeProjectFiles } from "@/facilis/analyze-client";

export interface AnalyzerDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly source: { readonly file: string; readonly line: number } | null;
}

export type AnalyzeSource = (
  files: ReadonlyMap<string, string>,
) => Promise<
  | { readonly ok: true; readonly analysis: { readonly diagnostics: readonly AnalyzerDiagnostic[] } }
  | { readonly ok: false; readonly error: string }
>;

export function createAnalyzerSyntaxChecker(
  analyze: AnalyzeSource = analyzeProjectFiles,
): SyntaxChecker {
  return {
    async check(path: string, content: string): Promise<SyntaxIssue[]> {
      const result = await analyze(new Map([[path, content]]));
      if (!result.ok) {
        throw new Error("the analyzer could not parse " + path + ": " + result.error);
      }
      const issues: SyntaxIssue[] = [];
      for (const entry of result.analysis.diagnostics) {
        if (entry.code !== "parse-error" || entry.severity !== "error") continue;
        // SourceRef carries the line but not a column; the message carries the detail.
        issues.push({ line: entry.source?.line ?? 1, column: 1, message: entry.message });
      }
      return issues;
    },
  };
}
