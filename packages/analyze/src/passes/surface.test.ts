import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createOxcParser } from "../node.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';

function analyze(files: Record<string, string>) {
  return analyzeProject({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
  });
}

function codes(files: Record<string, string>): string[] {
  return analyze(files).diagnostics.map((entry) => entry.code);
}

function authorizedRoute(
  config = "permission: [], dbTables: []",
  body = "async () => ({})",
): string {
  return CORE + "export default defineAuthorizedHandler({ " + config + " }, " + body + ");\n";
}

describe("declared security surface (D-226)", () => {
  it("classifies an authorized route as standard", () => {
    const analysis = analyze({ "server/api/x.get.ts": authorizedRoute() });
    expect(analysis.routes[0]?.surface.class).toBe("standard");
    expect(analysis.routes[0]?.surface.declarations).toEqual([]);
    expect(analysis.routes[0]?.auth).toBe("none");
  });

  it("accepts a declared raw route with auth none", () => {
    const source =
      'import { defineRawRoute } from "@facilis.dev/core";\n' +
      'export default defineRawRoute({ reason: "signed webhook", auth: "none" }, async (_event, { rawDb }) => rawDb({ reason: "upsert" }));\n';
    const analysis = analyze({ "server/api/hooks.post.ts": source });
    const route = analysis.routes[0];
    expect(route?.wrapper).toBe("valid");
    expect(route?.surface.class).toBe("declared");
    expect(route?.auth).toBe("none");
    expect(route?.surface.declarations.map((entry) => entry.kind).toSorted()).toEqual([
      "raw-db",
      "raw-route",
    ]);
  });

  it("rejects a raw route without a reason and one without auth", () => {
    const noReason =
      'import { defineRawRoute } from "@facilis.dev/core";\n' +
      'export default defineRawRoute({ auth: "none" }, async () => ({}));\n';
    expect(analyze({ "server/api/a.get.ts": noReason }).routes[0]?.surface.class).toBe(
      "undeclared",
    );
    const noAuth =
      'import { defineRawRoute } from "@facilis.dev/core";\n' +
      'export default defineRawRoute({ reason: "x" }, async () => ({}));\n';
    expect(analyze({ "server/api/b.get.ts": noAuth }).routes[0]?.surface.class).toBe("undeclared");
  });

  it("treats rawSql: true as undeclared and rawSql: { reason } as declared", () => {
    const legacy = analyze({
      "server/api/x.get.ts": authorizedRoute("permission: [], dbTables: [], rawSql: true"),
    });
    expect(legacy.routes[0]?.surface.class).toBe("undeclared");
    expect(legacy.diagnostics.some((entry) => entry.code === "surface-undeclared")).toBe(true);

    const declared = analyze({
      "server/api/x.get.ts": authorizedRoute(
        'permission: [], dbTables: [], rawSql: { reason: "computed index" }',
      ),
    });
    expect(declared.routes[0]?.surface.class).toBe("declared");
    expect(declared.routes[0]?.surface.rawSqlReason).toBe("computed index");
  });

  it("classifies ctx.rawDb with and without a reason", () => {
    const declared = analyze({
      "server/api/x.get.ts": authorizedRoute(
        "permission: [], dbTables: []",
        'async (_event, ctx) => ctx.rawDb({ reason: "dynamic report" })',
      ),
    });
    expect(declared.routes[0]?.surface.class).toBe("declared");
    const missing = analyze({
      "server/api/x.get.ts": authorizedRoute(
        "permission: [], dbTables: []",
        "async (_event, ctx) => ctx.rawDb({})",
      ),
    });
    expect(missing.routes[0]?.surface.class).toBe("undeclared");
  });

  it("declares server extensions and rejects a bare plugin", () => {
    const declared = analyze({
      "server/plugins/ids.ts":
        'import { defineServerExtension } from "@facilis.dev/core";\n' +
        'export default defineServerExtension({ reason: "request id" }, () => {});\n',
    });
    expect(declared.surface.extensions[0]?.surface.class).toBe("declared");

    const bare = analyze({ "server/plugins/extra.ts": "export default () => {};\n" });
    expect(bare.surface.extensions[0]?.surface.class).toBe("undeclared");
    expect(bare.diagnostics.some((entry) => entry.code === "surface-undeclared")).toBe(true);
  });

  it("reports forbidden db imports and dynamic code", () => {
    const forbidden = analyze({
      "server/api/x.get.ts":
        CORE +
        'import { createDb } from "@facilis.dev/db";\n' +
        "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => createDb());\n",
    });
    expect(forbidden.surface.forbiddenImports[0]?.imported).toBe("createDb");

    const blocked = analyze({
      "lib/eval.ts": "export const run = (code: string) => eval(code);\n",
    });
    expect(blocked.surface.dynamicCode[0]?.surface.class).toBe("undeclared");
    expect(
      codes({ "lib/eval.ts": "export const run = (code: string) => eval(code);\n" }),
    ).toContain("surface-undeclared");

    const declared = analyze({
      "lib/eval.ts":
        "// dynamic-code: template sandbox\nexport const run = (code: string) => eval(code);\n",
    });
    expect(declared.surface.dynamicCode[0]?.surface.class).toBe("declared");
  });

  it("counts every class in the summary", () => {
    const analysis = analyze({
      "server/api/a.get.ts": authorizedRoute(),
      "server/api/b.get.ts":
        'import { defineRawRoute } from "@facilis.dev/core";\n' +
        'export default defineRawRoute({ reason: "hook", auth: "none" }, async () => ({}));\n',
      "server/api/c.get.ts":
        'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
        "export default defineAuthorizedHandler({ permission: [], dbTables: [], rawSql: true }, async () => ({}));\n",
    });
    expect(analysis.surface.summary).toMatchObject({
      standard: 1,
      declared: 1,
      undeclared: 1,
      unknown: 0,
    });
  });
});
