// Mapping from the analyzer's schema facts to the runtime SchemaSnapshot contract (SPEC §7.3).
//
// The Release Preview computes a schema plan without a database and without booting the
// project, from the AST analyzer's facts (D-086/D-094). The analyzer's model is flat and
// source-oriented, while the plan consumes the snapshot the runtime derives from Drizzle, so
// this module is the only bridge between them. A construct the analyzer cannot read must
// surface as `unsupported`, never as an empty value: `planSchema` fails the release closed on
// those (D-158).

import type {
  CheckSnapshot,
  ColumnSnapshot,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  PolicySnapshot,
  SchemaSnapshot,
  TableSnapshot,
  UniqueConstraintSnapshot,
  UnsupportedDeclarationSnapshot,
} from "@facilis.dev/db";
import type {
  Analysis,
  ColumnFact,
  EnumFact,
  ForeignKeyFact,
  IndexFact,
  PolicyFact,
  TableFact,
  UniqueConstraintFact,
} from "./types.ts";

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Mirrors `policyCreateSql` in @facilis.dev/db, so a plan renders the same statement. */
function policySql(table: string, policy: PolicyFact): string {
  const parts = [`CREATE POLICY ${quoteIdentifier(policy.name)} ON ${quoteIdentifier(table)}`];
  if (policy.restrictive) parts.push("AS RESTRICTIVE");
  parts.push(`FOR ${policy.command}`);
  if (policy.using !== null) parts.push(`USING (${policy.using})`);
  if (policy.withCheck !== null) parts.push(`WITH CHECK (${policy.withCheck})`);
  return `${parts.join(" ")};`;
}

function columnDefault(column: ColumnFact): string | null {
  const value = column.default;
  if (value === null) return null;
  if (value.kind === "literal") return value.value;
  if (value.kind === "now") return "now()";
  if (value.kind === "random") return "gen_random_uuid()";
  // An unreadable default must not become "no default": the plan would emit a column the
  // declaration does not have. Null is the only faithful value the snapshot can carry, and
  // the column keeps its unknown facts for the caller.
  return null;
}

function columnSnapshot(column: ColumnFact, primaryKey: ReadonlySet<string>): ColumnSnapshot {
  return {
    name: column.name,
    type: column.type,
    notNull: column.notNull,
    default: columnDefault(column),
    // A composite (table-level) PK marks its members even though they carry no .primaryKey(),
    // mirroring the runtime's column.primary || primaryKey.includes(column.name).
    isPrimaryKey: column.primaryKey || primaryKey.has(column.property),
    isUnique: column.unique,
  };
}

type ReferentialAction = NonNullable<ForeignKeySnapshot["onDelete"]>;

function referentialAction(raw: string | null): ReferentialAction | undefined {
  if (raw === null) return undefined;
  const normalized = raw.toLowerCase().replaceAll("_", " ");
  if (normalized === "cascade" || normalized === "set null" || normalized === "restrict") {
    return normalized;
  }
  return normalized === "no action" ? "no action" : undefined;
}

function foreignKeySnapshot(foreignKey: ForeignKeyFact): ForeignKeySnapshot {
  const onDelete = referentialAction(foreignKey.onDelete);
  const onUpdate = referentialAction(foreignKey.onUpdate);
  return {
    columns: [...foreignKey.columns],
    targetTable: foreignKey.targetTable,
    targetColumns: [...foreignKey.targetColumns],
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  };
}

/**
 * Index and constraint facts name Drizzle properties; the snapshot names SQL columns. The
 * table's own column facts are the only mapping between the two domains.
 */
function sqlNames(table: TableFact, properties: readonly string[]): string[] {
  const names = new Map(table.columns.map((column) => [column.property, column.name]));
  return properties.map((property) => names.get(property) ?? property);
}

function indexSnapshot(index: IndexFact): IndexSnapshot | null {
  if (index.unsupported !== null) return null;
  return {
    name: index.name,
    columns: [...index.columns],
    unique: index.unique,
    ...(index.expression === null ? {} : { expression: index.expression }),
  };
}

