import { createHash } from "node:crypto";

import type {
  LiveColumnSnapshot,
  LiveSchemaSnapshot,
  LivePolicySnapshot,
  LiveTableSnapshot,
} from "./live-schema.ts";
import { canonicalColumnType, isRestrictivePolicy, normalizePolicySql } from "./schema-drift.ts";
import type { ColumnSnapshot, PolicySnapshot, SchemaSnapshot, TableSnapshot } from "./snapshot.ts";

/**
 * Canonical schema digest (docs/MIGRATION-PLAN.md §3.1, ADR D-146).
 *
 * The declared snapshot (`schemaSnapshot`, from `db/schema.ts`) and the live snapshot
 * (`liveSchemaSnapshot`, from the Postgres catalogs) are projected onto one canonical
 * form and hashed. A release artifact carries these digests as `fromDigest`/`toDigest`;
 * the deploy uses them to check that the database is where the ledger says it is.
 *
 * Equality is fail-closed by construction: only the normalization described below is
 * applied, everything else is a difference, so two different schemas cannot share a
 * digest and a declared schema and the catalog it produces can.
 *
 * Digest scope v1 — the first segment of the digest string is the version:
 * - table: name, `rlsEnabled`;
 * - column: name, canonical SQL type (`canonicalColumnType`), `notNull`, canonical
 *   default (`normalizeDefault`), `isPrimaryKey`;
 * - policy: name, command upper-cased, restrictive flag, normalized USING and WITH CHECK
 *   predicates (`normalizePolicySql`, shared with `diffSchemaSnapshots`).
 *
 * NOT in v1: foreign keys, indexes, unique/check constraints, enum types, scope columns,
 * policy roles and the table's schema (framework tables live in the connection's current
 * schema, i.e. `public`). They join the projection in v2, which changes the digest string
 * prefix too, so a v1 digest is never compared with a v2 one.
 *
 * Framework bookkeeping tables never reach the projection: `liveSchemaSnapshot` filters
 * the migration tracking table and reads only the current schema, and declared snapshots
 * contain only project tables.
 */
export const SCHEMA_DIGEST_VERSION = 1;

export interface DigestColumn {
  readonly name: string;
  /** `canonicalColumnType` spelling, e.g. `varchar(120)` or `timestamp with time zone`. */
  readonly type: string;
  readonly notNull: boolean;
  /** `normalizeDefault` form; null means the column has no default. */
  readonly default: string | null;
  readonly isPrimaryKey: boolean;
}

export interface DigestPolicy {
  readonly name: string;
  /** SQL command, upper-cased: SELECT, INSERT, UPDATE, DELETE or ALL. */
  readonly command: string;
  /** RESTRICTIVE policies are AND-ed with the permissive set (D-008). */
  readonly restrictive: boolean;
  /** `normalizePolicySql` form; "" means the policy has no USING clause. */
  readonly using: string;
  /** `normalizePolicySql` form; "" means the policy has no WITH CHECK clause. */
  readonly withCheck: string;
}

export interface DigestTable {
  readonly name: string;
  readonly rlsEnabled: boolean;
  /** Sorted by name: `ordinal_position` is not part of the projection. */
  readonly columns: readonly DigestColumn[];
  /** Sorted by name. */
  readonly policies: readonly DigestPolicy[];
}

export interface DigestSchema {
  /** Projection version; part of the canonical JSON and of the digest string prefix. */
  readonly digestVersion: number;
  /** Sorted by name. */
  readonly tables: readonly DigestTable[];
}

/** Project the declared (Drizzle) snapshot onto the canonical form. */
export function declaredDigestSchema(snapshot: SchemaSnapshot): DigestSchema {
  return {
    digestVersion: SCHEMA_DIGEST_VERSION,
    tables: snapshot.tables.map(declaredDigestTable).toSorted(byName),
  };
}

/** Project the live (catalog) snapshot onto the same canonical form. */
export function liveDigestSchema(snapshot: LiveSchemaSnapshot): DigestSchema {
  return {
    digestVersion: SCHEMA_DIGEST_VERSION,
    tables: snapshot.tables.map(liveDigestTable).toSorted(byName),
  };
}

function declaredDigestTable(table: TableSnapshot): DigestTable {
  return {
    name: table.name,
    rlsEnabled: table.rlsEnabled,
    columns: table.columns.map(declaredDigestColumn).toSorted(byName),
    policies: table.policies.map(declaredDigestPolicy).toSorted(byName),
  };
}

