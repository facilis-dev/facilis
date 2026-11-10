import type {
  CheckSnapshot,
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  PolicySnapshot,
  TableSnapshot,
  UniqueConstraintSnapshot,
} from "@facilis/db";

/**
 * SQL rendering for the planned batches, ported from the orphaned D-109 renderer
 * (ide/src/ai/migration-sql.ts): identifiers are always double-quoted, defaults arrive as
 * SQL text from the snapshot, and constraint names are derived from the declaration so the
 * ADD and the DROP of the same constraint always use the same name (the snapshots do not
 * carry a database-generated name for foreign keys).
 */

export function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Single-quoted SQL literal, used for enum values. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Constraint names are derived, never read from the database: see the module note. */
export function primaryKeyName(table: string, columns: readonly string[]): string {
  return `pk__${table}__${columns.join("_")}`;
}

export function foreignKeyName(table: string, foreignKey: ForeignKeySnapshot): string {
  return `fk__${table}__${foreignKey.columns.join("_")}__${foreignKey.targetTable}__${foreignKey.targetColumns.join("_")}`;
}

export function uniqueName(table: string, columns: readonly string[]): string {
  return `uniq__${table}__${columns.join("_")}`;
}

export function foreignKeySignature(foreignKey: ForeignKeySnapshot): string {
  return JSON.stringify([
    foreignKey.columns,
    foreignKey.targetTable,
    foreignKey.targetColumns,
    foreignKey.onDelete ?? "no action",
    foreignKey.onUpdate ?? "no action",
  ]);
}

export function columnDefinition(column: ColumnSnapshot): string {
  const parts = [quote(column.name), column.type];
  if (column.default !== null) parts.push(`DEFAULT ${column.default}`);
  if (column.notNull) parts.push("NOT NULL");
  return parts.join(" ");
}

/** CREATE TABLE carries the columns plus the constraints that do not reference other tables. */
export function createTableSql(table: TableSnapshot): string {
  const lines = table.columns.map(columnDefinition);
  const primaryKey = table.primaryKey ?? [];
  if (primaryKey.length > 0) {
    lines.push(
      `CONSTRAINT ${quote(primaryKeyName(table.name, primaryKey))} PRIMARY KEY (${primaryKey
        .map(quote)
        .join(", ")})`,
    );
  }
  for (const column of table.columns) {
    if (!column.isUnique) continue;
    lines.push(
      `CONSTRAINT ${quote(uniqueName(table.name, [column.name]))} UNIQUE (${quote(column.name)})`,
    );
  }
  for (const unique of sortedUniqueConstraints(table.uniqueConstraints)) {
    lines.push(
      `CONSTRAINT ${quote(unique.name)} UNIQUE (${unique.columns.map(quote).join(", ")})`,
    );
  }
  for (const check of sortedChecks(table.checks)) {
    lines.push(`CONSTRAINT ${quote(check.name)} CHECK (${check.expression})`);
  }
  return `CREATE TABLE ${quote(table.name)} (\n  ${lines.join(",\n  ")}\n);`;
}

export function addColumnSql(table: string, column: ColumnSnapshot): string {
  return `ALTER TABLE ${quote(table)} ADD COLUMN ${columnDefinition(column)};`;
}

export function alterColumnTypeSql(table: string, column: string, type: string): string {
  // Always cast explicitly: without USING, Postgres refuses text -> uuid and other useful
  // conversions; the destructive risk is already on the batch, and a bad cast fails loudly.
  return `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} TYPE ${type} USING ${quote(column)}::${type};`;
}

export function setDefaultSql(table: string, column: string, value: string): string {
  return `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} SET DEFAULT ${value};`;
}

export function dropDefaultSql(table: string, column: string): string {
  return `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} DROP DEFAULT;`;
}

export function setNotNullSql(table: string, column: string): string {
  return `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} SET NOT NULL;`;
}

export function dropNotNullSql(table: string, column: string): string {
  return `ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column)} DROP NOT NULL;`;
}

