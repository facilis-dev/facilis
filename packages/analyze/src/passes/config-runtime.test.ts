import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildConfigFacts } from "./config.ts";

const HEADER = 'import { defineConfig } from "@facilis.dev/core";\n';

function configFacts(body: string) {
  const graph = createModuleGraph({
    files: new Map([["facilis.config.ts", HEADER + "export default defineConfig(" + body + ");"]]),
    parser: createOxcParser(),
  });
  return buildConfigFacts(graph).facts;
}

describe("readConfigRuntime (D-224)", () => {
  it("distinguishes literals, the secret marker and dynamic values", () => {
    const facts = configFacts(
      '({ runtime: { databaseMode: "pglite", databaseUrl: { secret: true }, logLevel: process.env.LOG_LEVEL } })',
    );
    expect(facts.runtimeConfig.runtime["databaseMode"]).toMatchObject({
      state: "literal",
      value: "pglite",
    });
    expect(facts.runtimeConfig.runtime["databaseUrl"]).toMatchObject({ state: "secret" });
    expect(facts.runtimeConfig.runtime["logLevel"]).toMatchObject({ state: "unknown" });
    expect(facts.runtimeConfig.runtimeUnknown).toBe(false);
  });

  it("reads the public section with the same shape", () => {
    const facts = configFacts('({ public: { appName: "My app" } })');
    expect(facts.runtimeConfig.public["appName"]).toMatchObject({
      state: "literal",
      value: "My app",
    });
  });

  it("marks a spread section unknown and keeps no computed keys", () => {
    const facts = configFacts(
      "({ runtime: { ...base, databaseMode: undefined, logLevel: 'info' } })",
    );
    expect(facts.runtimeConfig.runtimeUnknown).toBe(true);
    expect(facts.runtimeConfig.runtime["databaseMode"]?.state).toBe("unset");
  });

  it("is empty when the sections are absent", () => {
    const facts = configFacts("({ auth: { defaultRole: 'user', roles: { user: [] } } })");
    expect(facts.runtimeConfig.runtime).toEqual({});
    expect(facts.runtimeConfig.public).toEqual({});
    expect(facts.runtimeConfig.runtimeUnknown).toBe(false);
  });
});
