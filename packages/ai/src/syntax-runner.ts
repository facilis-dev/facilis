/**
 * Runs the injected TypeScript parser over the patch's script files (rule 1).
 *
 * Kept separate from the rule so the async parser call happens once, before the pure
 * validator runs: `checkPatchSyntax()` is the only async step of validation.
 */

import { scriptSources } from "./rules/ts-parse.ts";
import type { FilePatch, SyntaxChecker, SyntaxFinding } from "./types.ts";

export async function checkPatchSyntax(
  patches: readonly FilePatch[],
  checker: SyntaxChecker,
): Promise<SyntaxFinding[]> {
  const checked = await Promise.all(
    scriptSources(patches).map(async (source) => ({
      source,
      issues: await checker.check(source.path, source.content),
    })),
  );
  const findings: SyntaxFinding[] = [];
  for (const entry of checked) {
    for (const issue of entry.issues) {
      findings.push({
        file: entry.source.path,
        line: issue.line,
        column: issue.column,
        message: issue.message,
      });
    }
  }
  return findings;
}
