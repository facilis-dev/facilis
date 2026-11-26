import { describe, expect, it } from "vitest";

import { create, update, validate } from "./testing/fixtures.ts";

function i18nWarnings(
  patches: Parameters<typeof validate>[0],
  options?: Parameters<typeof validate>[1],
) {
  return validate(patches, options).result.warnings.filter(
    (entry) => entry.rule === "i18n-keys-registered",
  );
}

describe("rule 13 i18n-keys-registered dynamic keys (D-218)", () => {
  it("warns once per non-literal t() call in a patched file", () => {
    const content = `export const a = t(key);
export const b = t("app." + suffix);
export const c = t(\`dynamic.\${suffix}\`);
export const d = t(label());
`;
    const warnings = i18nWarnings([create("src/page.ts", content)]);
    expect(warnings.map((entry) => entry.message)).toEqual([
      "A t() call uses a non-literal key, so it cannot be verified against locales/en.json.",
      "A t() call uses a non-literal key, so it cannot be verified against locales/en.json.",
      "A t() call uses a non-literal key, so it cannot be verified against locales/en.json.",
      "A t() call uses a non-literal key, so it cannot be verified against locales/en.json.",
    ]);
    expect(warnings.map((entry) => entry.line)).toEqual([1, 2, 3, 4]);
    expect(new Set(warnings.map((entry) => entry.severity))).toEqual(new Set(["warning"]));
  });

  it("passes registered literal keys and expression-free templates", () => {
    const content = `export const a = t("app.title");
export const b = t(\`todos.title\`);
`;
    expect(i18nWarnings([create("src/page.ts", content)])).toEqual([]);
  });
});

describe("rule 13 i18n-keys-registered locale parity (D-218)", () => {
  it("warns once per key missing from a secondary catalogue", () => {
    const warnings = i18nWarnings([create("src/page.ts", "export const a = 1;\n")], {
      sources: { "locales/it.json": '{ "app.title": "Facilis todos" }' },
    });
    expect(warnings.map((entry) => entry.message)).toEqual([
      'locale key "todos.title" is in locales/en.json but missing from locales/it.json.',
    ]);
    expect(warnings[0]?.file).toBe("locales/it.json");
  });

  it("warns once per key a secondary catalogue has but the default lacks", () => {
    const warnings = i18nWarnings([create("src/page.ts", "export const a = 1;\n")], {
      sources: { "locales/it.json": '{ "app.title": "T", "todos.title": "T", "extra.it": "X" }' },
    });
    expect(warnings.map((entry) => entry.message)).toEqual([
      'locale key "extra.it" is in locales/it.json but missing from locales/en.json.',
    ]);
    expect(warnings[0]?.file).toBe("locales/en.json");
  });

  it("checks the effective post-patch catalogues, not the pre-patch ones", () => {
    const en = JSON.stringify({
      "app.title": "Facilis todos",
      "todos.title": "Todos",
      "new.key": "New",
    });
    const warnings = i18nWarnings([update("locales/en.json", en)]);
    expect(warnings.map((entry) => entry.message)).toEqual([
      'locale key "new.key" is in locales/en.json but missing from locales/it.json.',
    ]);
  });

  it("keeps one warning for a malformed catalogue and adds no parity noise", () => {
    const warnings = i18nWarnings([update("locales/en.json", "{ not json")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("not a valid JSON catalogue");
  });
});
