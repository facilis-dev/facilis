// Codegen for a reusable view created from the Data Explorer query console (D-097).
//
// One view is one project file (`db/views/<name>.ts`, no barrel): `defineView` keeps the SQL
// in the schema layer. Without a permission the framework creates it
// `WITH (security_invoker = true)`, so it runs with the base tables' RLS; with a permission it
// is a definer view (D-098) gated by that permission instead. The mapping from the query's
// Postgres column types to Drizzle builders is the contract of this file, so the generated
// schema matches what the query returned.

export interface ViewColumnInput {
  name: string;
  pgType: string;
}

export interface ViewSourceInput {
  name: string;
  columns: readonly ViewColumnInput[];
  query: string;
  /** A declared permission turns the view into a definer view (D-098). */
  permission?: string;
}

export interface ViewSource {
  path: string;
  contents: string;
  exportName: string;
}

export type ViewValidationCode = "invalid_name" | "invalid_permission" | "invalid_columns";

/** The contract's name rule: lowercase, starts with a letter, at most 63 characters. */
export const VIEW_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
/** Declared permission identifiers (SPEC §8.4.1): lowercase namespaced names. */
export const VIEW_PERMISSION_PATTERN = /^[a-z][a-z0-9:_-]{0,63}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isValidViewName(name: string): boolean {
  return VIEW_NAME_PATTERN.test(name);
}

export function isValidViewPermission(permission: string): boolean {
  return VIEW_PERMISSION_PATTERN.test(permission);
}

function normalizePermission(permission: string | undefined): string | undefined {
  return permission === undefined || permission.length === 0 ? undefined : permission;
}

export function validateViewColumns(
  columns: readonly ViewColumnInput[],
): ViewValidationCode | null {
  if (columns.length === 0) return "invalid_columns";
  const seen = new Set<string>();
  for (const column of columns) {
    if (!IDENTIFIER_PATTERN.test(column.name)) return "invalid_columns";
    if (seen.has(column.name)) return "invalid_columns";
    seen.add(column.name);
  }
  return null;
}

export function validateViewSourceInput(input: ViewSourceInput): ViewValidationCode | null {
  if (!isValidViewName(input.name)) return "invalid_name";
  const permission = normalizePermission(input.permission);
  if (permission !== undefined && !isValidViewPermission(permission)) return "invalid_permission";
  return validateViewColumns(input.columns);
}

/** `active_todos` -> `active-todos`, the view file's kebab-case stem. */
export function viewSlug(name: string): string {
  return name.replace(/_/g, "-");
}

/** `active_todos` -> `activeTodos`. */
export function viewExportName(name: string): string {
  const parts = name.split("_").filter((part) => part.length > 0);
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

interface PgBuilder {
  readonly importName: string;
  readonly expression: string;
}

const TEXT_LIKE = new Set(["text", "varchar", "bpchar", "char", "name", "citext"]);
const BUILDERS: Record<string, PgBuilder> = {
  bool: { importName: "boolean", expression: "boolean()" },
  boolean: { importName: "boolean", expression: "boolean()" },
  uuid: { importName: "uuid", expression: "uuid()" },
  int2: { importName: "smallint", expression: "smallint()" },
  smallint: { importName: "smallint", expression: "smallint()" },
  int4: { importName: "integer", expression: "integer()" },
  integer: { importName: "integer", expression: "integer()" },
  int8: { importName: "bigint", expression: 'bigint({ mode: "string" })' },
  bigint: { importName: "bigint", expression: 'bigint({ mode: "string" })' },
  numeric: { importName: "numeric", expression: "numeric()" },
  decimal: { importName: "numeric", expression: "numeric()" },
  float4: { importName: "real", expression: "real()" },
  real: { importName: "real", expression: "real()" },
  float8: { importName: "doublePrecision", expression: "doublePrecision()" },
  timestamptz: {
    importName: "timestamp",
    expression: 'timestamp({ withTimezone: true, mode: "string" })',
  },
  timestamp: {
    importName: "timestamp",
    expression: 'timestamp({ withTimezone: false, mode: "string" })',
  },
  date: { importName: "date", expression: 'date({ mode: "string" })' },
  time: { importName: "time", expression: "time()" },
  timetz: { importName: "time", expression: "time()" },
  interval: { importName: "interval", expression: "interval()" },
  json: { importName: "json", expression: "json()" },
  jsonb: { importName: "jsonb", expression: "jsonb()" },
};

/** Strip a length/precision suffix (`varchar(120)`, `numeric(10, 2)`) before mapping. */
function normalizePgType(pgType: string): string {
  return pgType.trim().toLowerCase().replace(/\(.*$/, "").trim();
}

function builderFor(pgType: string): PgBuilder {
  const normalized = normalizePgType(pgType);
  if (TEXT_LIKE.has(normalized)) return { importName: "text", expression: "text()" };
  return BUILDERS[normalized] ?? { importName: "text", expression: "text()" };
}

/** Escape what would otherwise close the generated template literal. */
function escapeTemplateLiteral(sql: string): string {
  return sql.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function stripTrailing(sql: string): string {
  return sql.trim().replace(/[;\s]+$/, "");
}

export function buildViewSource(input: ViewSourceInput): ViewSource {
  const validation = validateViewSourceInput(input);
  if (validation !== null) throw new Error(validation);

  const builders = input.columns.map((column) => builderFor(column.pgType));
  const imported = [...new Set(builders.map((builder) => builder.importName))].toSorted(
    (left, right) => left.localeCompare(right),
  );
  const exportName = viewExportName(input.name);
  const permission = normalizePermission(input.permission);
  const queryLines = escapeTemplateLiteral(stripTrailing(input.query))
    .split("\n")
    .map((line) => (line.length === 0 ? "" : "    " + line))
    .join("\n");
  const columnLines = input.columns
    .map((column, index) => "    " + column.name + ": " + builders[index]?.expression + ",")
    .join("\n");
  const commentLines =
    permission === undefined
      ? [
          "// " + input.name + " — created from the Data Explorer query console (D-097).",
          "// Views run with the permissions (RLS) of the tables they select (security_invoker).",
        ]
      : [
          "// " + input.name + " — created from the Data Explorer query console (D-097).",
          '// Permission view (D-098): runs with the "' +
            permission +
            '" permission as a definer view;',
          "// the underlying tables' RLS does not apply.",
        ];
  const permissionLine = permission === undefined ? [] : ['  permission: "' + permission + '",'];
  const contents = [
    ...commentLines,
    'import { sql } from "drizzle-orm";',
    'import { defineView } from "@facilis.dev/db";',
    "import { " + imported.join(", ") + ' } from "drizzle-orm/pg-core";',
    "",
    "export const " + exportName + " = defineView({",
    '  name: "' + input.name + '",',
    ...permissionLine,
    "  columns: {",
    columnLines,
    "  },",
    "  query: sql`",
    queryLines,
    "  `,",
    "});",
    "",
  ].join("\n");
  return { path: "db/views/" + viewSlug(input.name) + ".ts", contents, exportName };
}
