import { describe, expect, it } from "vitest";
import { openDeployment, resolveDeployment } from "@/deploy/resolve";
import type { DeploymentInput, ResolvedDeployment } from "@/deploy/types";
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

const MANAGED: DeploymentInput = {
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
};

function managed(ai: DeploymentInput["ai"] = {}): ResolvedDeployment {
  return resolveDeployment({ ...MANAGED, ai });
}

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

describe("deployment policy", () => {
  const byo = managed({ mode: "byo", providers: ["openai"] });
  const gateway = managed({ mode: "gateway", gateway: "https://llm.acme.example/v1" });
  const off = managed();
  const openai = { providerId: "openai", apiKey: "sk", model: "gpt-5", baseUrl: "" };

  it("drops a stored custom base URL when loading a managed build", () => {
    const storage = fakeStorage({
      [AI_SETTINGS_KEY]: JSON.stringify({
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-5",
        baseUrl: "http://localhost:11434/v1",
      }),
    });
    expect(loadAiSettings(storage, byo)).toEqual({
      providerId: "openai",
      apiKey: "sk-test",
      model: "gpt-5",
      baseUrl: "",
    });
  });

  it("never persists a custom base URL in a managed build", () => {
    const storage = fakeStorage();
    saveAiSettings(
      { providerId: "openai", apiKey: "sk", model: "gpt-5", baseUrl: " https://host/v1 " },
      storage,
      byo,
    );
    expect(loadAiSettings(storage, byo)?.baseUrl).toBe("");
  });

  it("keeps the base URL in the open profile", () => {
    const storage = fakeStorage();
    saveAiSettings(settings, storage);
    expect(loadAiSettings(storage, openDeployment())?.baseUrl).toBe("https://host/v1");
  });

  it("resolves a stored provider outside the allowlist as unconfigured", () => {
    const stored = '{"providerId":"anthropic","apiKey":"sk-ant","model":"claude","baseUrl":""}';
    const loaded = loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: stored }), byo);
    // The entry is kept, not erased: the user can see it and pick an allowed provider.
    expect(loaded?.providerId).toBe("anthropic");
    expect(isConfigured(loaded, false, byo)).toBe(false);
    expect(isConfigured(openai, false, byo)).toBe(true);
  });

  it("configures the gateway without a browser-side key", () => {
    const gatewaySettings = { providerId: "gateway", apiKey: "", model: "acme-llm", baseUrl: "" };
    expect(isConfigured(gatewaySettings, false, gateway)).toBe(true);
    expect(isConfigured(openai, false, gateway)).toBe(false);
  });

  it("treats AI off as unconfigured", () => {
    expect(isConfigured(openai, false, off)).toBe(false);
  });
});
