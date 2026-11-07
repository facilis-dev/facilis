import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { readLocaleCatalogs } from "./i18n.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";

function catalogsOf(files: Record<string, string>, root = "") {
  const graph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
    root,
  });
  return readLocaleCatalogs(graph);
}

describe("readLocaleCatalogs", () => {
  it("reads the fixture locales", () => {
    const graph = createModuleGraph({ files: loadFixtureProject(), parser: createOxcParser() });
    const { locales, diagnostics } = readLocaleCatalogs(graph);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(locales)).toEqual(["en", "it"]);
    expect(locales["en"]).toEqual({ "app.title": "Todos" });
    expect(locales["it"]).toEqual({ "app.title": "Attività" });
  });

  it("warns about malformed or non-object catalogs and skips them", () => {
    const { locales, diagnostics } = catalogsOf({
      "locales/en.json": "{ not json",
      "locales/it.json": '["not", "an", "object"]',
      "locales/de.json": '{ "app.title": "Titel" }',
    });
    expect(Object.keys(locales)).toEqual(["de"]);
    expect(diagnostics.map((item) => item.code)).toEqual(["i18n-catalog", "i18n-catalog"]);
  });

  it("ignores nested and non-JSON files and tolerates a missing directory", () => {
    expect(catalogsOf({ "src/index.ts": "export {};" }).locales).toEqual({});
    expect(
      catalogsOf({ "locales/nested/en.json": "{}", "locales/README.md": "x" }).locales,
    ).toEqual({});
  });

  it("resolves locales under a non-empty project root", () => {
    const { locales } = catalogsOf({ "project/locales/en.json": '{ "a": "b" }' }, "project");
    expect(locales).toEqual({ en: { a: "b" } });
  });
});
