import { describe, expect, it } from "vitest";

import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { loadFixtureProject } from "../test-fixtures/load.ts";

function fixtureGraph() {
  return createModuleGraph({ files: loadFixtureProject(), parser: createOxcParser() });
}

describe("createModuleGraph", () => {
  it("resolves relative imports, aliases and packages", () => {
    const graph = fixtureGraph();
    expect(
      graph.resolve("server/routes/api/todos/index.post.ts", "../../../lib/route-config"),
    ).toBe("server/lib/route-config.ts");
    expect(graph.resolve("server/routes/api/todos/index.get.ts", "~/db/schema.ts")).toBe(
      "db/schema.ts",
    );
    expect(graph.resolve("db/schema.ts", "@facilis.dev/auth")).toBe(
      "node_modules/@facilis.dev/auth/src/index.ts",
    );
  });

  it("resolves re-exported bindings", () => {
    const graph = fixtureGraph();
    expect(graph.resolveExport("db/schema.ts", "users")).toEqual({
      file: "node_modules/@facilis.dev/auth/src/index.ts",
      name: "users",
    });
  });

  it("exposes raw files for JSON readers", () => {
    const graph = fixtureGraph();
    expect(graph.allFiles.has("locales/en.json")).toBe(true);
    expect(graph.readJson("locales/en.json")).toEqual({ "app.title": "Todos" });
  });

  it("collects import and export bindings", () => {
    const graph = fixtureGraph();
    const file = graph.file("server/routes/api/todos/index.get.ts");
    expect(file?.module.imports.map((entry) => entry.local)).toContain("defineAuthorizedHandler");
    const schema = graph.file("db/schema.ts");
    expect(schema?.module.exports.map((entry) => entry.exported)).toContain("todos");
  });
});
