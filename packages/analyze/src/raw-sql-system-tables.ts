/**
 * System-only auth tables and raw SQL (invariant 8, D-158/D-204/D-214): `role_permissions`,
 * `roles`, `user_roles` and `sessions` are written only by the release artifact's seed
 * statements and the framework's audited auth paths. A literal `db.execute` write against one
 * of them is an early warning: the runtime audit stays the security authority, and SQL the
 * analyzer cannot read stays unknown and is never guessed.
 */

import type { RawSqlStatementFact } from "./types-relations.ts";
import type { SourceRef } from "./types.ts";

/** The seed-only auth tables (D-158/D-204): app code never writes them directly. */
export const SYSTEM_ONLY_AUTH_TABLES: ReadonlySet<string> = new Set([
  "role_permissions",
  "roles",
  "user_roles",
  "sessions",
]);

export interface RawSqlUsage {
  /** Literal statements recorded by the relation walk (D-214). */
  readonly rawSqlStatements?: readonly RawSqlStatementFact[];
}

export interface RawSqlSystemWriteSite {
  readonly source: SourceRef;
  readonly verb: string;
  readonly table: string;
}

/** The table a write/DDL target names: last dotted segment, unquoted and lowercased. */
function tableName(raw: string): string {
  const segment = raw.split(".").at(-1) ?? raw;
  return segment.replace(/^["`[]|["`\]]$/g, "").toLowerCase();
}

const TARGET = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[a-z_][\w$]*))?`;
const DIRECT_WRITE = new RegExp(
  String.raw`\b(insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|create\s+table(?:\s+if\s+not\s+exists)?)\s+(` +
    TARGET +
    `)`,
  "gi",
);
const CREATE_INDEX = new RegExp(
  String.raw`\bcreate\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+\S+\s+on\s+(` +
    TARGET +
    `)`,
  "gi",
);

/**
 * Drop comments and single-quoted values before matching: a literal like
 * `SELECT 'INSERT INTO roles'` is data, not a statement. Double-quoted identifiers stay
 * because they can name the table.
 */
function sqlStructure(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

/** Write/DDL statements a literal SQL string contains, in source order (conservative). */
export function systemTableWrites(sql: string): { verb: string; table: string }[] {
  const structure = sqlStructure(sql);
  const writes: { verb: string; table: string }[] = [];
  for (const match of structure.matchAll(DIRECT_WRITE)) {
    const verb = (match[1] ?? "").replace(/\s+/g, " ").toUpperCase();
    writes.push({ verb, table: tableName(match[2] ?? "") });
  }
  for (const match of structure.matchAll(CREATE_INDEX)) {
    writes.push({ verb: "CREATE INDEX", table: tableName(match[1] ?? "") });
  }
  return writes;
}

/** The literal SQL text of a `db.execute` argument, or null when it is opaque/dynamic. */
export function readRawSqlArgument(node: unknown): string | null {
  let candidate = node as { type?: string } | undefined;
  while (
    candidate &&
    (candidate.type === "ParenthesizedExpression" ||
      candidate.type === "TSAsExpression" ||
      candidate.type === "TSSatisfiesExpression" ||
      candidate.type === "TSNonNullExpression" ||
      candidate.type === "ChainExpression")
  ) {
    candidate = (candidate as { expression?: { type?: string } }).expression;
  }
  if (candidate?.type === "Literal") {
    const value = (candidate as { value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  type TemplateNode = { type?: string; expressions?: unknown[]; quasis?: unknown[] };
  const template: TemplateNode | undefined =
    candidate?.type === "TaggedTemplateExpression"
      ? ((candidate as { quasi?: TemplateNode }).quasi ?? undefined)
      : candidate;
  if (template?.type !== "TemplateLiteral") return null;
  const expressions = Array.isArray(template.expressions) ? template.expressions : [];
  if (expressions.length > 0) return null;
  const quasis = Array.isArray(template.quasis) ? template.quasis : [];
  const value = (quasis[0] as { value?: { cooked?: unknown } } | undefined)?.value?.cooked;
  return typeof value === "string" ? value : null;
}

/**
 * Every literal system-table write a usage fact reaches, deduplicated per statement and table.
 * Framework sources (`node_modules/`) are shipped seed code and stay exempt; only the project's
 * route/job handlers are scanned, so a standalone seed file is never a finding either.
 */
export function rawSqlSystemWriteSites(
  usages: readonly RawSqlUsage[],
): RawSqlSystemWriteSite[] {
  const sites: RawSqlSystemWriteSite[] = [];
  for (const usage of usages) {
    for (const statement of usage.rawSqlStatements ?? []) {
      if (statement.source.file.startsWith("node_modules/")) continue;
      const seen = new Set<string>();
      for (const write of systemTableWrites(statement.sql)) {
        if (!SYSTEM_ONLY_AUTH_TABLES.has(write.table) || seen.has(write.table)) continue;
        seen.add(write.table);
        sites.push({ source: statement.source, verb: write.verb, table: write.table });
      }
    }
  }
  return sites;
}
