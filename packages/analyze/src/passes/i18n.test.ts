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

  it("warns once per key missing from a secondary catalogue", () => {
    const { diagnostics } = catalogsOf({
      "locales/en.json": '{ "a": "A", "b": "B" }',
      "locales/it.json": '{ "a": "A" }',
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "i18n-locale-parity",
      severity: "warning",
      source: { file: "locales/it.json", line: 1 },
    });
    expect(diagnostics[0]?.message).toBe(
      'locale key "b" is in locales/en.json but missing from locales/it.json.',
    );
  });

  it("warns once per key a secondary catalogue has but the default lacks", () => {
    const { diagnostics } = catalogsOf({
      "locales/en.json": '{ "a": "A" }',
      "locales/it.json": '{ "a": "A", "b": "B" }',
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.source).toEqual({ file: "locales/en.json", line: 1 });
    expect(diagnostics[0]?.message).toBe(
      'locale key "b" is in locales/it.json but missing from locales/en.json.',
    );
  });

  it("skips malformed catalogues in parity and keeps their own warning", () => {
    const { diagnostics } = catalogsOf({
      "locales/en.json": '{ "a": "A" }',
      "locales/it.json": "{ not json",
      "locales/de.json": '{ "a": "A" }',
    });
    expect(diagnostics.map((item) => item.code)).toEqual(["i18n-catalog"]);
  });

  it("does not compare against a missing or malformed default catalogue", () => {
    expect(
      catalogsOf({ "locales/it.json": '{ "a": "A" }' }).diagnostics.map((item) => item.code),
    ).toEqual([]);
    expect(
      catalogsOf({
        "locales/en.json": "{ not json",
        "locales/it.json": '{ "a": "A" }',
      }).diagnostics.map((item) => item.code),
    ).toEqual(["i18n-catalog"]);
  });

  it("orders parity warnings deterministically across secondary locales", () => {
    const first = catalogsOf({
      "locales/en.json": '{ "a": "A", "b": "B" }',
      "locales/it.json": '{ "a": "A" }',
      "locales/de.json": '{ "b": "B", "c": "C" }',
    });
    const second = catalogsOf({
      "locales/de.json": '{ "b": "B", "c": "C" }',
      "locales/it.json": '{ "a": "A" }',
      "locales/en.json": '{ "a": "A", "b": "B" }',
    });
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.diagnostics.map((item) => item.source?.file)).toEqual([
      "locales/de.json",
      "locales/en.json",
      "locales/it.json",
    ]);
  });
});
