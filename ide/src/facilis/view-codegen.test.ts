import { describe, expect, it } from "vitest";
import {
  buildViewSource,
  isValidViewName,
  isValidViewPermission,
  validateViewColumns,
  validateViewSourceInput,
  viewExportName,
  viewSlug,
  type ViewColumnInput,
} from "./view-codegen";

const columns: ViewColumnInput[] = [
  { name: "id", pgType: "uuid" },
  { name: "title", pgType: "varchar(120)" },
  { name: "done", pgType: "bool" },
  { name: "createdAt", pgType: "timestamptz" },
];

describe("buildViewSource", () => {
  it("generates the one-file defineView module", () => {
    const source = buildViewSource({
      name: "active_todos",
      columns,
      query: "select id, title, done from todos where done = false;",
    });
    expect(source.path).toBe("db/views/active-todos.ts");
    expect(source.exportName).toBe("activeTodos");
    expect(source.contents).toBe(
      [
        "// active_todos — created from the Data Explorer query console (D-097).",
        "// Views run with the permissions (RLS) of the tables they select (security_invoker).",
        'import { sql } from "drizzle-orm";',
        'import { defineView } from "@facilis/db";',
        'import { boolean, text, timestamp, uuid } from "drizzle-orm/pg-core";',
        "",
        "export const activeTodos = defineView({",
        '  name: "active_todos",',
        "  columns: {",
        "    id: uuid(),",
        "    title: text(),",
        "    done: boolean(),",
        '    createdAt: timestamp({ withTimezone: true, mode: "string" }),',
        "  },",
        "  query: sql\x60",
        "    select id, title, done from todos where done = false",
        "  \x60,",
        "});",
        "",
      ].join("\n"),
    );
  });

  it("adds the permission line and definer comment when a permission is chosen", () => {
    const source = buildViewSource({
      name: "active_todos",
      columns: [{ name: "id", pgType: "uuid" }],
      query: "select id from todos",
      permission: "stats:read",
    });
    expect(source.contents).toBe(
      [
        "// active_todos — created from the Data Explorer query console (D-097).",
        '// Permission view (D-098): runs with the "stats:read" permission as a definer view;',
        "// the underlying tables' RLS does not apply.",
        'import { sql } from "drizzle-orm";',
        'import { defineView } from "@facilis/db";',
        'import { uuid } from "drizzle-orm/pg-core";',
        "",
        "export const activeTodos = defineView({",
        '  name: "active_todos",',
        '  permission: "stats:read",',
        "  columns: {",
        "    id: uuid(),",
        "  },",
        "  query: sql\x60",
        "    select id from todos",
        "  \x60,",
        "});",
        "",
      ].join("\n"),
    );
  });

  it("treats an empty permission as the invoker form", () => {
    const invoker = buildViewSource({ name: "plain", columns, query: "select 1" });
    const empty = buildViewSource({ name: "plain", columns, query: "select 1", permission: "" });
    expect(empty).toEqual(invoker);
  });

  it("maps the contract's pg types and falls back to text", () => {
    const cases: [string, string, string][] = [
      ["int2", "smallint", "smallint()"],
      ["int4", "integer", "integer()"],
      ["int8", "bigint", 'bigint({ mode: "string" })'],
      ["numeric(10, 2)", "numeric", "numeric()"],
      ["decimal", "numeric", "numeric()"],
      ["float4", "real", "real()"],
      ["float8", "doublePrecision", "doublePrecision()"],
      ["timestamp(3)", "timestamp", 'timestamp({ withTimezone: false, mode: "string" })'],
      ["date", "date", 'date({ mode: "string" })'],
      ["time", "time", "time()"],
      ["timetz", "time", "time()"],
      ["interval", "interval", "interval()"],
      ["json", "json", "json()"],
      ["jsonb", "jsonb", "jsonb()"],
      ["geography", "text", "text()"],
    ];
    for (const [pgType, importName, expression] of cases) {
      const source = buildViewSource({
        name: "typed",
        columns: [{ name: "value", pgType }],
        query: "select value from t",
      });
      expect(source.contents, pgType).toContain(
        "import { " + importName + ' } from "drizzle-orm/pg-core";',
      );
      expect(source.contents, pgType).toContain("    value: " + expression + ",");
    }
  });

  it("dedupes builder imports and sorts them", () => {
    const source = buildViewSource({
      name: "many",
      columns: [
        { name: "a", pgType: "varchar" },
        { name: "b", pgType: "text" },
        { name: "c", pgType: "uuid" },
        { name: "d", pgType: "bool" },
        { name: "e", pgType: "boolean" },
      ],
      query: "select 1",
    });
    expect(source.contents).toContain('import { boolean, text, uuid } from "drizzle-orm/pg-core";');
  });

  it("escapes backticks and interpolation and strips trailing semicolons", () => {
    const query = "select \x60x\x60, '\x24{secret}' from t ;  \n";
    const source = buildViewSource({
      name: "escaped",
      columns: [{ name: "value", pgType: "text" }],
      query,
    });
    expect(source.contents).toContain("    select \x5c\x60x\x5c\x60, '\x5c\x24{secret}' from t");
    expect(source.contents.endsWith("  \x60,\n});\n")).toBe(true);
  });

  it("is deterministic and does not mutate the input", () => {
    const input = { name: "stable", columns, query: "select 1" };
    expect(buildViewSource(input)).toEqual(buildViewSource(input));
    expect(input.columns).toHaveLength(4);
  });

  it("throws on an invalid name or columns", () => {
    expect(() => buildViewSource({ name: "Active", columns, query: "select 1" })).toThrow(
      "invalid_name",
    );
    expect(() => buildViewSource({ name: "1active", columns, query: "select 1" })).toThrow(
      "invalid_name",
    );
    expect(() => buildViewSource({ name: "active", columns: [], query: "select 1" })).toThrow(
      "invalid_columns",
    );
    expect(() =>
      buildViewSource({ name: "active", columns: [{ name: "a-b", pgType: "text" }], query: "x" }),
    ).toThrow("invalid_columns");
    expect(() =>
      buildViewSource({ name: "active", columns, query: "x", permission: "Stats:Read" }),
    ).toThrow("invalid_permission");
  });
});