function liveDigestTable(table: LiveTableSnapshot): DigestTable {
  return {
    name: table.name,
    rlsEnabled: table.rlsEnabled,
    columns: table.columns.map(liveDigestColumn).toSorted(byName),
    policies: table.policies.map(liveDigestPolicy).toSorted(byName),
  };
}

function declaredDigestColumn(column: ColumnSnapshot): DigestColumn {
  return {
    name: column.name,
    type: canonicalColumnType(column.type),
    notNull: column.notNull,
    default: normalizeDefault(column.default),
    isPrimaryKey: column.isPrimaryKey,
  };
}

function liveDigestColumn(column: LiveColumnSnapshot): DigestColumn {
  return {
    name: column.name,
    type: canonicalColumnType(column.type),
    notNull: column.notNull,
    default: normalizeDefault(column.default),
    isPrimaryKey: column.isPrimaryKey,
  };
}

function declaredDigestPolicy(policy: PolicySnapshot): DigestPolicy {
  return {
    name: policy.name,
    command: policy.command.toUpperCase(),
    restrictive: isRestrictivePolicy(policy),
    using: normalizePolicySql(policy.using),
    withCheck: normalizePolicySql(policy.withCheck),
  };
}

function liveDigestPolicy(policy: LivePolicySnapshot): DigestPolicy {
  return {
    name: policy.name,
    command: policy.command.toUpperCase(),
    restrictive: policy.restrictive,
    using: normalizePolicySql(policy.using),
    withCheck: normalizePolicySql(policy.withCheck),
  };
}

/**
 * Canonical JSON: object keys sorted by code unit at every level, no whitespace, arrays in
 * the order the projection produced (already sorted by their semantic key).
 */
export function canonicalDigestJson(schema: DigestSchema): string {
  return JSON.stringify(sortKeys(schema));
}

/**
 * sha256 of the canonical form, spelled `v<version>:sha256:<64 lowercase hex>`. The
 * version prefix is part of the value on purpose: a digest computed under a different
 * projection must not compare equal to this one.
 */
export function digestSchema(schema: DigestSchema): string {
  const hash = createHash("sha256").update(canonicalDigestJson(schema), "utf8").digest("hex");
  return `v${schema.digestVersion}:sha256:${hash}`;
}

/**
 * Code-unit comparison, not `localeCompare`: the digest must not depend on the ICU locale
 * of the machine (or browser) that computes it.
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return compareText(left.name, right.name);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .toSorted(compareText)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** A cast suffix: the column type is already part of the projection, so casts are noise. */
const TYPE_CAST = /::[a-z][a-z_ ]*(?:\([0-9, ]*\))?(?:\[\])?/g;
/** Single-quoted SQL literal, including the doubled-quote escape (`''`). */
const STRING_LITERAL = /'(?:[^']|'')*'/g;

/**
 * Normalize a column default onto the spelling both renderers agree on.
 *
 * Drizzle (`schemaSnapshot`) renders `'untitled'`, `false`, `now()`; `pg_get_expr`
 * (`liveSchemaSnapshot`) renders `'untitled'::text`, `false`, `now()`. The differences
 * are catalog-only noise: explicit casts, keyword case, redundant parentheses and
 * whitespace. String-literal bodies are preserved verbatim, so `'Draft'` and `'draft'`
 * stay different defaults (guessed normalization here would turn drift into a digest
 * match). `CURRENT_TIMESTAMP` is folded onto `now` because Postgres stores both as
 * `now()`.
 *
 * NOT normalized (documented v1 limitations): JSON object/array defaults (`{}` vs
 * `'{}'::jsonb`), date values rendered as full ISO timestamps by Drizzle, array defaults
 * and sequences of `serial` columns. P2's renderer owns producing catalog-compatible
 * defaults; until then such a column is a digest difference, never a false match.
 */
export function normalizeDefault(value: string | null): string | null {
  if (value === null) return null;
  let normalized = "";
  let cursor = 0;
  for (const match of value.matchAll(STRING_LITERAL)) {
    const start = match.index ?? 0;
    normalized += normalizeDefaultFragment(value.slice(cursor, start));
    normalized += match[0];
    cursor = start + match[0].length;
  }
  normalized += normalizeDefaultFragment(value.slice(cursor));
  return normalized;
}

function normalizeDefaultFragment(fragment: string): string {
  return fragment
    .toLowerCase()
    .replace(TYPE_CAST, "")
    .replace(/[()]/g, "")
    .replace(/\bcurrent_timestamp\b/g, "now")
    .replace(/\s+/g, "");
}
