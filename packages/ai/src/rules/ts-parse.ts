/**
 * Rule 1 `ts-parse` (SPEC §9.3): every script file the patch writes must parse.
 *
 * The parser itself is injected — the IDE passes Monaco's TypeScript worker, Node tooling
 * passes `@facilis/ai/node` — so `@facilis/ai` never imports TypeScript. When the
 * injected checker is unavailable the rule fails closed: a patch is never written with
 * rule 1 silently skipped.
 */

import { isScriptPath, normalizeProjectPath } from "../paths.ts";
import type { FilePatch, SyntaxCheck, ValidationError } from "../types.ts";

export interface ScriptSource {
  path: string;
  content: string;
}

/** Create/update patches that carry a script file, in patch order. */
export function scriptSources(patches: readonly FilePatch[]): ScriptSource[] {
  const sources: ScriptSource[] = [];
  for (const patch of patches) {
    if (patch.action === "delete" || patch.content === undefined) continue;
    const path = normalizeProjectPath(patch.path);
    if (isScriptPath(path)) sources.push({ path, content: patch.content });
  }
  return sources;
}

function excerptOf(content: string, line: number): string | undefined {
  const text = content.split("\n")[line - 1];
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed.length > 160 ? trimmed.slice(0, 160) + "…" : trimmed;
}

export function tsParseErrors(
  patches: readonly FilePatch[],
  syntax: SyntaxCheck,
): ValidationError[] {
  const sources = scriptSources(patches);
  if (sources.length === 0) return [];
  if (syntax.status === "unavailable") {
    return sources.map((source) => ({
      rule: "ts-parse",
      severity: "error",
      file: source.path,
      message: "TypeScript syntax could not be checked: " + syntax.reason,
      fix_hint:
        "Wait for the editor's TypeScript service to load and retry; rule 1 fails closed on purpose.",
    }));
  }
  const byFile = new Map(sources.map((source) => [source.path, source]));
  const errors: ValidationError[] = [];
  for (const finding of syntax.findings) {
    const source = byFile.get(finding.file);
    if (source === undefined) continue;
    const excerpt = excerptOf(source.content, finding.line);
    errors.push({
      rule: "ts-parse",
      severity: "error",
      file: finding.file,
      message: finding.message,
      fix_hint: "Fix the TypeScript syntax error; a file that does not parse cannot be applied.",
      line: finding.line,
      column: finding.column,
      ...(excerpt === undefined ? {} : { excerpt }),
    });
  }
  return errors;
}
