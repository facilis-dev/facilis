import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDefaultLocale,
  registerCatalog,
  setDefaultLocale,
  setMissingTranslationHandler,
  t,
} from "./i18n.ts";

beforeEach(() => {
  registerCatalog("en", {
    "app.name": "Facilis",
    "todos.count": "{count} todos for {name}",
    "todos.empty": "No todos yet",
  });
  setDefaultLocale("en");
  setMissingTranslationHandler(null);
});

afterEach(() => {
  setMissingTranslationHandler(null);
});

describe("t", () => {
  it("returns the translated string for a flat key", () => {
    expect(t("todos.empty")).toBe("No todos yet");
  });

  it("interpolates params and repeats placeholders", () => {
    expect(t("todos.count", { count: 3, name: "Ada" })).toBe("3 todos for Ada");
    expect(t("todos.count", { count: 0, name: "Ada" })).toBe("0 todos for Ada");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("todos.count", { count: 1 })).toBe("1 todos for {name}");
  });

  it("returns the key for a missing translation without throwing", () => {
    expect(t("missing.key")).toBe("missing.key");
  });

  it("reports missing keys through the injected collector only", () => {
    const collector = vi.fn();
    setMissingTranslationHandler(collector);

    expect(t("missing.key")).toBe("missing.key");
    expect(collector).toHaveBeenCalledTimes(1);
    expect(collector).toHaveBeenCalledWith("missing.key", "en");
  });

  it("uses the selected default locale", () => {
    registerCatalog("fr", { "todos.empty": "Aucune tâche" });
    setDefaultLocale("fr");

    expect(getDefaultLocale()).toBe("fr");
    expect(t("todos.empty")).toBe("Aucune tâche");
    // The English catalogue is not a cross-locale fallback: the key itself is returned.
    expect(t("app.name")).toBe("app.name");
  });

  it("replaces a previously registered catalogue for the same locale", () => {
    registerCatalog("en", { "app.name": "Renamed" });
    expect(t("app.name")).toBe("Renamed");
    expect(t("todos.empty")).toBe("todos.empty");
  });
});
