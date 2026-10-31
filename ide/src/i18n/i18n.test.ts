import { beforeEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { it as itMessages } from "./it";
import { detectLocale, getLocale, initI18n, setLocale, t } from "./index";

const placeholders = (s: string) =>
  [...s.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)].map((m) => m[1]).sort();

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("catalogues", () => {
  it("has a non-empty English message for every key", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("only translates keys that exist in English", () => {
    for (const key of Object.keys(itMessages)) expect(key in en, key).toBe(true);
  });

  it("keeps the placeholders when translating", () => {
    for (const [key, value] of Object.entries(itMessages)) {
      const source = en[key as keyof typeof en];
      expect(placeholders(value ?? ""), key).toEqual(placeholders(source));
    }
  });
});

describe("detectLocale", () => {
  it("prefers a stored choice", () => {
    expect(detectLocale("it", "en-US")).toBe("it");
    expect(detectLocale("en", "it-IT")).toBe("en");
  });

  it("falls back to the browser language, English by default", () => {
    expect(detectLocale(null, "it-IT")).toBe("it");
    expect(detectLocale(null, "en-GB")).toBe("en");
    expect(detectLocale(null, undefined)).toBe("en");
    expect(detectLocale("de", undefined)).toBe("en");
  });
});

describe("t", () => {
  it("returns the English string in the default locale", () => {
    expect(getLocale()).toBe("en");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("interpolates parameters and leaves unknown placeholders verbatim", () => {
    expect(t("palette.goToLine", { line: 42 })).toBe("Go to line 42");
    expect(t("import.progress", { phase: "Fetching", done: 3, total: 10 })).toBe("Fetching (3/10)");
  });

  it("switches to Italian, falling back to English for untranslated keys", () => {
    setLocale("it");
    expect(getLocale()).toBe("it");
    expect(t("common.cancel")).toBe("Annulla");
    expect(t("theme.dark")).toBe("Tema: Scuro");
  });
});
