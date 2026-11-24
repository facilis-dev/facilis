import { describe, expect, it } from "vitest";
import enCatalog from "../../locales/en.json";
import itCatalog from "../../locales/it.json";
import { DEFAULT_LOCALE, initI18n, resolvePreferredLocale, t } from "./i18n.tsx";
import { NAV_ITEMS } from "./navigation.ts";

const CATALOGS: Record<"en" | "it", Record<string, string>> = { en: enCatalog, it: itCatalog };

describe("resolvePreferredLocale", () => {
  it("prefers a stored locale", () => {
    expect(resolvePreferredLocale("it", ["en-US"])).toBe("it");
  });

  it("falls back to the navigator base language", () => {
    expect(resolvePreferredLocale(null, ["fr-FR", "it-IT"])).toBe("it");
  });

  it("returns the default locale when nothing matches", () => {
    expect(resolvePreferredLocale(null, ["fr-FR"], ["en", "it"], DEFAULT_LOCALE)).toBe(
      DEFAULT_LOCALE,
    );
  });
});

describe("catalogues", () => {
  it("ship the same keys in every locale", () => {
    expect(Object.keys(CATALOGS.it).toSorted()).toEqual(Object.keys(CATALOGS.en).toSorted());
  });

  it("translate every navigation key", () => {
    for (const item of NAV_ITEMS) {
      expect(CATALOGS.en[item.key], "en: " + item.key).toBeTypeOf("string");
      expect(CATALOGS.it[item.key], "it: " + item.key).toBeTypeOf("string");
    }
  });
});

describe("t", () => {
  it("returns the key for a missing translation", () => {
    initI18n();
    expect(t("missing.translation")).toBe("missing.translation");
  });

  it("interpolates parameters", () => {
    initI18n();
    expect(t("home.section.count", { count: 4 })).toContain("4");
  });
});
