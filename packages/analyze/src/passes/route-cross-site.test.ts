import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { emptyConfigFacts } from "./config.ts";
import { buildRouteFacts } from "./routes.ts";

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis/core";\n';

function routesOf(config: string, permissions: readonly string[] = []) {
  const graph = createModuleGraph({
    files: new Map([
      [
        "server/routes/x.get.ts",
        CORE_IMPORT + "export default defineAuthorizedHandler(" + config + ", async () => null);",
      ],
    ]),
    parser: createOxcParser(),
  });
  return buildRouteFacts(graph, { ...emptyConfigFacts(), permissions: [...permissions] });
}

const STATIC_READ = "route-config-static";
const CROSS_SITE_AUTHENTICATED = "route-cross-site-authenticated";

describe("route crossSite", () => {
  it("is false when the wrapper does not declare it", () => {
    const { routes, diagnostics } = routesOf("{ permission: [], dbTables: [] }");
    expect(routes[0]?.crossSite).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it("reads a literal true and a literal false", () => {
    const enabled = routesOf("{ permission: [], crossSite: true, dbTables: [] }");
    expect(enabled.routes[0]?.crossSite).toBe(true);
    expect(enabled.diagnostics).toEqual([]);
    const disabled = routesOf("{ permission: [], crossSite: false, dbTables: [] }");
    expect(disabled.routes[0]?.crossSite).toBe(false);
    expect(disabled.diagnostics).toEqual([]);
  });

  it("records an unreadable computed value as null plus an unknown", () => {
    const { routes, diagnostics } = routesOf(
      "{ permission: [], crossSite: computeCrossSite(), dbTables: [] }",
    );
    expect(routes[0]?.crossSite).toBeNull();
    expect(routes[0]?.unknown).toContainEqual(expect.objectContaining({ code: STATIC_READ }));
    expect(diagnostics.map((item) => item.code)).toContain(STATIC_READ);
  });

  it("rejects a non-boolean value as null plus an unknown", () => {
    const { routes, diagnostics } = routesOf('{ permission: [], crossSite: "yes", dbTables: [] }');
    expect(routes[0]?.crossSite).toBeNull();
    expect(routes[0]?.unknown).toContainEqual(expect.objectContaining({ code: STATIC_READ }));
    expect(diagnostics.map((item) => item.code)).toContain(STATIC_READ);
  });

  it("warns when crossSite is true and permission is non-empty", () => {
    const { routes, diagnostics } = routesOf(
      '{ permission: ["todos:read"], crossSite: true, dbTables: [] }',
      ["todos:read"],
    );
    expect(routes[0]?.crossSite).toBe(true);
    // v3a: the combination is legal (Bearer token); only the cookie caveat remains a warning.
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: CROSS_SITE_AUTHENTICATED, severity: "warning" }),
    ]);
  });

  it("does not flag crossSite true when permission is explicitly public", () => {
    const { diagnostics } = routesOf("{ permission: [], crossSite: true, dbTables: [] }");
    expect(diagnostics.map((item) => item.code)).not.toContain(CROSS_SITE_AUTHENTICATED);
  });

  it("leaves crossSite null when the wrapper is invalid", () => {
    const graph = createModuleGraph({
      files: new Map([["server/routes/raw.get.ts", "export default async () => null;\n"]]),
      parser: createOxcParser(),
    });
    const { routes } = buildRouteFacts(graph, emptyConfigFacts());
    expect(routes[0]?.crossSite).toBeNull();
  });
});
