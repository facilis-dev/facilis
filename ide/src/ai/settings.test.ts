import { describe, expect, it } from "vitest";
import {
  AI_SETTINGS_KEY,
  clearAiSettings,
  isConfigured,
  loadAiSettings,
  saveAiSettings,
  type SettingsStorage,
} from "./settings";

function fakeStorage(initial: Record<string, string> = {}): SettingsStorage & {
  value: Map<string, string>;
} {
  const value = new Map(Object.entries(initial));
  return {
    value,
    getItem: (key) => value.get(key) ?? null,
    setItem: (key, next) => {
      value.set(key, next);
    },
    removeItem: (key) => {
      value.delete(key);
    },
  };
}

const settings = {
  providerId: "custom",
  apiKey: "  sk-test  ",
  model: "  my-model ",
  baseUrl: " https://host/v1 ",
};

describe("AI settings persistence", () => {
  it("round-trips and trims every field", () => {
    const storage = fakeStorage();
    saveAiSettings(settings, storage);
    expect(loadAiSettings(storage)).toEqual({
      providerId: "custom",
      apiKey: "sk-test",
      model: "my-model",
      baseUrl: "https://host/v1",
    });
  });

  it("returns null for malformed or unusable entries", () => {
    expect(loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: "not json" }))).toBeNull();
    expect(loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: "[]" }))).toBeNull();
    expect(loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: "{}" }))).toBeNull();
    expect(loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: '{"providerId":""}' }))).toBeNull();
    expect(loadAiSettings(null)).toBeNull();
  });

  it("clears the stored entry", () => {
    const storage = fakeStorage();
    saveAiSettings(settings, storage);
    clearAiSettings(storage);
    expect(storage.value.size).toBe(0);
    expect(loadAiSettings(storage)).toBeNull();
  });

  it("requires a key only when the provider needs one", () => {
    const local = {
      providerId: "custom",
      apiKey: "",
      model: "m",
      baseUrl: "http://localhost:11434/v1",
    };
    expect(isConfigured(local, false)).toBe(true);
    const openai = { providerId: "openai", apiKey: "", model: "gpt-5", baseUrl: "" };
    expect(isConfigured(openai, false)).toBe(false);
    expect(isConfigured({ ...openai, apiKey: "sk" }, false)).toBe(true);
    expect(isConfigured(null, false)).toBe(false);
  });

  it("needs a model and a resolved base URL", () => {
    expect(isConfigured({ providerId: "custom", apiKey: "", model: "", baseUrl: "x" }, false)).toBe(
      false,
    );
    expect(isConfigured({ providerId: "custom", apiKey: "", model: "m", baseUrl: "" }, false)).toBe(
      false,
    );
  });

  it("treats the dev mock as configured without a key", () => {
    const mock = { providerId: "mock", apiKey: "", model: "mock", baseUrl: "" };
    expect(isConfigured(mock, true)).toBe(true);
    expect(isConfigured(mock, false)).toBe(false);
  });
});
