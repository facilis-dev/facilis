import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";
import { buildFileFacts } from "./file-facts.ts";
import { dynamicTranslationKeyDiagnostics, I18N_DYNAMIC_KEY_CODE } from "./i18n-keys.ts";

function factsOf(files: Record<string, string>) {
  const graph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
  });
  return buildFileFacts(graph);
}

function diagnosticsOf(files: Record<string, string>) {
  return dynamicTranslationKeyDiagnostics(factsOf(files));
}

describe("dynamicTranslationKeyDiagnostics", () => {
  it("warns once per non-literal t() argument", () => {
    const diagnostics = diagnosticsOf({
      "src/page.ts":
        'export const a = t("static.key");\n' +
        "export const b = t(`static.template`);\n" +
        "export const c = t(key);\n" +
        'export const d = t("prefix." + suffix);\n' +
        "export const e = t(`key.${suffix}`);\n" +
        "export const f = t(label());\n" +
        "export const g = t();\n",
    });
    expect(diagnostics).toHaveLength(5);
    expect(new Set(diagnostics.map((entry) => entry.code))).toEqual(
      new Set([I18N_DYNAMIC_KEY_CODE]),
    );
    expect(new Set(diagnostics.map((entry) => entry.severity))).toEqual(new Set(["warning"]));
    expect(diagnostics.map((entry) => entry.source?.line)).toEqual([3, 4, 5, 6, 7]);
  });

  it("is silent on literal strings and expression-free templates", () => {
    expect(
      diagnosticsOf({
        "src/page.ts": 'export const a = t("a");\nexport const b = t(`b`);\n',
      }),
    ).toEqual([]);
  });

  it("covers the fixture project's three dynamic calls", () => {
    const graph = createModuleGraph({
      files: loadFixtureProject(),
      parser: createOxcParser(),
    });
    const diagnostics = dynamicTranslationKeyDiagnostics(buildFileFacts(graph));
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((entry) => entry.source?.file)).toEqual([
      "src/lib/i18n.ts",
      "src/lib/i18n.ts",
      "src/lib/i18n.ts",
    ]);
  });
});
