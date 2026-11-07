import { describe, expect, it } from "vitest";

import { create, rulesOf, SCHEMA, update, validate } from "./testing/fixtures.ts";

/**
 * New D-092 seams: constructs the old text scanners had to approximate are now AST facts.
 * Each test proves the analyzer fact, not the source wording, drives the rule.
 */

describe("module facts cover every import form", () => {
  it("resolves export-from and dynamic imports (rule 12)", () => {
    const resolvable = `export { api } from "./lib/api";
export const lazy = () => import("./lib/api");
`;
    expect(rulesOf(validate([create("src/feature.ts", resolvable)]).result.errors)).not.toContain(
      "import-resolves",
    );

    const broken = `export * from "./missing";
export const lazy = () => import("./nope");
`;
    const { result } = validate([create("src/feature.ts", broken)]);
    const unresolved = result.errors.filter((entry) => entry.rule === "import-resolves");
    expect(unresolved.map((entry) => entry.message)).toEqual([
      'Import "./missing" does not resolve.',
      'Import "./nope" does not resolve.',
    ]);
  });

  it("sees raw database clients imported dynamically or via require (rule 9)", () => {
    const content = `export const lazy = () => import("pg");
export const legacy = require("@electric-sql/pglite");
`;
    const { result } = validate([create("db/client.ts", content)]);
    expect(rulesOf(result.errors)).toContain("no-raw-db-access");
  });
});

describe("schema facts use Drizzle property names", () => {
  it("warns when the patch drops a column an existing route references (rule 5)", () => {
    const withoutTitle = SCHEMA.replace('    title: text("title").notNull(),\n', "");
    const { result } = validate([update("db/schema.ts", withoutTitle)]);
    const warning = result.warnings.find((entry) => entry.rule === "db-columns-valid");
    expect(warning?.message).toContain("todos.title");
  });
});

describe("translation facts are literal-only", () => {
  it("checks static string and template keys, skips interpolated ones (rule 13)", () => {
    const content = `import { t } from "./lib/i18n";

export const registered = t("app.title");
export const template = t(\`todos.title\`);
export const missing = t(\`missing.template\`);
export const dynamic = t(\`dynamic.\${suffix}\`);
`;
    const { result } = validate([create("src/page.ts", content)]);
    const warnings = result.warnings.filter((entry) => entry.rule === "i18n-keys-registered");
    expect(warnings.map((entry) => entry.message)).toEqual([
      't("missing.template") is not registered in locales/en.json.',
    ]);
  });
});