function uniqueSnapshot(unique: UniqueConstraintFact): UniqueConstraintSnapshot {
  return { name: unique.name, columns: [...unique.columns] };
}

function policySnapshot(table: string, policy: PolicyFact): PolicySnapshot {
  return {
    name: policy.name,
    command: policy.command,
    using: policy.using,
    withCheck: policy.withCheck,
    sql: policySql(table, policy),
  };
}

function tableSnapshot(table: TableFact): TableSnapshot {
  const unsupported: UnsupportedDeclarationSnapshot[] = [];
  const seen = new Set<string>();
  // The analyzer already reports every unreadable declaration; the mapper re-adds the ones
  // the snapshot cannot express. Deduplicating keeps one problem per declaration.
  const failClosed = (entry: UnsupportedDeclarationSnapshot): void => {
    const token = entry.construct + ":" + entry.name;
    if (seen.has(token)) return;
    seen.add(token);
    unsupported.push(entry);
  };
  for (const entry of table.unsupported) {
    failClosed({ construct: entry.construct, name: entry.name });
  }
  const indexes = table.indexes.flatMap((index) => {
    const snapshot = indexSnapshot(index);
    if (snapshot !== null) return [snapshot];
    failClosed({ construct: "index", name: index.name });
    return [];
  });
  const checks: CheckSnapshot[] = table.checks.flatMap((check) => {
    if (check.expression !== null) return [{ name: check.name, expression: check.expression }];
    // A check whose SQL the analyzer could not render must fail the plan, not disappear.
    failClosed({ construct: "check", name: check.name });
    return [];
  });
  const primaryKey = new Set(table.primaryKey);
  return {
    name: table.name,
    rlsEnabled: table.rlsEnabled,
    columns: table.columns.map((column) => columnSnapshot(column, primaryKey)),
    foreignKeys: table.foreignKeys.map(foreignKeySnapshot),
    policies: table.policies.map((policy) => {
      // An unreadable policy predicate must fail the plan closed; a null USING with no
      // unknown fact is a legitimate "no clause" and stays as is.
      if (policy.unknown.length > 0) failClosed({ construct: "policy", name: policy.name });
      return policySnapshot(table.name, policy);
    }),
    ...(table.scope === null
      ? {}
      : {
          scopeColumn: {
            name: sqlNames(table, [table.scope.column])[0] ?? table.scope.column,
            kind: table.scope.kind,
          },
        }),
    primaryKey: sqlNames(table, table.primaryKey),
    indexes,
    checks,
    uniqueConstraints: table.uniqueConstraints.flatMap((unique) => {
      if (unique.columns.length === 0) {
        failClosed({ construct: "unique", name: unique.name });
        return [];
      }
      return [uniqueSnapshot(unique)];
    }),
    unsupported,
  };
}

function enumSnapshot(fact: EnumFact): EnumSnapshot {
  return { name: fact.name, values: [...fact.values] };
}

/** Enum types a column actually references; the runtime snapshot only carries those. */
function referencedEnumNames(tables: readonly TableSnapshot[]): Set<string> {
  const names = new Set<string>();
  for (const table of tables) {
    for (const column of table.columns) names.add(column.type.replace(/\[\]$/, ""));
  }
  return names;
}

/**
 * The declared schema at one ref, in the shape `planSchema` consumes. Tables and enums are
 * ordered by name so two refs compare deterministically.
 */
export function schemaSnapshotFromAnalysis(analysis: Analysis): SchemaSnapshot {
  const tables = analysis.tables
    .map(tableSnapshot)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  // The analyzer reports every declared enum; the runtime snapshot only carries the ones a
  // column references, so filter to those to keep the two projections identical.
  const referenced = referencedEnumNames(tables);
  return {
    tables,
    enums: analysis.enums
      .filter((fact) => referenced.has(fact.name))
      .map(enumSnapshot)
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}
