import { describe, expect, it } from "vitest";

import { create, rulesOf, SCHEMA, update, validate } from "./testing/fixtures.ts";

const PLAIN = '\nexport const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
const MARKED =
  "\n// system-only: audit trail, reached only through ctx.sudo\n" +
  'export const audit = pgTable("audit", { id: uuid("id").primaryKey() });\n';
const HALF =
  '\nexport const half = pgTable("half", { id: uuid("id").primaryKey() }, () => []).enableRLS();\n';

describe("rule 20 table-class-declared", () => {
  it("rejects a project table without RLS and without a system-only marker", () => {
    const { result } = validate([update("db/schema.ts", SCHEMA + PLAIN)]);
    expect(rulesOf(result.errors)).toContain("table-class-declared");
    expect(result.ok).toBe(false);
    // Rule 10 does not see this table: it has no tenant/owner scope column.
    expect(rulesOf(result.errors)).not.toContain("rls-on-scoped-table");
  });

  it("accepts an explicit system-only marker", () => {
    const { result } = validate([update("db/schema.ts", SCHEMA + MARKED)]);
    expect(rulesOf(result.errors)).not.toContain("table-class-declared");
    expect(rulesOf(result.warnings)).not.toContain("table-class-declared");
    expect(result.ok).toBe(true);
  });

  it("warns, without blocking, on RLS with zero policies", () => {
    const { result } = validate([update("db/schema.ts", SCHEMA + HALF)]);
    expect(rulesOf(result.warnings)).toContain("table-class-declared");
    expect(rulesOf(result.errors)).not.toContain("table-class-declared");
    expect(result.ok).toBe(true);
  });

  it("audits every project table in the re-emitted schema, not only new ones", () => {
    const withoutRls = SCHEMA.replace(").enableRLS();", ");");
    const { result } = validate([update("db/schema.ts", withoutRls)]);
    expect(rulesOf(result.errors)).toContain("table-class-declared");
    expect(rulesOf(result.errors)).toContain("rls-on-scoped-table");
  });

  it("does not fire on patches that leave the schema untouched", () => {
    const { result } = validate([create("src/extra.ts", "export const extra = 1;\n")], {
      sources: { "db/schema.ts": SCHEMA + PLAIN },
    });
    expect(rulesOf(result.errors)).not.toContain("table-class-declared");
    expect(rulesOf(result.warnings)).not.toContain("table-class-declared");
    expect(result.ok).toBe(true);
  });

  it("exempts tables whose declaration lives outside db/schema.ts (re-export surface)", () => {
    const schema = SCHEMA + 'export { audit } from "./system.ts";\n';
    const system =
      'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
      'export const audit = pgTable("audit", { id: uuid("id").primaryKey() });\n';
    const { result } = validate([update("db/schema.ts", schema)], {
      sources: { "db/schema.ts": schema, "db/system.ts": system },
    });
    expect(rulesOf(result.errors)).not.toContain("table-class-declared");
    expect(result.ok).toBe(true);
  });
});
