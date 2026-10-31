import { describe, expect, it } from "vitest";

import * as i18nDb from "./index.ts";

describe("public server API", () => {
  it("exports the translated-content helpers, the table and the catalogue API", () => {
    expect(i18nDb.translatedText).toBeTypeOf("function");
    expect(i18nDb.translationsSchema).toBeDefined();
    expect(i18nDb.resolveTranslation).toBeTypeOf("function");
    expect(i18nDb.normalizeLocale).toBeTypeOf("function");
    expect(i18nDb.matchLocale).toBeTypeOf("function");
    expect(i18nDb.parseAcceptLanguage).toBeTypeOf("function");
    expect(i18nDb.resolveUserLocale).toBeTypeOf("function");

    expect(i18nDb.i18nMessages).toBeDefined();
    expect(i18nDb.catalogQuery).toBeDefined();
    expect(i18nDb.parseCatalogLocales).toBeTypeOf("function");
    expect(i18nDb.loadCatalog).toBeTypeOf("function");
    expect(i18nDb.loadCatalogs).toBeTypeOf("function");
    expect(i18nDb.saveCatalog).toBeTypeOf("function");
  });

  it("ships no ready-made handler (the project writes the explicit route)", () => {
    expect("i18nCatalogHandler" in i18nDb).toBe(false);
  });
});