describe("view name helpers", () => {
  it("validates the name rule", () => {
    expect(isValidViewName("active_todos")).toBe(true);
    expect(isValidViewName("a" + "x".repeat(62))).toBe(true);
    expect(isValidViewName("a" + "x".repeat(63))).toBe(false);
    expect(isValidViewName("Active")).toBe(false);
    expect(isValidViewName("")).toBe(false);
  });

  it("derives the kebab path stem and the camelCase export", () => {
    expect(viewSlug("active_todos")).toBe("active-todos");
    expect(viewExportName("active_todos")).toBe("activeTodos");
    expect(viewExportName("todos")).toBe("todos");
  });

  it("validates a permission against the declared-name pattern", () => {
    expect(isValidViewPermission("stats:read")).toBe(true);
    expect(isValidViewPermission("reports_daily-2")).toBe(true);
    expect(isValidViewPermission("Stats:Read")).toBe(false);
    expect(isValidViewPermission("1stats")).toBe(false);
    expect(isValidViewPermission("")).toBe(false);
    expect(
      validateViewSourceInput({ name: "active", columns, query: "x", permission: "has space" }),
    ).toBe("invalid_permission");
  });

  it("validates columns as a set of unique JS identifiers", () => {
    expect(validateViewColumns([{ name: "id", pgType: "uuid" }])).toBeNull();
    expect(validateViewColumns([])).toBe("invalid_columns");
    expect(validateViewColumns([{ name: "1id", pgType: "text" }])).toBe("invalid_columns");
    expect(
      validateViewColumns([
        { name: "id", pgType: "uuid" },
        { name: "id", pgType: "uuid" },
      ]),
    ).toBe("invalid_columns");
    expect(validateViewSourceInput({ name: "Bad", columns, query: "x" })).toBe("invalid_name");
  });
});