export function addForeignKeySql(table: string, foreignKey: ForeignKeySnapshot): string {
  return (
    `ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(foreignKeyName(table, foreignKey))} ` +
    `FOREIGN KEY (${foreignKey.columns.map(quote).join(", ")}) REFERENCES ` +
    `${quote(foreignKey.targetTable)} (${foreignKey.targetColumns.map(quote).join(", ")}) ` +
    `ON DELETE ${actionSql(foreignKey.onDelete)} ON UPDATE ${actionSql(foreignKey.onUpdate)};`
  );
}

export function addUniqueConstraintSql(
  table: string,
  unique: UniqueConstraintSnapshot,
): string {
  return `ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(unique.name)} UNIQUE (${unique.columns
    .map(quote)
    .join(", ")});`;
}

export function addColumnUniqueSql(table: string, column: string): string {
  return `ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(uniqueName(table, [column]))} UNIQUE (${quote(column)});`;
}

export function addCheckSql(table: string, check: CheckSnapshot): string {
  return `ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(check.name)} CHECK (${check.expression});`;
}

export function dropConstraintSql(table: string, name: string): string {
  return `ALTER TABLE ${quote(table)} DROP CONSTRAINT ${quote(name)};`;
}

export function dropPolicySql(table: string, policyName: string): string {
  return `DROP POLICY IF EXISTS ${quote(policyName)} ON ${quote(table)};`;
}

/** The declared snapshot already carries the complete CREATE POLICY statement. */
export function createPolicySql(policy: PolicySnapshot): string {
  return policy.sql;
}

export function enableRlsSql(table: string): string {
  return `ALTER TABLE ${quote(table)} ENABLE ROW LEVEL SECURITY;`;
}

export function disableRlsSql(table: string): string {
  return `ALTER TABLE ${quote(table)} DISABLE ROW LEVEL SECURITY;`;
}

export function createIndexSql(table: string, index: IndexSnapshot): string {
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(index.name)} ON ${quote(table)} (${index.columns
    .map(quote)
    .join(", ")});`;
}

export function dropIndexSql(name: string): string {
  return `DROP INDEX ${quote(name)};`;
}

export function dropColumnSql(table: string, column: string): string {
  return `ALTER TABLE ${quote(table)} DROP COLUMN ${quote(column)};`;
}

export function dropTableSql(table: string): string {
  return `DROP TABLE ${quote(table)};`;
}

/** True when two policies render the same SQL: the declared snapshots are comparable verbatim. */
export function samePolicy(left: PolicySnapshot, right: PolicySnapshot): boolean {
  return left.sql === right.sql;
}

function actionSql(action: ForeignKeySnapshot["onDelete"]): string {
  return (action ?? "no action").toUpperCase();
}

export function sortedUniqueConstraints(
  constraints: readonly UniqueConstraintSnapshot[] | undefined,
): UniqueConstraintSnapshot[] {
  return [...(constraints ?? [])].toSorted((left, right) => compareText(left.name, right.name));
}

export function sortedChecks(checks: readonly CheckSnapshot[] | undefined): CheckSnapshot[] {
  return [...(checks ?? [])].toSorted((left, right) => compareText(left.name, right.name));
}

export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameIndex(left: IndexSnapshot, right: IndexSnapshot): boolean {
  return left.unique === right.unique && sameStringArray(left.columns, right.columns);
}

export function sortedForeignKeys(list: readonly ForeignKeySnapshot[]): ForeignKeySnapshot[] {
  return [...list].toSorted((left, right) =>
    compareText(foreignKeySignature(left), foreignKeySignature(right)),
  );
}

export function sortedPolicies(list: readonly PolicySnapshot[]): PolicySnapshot[] {
  return [...list].toSorted((left, right) => compareText(left.name, right.name));
}

export function sortedIndexes(list: readonly IndexSnapshot[] | undefined): IndexSnapshot[] {
  return [...(list ?? [])].toSorted((left, right) => compareText(left.name, right.name));
}
