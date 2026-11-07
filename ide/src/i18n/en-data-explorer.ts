// The Data Explorer strings (SPEC §11.1), spread into `en` in en.ts.
//
// The catalogue sits at the 300-line limit, so this feature block lives in its own module
// instead of growing en.ts — same rule as en-git-remote.ts. Keys stay flat.
export const dataExplorerEn = {
  "activity.data": "Data",

  "dataExplorer.title": "Data Explorer",
  "dataExplorer.refresh": "Refresh schema",
  "dataExplorer.retry": "Try again",
  "dataExplorer.unreachable": "Project not reachable",
  "dataExplorer.unreachableHint": "Run the project to introspect its live database.",
  "dataExplorer.loading": "Reading the live schema…",
  "dataExplorer.dbUnavailable": "The database is not available. Check the project's boot warnings.",
  "dataExplorer.error": "Could not read the schema: {error}",

  "dataExplorer.inSync": "Code and database are in sync",
  "dataExplorer.driftCount": "{count} drift(s) between code and database",
  "dataExplorer.driftHint": "Run the project's migrations to close the gap.",
  "dataExplorer.noTables": "No tables declared in db/schema.ts and none in the database.",
  "dataExplorer.notInCode": "This table exists only in the database.",
  "dataExplorer.noUsage": "No route uses this table",
  "dataExplorer.usedBy": "Used by {count} route(s)",
  "dataExplorer.openTable": "Open db/schema.ts",
  "dataExplorer.openRoute": "Open {route}",
  "dataExplorer.pk": "Primary key",
  "dataExplorer.nullable": "Nullable",
  "dataExplorer.default": "Default {value}",

  "dataExplorer.rls.policy": "RLS + policy",
  "dataExplorer.rls.rls_without_policy": "RLS on, no policy",
  "dataExplorer.rls.rls_off_scoped": "RLS off on scoped table",
  "dataExplorer.rls.rls_off": "RLS off",
  "dataExplorer.rls.missing": "Not in database",

  "dataExplorer.drift.table_missing": "Table {table} is in code but not in the database",
  "dataExplorer.drift.table_extra": "Table {table} is in the database but not in code",
  "dataExplorer.drift.column_missing": "Column {table}.{column} is in code but not in the database",
  "dataExplorer.drift.column_extra": "Column {table}.{column} is in the database but not in code",
  "dataExplorer.drift.column_type":
    "Column {table}.{column}: code says {expected}, database says {actual}",
  "dataExplorer.drift.column_nullability":
    "Column {table}.{column}: code says {expected}, database says {actual}",
  "dataExplorer.drift.rls_disabled": "RLS is off on the scoped table {table}",
  "dataExplorer.drift.policy_missing": "Policy {policy} is missing from {table}",
  "dataExplorer.drift.policy_extra": "Policy {policy} exists on {table} but not in code",
  "dataExplorer.drift.policy_changed": "Policy {policy} on {table} differs from code",
} as const;
