/**
 * Parsing of `db/schema.ts` (Drizzle) into table facts the database rules read.
 *
 * It is a tolerant scan, not a compiler: `pgTable("name", { ... })` calls, their column
 * keys, their trailing `.enableRLS()`/policy helpers and the auth re-exports are enough for
 * rules 4, 5, 10, 14 and 15. Anything it cannot see is reported as an empty/unknown fact,
 * never guessed.
 */

import { maskSource, matchBracket, skipString, stringLiterals } from "./scan.ts";
import type { ConfigFacts, TableFacts } from "./types.ts";

const TABLE_CALL = /\bpgTable\s*\(/g;
const POLICY_CALL = /\b(pgPolicy|tenantIsolationPolicy|ownerIsolationPolicy|rlsForTable)\s*\(/g;
const RE_EXPORT = /\bexport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
const ENABLE_RLS = /\.enableRLS\s*\(/;

/** Identifier keys at the top level of an object literal, skipping nested objects/arrays. */
function topLevelKeys(masked: string, open: number, close: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let cursor = open + 1;
  while (cursor < close) {
    const char = masked[cursor];
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipString(masked, cursor);
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      cursor += 1;
      continue;
    }
    if (depth === 0 && char !== undefined && /[A-Za-z_$]/.test(char)) {
      const start = cursor;
      while (cursor < close && /[\w$]/.test(masked[cursor] ?? "")) cursor += 1;
      const name = masked.slice(start, cursor);
      let probe = cursor;
      while (probe < close && /\s/.test(masked[probe] ?? "")) probe += 1;
      if (masked[probe] === ":") {
        keys.push(name);
        cursor = probe + 1;
      } else {
        // A column type/value, not a key: resume at the token after the identifier so
        // its brackets still update the depth.
        cursor = probe;
      }
      continue;
    }
    cursor += 1;
  }
  return keys;
}

function normalized(value: string): string {
  return value.replace(/_/g, "").toLowerCase();
}

function scopedColumns(config: Pick<ConfigFacts, "tenantColumns" | "ownerColumns">): Set<string> {
  return new Set([...config.tenantColumns, ...config.ownerColumns].map(normalized));
}

/** The `export const <binding> = ` before a `pgTable` call. */
function bindingBefore(masked: string, index: number): string | null {
  const before = masked.slice(0, index);
  const matches = [...before.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)];
  return matches.at(-1)?.[1] ?? null;
}

/** One table definition: name, column keys, RLS marker and whether it is scoped. */
function tableAt(
  source: string,
  masked: string,
  callIndex: number,
  config: Pick<ConfigFacts, "tenantColumns" | "ownerColumns">,
): TableFacts | null {
  const open = masked.indexOf("(", callIndex);
  if (open === -1) return null;
  const close = matchBracket(masked, open, "(", ")");
  if (close === -1) return null;
  const args = source.slice(open + 1, close);
  const name = stringLiterals(args.slice(0, Math.max(0, args.indexOf("{"))))[0];
  if (name === undefined) return null;

  const objectOpen = masked.indexOf("{", masked.indexOf(",", open));
  let columns: string[] = [];
  let columnLiterals: string[] = [];
  if (objectOpen !== -1 && objectOpen < close) {
    const objectClose = matchBracket(masked, objectOpen, "{", "}");
    if (objectClose !== -1) {
      columns = topLevelKeys(masked, objectOpen, objectClose);
      // A column's SQL name may be snake_case while the property is camelCase.
      columnLiterals = stringLiterals(source.slice(objectOpen + 1, objectClose));
    }
  }

  const statementEnd = masked.indexOf(";", close);
  const tail = source.slice(close, statementEnd === -1 ? close + 160 : statementEnd);
  const block = source.slice(callIndex, close);
  const policyNames = [...block.matchAll(POLICY_CALL)].map((match) => match[1] ?? "");
  const scopedMarker = /\b(?:tenantColumn|ownerColumn)\s*\(/.test(block);
  const declared = scopedColumns(config);
  const scoped =
    scopedMarker ||
    columns.some((column) => declared.has(normalized(column))) ||
    columnLiterals.some((literal) => declared.has(normalized(literal)));

  const table: TableFacts = {
    name,
    columns,
    rlsEnabled: ENABLE_RLS.test(tail),
    policies: policyNames,
    scoped,
    source: "schema",
  };
  const variable = bindingBefore(masked, callIndex);
  if (variable !== null && variable !== name) table.variable = variable;
  return table;
}

/** Re-exported framework tables (`export { users, sessions } from "@facilis/auth"`). */
function reExports(masked: string): string[] {
  const names: string[] = [];
  for (const match of masked.matchAll(RE_EXPORT)) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

/** Tables declared by a schema source, in source order. */
export function parseSchemaSource(
  source: string,
  config: Pick<ConfigFacts, "tenantColumns" | "ownerColumns">,
): TableFacts[] {
  const masked = maskSource(source);
  const tables: TableFacts[] = [];
  const seen = new Set<string>();
  for (const match of masked.matchAll(TABLE_CALL)) {
    const table = tableAt(source, masked, match.index, config);
    if (table === null || seen.has(table.name)) continue;
    seen.add(table.name);
    tables.push(table);
  }
  for (const name of reExports(masked)) {
    if (seen.has(name)) continue;
    seen.add(name);
    tables.push({
      name,
      columns: [],
      rlsEnabled: true,
      policies: [],
      scoped: false,
      source: "re-export",
    });
  }
  return tables;
}
