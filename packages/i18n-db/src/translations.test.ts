import { describe, expect, it } from "vitest";

import {
  matchLocale,
  normalizeLocale,
  parseAcceptLanguage,
  resolveTranslation,
  resolveUserLocale,
  translationsSchema,
  type Translations,
} from "./translations.ts";

describe("normalizeLocale", () => {
  it("canonicalizes case and subtags", () => {
    expect(normalizeLocale("it-ch")).toBe("it-CH");
    expect(normalizeLocale(" EN ")).toBe("en");
  });

  it("returns null for invalid tags", () => {
    expect(normalizeLocale("not a locale!")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
  });
});

describe("matchLocale", () => {
  const supported = ["en", "it", "pt-BR"];

  it("matches exactly and case-insensitively", () => {
    expect(matchLocale("IT", supported, "en")).toBe("it");
    expect(matchLocale("pt-br", supported, "en")).toBe("pt-BR");
  });

  it("falls back to the base language", () => {
    expect(matchLocale("it-CH", supported, "en")).toBe("it");
  });

  it("falls back to any supported variant of the language", () => {
    expect(matchLocale("pt-PT", supported, "en")).toBe("pt-BR");
  });

  it("returns the fallback for missing, invalid or unsupported tags", () => {
    expect(matchLocale(undefined, supported, "en")).toBe("en");
    expect(matchLocale("fr", supported, "en")).toBe("en");
    expect(matchLocale("not a locale!", supported, "en")).toBe("en");
  });
});

describe("parseAcceptLanguage", () => {
  it("orders tags by q descending", () => {
    expect(parseAcceptLanguage("en;q=0.5, it;q=0.9, de")).toEqual(["de", "it", "en"]);
  });

  it("skips wildcards and q=0, and canonicalizes the rest", () => {
    expect(parseAcceptLanguage("it-ch, *;q=0.9, de;q=0, fr;q=0.3")).toEqual(["it-CH", "fr"]);
  });

  it("handles missing and blank headers", () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage("   ")).toEqual([]);
  });

  it("keeps declaration order for equal q and dedupes", () => {
    expect(parseAcceptLanguage("en, it, en;q=0.8")).toEqual(["en", "it"]);
  });

  it("drops malformed tags", () => {
    expect(parseAcceptLanguage("not a locale!, it")).toEqual(["it"]);
  });
});

describe("resolveUserLocale", () => {
  const supported = ["en", "it", "pt-BR"];

  it("prefers the saved preference over the header", () => {
    expect(resolveUserLocale({ userLocale: "it", acceptLanguage: "pt-BR", supported })).toBe("it");
  });

  it("uses Accept-Language when the preference is missing or unsupported", () => {
    expect(resolveUserLocale({ acceptLanguage: "pt-br, it;q=0.5", supported })).toBe("pt-BR");
    expect(resolveUserLocale({ userLocale: "fr", acceptLanguage: "it", supported })).toBe("it");
  });

  it("matches the base language and filters through supported", () => {
    expect(resolveUserLocale({ userLocale: "it-CH", supported })).toBe("it");
  });

  it("falls back to the default locale", () => {
    expect(resolveUserLocale({ supported })).toBe("en");
    expect(resolveUserLocale({ acceptLanguage: "fr", supported })).toBe("en");
    expect(resolveUserLocale({})).toBe("en");
  });

  it("normalizes the resolved locale", () => {
    expect(resolveUserLocale({ userLocale: "IT-ch" })).toBe("it-CH");
  });

  it("honours a custom default locale", () => {
    expect(resolveUserLocale({ acceptLanguage: "fr", supported, defaultLocale: "it" })).toBe("it");
  });
});

describe("resolveTranslation", () => {
  const value = { en: "Todo", it: "Da fare", "it-CH": "Fare (CH)", "pt-BR": "A fazer" };

  it("returns the exact locale", () => {
    expect(resolveTranslation(value, "it-CH")).toBe("Fare (CH)");
  });

  it("matches case-insensitively and by base language", () => {
    expect(resolveTranslation(value, "IT")).toBe("Da fare");
    expect(resolveTranslation({ en: "Todo", it: "Da fare" }, "it-IT")).toBe("Da fare");
  });

  it("falls back to the fallback locale", () => {
    expect(resolveTranslation(value, "fr")).toBe("Todo");
    expect(resolveTranslation(value, "fr", "it")).toBe("Da fare");
    expect(resolveTranslation({ it: "", en: "Todo" }, "it")).toBe("Todo");
  });

  it("returns the first present value when locale and fallback have no entry", () => {
    expect(resolveTranslation({ fr: "À faire", de: "Zu tun" }, "it")).toBe("À faire");
  });

  it("returns an empty string for missing, empty or malformed values", () => {
    expect(resolveTranslation(undefined, "it")).toBe("");
    expect(resolveTranslation(null, "it")).toBe("");
    expect(resolveTranslation({}, "it")).toBe("");
    expect(resolveTranslation({ en: "" }, "it")).toBe("");
    expect(resolveTranslation("garbage" as unknown as Translations, "it")).toBe("");
    expect(resolveTranslation([] as unknown as Translations, "it")).toBe("");
  });
});

describe("translationsSchema", () => {
  it("accepts a valid translations map", () => {
    expect(translationsSchema.parse({ en: "Todo", it: "Da fare" })).toEqual({
      en: "Todo",
      it: "Da fare",
    });
  });

  it("accepts an empty map", () => {
    expect(translationsSchema.parse({})).toEqual({});
  });

  it("rejects empty values", () => {
    expect(translationsSchema.safeParse({ en: "" }).success).toBe(false);
  });

  it("rejects keys that are not locale tags", () => {
    expect(translationsSchema.safeParse({ "not a locale!": "Todo" }).success).toBe(false);
  });

  it("rejects non-string values and non-objects", () => {
    expect(translationsSchema.safeParse({ en: 1 }).success).toBe(false);
    expect(translationsSchema.safeParse(null).success).toBe(false);
  });
});
