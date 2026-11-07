// Tolerant SQL statement splitting for a release preview (SPEC §11.3).
//
// Migration files are read statement by statement; quotes, comments and dollar-quoted
// bodies must not split a statement. The risk classification that consumes these
// statements lives in release-classify.ts so each file stays small.

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function unquote(identifier: string): string {
  const parts = identifier.split(".");
  const last = parts[parts.length - 1] ?? identifier;
  return last.replace(/^"|"$/g, "");
}

/**
 * Split a migration file into statements, tolerating comments, quoted literals and
 * dollar-quoted bodies. The statements keep their original text (comments included) so the
 * preview can show what will run; classification works on a comment-free copy.
 */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let quote: string | null = null;
  let dollar: string | null = null;
  let lineComment = false;
  let blockComment = false;
  const flush = () => {
    const statement = buffer.trim();
    // A body made only of comments is not a statement.
    if (statement.length > 0 && stripComments(statement).trim().length > 0)
      statements.push(statement);
    buffer = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);
    if (lineComment) {
      buffer += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      buffer += char;
      if (char === "*" && next === "/") {
        buffer += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollar !== null) {
      buffer += char;
      if (char === "$" && source.startsWith(dollar, index)) {
        buffer += dollar.slice(1);
        index += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote !== null) {
      buffer += char;
      if (char === quote) {
        if (next === quote) {
          buffer += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      buffer += "--";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      buffer += "/*";
      index += 1;
      continue;
    }
    if (char === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(source.slice(index));
      if (match !== null && match[0] !== undefined) {
        dollar = match[0];
        buffer += match[0];
        index += match[0].length - 1;
        continue;
      }
    }
    if (char === ";") {
      flush();
      continue;
    }
    buffer += char;
  }
  flush();
  return statements;
}
