// Static guards for SQL text that reaches a read-only surface (SPEC §11.2).
//
// These checks are the UX half of the contract: the dev query endpoint wraps every
// statement in a read-only transaction, which is what actually rejects writes. They still
// matter where a query is inlined into another statement — a view definition is embedded
// in CREATE VIEW, so a second statement must never slip through, and a prefix check alone
// would accept "select 1; drop table todos".

const READ_ONLY_KEYWORDS: ReadonlySet<string> = new Set(["SELECT", "WITH", "VALUES", "TABLE"]);

/** True for a single read-only statement: SELECT, WITH, VALUES or TABLE. */
export function isReadOnlySql(text: string): boolean {
  const keyword = firstKeyword(text);
  if (keyword === null || !READ_ONLY_KEYWORDS.has(keyword)) return false;
  return !hasMultipleStatements(text);
}

/** The statement without a trailing semicolon, for embedding in a wrapper or in DDL. */
export function stripTrailingSemicolon(text: string): string {
  return text.trim().replace(/;\s*$/, "");
}

type ScanState =
  { kind: "normal" } | { kind: "single" } | { kind: "double" } | { kind: "dollar"; tag: string };

interface Cursor {
  readonly text: string;
  index: number;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

/** True when the text at `cursor.index` starts a comment; advances past it when so. */
function skipComment(cursor: Cursor): boolean {
  const { text, index } = cursor;
  if (text[index] === "-" && text[index + 1] === "-") {
    const newline = text.indexOf("\n", index + 2);
    cursor.index = newline === -1 ? text.length : newline + 1;
    return true;
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    // Postgres block comments nest; count them so an inner comment cannot end the outer.
    let depth = 1;
    let at = index + 2;
    while (at < text.length && depth > 0) {
      if (text[at] === "/" && text[at + 1] === "*") {
        depth += 1;
        at += 2;
        continue;
      }
      if (text[at] === "*" && text[at + 1] === "/") {
        depth -= 1;
        at += 2;
        continue;
      }
      at += 1;
    }
    cursor.index = at;
    return true;
  }
  return false;
}

/** The first keyword of the statement, comments and whitespace skipped. */
export function firstKeyword(text: string): string | null {
  const cursor: Cursor = { text, index: 0 };
  while (cursor.index < text.length) {
    while (cursor.index < text.length && isSpace(text[cursor.index] ?? "")) cursor.index += 1;
    if (skipComment(cursor)) continue;
    break;
  }
  const match = /^[A-Za-z]+/.exec(text.slice(cursor.index));
  return match === null ? null : match[0].toUpperCase();
}

/**
 * True when a ';' is followed by anything but comments/whitespace, or by another ';'.
 * Backslashes are NOT treated as escapes: standard_conforming_strings is on, and a
 * missed closing quote would make the scanner swallow a real statement separator (a
 * false "single statement" is the one answer this must never give).
 */
export function hasMultipleStatements(text: string): boolean {
  const cursor: Cursor = { text, index: 0 };
  let state: ScanState = { kind: "normal" };
  let separatorSeen = false;

  while (cursor.index < text.length) {
    const ch = text[cursor.index] ?? "";
    if (state.kind === "normal") {
      if (skipComment(cursor)) continue;
      if (isSpace(ch)) {
        cursor.index += 1;
        continue;
      }
      if (separatorSeen) return true;
      if (ch === "'") {
        state = { kind: "single" };
        cursor.index += 1;
        continue;
      }
      if (ch === '"') {
        state = { kind: "double" };
        cursor.index += 1;
        continue;
      }
      if (ch === "$") {
        const tag = dollarTagAt(text, cursor.index);
        if (tag !== null) {
          state = { kind: "dollar", tag };
          cursor.index += tag.length;
          continue;
        }
      }
      if (ch === ";") separatorSeen = true;
      cursor.index += 1;
      continue;
    }
    if (state.kind === "single") {
      if (ch === "'") {
        if (text[cursor.index + 1] === "'") {
          cursor.index += 2;
          continue;
        }
        state = { kind: "normal" };
      }
      cursor.index += 1;
      continue;
    }
    if (state.kind === "double") {
      if (ch === '"') {
        if (text[cursor.index + 1] === '"') {
          cursor.index += 2;
          continue;
        }
        state = { kind: "normal" };
      }
      cursor.index += 1;
      continue;
    }
    if (text.startsWith(state.tag, cursor.index)) {
      cursor.index += state.tag.length;
      state = { kind: "normal" };
      continue;
    }
    cursor.index += 1;
  }
  return false;
}

/** A complete dollar-quote tag (`$tag$`) at `index`, or null for a positional parameter. */
function dollarTagAt(text: string, index: number): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(index));
  return match === null ? null : match[0];
}
