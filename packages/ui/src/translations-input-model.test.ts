import { describe, expect, it } from "vitest";
import {
  addableLocales,
  addLocale,
  defaultLocaleOf,
  isFilled,
  orderedLocales,
  removeLocale,
  resolveActiveLocale,
} from "./translations-input-model.ts";

describe("orderedLocales", () => {
  it("puts configured locales first, then added ones, then extra value keys sorted", () => {
    expect(orderedLocales({ en: "Hello", es: "", it: "" }, ["en", "it"], ["fr"])).toEqual([
      "en",
      "it",
      "fr",
      "es",
    ]);
  });

  it("deduplicates and ignores blank keys", () => {
    expect(orderedLocales({ en: "Hello" }, ["en", ""], ["en"])).toEqual(["en"]);
  });
});

describe("default and active locale", () => {
  it("prefers the configured default and falls back to the first", () => {
    expect(defaultLocaleOf(["en", "it"], "it")).toBe("it");
    expect(defaultLocaleOf(["en", "it"], "fr")).toBe("en");
    expect(defaultLocaleOf([], "en")).toBeUndefined();
  });

  it("keeps the active locale while present and otherwise falls back", () => {
    expect(resolveActiveLocale("it", ["en", "it"], "en")).toBe("it");
    expect(resolveActiveLocale("fr", ["en", "it"], "en")).toBe("en");
    expect(resolveActiveLocale(undefined, ["en", "it"], "it")).toBe("it");
  });
});

describe("value helpers", () => {
  it("checks filled text ignoring whitespace", () => {
    const value = { en: "Hello", it: "   " };
    expect(isFilled(value, "en")).toBe(true);
    expect(isFilled(value, "it")).toBe(false);
    expect(isFilled(value, "es")).toBe(false);
  });

  it("adds a locale without overwriting and removes it again", () => {
    const value = { en: "Hello" };
    const added = addLocale(value, "it");
    expect(added).toEqual({ en: "Hello", it: "" });
    expect(addLocale(added, "it")).toBe(added);
    expect(removeLocale(added, "it")).toEqual({ en: "Hello" });
  });

  it("lists addable locales from the available set", () => {
    expect(addableLocales(["en", "it", "es", "es"], ["en", "it"])).toEqual(["es"]);
    expect(addableLocales(undefined, ["en"])).toEqual([]);
  });
});
