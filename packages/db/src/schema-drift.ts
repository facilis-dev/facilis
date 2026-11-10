import type { LivePolicySnapshot, LiveSchemaSnapshot, LiveTableSnapshot } from "./live-schema.ts";
import type { PolicySnapshot, SchemaSnapshot, TableSnapshot } from "./snapshot.ts";

/**
 * Code↔live schema diff (SPEC §11.1): a pure comparison of the snapshot derived from
 * `db/schema.ts` with the one read from the running database. The Studio renders the
 * resulting entries; the release preview (SPEC §11.3) can reuse the same typed drift.
 */

export type SchemaDriftKind =
  | "table_missing"
  | "table_extra"
  | "column_missing"
  | "column_extra"
  | "column_type"
  | "column_nullability"
  | "rls_disabled"
  | "policy_missing"
  | "policy_extra"
  | "policy_changed";

/**
 * One difference. `expected` is the code-side value and `actual` the live one, so a
 * consumer never has to guess which side of the diff it is looking at.
 */
export interface SchemaDrift {
  kind: SchemaDriftKind;
  table: string;
  column?: string;
  policy?: string;
  expected?: string | null;
  actual?: string | null;
}

/** Compare the code schema against the live one, deterministically ordered. */
export function diffSchemaSnapshots(code: SchemaSnapshot, live: LiveSchemaSnapshot): SchemaDrift[] {
  const liveTables = new Map(live.tables.map((table) => [table.name, table]));
  const codeTables = new Set(code.tables.map((table) => table.name));
  const drift: SchemaDrift[] = [];

  for (const table of code.tables) {
    const liveTable = liveTables.get(table.name);
    if (liveTable === undefined) {
      drift.push({ kind: "table_missing", table: table.name });
      continue;
    }
    diffColumns(table, liveTable, drift);
    // A scoped table without RLS is the one combo the security invariants forbid
    // (SPEC §8.4.5); RLS off on an unscoped table is reported by the panel badge only.
    if (table.scopeColumn !== undefined && !liveTable.rlsEnabled) {
      drift.push({ kind: "rls_disabled", table: table.name });
    }
    diffPolicies(table, liveTable, drift);
  }

  for (const table of live.tables) {
    if (!codeTables.has(table.name)) drift.push({ kind: "table_extra", table: table.name });
  }

  return drift.toSorted(compareDrift);
}

function diffColumns(
  table: TableSnapshot,
  liveTable: LiveTableSnapshot,
  drift: SchemaDrift[],
): void {
  const liveColumns = new Map(liveTable.columns.map((column) => [column.name, column]));
  for (const column of table.columns) {
    const liveColumn = liveColumns.get(column.name);
    if (liveColumn === undefined) {
      drift.push({ kind: "column_missing", table: table.name, column: column.name });
      continue;
    }
    const expectedType = canonicalColumnType(column.type);
    const actualType = canonicalColumnType(liveColumn.type);
    if (expectedType !== actualType) {
      drift.push({
        kind: "column_type",
        table: table.name,
        column: column.name,
        expected: column.type,
        actual: liveColumn.type,
      });
    }
    if (column.notNull !== liveColumn.notNull) {
      drift.push({
        kind: "column_nullability",
        table: table.name,
        column: column.name,
        expected: nullability(column.notNull),
        actual: nullability(liveColumn.notNull),
      });
    }
  }
  const codeColumns = new Set(table.columns.map((column) => column.name));
  for (const liveColumn of liveTable.columns) {
    if (!codeColumns.has(liveColumn.name)) {
      drift.push({ kind: "column_extra", table: table.name, column: liveColumn.name });
    }
  }
}

function diffPolicies(
  table: TableSnapshot,
  liveTable: LiveTableSnapshot,
  drift: SchemaDrift[],
): void {
  const livePolicies = new Map(liveTable.policies.map((policy) => [policy.name, policy]));
  const codePolicies = new Set(table.policies.map((policy) => policy.name));
  for (const policy of table.policies) {
    const livePolicy = livePolicies.get(policy.name);
    if (livePolicy === undefined) {
      drift.push({ kind: "policy_missing", table: table.name, policy: policy.name });
      continue;
    }
    const expected = policySignature(policy);
    const actual = livePolicySignature(livePolicy);
    if (expected !== actual) {
      drift.push({
        kind: "policy_changed",
        table: table.name,
        policy: policy.name,
        expected,
        actual,
      });
    }
  }
  for (const livePolicy of liveTable.policies) {
    if (!codePolicies.has(livePolicy.name)) {
      drift.push({ kind: "policy_extra", table: table.name, policy: livePolicy.name });
    }
  }
}

