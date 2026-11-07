import type { ColumnFact, ConfigFacts, ScopeFact } from "../types.ts";

export interface ScopedColumn {
  readonly column: ColumnFact;
  readonly tenant: boolean;
}

function normalized(value: string): string {
  return value.replaceAll("_", "").replaceAll("-", "").toLowerCase();
}

function matchesConfig(column: ColumnFact, names: readonly string[]): boolean {
  const property = normalized(column.property);
  const sqlName = normalized(column.name);
  return names.some((candidate) => {
    const value = normalized(candidate);
    return value === property || value === sqlName;
  });
}

/** Tenant scope wins over owner scope: both can be declared on the same table. */
export function scopeOf(columns: readonly ScopedColumn[], config: ConfigFacts): ScopeFact | null {
  const tenant =
    columns.find((entry) => entry.tenant) ??
    columns.find((entry) => matchesConfig(entry.column, config.tenantColumns));
  if (tenant !== undefined) return { column: tenant.column.property, kind: "tenant" };
  const owner = columns.find((entry) => matchesConfig(entry.column, config.ownerColumns));
  return owner === undefined ? null : { column: owner.column.property, kind: "owner" };
}
