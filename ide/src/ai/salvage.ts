// Recover the complete patches from an answer the provider cut off mid-JSON (D-106).
//
// A cut answer is not useless: the patches before the cut are complete JSON objects, so the
// turn loop keeps them and asks the model for the rest instead of asking it to resend
// everything (which the same output limit would cut again). This scanner never guesses
// content: it only slices objects whose braces balance in a string-aware scan.

import type { FilePatch } from "@facilis/ai";
import { isRecord, parsePatches } from "./response-shape";

const PATCHES_ARRAY = /"patches"\s*:\s*\[/;

/** Index of the "[" opening the patches array, or -1 when the cut came before it. */
function arrayStart(text: string): number {
  const match = PATCHES_ARRAY.exec(text);
  return match === null ? -1 : match.index + match[0].length - 1;
}

function isSeparator(char: string): boolean {
  return char === "," || /\s/.test(char);
}

/** Index of the "}" that closes the object opened at `start`, or -1 when it is cut. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Every complete element of the patches array; the cut tail is dropped. */
function completeObjects(text: string): unknown[] {
  const start = arrayStart(text);
  if (start === -1) return [];
  const values: unknown[] = [];
  let index = start + 1;
  for (;;) {
    while (index < text.length && isSeparator(text.charAt(index))) index += 1;
    // "]" ends the array; anything else is the cut or a malformed element.
    if (text.charAt(index) !== "{") break;
    const end = objectEnd(text, index);
    if (end === -1) break;
    try {
      const value: unknown = JSON.parse(text.slice(index, end + 1));
      if (isRecord(value)) values.push(value);
    } catch {
      // A balanced object that is not valid JSON is not salvaged.
    }
    index = end + 1;
  }
  return values;
}

/** The patches a cut-off or malformed answer did deliver, in order. */
export function salvagePatches(raw: string): FilePatch[] {
  const patches: FilePatch[] = [];
  for (const value of completeObjects(raw)) {
    patches.push(...parsePatches([value]).patches);
  }
  return patches;
}
