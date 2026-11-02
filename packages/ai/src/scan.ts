/**
 * Tolerant source scanning for the validator (browser-safe, no TypeScript).
 *
 * The project's source files are code we do not execute: the rules only need comments
 * masked, string literals read and matched bracket spans. Indexes are preserved so a
 * finding can name the exact line, and the scanners are deliberately forgiving — a file
 * that does not parse is rule 1's problem, not this module's.
 */

export interface ImportRef {
  specifier: string;
  /** Local bindings the import introduces (default and named); empty for a side effect. */
  names: readonly string[];
  /** Offset of the import statement, for rule 12's line number. */
  index: number;
}

/** Blank comments in place, keeping newlines and every offset stable. */
export function maskSource(source: string): string {
  const chars = source.split("");
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote !== null) {
      if (char === "\\") index += 2;
      else {
        if (char === quote) quote = null;
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        chars[index] = " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      chars[index] = " ";
      chars[index + 1] = " ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") chars[index] = " ";
        index += 1;
      }
      if (index < source.length) {
        chars[index] = " ";
        chars[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    index += 1;
  }
  return chars.join("");
}

export function skipString(masked: string, index: number): number {
  const quote = masked[index];
  let cursor = index + 1;
  while (cursor < masked.length) {
    if (masked[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (masked[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return masked.length;
}

/** Index of the bracket matching the one at `index`, or -1 when the source is unbalanced. */
export function matchBracket(masked: string, index: number, open: string, close: string): number {
  if (masked[index] !== open) return -1;
  let depth = 0;
  let cursor = index;
  while (cursor < masked.length) {
    const char = masked[cursor];
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipString(masked, cursor);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return -1;
}

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function decodeLiteral(raw: string): string {
  const body = raw.slice(1, -1);
  return body.replace(/\\(["'`nrt])/g, (_match, escape: string) => {
    if (escape === "n") return "\n";
    if (escape === "r") return "\r";
    if (escape === "t") return "\t";
    return escape;
  });
}

/** Every string literal in a text slice, without its quotes. */
export function stringLiterals(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(STRING_LITERAL)) {
    values.push(decodeLiteral(match[0]));
  }
  return values;
}

/** The string literals of the array assigned to `key`, or null when it is not an array. */
export function arrayProperty(source: string, masked: string, key: string): string[] | null {
  const match = new RegExp("\\b" + key + "\\s*:\\s*\\[").exec(masked);
  if (!match) return null;
  const open = masked.indexOf("[", match.index);
  const close = matchBracket(masked, open, "[", "]");
  if (close === -1) return null;
  return stringLiterals(source.slice(open + 1, close));
}

/** The object span assigned to `key`, or null when it is not an object literal. */
export function objectProperty(source: string, masked: string, key: string): string | null {
  const match = new RegExp("\\b" + key + "\\s*:\\s*{").exec(masked);
  if (!match) return null;
  const open = masked.indexOf("{", match.index);
  const close = matchBracket(masked, open, "{", "}");
  if (close === -1) return null;
  return source.slice(open + 1, close);
}

/** A single quoted string property, or null. */
export function stringProperty(masked: string, key: string): string | null {
  const match = new RegExp("\\b" + key + "\\s*:\\s*([\"'])((?:(?!\\1)[^\\\\])*)\\1").exec(masked);
  return match?.[2] ?? null;
}

/** True when the source declares the property or key `key`. */
export function hasProperty(masked: string, key: string): boolean {
  return new RegExp("\\b" + key + "\\s*:").test(masked);
}

/** True when the source calls the named function. */
export function callsFunction(masked: string, name: string): boolean {
  return new RegExp("\\b" + name + "\\s*\\(").test(masked);
}

/** Line number (1-based) of an offset. */
export function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

const IMPORT_FROM = /\bimport\s+(?:type\s+)?([^;]*?)\s+from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function clauseNames(clause: string): string[] {
  const trimmed = clause.trim();
  if (trimmed.length === 0 || trimmed.startsWith("*")) return [];
  const names: string[] = [];
  const braces = /\{([^}]*)\}/.exec(trimmed);
  const beforeBraces = braces ? trimmed.slice(0, braces.index) : trimmed;
  const defaultName = /^([A-Za-z_$][\w$]*)/.exec(beforeBraces.replace(/,/g, " ").trim());
  if (defaultName?.[1] !== undefined) names.push(defaultName[1]);
  if (braces?.[1] !== undefined) {
    for (const part of braces[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.replace(/^type\s+/, "")
        .trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

/** Every static import/export-from/require in a source file, in source order. */
export function collectImports(source: string): ImportRef[] {
  const masked = maskSource(source);
  const found: ImportRef[] = [];
  for (const match of masked.matchAll(IMPORT_FROM)) {
    const specifier = match[2];
    if (specifier !== undefined) {
      found.push({ specifier, names: clauseNames(match[1] ?? ""), index: match.index });
    }
  }
  for (const match of masked.matchAll(SIDE_EFFECT_IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push({ specifier, names: [], index: match.index });
  }
  for (const match of masked.matchAll(EXPORT_FROM)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push({ specifier, names: [], index: match.index });
  }
  for (const match of masked.matchAll(REQUIRE_CALL)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push({ specifier, names: [], index: match.index });
  }
  for (const match of masked.matchAll(DYNAMIC_IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push({ specifier, names: [], index: match.index });
  }
  return found.toSorted((left, right) => left.index - right.index);
}

/** Static keys passed to `t("key")` (dynamic keys are not checkable and are skipped). */
const T_CALL = /(?<![\w$.])t\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

export function tCallKeys(source: string): { key: string; index: number }[] {
  const masked = maskSource(source);
  const keys: { key: string; index: number }[] = [];
  for (const match of masked.matchAll(T_CALL)) {
    const literal = match[1];
    if (literal === undefined) continue;
    if (literal.startsWith("`") && literal.includes("${")) continue;
    keys.push({ key: decodeLiteral(literal), index: match.index });
  }
  return keys;
}
