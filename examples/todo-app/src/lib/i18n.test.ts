import { describe, expect, it } from "vitest";
import enCatalog from "../../locales/en.json";
import itCatalog from "../../locales/it.json";
import { resolvePreferredLocale } from "./i18n.tsx";

describe("resolvePreferredLocale", () => {
  it("prefers the stored choice", () => {
    expect(resolvePreferredLocale("it", ["en-US"])).toBe("it");
    expect(resolvePreferredLocale("en", ["it-IT"])).toBe("en");
  });

  it("matches a stored regional tag by base language", () => {
    expect(resolvePreferredLocale("it-CH", [])).toBe("it");
  });

  it("falls back to the first supported navigator language", () => {
    expect(resolvePreferredLocale(null, ["de-DE", "it-CH"])).toBe("it");
    expect(resolvePreferredLocale("fr", ["it"])).toBe("it");
  });

  it("falls back to the default locale", () => {
    expect(resolvePreferredLocale(null, ["de", "fr"])).toBe("en");
    expect(resolvePreferredLocale("", [])).toBe("en");
  });
});

describe("catalogue parity", () => {
  it("ships exactly the same keys in every locale", () => {
    expect(Object.keys(itCatalog).toSorted()).toEqual(Object.keys(enCatalog).toSorted());
  });

  it("has no blank values", () => {
    for (const [key, value] of Object.entries(enCatalog)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(itCatalog)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });
});
