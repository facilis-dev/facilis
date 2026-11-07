import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { buildFileFacts } from "./file-facts.ts";
import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";

function fixtureFacts() {
  const graph = createModuleGraph({ files: loadFixtureProject(), parser: createOxcParser() });
  return buildFileFacts(graph);
}

function factsOf(files: Record<string, string>) {
  const graph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
  });
  return buildFileFacts(graph);
}

describe("buildFileFacts", () => {
  it("reads static imports with their local binding and line", () => {
    const page = fixtureFacts().find((file) => file.path === "src/pages/todos.tsx");
    expect(page?.imports).toMatchObject([
      {
        specifier: "../lib/api.ts",
        kind: "named",
        local: "api",
        imported: "api",
        source: { line: 1 },
      },
      {
        specifier: "../lib/todos.ts",
        kind: "named",
        local: "todoPath",
        imported: "todoPath",
        source: { line: 2 },
      },
    ]);
  });

  it("covers side-effect, re-export, dynamic import and require forms", () => {
    const [file] = factsOf({
      "src/lib/loader.ts":
        'import "./side-effect.ts";\n' +
        'export * from "./re-export.ts";\n' +
        'const a = import("./dynamic.ts");\n' +
        'const b = require("./cjs.cjs");\n',
    });
    expect(file?.imports.map((entry) => entry.kind).toSorted()).toEqual([
      "dynamic",
      "export-from",
      "require",
      "side-effect",
    ]);
  });

  it("reads literal t() keys and skips interpolated ones", () => {
    const i18n = fixtureFacts().find((file) => file.path === "src/lib/i18n.ts");
    expect(i18n?.translationCalls.map((call) => call.key)).toEqual(["todos.title", "todos.empty"]);
    expect(i18n?.calls.filter((call) => call.name === "t")).toHaveLength(5);
  });

  it("returns one entry per parsed source file in path order", () => {
    const paths = fixtureFacts().map((file) => file.path);
    expect(paths).toContain("server/routes/api/todos/index.get.ts");
    expect(paths).toContain("src/lib/api.ts");
    expect(paths).toEqual([...paths].toSorted((left, right) => left.localeCompare(right)));
  });

  it("exposes the facts on the analysis", () => {
    const analysis = analyzeProject({ files: loadFixtureProject(), parser: createOxcParser() });
    expect(analysis.fileFacts).toHaveLength(analysis.files.length);
  });
});
