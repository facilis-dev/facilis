// Tolerant text reader for a project's `db/schema.ts` (SPEC §11.3, D-086).
//
// The Release Preview has to describe the schema declared at an old git ref without booting
// the project, and `db/schema.ts` is a TypeScript module the Studio cannot execute (it
// imports drizzle and the project's own packages). So this reads the source as text:
// `pgTable("name", { ... }, extras)` calls, their top-level column keys and the RLS policies
// the extras declare. Anything the parser cannot see stays empty — it never invents a
// column, a policy or a flag (the limit D-086 declares).

import type { ReleasePolicyFact, ReleaseTableFact } from "./release-engine";

const PGTABLE_CALL = /\bpgTable\s*(?:<[^>]*>)?\s*\(/g;
const TABLE_NAME = /^\s*["'`]([^"'`]+)["'`]/;
const POLICY_NAMED = /\bpgPolicy\s*\(\s*["'`]([^"'`]+)["'`]/g;
const ROLE_POLICY = /\brolePolicy\s*\(([^)]*)\)/g;
const COLUMN_KEY = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/;
const SCOPED_COLUMN = /^(?:tenant|owner|user)_?id$/i;
const ENABLE_RLS = /^\s*\.\s*enableRLS\s*\(/;
const HELPER_CALL = /\b(?:rlsForTable|withRls)\s*\(([^)]*)\)/g;

/** Parse every `pgTable` declaration it can read, in source order, without duplicates. */
export function parseSchemaTables(source: string): ReleaseTableFact[] {
  const text = stripComments(source);
  // Same length as `text`, with every string body blanked: a `pgTable` mentioned in a
  // comment or a string is data, not a declaration. Names are read back from `text` at the
  // same indices, so literal table/policy names survive.
  const masked = maskStrings(text);
  const tables: ReleaseTableFact[] = [];
  const seen = new Set<string>();
  PGTABLE_CALL.lastIndex = 0;
  let match = PGTABLE_CALL.exec(masked);
  while (match !== null) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close === -1) break;
    const table = parseTable(
      text.slice(open + 1, close),
      text.slice(close + 1, close + 64),
      masked.slice(open + 1, close),
    );
    if (table !== null && !seen.has(table.name)) {
      seen.add(table.name);
      tables.push(table);
    }
    PGTABLE_CALL.lastIndex = close + 1;
    match = PGTABLE_CALL.exec(masked);
  }
  return tables;
}

function parseTable(
  argsText: string,
  afterCall: string,
  maskedArgs: string,
): ReleaseTableFact | null {
  const name = TABLE_NAME.exec(argsText)?.[1];
  if (name === undefined) return null;
  const args = splitTopLevel(argsText, ",");
  const columns = args.length > 1 ? columnKeys(args[1] ?? "") : [];
  return {
    name,
    columns,
    policies: readPolicies(argsText, maskedArgs),
    rlsEnabled: ENABLE_RLS.test(afterCall),
    scoped: columns.some((column) => SCOPED_COLUMN.test(column)),
  };
}

/** The top-level keys of the table-definition object are the column names. */
function columnKeys(objectText: string): string[] {
  const trimmed = objectText.trim();
  if (!trimmed.startsWith("{")) return [];
  const close = findClosing(trimmed, 0);
  if (close === -1) return [];
  const keys: string[] = [];
  for (const entry of splitTopLevel(trimmed.slice(1, close), ",")) {
    if (entry.trim().startsWith("...")) continue;
    const key = COLUMN_KEY.exec(entry);
    if (key === null) continue;
    const name = key[1] ?? key[2] ?? key[3];
    if (name !== undefined && !keys.includes(name)) keys.push(name);
  }
  return keys;
}

/**
 * Policies declared through a helper. @facilis/db expands them to fixed names
 * (packages/db/src/rls.ts): tenantIsolationPolicy → tenant_isolation,
 * ownerIsolationPolicy → owner_isolation, rolePolicy → role_access (or its second argument).
 */
function readPolicies(text: string, masked: string): ReleasePolicyFact[] {
  const names: string[] = [];
  const add = (name: string): void => {
    if (!names.includes(name)) names.push(name);
  };
  const inCode = (match: RegExpMatchArray): boolean => masked.charAt(match.index ?? -1) !== " ";
  for (const match of text.matchAll(POLICY_NAMED)) {
    if (inCode(match) && match[1] !== undefined) add(match[1]);
  }
  if (/\b(?:tenantIsolationPolicy|rlsForTable|withRls)\s*\(/.test(masked)) {
    add("tenant_isolation");
  }
  if (/\bownerIsolationPolicy\s*\(/.test(masked)) add("owner_isolation");
  for (const match of text.matchAll(ROLE_POLICY)) {
    if (!inCode(match)) continue;
    const args = splitTopLevel(match[1] ?? "", ",");
    const custom = args.length > 1 ? /["'`]([^"'`]+)["'`]/.exec(args[1] ?? "")?.[1] : undefined;
    add(custom ?? "role_access");
  }
  for (const match of text.matchAll(HELPER_CALL)) {
    if (!inCode(match)) continue;
    const options = match[1] ?? "";
    if (/\bownerColumn\b/.test(options)) add("owner_isolation");
    if (/\brolesColumn\b/.test(options)) add("role_access");
  }
  return names.map((name) => ({ name }));
}

// ── text scanning ─────────────────────────────────────────────────────────────────

/** Strip line and block comments while leaving string contents untouched. */
function stripComments(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (ch === "/" && text[index + 1] === "/") {
      const end = nextLineEnd(text, index);
      out += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      const found = text.indexOf("*/", index + 2);
      const end = found === -1 ? text.length : found + 2;
      out += text.slice(index, end).replace(/[^\n]/g, " ");
      index = end;
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

/** Same-length copy with every string literal blanked; used to reject lookalikes. */
function maskStrings(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, index);
      out += " ".repeat(end - index);
      index = end;
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

function nextLineEnd(text: string, from: number): number {
  const found = text.indexOf("\n", from);
  return found === -1 ? text.length : found;
}

/** Index just past the closing quote of the string that starts at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

/** Index of the bracket that closes the one at `open`, or -1 when the text is unbalanced. */
function findClosing(text: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'" || ch === "`") {
      index = skipString(text, index);
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

/** Split on `separator` outside of strings and nested brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'" || ch === "`") {
      index = skipString(text, index);
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(text.slice(start));
  return parts;
}
