import type { SourceRef, UnknownFact } from "./types.ts";

/**
 * Schema facts (the 300-line split of types.ts).
 *
 * A fact that cannot be determined is represented explicitly (null, an `unknown` entry, or
 * `unsupported`), never as an empty value: an unreadable index is not "no index", and a
 * policy whose SQL cannot be read is not "no USING clause".
 */

export type ColumnDefaultKind = "literal" | "now" | "random" | "unknown";

export interface ColumnDefaultFact {
  readonly kind: ColumnDefaultKind;
  readonly value: string | null;
}

export interface ForeignKeyFact {
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
  readonly source: SourceRef;
}

export interface ColumnFact {
  /** Drizzle property key in the table object (the dbColumns domain). */
  readonly property: string;
  /** SQL column name (first literal argument of the builder, or the property key). */
  readonly name: string;
  readonly builder: string;
  /** Display type derived from the builder and its arguments. */
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly default: ColumnDefaultFact | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export interface PolicyFact {
  readonly name: string;
  readonly command: PolicyCommand;
  readonly restrictive: boolean;
  /**
   * Static SQL of the policy predicate, or null. Null means "no clause OR not readable":
   * the paired `unknown` entry is what tells the two apart (fail closed, never empty).
   */
  readonly using: string | null;
  readonly withCheck: string | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/**
 * A module-level `pgEnum("name", [...]) {}` declaration. Empty `values` always comes with
 * an `unknown` entry: an enum with no values is otherwise indistinguishable from an
 * unreadable one.
 */
export interface EnumFact {
  readonly name: string;
  readonly values: readonly string[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/**
 * Index declaration from the pgTable extras callback.
 *
 * `columns` are Drizzle property keys (the dbColumns domain, like `TableFact.primaryKey`);
 * `expression` is SQL. A shape the snapshot cannot represent (partial, non-btree, mixed or
 * multi-expression, column order/opclass modifiers) is never flattened: `unsupported`
 * carries the reason and both `columns` and `expression` stay empty.
 */
export interface IndexFact {
  readonly name: string;
  readonly columns: readonly string[];
  readonly expression: string | null;
  readonly unique: boolean;
  readonly unsupported: string | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface CheckFact {
  readonly name: string;
  /** SQL of the check expression, or null with an `unknown` entry when not static. */
  readonly expression: string | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/** A table-level `unique()`; `columns` are Drizzle property keys, like `IndexFact.columns`. */
export interface UniqueConstraintFact {
  readonly name: string;
  readonly columns: readonly string[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/** A declaration the snapshot cannot read faithfully (D-158: fail the release, never drop it). */
export interface UnsupportedDeclarationFact {
  readonly construct: "index" | "foreign_key" | "check" | "unique" | "policy";
  readonly name: string;
}

export interface ScopeFact {
  readonly column: string;
  readonly kind: "tenant" | "owner";
}

export interface TableFact {
  readonly name: string;
  /** TypeScript binding holding the table, when declared as a const. */
  readonly binding: string | null;
  readonly columns: readonly ColumnFact[];
  /** Drizzle property keys of the primary key, in order. */
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeyFact[];
  readonly indexes: readonly IndexFact[];
  readonly checks: readonly CheckFact[];
  readonly uniqueConstraints: readonly UniqueConstraintFact[];
  /** Index/foreign-key declarations that are readable but not representable in a snapshot. */
  readonly unsupported: readonly UnsupportedDeclarationFact[];
  readonly policies: readonly PolicyFact[];
  readonly rlsEnabled: boolean;
  /** Explicit `// system-only` marker on the declaration (D-211). False when absent or
   * unreadable; an unreadable marker carries a `schema-marker` unknown entry, never a guess. */
  readonly systemOnly: boolean;
  readonly scope: ScopeFact | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface RelationFact {
  readonly from: string;
  readonly to: string;
  readonly cardinality: "one" | "many";
  readonly fields: readonly string[];
  readonly references: readonly string[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}
