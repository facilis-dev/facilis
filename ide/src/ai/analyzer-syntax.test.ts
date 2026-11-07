import { describe, expect, it } from "vitest";
import { createAnalyzerSyntaxChecker, type AnalyzeSource } from "./analyzer-syntax";

function analyzer(
  diagnostics: { code: string; severity: string; message: string; source: { file: string; line: number } | null }[],
): AnalyzeSource {
  return async () => ({ ok: true, analysis: { diagnostics } });
}

describe("createAnalyzerSyntaxChecker", () => {
  it("maps parse-error diagnostics to rule-1 issues", async () => {
    const checker = createAnalyzerSyntaxChecker(
      analyzer([
        {
          code: "parse-error",
          severity: "error",
          message: "Unexpected token",
          source: { file: "db/schema.ts", line: 7 },
        },
      ]),
    );
    await expect(checker.check("db/schema.ts", "x")).resolves.toEqual([
      { line: 7, column: 1, message: "Unexpected token" },
    ]);
  });

  it("ignores analyzer diagnostics that are not parse errors", async () => {
    const checker = createAnalyzerSyntaxChecker(
      analyzer([
        { code: "client-transport", severity: "warning", message: "direct fetch", source: { file: "src/a.tsx", line: 3 } },
      ]),
    );
    await expect(checker.check("src/a.tsx", "x")).resolves.toEqual([]);
  });

  it("fails closed when the analyzer cannot answer", async () => {
    const checker = createAnalyzerSyntaxChecker(async () => ({ ok: false, error: "worker did not start" }));
    await expect(checker.check("src/a.ts", "x")).rejects.toThrow("worker did not start");
  });
});