function nullability(notNull: boolean): string {
  return notNull ? "not null" : "nullable";
}

/** Code-side signature: command + permissiveness + rendered predicates. */
function policySignature(policy: PolicySnapshot): string {
  return [
    policy.command.toUpperCase(),
    isRestrictivePolicy(policy) ? "RESTRICTIVE" : "PERMISSIVE",
    normalizePolicySql(policy.using),
    normalizePolicySql(policy.withCheck),
  ].join("|");
}

function livePolicySignature(policy: LivePolicySnapshot): string {
  return [
    policy.command.toUpperCase(),
    policy.restrictive ? "RESTRICTIVE" : "PERMISSIVE",
    normalizePolicySql(policy.using),
    normalizePolicySql(policy.withCheck),
  ].join("|");
}

/**
 * Code-side permissiveness: `PolicySnapshot` keeps only the rendered SQL, so the flag is
 * read from the `AS RESTRICTIVE` clause the generator emits (D-008).
 */
export function isRestrictivePolicy(policy: PolicySnapshot): boolean {
  return /\bas\s+restrictive\b/i.test(policy.sql);
}

/**
 * Postgres re-renders a policy's qualifier (adds parentheses and explicit `::text`
 * casts), so raw SQL text never matches the Drizzle rendering even when the policies are
 * identical. Compare a normalized form instead: lower-case, casts removed, quotes and
 * parentheses dropped, whitespace collapsed away.
 *
 * Exported so the canonical schema digest (./schema-digest.ts) normalizes the same way
 * instead of carrying a second copy.
 */
export function normalizePolicySql(value: string | null): string {
  if (value === null) return "";
  return value
    .toLowerCase()
    .replace(
      /::(?:uuid|text|jsonb|json|integer|int4|int8|bigint|boolean|bool|numeric|date|timestamptz|timestamp(?: with(?:out)? time zone)?)\b/g,
      "",
    )
    .replace(/["'()]/g, "")
    .replace(/\s+/g, "");
}

const TYPE_ALIASES: Readonly<Record<string, string>> = {
  serial: "integer",
  serial4: "integer",
  bigserial: "bigint",
  serial8: "bigint",
  smallserial: "smallint",
  serial2: "smallint",
  int: "integer",
  int4: "integer",
  int8: "bigint",
  int2: "smallint",
  bool: "boolean",
  float4: "real",
  float8: "double precision",
  decimal: "numeric",
  bpchar: "char",
};

/**
 * Normalize both renderers onto one spelling: Drizzle says `varchar(120)`/`serial`,
 * `format_type()` says `character varying(120)`/`integer`. Without this every column
 * would look like drift.
 */
export function canonicalColumnType(value: string): string {
  const array = value.trim().endsWith("[]") ? "[]" : "";
  const bare = array === "[]" ? value.trim().slice(0, -2) : value.trim();
  const type = bare
    .toLowerCase()
    .replace(/\bcharacter varying\b/g, "varchar")
    .replace(/\bcharacter\b/g, "char")
    // Only the "without" suffix is catalog-only: Drizzle renders no-tz columns as plain
    // `timestamp`/`time`, while the catalog spells the default timezone out. Keeping
    // "with time zone" makes a tz change a real type drift.
    .replace(/\s+without\s+time zone\b/g, "")
    .replace(/\s*,\s*/g, ",");
  const base = /^([a-z][a-z0-9_]*)/.exec(type)?.[1] ?? type;
  return (TYPE_ALIASES[base] ?? base) + type.slice(base.length) + array;
}

function compareDrift(left: SchemaDrift, right: SchemaDrift): number {
  return (
    left.table.localeCompare(right.table) ||
    (left.column ?? "").localeCompare(right.column ?? "") ||
    (left.policy ?? "").localeCompare(right.policy ?? "") ||
    left.kind.localeCompare(right.kind)
  );
}
