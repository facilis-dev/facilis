// Context-aware SQL completion for the Data Explorer console (D-097). Pure and
// Monaco-free so the ranking rules stay unit-testable; SqlQueryEditor turns these
// candidates into Monaco suggestions.
//
// The parse is deliberately shallow: the console runs one statement at a time, so
// "nearest clause keyword before the cursor" is enough context, and table aliases,
// CTEs and subquery scope are out of scope.

export interface SqlTable {
  name: string;
  columns: readonly string[];
}

export type SqlCompletionKind = "keyword" | "table" | "column";

export interface SqlCompletion {
  label: string;
  kind: SqlCompletionKind;
  /** Text Monaco inserts; the label, except that it is unqualified after a qualifier. */
  insertText: string;
  /** Lowercase and bucket-prefixed, so Monaco's list keeps our ranking. */
  sortText: string;
  /** The owning table for a column candidate — an identifier, never prose. */
  detail?: string;
}

export interface SqlCompletionRequest {
  text: string;
  offset: number;
  tables?: readonly SqlTable[];
  /** Overrides the catalogue (tests rely on a small, stable vocabulary). */
  keywords?: readonly string[];
}

/** What the cursor is inside of, as far as completion is concerned. */
export type SqlCompletionContext = "general" | "tables" | "columns";

/** The statement vocabulary offered in every context. */
export const SQL_KEYWORDS: readonly string[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE VIEW",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "ASC",
  "DESC",
  "IS",
  "IN",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "UNION",
  "ALL",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "TRUE",
  "FALSE",
];

const TABLE_CLAUSES = new Set(["FROM", "JOIN", "UPDATE", "INTO"]);

// GROUP/ORDER complete columns once their BY arrives, but the keyword itself is
// already a column-clause marker, so a cursor right after it behaves the same.
const COLUMN_CLAUSES = new Set([
  "SELECT",
  "WHERE",
  "ON",
  "GROUP",
  "ORDER",
  "BY",
  "HAVING",
  "SET",
  "AND",
  "OR",
]);

// Words that can legally follow a table introducer without being a table name:
// subqueries (FROM (SELECT …)) and invalid drafts, where suggesting a keyword is
// still better than inventing a table called "select".
const NOT_A_TABLE = new Set([
  "SELECT",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "ON",
  "USING",
  "SET",
  "VALUES",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "FULL",
  "CROSS",
  "OUTER",
  "DISTINCT",
  "UNION",
  "ALL",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "RETURNING",
  "INSERT",
  "DELETE",
  "CREATE",
  "VIEW",
]);

/** One identifier, optionally schema-qualified (`public.todos`) or quoted. */
const TOKEN = /(?:"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*))*/g;

interface SqlToken {
  raw: string;
  upper: string;
}

function blank(match: string): string {
  return " ".repeat(match.length);
}

/** Comments and string literals become spaces, so offsets do not move. */
function codeOnly(text: string): string {
  return text
    .replace(/'(?:[^']|'')*'/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank);
}

function tokensOf(code: string): SqlToken[] {
  return [...code.matchAll(TOKEN)].map((match) => ({
    raw: match[0],
    upper: match[0].toUpperCase(),
  }));
}

/** The nearest clause keyword before the cursor decides what to suggest. */
export function completionContext(text: string, offset: number): SqlCompletionContext {
  const tokens = tokensOf(codeOnly(text.slice(0, offset)));
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const upper = tokens[index].upper;
    if (TABLE_CLAUSES.has(upper)) return "tables";
    if (COLUMN_CLAUSES.has(upper)) return "columns";
  }
  return "general";
}

/** The bare table name of a possibly schema-qualified, possibly quoted token. */
function tableName(raw: string): string | null {
  const segments = raw.split(".");
  const base = segments[segments.length - 1].replace(/^"|"$/g, "");
  return base === "" || NOT_A_TABLE.has(base.toUpperCase()) ? null : base;
}

/** Table names introduced by FROM/JOIN/UPDATE/INTO, in statement order, deduped. */
export function referencedTables(text: string): string[] {
  const tokens = tokensOf(codeOnly(text));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!TABLE_CLAUSES.has(tokens[index].upper)) continue;
    const name = tableName(tokens[index + 1].raw);
    if (name === null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The `table` part of a `table.` prefix, or null when the cursor is not qualified. */
function qualifierAt(text: string, offset: number): string | null {
  const match = /(?:^|[^A-Za-z0-9_$])([A-Za-z_][A-Za-z0-9_$]*)\.[A-Za-z0-9_$]*$/.exec(
    text.slice(0, offset),
  );
  return match === null ? null : match[1];
}

/**
 * Completion candidates for the cursor at `offset`. Ranking (lowest sortText first):
 * the referenced tables' columns, their qualified forms, other tables' columns,
 * then keywords; in a table clause, referenced tables, other tables, keywords.
 */
export function sqlCompletions(request: SqlCompletionRequest): SqlCompletion[] {
  const text = request.text;
  const offset = Math.min(Math.max(request.offset, 0), text.length);
  const tables = request.tables ?? [];
  const keywords = request.keywords ?? SQL_KEYWORDS;
  const candidates: SqlCompletion[] = [];
  const seen = new Set<string>();
  const add = (label: string, kind: SqlCompletionKind, bucket: number, detail?: string): void => {
    const key = label.toLowerCase();
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    candidates.push({
      label,
      kind,
      insertText: label,
      sortText: String(bucket).padStart(2, "0") + key,
      ...(detail === undefined ? {} : { detail }),
    });
  };

  // After `table.` only that table's columns make sense; Monaco replaces the word
  // after the dot, so the inserted text must not repeat the qualifier.
  const qualifier = qualifierAt(text, offset);
  if (qualifier !== null) {
    const table = tables.find((entry) => entry.name.toLowerCase() === qualifier.toLowerCase());
    if (table === undefined) return candidates;
    for (const column of table.columns) add(column, "column", 0, table.name);
    return candidates;
  }

  const context = completionContext(text, offset);

  if (context === "general") {
    for (const keyword of keywords) add(keyword, "keyword", 0);
    return candidates;
  }

  const referenced = new Set(referencedTables(text).map((name) => name.toLowerCase()));
  const known = tables.filter((table) => referenced.has(table.name.toLowerCase()));
  const unknown = tables.filter((table) => !referenced.has(table.name.toLowerCase()));

  if (context === "tables") {
    for (const table of known) add(table.name, "table", 0);
    for (const table of unknown) add(table.name, "table", 1);
    for (const keyword of keywords) add(keyword, "keyword", 2);
    return candidates;
  }

  for (const table of known) {
    for (const column of table.columns) add(column, "column", 0, table.name);
  }
  // Qualified forms disambiguate a column shared by two referenced tables.
  for (const table of known) {
    for (const column of table.columns) add(table.name + "." + column, "column", 1, table.name);
  }
  for (const table of unknown) {
    for (const column of table.columns) add(column, "column", 2, table.name);
  }
  for (const keyword of keywords) add(keyword, "keyword", 3);
  return candidates;
}
