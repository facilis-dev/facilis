import { describe, expect, it } from "vitest";
import enCatalog from "../../locales/en.json";
import itCatalog from "../../locales/it.json";
import { FEATURES, PROCESS_STEPS, PROJECTS, STATS } from "./content.ts";
import { DEFAULT_LOCALE, initI18n, resolvePreferredLocale, t } from "./i18n.tsx";
import { NAV_ITEMS } from "./navigation.ts";

const CATALOGS: Record<"en" | "it", Record<string, string>> = { en: enCatalog, it: itCatalog };

const CONTENT_KEYS = [
  ...NAV_ITEMS.map((item) => item.key),
  ...FEATURES.flatMap((feature) => [feature.titleKey, feature.bodyKey]),
  ...STATS.map((stat) => stat.labelKey),
  ...PROJECTS.flatMap((project) => [project.titleKey, project.categoryKey]),
  ...PROCESS_STEPS.flatMap((step) => [step.titleKey, step.bodyKey]),
];

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

  it("translate every key used by the content data", () => {
    for (const key of CONTENT_KEYS) {
      expect(CATALOGS.en[key], `en: ${key}`).toBeTypeOf("string");
      expect(CATALOGS.it[key], `it: ${key}`).toBeTypeOf("string");
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
    expect(t("showcase.count", { count: 4 })).toContain("4");
  });
});
