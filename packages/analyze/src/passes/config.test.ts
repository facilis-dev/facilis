import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildConfigFacts } from "./config.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";

function graphOf(files: Record<string, string>) {
  return createModuleGraph({ files: new Map(Object.entries(files)), parser: createOxcParser() });
}

function fixtureConfig() {
  const graph = createModuleGraph({
    files: loadFixtureProject(),
    parser: createOxcParser(),
  });
  return buildConfigFacts(graph);
}

const HEADER = 'import { defineConfig } from "@facilis.dev/core";\n';

describe("buildConfigFacts", () => {
  it("reads the fixture config without diagnostics", () => {
    const { facts, diagnostics } = fixtureConfig();
    expect(diagnostics).toEqual([]);
    expect(facts.parsed).toBe(true);
    expect(facts.source?.file).toBe("facilis.config.ts");
    expect(facts.permissions).toEqual(["todos:read", "todos:write"]);
    expect(facts.roles).toEqual({
      admin: ["*"],
      user: ["todos:read", "todos:write"],
    });
    expect(facts.defaultRole).toBe("user");
    expect(facts.defaultLocale).toBe("en");
    expect(facts.locales).toEqual(["en", "it"]);
    expect(facts.migrationsDir).toBe("db/migrations");
    expect(facts.tenantColumns).toEqual(["tenantId"]);
    expect(facts.ownerColumns).toEqual(["ownerId"]);
    expect(facts.unknown).toEqual([]);
  });

  it("applies the @facilis.dev/core defaults when sections are absent", () => {
    const { facts, diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          HEADER +
          'export default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } } });',
      }),
    );
    expect(diagnostics).toEqual([]);
    expect(facts.migrationsDir).toBe("./drizzle");
    expect(facts.tenantColumns).toEqual(["tenantId"]);
    expect(facts.ownerColumns).toEqual(["ownerId"]);
    expect(facts.defaultLocale).toBe("en");
    expect(facts.locales).toEqual(["en"]);
    expect(facts.permissions).toEqual([]);
  });

  it("keeps statically readable siblings of a computed field", () => {
    const { facts, diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          HEADER +
          'const config = { i18n: { defaultLocale: process.env.LOCALE, locales: ["en", "it"] }, auth: { permissions: ["todos:read"], roles: { user: ["todos:read"] }, defaultRole: "user" } };\n' +
          "export default defineConfig(config);",
      }),
    );
    expect(facts.defaultLocale).toBe("en");
    expect(facts.locales).toEqual(["en", "it"]);
    expect(facts.unknown).toHaveLength(1);
    expect(facts.unknown[0]?.code).toBe("config-static");
    expect(diagnostics.map((item) => item.code)).toEqual(["config-static"]);
  });

  it("accepts the aliased core defineConfig import", () => {
    const { facts, diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          'import { defineConfig as createConfig } from "@facilis.dev/core";\n' +
          'export default createConfig({ auth: { defaultRole: "user", roles: { user: [] } } });',
      }),
    );
    expect(diagnostics).toEqual([]);
    expect(facts.parsed).toBe(true);
    expect(facts.defaultRole).toBe("user");
  });

  it("rejects a defineConfig that is not the core import", () => {
    const { facts, diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          'import { defineConfig } from "somewhere-else";\nexport default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } } });',
      }),
    );
    expect(facts.parsed).toBe(false);
    expect(diagnostics.map((item) => item.code)).toEqual(["config-static"]);
  });

  it("rejects a locally shadowed defineConfig", () => {
    const { facts, diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          "function defineConfig(value: unknown): unknown { return value; }\n" +
          'export default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } } });',
      }),
    );
    expect(facts.parsed).toBe(false);
    expect(diagnostics[0]?.code).toBe("config-static");
    expect(diagnostics[0]?.message).toContain("shadowed");
  });

  it("reports a missing config file", () => {
    const { facts, diagnostics } = buildConfigFacts(graphOf({ "src/index.ts": "export {};" }));
    expect(facts.parsed).toBe(false);
    expect(diagnostics.map((item) => item.code)).toEqual(["config-missing"]);
    expect(facts.migrationsDir).toBe("./drizzle");
  });

  it("validates permissions, roles and the default locale", () => {
    const { diagnostics } = buildConfigFacts(
      graphOf({
        "facilis.config.ts":
          HEADER +
          "export default defineConfig({\n" +
          '  i18n: { defaultLocale: "fr", locales: ["en"] },\n' +
          '  auth: { permissions: ["todos:read", "todos:read"], roles: { admin: ["todos:write", "todos:read", "todos:read"] }, defaultRole: "guest" },\n' +
          "});",
      }),
    );
    expect(diagnostics.every((item) => item.code === "config-invalid")).toBe(true);
    expect(diagnostics).toHaveLength(5);
  });
});
