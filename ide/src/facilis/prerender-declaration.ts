// Read-modify-write of the prerender allowlist (D-202 §2, issue #84) as pure text surgery.
//
// Two declaration surfaces: `prerender.routes` in facilis.config.ts (full-stack projects) and
// the `prerender({ routes })` plugin option in vite.config.ts (static templates, which have no
// config file — see analyze passes/prerender-vite.ts). Only the routes array is edited; every
// other byte is preserved. Anything that cannot be edited unambiguously returns null so the
// caller surfaces an explanation instead of guessing a declaration (D-092 style, fail closed).

/** True where the character is code; false inside string literals and comments. */
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        state = ch;
        continue;
      }
      mask[i] = 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        i++;
        state = "code";
      }
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === state) state = "code";
  }
  return mask;
}

/** The index of the bracket closing the one at `open`, or null when unbalanced. */
function matchingBracket(source: string, mask: Uint8Array, open: number): number | null {
  const opener = source[open];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : null;
  if (closer === null) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (mask[i] !== 1) continue;
    if (source[i] === opener) depth++;
    else if (source[i] === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** First regex match that starts in code (never inside a string or comment). */
function maskedExec(
  source: string,
  mask: Uint8Array,
  pattern: RegExp,
  from = 0,
): RegExpExecArray | null {
  pattern.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (mask[match.index] === 1) return match;
  }
  return null;
}

interface StringArray {
  readonly values: readonly string[];
  readonly quote: "'" | '"';
  readonly multiline: boolean;
  readonly indent: string;
  readonly closeIndent: string;
}

/** Parse a string-literal array; any non-string entry or exotic escape fails closed. */
function parseStringArray(source: string, open: number, close: number): StringArray | null {
  const inner = source.slice(open + 1, close);
  const literal = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  const values: string[] = [];
  let quote: "'" | '"' = '"';
  let rest = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = literal.exec(inner)) !== null) {
    rest += inner.slice(lastIndex, match.index);
    lastIndex = literal.lastIndex;
    if (values.length === 0) quote = match[1] === "'" ? "'" : '"';
    const raw = match[2] ?? "";
    // Routes are plain paths: only quote/backslash escapes are representable here.
    if (/\\(?![\\"'])/.test(raw)) return null;
    values.push(raw.replace(/\\(["\\'])/g, "$1"));
  }
  rest += inner.slice(lastIndex);
  if (!/^[\s,]*$/.test(rest)) return null;
  return {
    values,
    quote,
    multiline: inner.includes("\n"),
    indent: inner.match(/\n([ \t]+)\S/)?.[1] ?? "  ",
    closeIndent: inner.match(/\n([ \t]*)$/)?.[1] ?? "",
  };
}

/** Re-emit the array in the original style: inline stays inline, one-per-line stays so. */
function renderArray(array: StringArray, values: readonly string[]): string {
  const literal = (value: string): string =>
    array.quote +
    value.replace(/\\/g, "\\\\").replace(new RegExp(array.quote, "g"), "\\" + array.quote) +
    array.quote;
  if (!array.multiline) return "[" + values.map(literal).join(", ") + "]";
  if (values.length === 0) return "[]";
  const body = values.map((value) => array.indent + literal(value) + ",").join("\n");
  return "[\n" + body + "\n" + array.closeIndent + "]";
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Add or remove one route in the `routes: [...]` field of the object at `open`. */
function editRoutesInObject(
  source: string,
  mask: Uint8Array,
  open: number,
  close: number,
  route: string,
  enabled: boolean,
): string | null {
  const field = maskedExec(source, mask, /\broutes\s*:\s*\[/g, open);
  if (field !== null && field.index < close) {
    const arrayOpen = field.index + field[0].length - 1;
    const arrayClose = matchingBracket(source, mask, arrayOpen);
    if (arrayClose === null || arrayClose > close) return null;
    const array = parseStringArray(source, arrayOpen, arrayClose);
    if (array === null) return null;
    const next = enabled
      ? array.values.includes(route)
        ? array.values
        : [...array.values, route]
      : array.values.filter((value) => value !== route);
    if (sameValues(next, array.values)) return source;
    return source.slice(0, arrayOpen) + renderArray(array, next) + source.slice(arrayClose + 1);
  }
  // No routes field yet: disabling is a no-op, enabling inserts one after the opening brace.
  if (!enabled) return source;
  const inserted = " routes: [" + JSON.stringify(route) + "],";
  return source.slice(0, open + 1) + inserted + source.slice(open + 1);
}

const PRERENDER_SECTION = /\bprerender\s*:\s*\{/g;

/**
 * Edit `prerender.routes` in a facilis.config.ts source. Without a prerender section the
 * enable inserts one into the defineConfig object; a disable with nothing declared is a no-op.
 * Null when the source cannot be edited safely (no defineConfig, two sections, exotic array).
 */
export function setConfigPrerenderRoute(
  source: string,
  route: string,
  enabled: boolean,
): string | null {
  const mask = codeMask(source);
  const section = maskedExec(source, mask, PRERENDER_SECTION);
  if (section !== null) {
    if (maskedExec(source, mask, PRERENDER_SECTION, section.index + 1) !== null) return null;
    const open = section.index + section[0].length - 1;
    const close = matchingBracket(source, mask, open);
    if (close === null) return null;
    return editRoutesInObject(source, mask, open, close, route, enabled);
  }
  if (!enabled) return source;
  const call = maskedExec(source, mask, /\bdefineConfig\s*\(\s*\{/g);
  if (call === null) return null;
  const open = call.index + call[0].length - 1;
  const after = source.slice(open + 1);
  const indent = after.match(/\n([ \t]+)\S/)?.[1] ?? "  ";
  const empty = /^\s*\}/.test(after);
  const inserted =
    "\n" + indent + "prerender: { routes: [" + JSON.stringify(route) + "] }," + (empty ? "\n" : "");
  return source.slice(0, open + 1) + inserted + source.slice(open + 1);
}

const PRERENDER_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@facilis\.dev\/nitro\/prerender["']/g;
const PRERENDER_SPECIFIER = /(?:^|,)\s*prerender(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*(?=,|$)/;

/** The local name of the framework prerender import, or null when the file has none. */
function prerenderLocal(source: string, mask: Uint8Array): string | null {
  const entry = maskedExec(source, mask, PRERENDER_IMPORT);
  if (entry === null) return null;
  const specifier = PRERENDER_SPECIFIER.exec(entry[1] ?? "");
  if (specifier === null) return null;
  return specifier[1] ?? "prerender";
}

/** Where a new import line goes: after the last single-line import, else the file top. */
function importInsertPosition(source: string, mask: Uint8Array): number {
  const pattern = /^import\s[^\n]*from\s*["'][^"']+["'];?[ \t]*$/gm;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (mask[match.index] === 1) last = match;
  }
  return last === null ? 0 : last.index + last[0].length;
}

/** Insert the plugin call (and its import when missing) into a vite.config.ts source. */
function addVitePlugin(
  source: string,
  mask: Uint8Array,
  route: string,
  withImport: boolean,
): string | null {
  const plugins = maskedExec(source, mask, /\bplugins\s*:\s*\[/g);
  if (plugins === null) return null;
  const open = plugins.index + plugins[0].length - 1;
  const close = matchingBracket(source, mask, open);
  if (close === null) return null;
  const importAt = withImport ? importInsertPosition(source, mask) : null;
  // The import edit must sit above the plugins edit, or the earlier index would shift.
  if (importAt !== null && importAt > open) return null;
  const call = "prerender({ routes: [" + JSON.stringify(route) + "] })";
  const inner = source.slice(open + 1, close);
  const head = source.slice(0, open + 1);
  const tail = source.slice(open + 1);
  let next: string;
  if (inner.includes("\n")) {
    const indent = inner.match(/\n([ \t]+)\S/)?.[1] ?? "    ";
    next = head + "\n" + indent + call + "," + tail;
  } else {
    next = head + call + (inner.trim() === "" ? "" : ", ") + tail;
  }
  if (importAt === null) return next;
  const line = 'import { prerender } from "@facilis.dev/nitro/prerender";';
  const prefix = importAt === 0 ? line + "\n" : "\n" + line;
  return next.slice(0, importAt) + prefix + next.slice(importAt);
}

/**
 * Edit the static-template declaration: the `prerender({ routes })` call in vite.config.ts
 * whose callee resolves to the @facilis.dev/nitro/prerender import (the analyzer's rule).
 * Without a call the enable adds import + plugin; a disable with nothing declared is a no-op.
 */
export function setVitePrerenderRoute(
  source: string,
  route: string,
  enabled: boolean,
): string | null {
  const mask = codeMask(source);
  const local = prerenderLocal(source, mask);
  if (local === null) {
    if (!enabled) return source;
    // A local binding named prerender would collide with the framework import: fail closed.
    if (maskedExec(source, mask, /\bprerender\b/g) !== null) return null;
    return addVitePlugin(source, mask, route, true);
  }
  const callPattern = new RegExp("\\b" + local + "\\s*\\(", "g");
  const call = maskedExec(source, mask, callPattern);
  if (call === null) {
    return enabled ? addVitePlugin(source, mask, route, false) : source;
  }
  // Two calls are ambiguous: the analyzer reads the first, a write must not guess.
  if (maskedExec(source, mask, callPattern, call.index + 1) !== null) return null;
  let open = call.index + call[0].length;
  while (open < source.length && /\s/.test(source[open] ?? "")) open++;
  if (source[open] !== "{") return null;
  const close = matchingBracket(source, mask, open);
  if (close === null) return null;
  return editRoutesInObject(source, mask, open, close, route, enabled);
}
