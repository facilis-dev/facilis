/**
 * The structural `json-parse` check: a create/update patch that writes a `.json` file must
 * write valid JSON.
 *
 * Context-free like `content-present`, and deliberately not rule 13's business: that rule
 * reads only `locales/en.json` and only warns, while every catalogue is imported by the
 * client, so a broken `locales/it.json` surfaces later as Vite's native JSON parser failing
 * on a module whose path its error does not name (`File: [object Object]`) — unactionable for
 * the model and for the user (D-190).
 *
 * `JSON.parse` is the grammar an imported module is held to, with the one adjustment Vite
 * makes itself: a leading BOM is dropped. Trailing commas, comments and single-quoted strings
 * stay errors, because strict JSON is what the loader applies.
 */

import { isJsonPath, normalizeProjectPath } from "../paths.ts";
import type { FilePatch, ValidationError } from "../types.ts";
import { excerptOf } from "./excerpt.ts";

export interface JsonSource {
  path: string;
  content: string;
}

/** Create/update patches that carry a JSON file, in patch order. */
export function jsonSources(patches: readonly FilePatch[]): JsonSource[] {
  const sources: JsonSource[] = [];
  for (const patch of patches) {
    if (patch.action === "delete" || patch.content === undefined) continue;
    const path = normalizeProjectPath(patch.path);
    if (isJsonPath(path)) sources.push({ path, content: patch.content });
  }
  return sources;
}

// Anchored at the end of the message on purpose: an unanchored match would also hit the
// excerpt of the input V8 quotes back at us ("Unexpected token 'x', ..."), and a wrong line
// pointer is worse than none.
const LOCATED = /\(line (\d+) column (\d+)\)$/;
const POSITION = / at position (\d+)$/;

/**
 * The parser's offset as a 1-based line/column, so the finding points at the bad byte.
 *
 * Exported for its own test: which of the two shapes V8's message takes (`position N`, or
 * `position N (line L column C)`) depends on the engine version, and some failures carry
 * neither. The finding names the file either way, which is the part that was missing.
 */
export function locate(content: string, message: string): { line?: number; column?: number } {
  const located = LOCATED.exec(message);
  if (located !== null) return { line: Number(located[1]), column: Number(located[2]) };
  const position = POSITION.exec(message);
  if (position === null) return {};
  const offset = Number(position[1]);
  const before = content.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

export function jsonParseErrors(patches: readonly FilePatch[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const source of jsonSources(patches)) {
    const content = source.content.startsWith("\uFEFF") ? source.content.slice(1) : source.content;
    try {
      JSON.parse(content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const { line, column } = locate(content, message);
      const excerpt = excerptOf(content, line);
      errors.push({
        rule: "json-parse",
        severity: "error",
        file: source.path,
        message: "The written file is not valid JSON: " + message,
        fix_hint:
          "Emit the whole file again as strict JSON: double-quoted keys and strings, a comma " +
          "only between entries, no trailing comma, no comments. The write is applied only " +
          "once the file parses.",
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
        ...(excerpt === undefined ? {} : { excerpt }),
      });
    }
  }
  return errors;
}
