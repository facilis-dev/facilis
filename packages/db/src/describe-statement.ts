/**
 * Statement descriptors for query spans (D-203 §1).
 *
 * The driver reports what kind of statement ran and which relation it touched — never the
 * statement text, a bind value, or a URL/query string. The scanner below reads identifiers
 * only: literals, dollar-quoted bodies and comments are skipped, so a value that happens to
 * contain "from users" can never become an attribute.
 */
import { firstKeyword } from "./read-only-sql.ts";

/** One traced statement: a verb plus the relation it targets, when it can be read safely. */
export interface QueryDescriptor {
  /** Lower-case verb used for the span name and `db.operation.name`. */
  readonly operation: string;
  /** Plain relation identifier (no schema prefix), or null when the text is not readable. */
  readonly relation: string | null;
}

/** Verbs we name; anything else collapses to "other" so attribute cardinality stays bounded. */
const KNOWN_OPERATIONS: ReadonlySet<string> = new Set([
  "ALTER",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "COPY",
  "CREATE",
  "DELETE",
  "DROP",
  "EXPLAIN",
  "GRANT",
  "INSERT",
  "RELEASE",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "SELECT",
  "SET",
  "SHOW",
  "TABLE",
  "TRUNCATE",
  "UPDATE",
  "VACUUM",
  "VALUES",
  "WITH",
]);

/** Keywords that introduce the statement's target relation, in scan order. */
const RELATION_KEYWORDS: ReadonlySet<string> = new Set(["FROM", "INTO", "UPDATE", "JOIN"]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*/;

/** Operations whose target relation is the first word after the keyword. */
export function describeStatement(sql: string): QueryDescriptor {
  const keyword = firstKeyword(sql);
  const operation =
    keyword !== null && KNOWN_OPERATIONS.has(keyword) ? keyword.toLowerCase() : "other";
  return { operation, relation: relationOf(sql) };
}

/**
 * The first relation the statement reads or writes, or null. Only an identifier (bare or
 * double-quoted, optionally schema-qualified) is accepted: a sub-select, a function call or a
 * label that does not parse simply yields null instead of a guess.
 */
function relationOf(sql: string): string | null {
  let index = 0;
  while (index < sql.length) {
    const ch = sql[index] ?? "";
    if (ch === "'") {
      index = skipSingleQuoted(sql, index);
      continue;
    }
    if (ch === '"') {
      // A double-quoted identifier is a relation name only after one of the keywords below,
      // which the token scan handles; skip it here so an embedded keyword cannot be read.
      index = skipDoubleQuoted(sql, index);
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    const word = IDENTIFIER.exec(sql.slice(index));
    if (word === null) {
      index += 1;
      continue;
    }
    if (RELATION_KEYWORDS.has(word[0].toUpperCase())) {
      // The first relation keyword decides: when what follows it is not a plain identifier
      // (a sub-select, a join target behind a comma), the statement shape is not readable and
      // a later keyword must not be presented as the relation.
      return relationAfter(sql, index + word[0].length);
    }
    index += word[0].length;
  }
  return null;
}

/** Reads the identifier that follows a relation keyword, skipping whitespace and comments. */
function relationAfter(sql: string, start: number): string | null {
  let index = start;
  while (index < sql.length) {
    const ch = sql[index] ?? "";
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    break;
  }
  const first = identifierAt(sql, index);
  // A call is a function, not a relation: "from generate_series(...)" names no table.
  if (first === null || first.call) return null;
  // schema.table resolves to the table: the span names the relation, not its namespace.
  if (sql[first.end] === ".") {
    const nested = identifierAt(sql, first.end + 1);
    return nested === null || nested.call ? null : nested.name;
  }
  return first.name;
}

interface Identifier {
  readonly name: string;
  /** Index just past the identifier (past the closing quote for a quoted one). */
  readonly end: number;
  /** True when a call follows, so the token is a function rather than a relation. */
  readonly call: boolean;
}

/** Reads a bare or double-quoted identifier at `index`; null when none starts there. */
function identifierAt(sql: string, index: number): Identifier | null {
  if (sql[index] === '"') {
    const quoted = quotedIdentifier(sql, index);
    if (quoted === null) return null;
    return { name: quoted.name, end: quoted.end, call: sql[quoted.end] === "(" };
  }
  const word = IDENTIFIER.exec(sql.slice(index));
  if (word === null) return null;
  const end = index + word[0].length;
  return { name: word[0], end, call: sql[end] === "(" };
}

/** The unescaped name of a double-quoted identifier, or null when the quote never closes. */
function quotedIdentifier(
  sql: string,
  start: number,
): { readonly name: string; readonly end: number } | null {
  let name = "";
  let index = start + 1;
  while (index < sql.length) {
    const ch = sql[index] ?? "";
    if (ch === '"') {
      if (sql[index + 1] === '"') {
        name += '"';
        index += 2;
        continue;
      }
      return name.length > 0 ? { name, end: index + 1 } : null;
    }
    name += ch;
    index += 1;
  }
  return null;
}

function skipSingleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'") {
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function skipDoubleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '"') {
      if (sql[index + 1] === '"') {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}
